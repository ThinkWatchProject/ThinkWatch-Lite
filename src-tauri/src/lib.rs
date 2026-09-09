//! ThinkWatch Lite 的 UI 侧。
//!
//! 它做三件事：起 core 并看着它、把控制面的数据搬给前端、以及在 core
//! 挂掉时悄悄修好。用户眼里这一切和 core 是**同一个程序**（§2.2.1）。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub mod autostart;
pub mod control;
pub mod menubar;
pub mod shellpath;
pub mod supervisor;

use control::ControlClient;
use supervisor::{CoreState, Supervisor};

pub struct AppState {
    pub control: ControlClient,
    pub core_state: Arc<tokio::sync::Mutex<CoreState>>,
    pub supervisor: Arc<Supervisor>,
}

/// twcore 在哪。
///
/// 开发时它在 core 仓库的 target 里；打包后它在 app bundle 的
/// Resources 下。**两条路径都要试，而且找不到时要说清楚找过哪儿** ——
/// 「二进制不存在」是安装期最常见的失败，而默认的错误信息只会说
/// No such file or directory。
pub fn locate_core(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    let mut tried = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = resource_dir.join("twcore");
        if p.exists() {
            return Ok(p);
        }
        tried.push(p);
    }

    // 开发时：core 是隔壁仓库
    if let Some(home) = std::env::var_os("HOME") {
        for profile in ["release", "debug"] {
            let p = PathBuf::from(&home)
                .join("Dev/thinkwatch-core/target")
                .join(profile)
                .join("twcore");
            if p.exists() {
                return Ok(p);
            }
            tried.push(p);
        }
    }

    anyhow::bail!(
        "找不到 twcore。找过这些位置：\n{}",
        tried
            .iter()
            .map(|p| format!("  · {}", p.display()))
            .collect::<Vec<_>>()
            .join("\n")
    )
}

#[tauri::command]
async fn core_status(state: tauri::State<'_, AppState>) -> Result<tw_api::Status, String> {
    // Tauri 的 invoke 用**字符串** reject，不是 Error 对象（§9.7）——
    // 前端 `e instanceof Error` 永远是 false。所以这里返回 String，
    // 前端那边也按字符串处理。
    state.control.status().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn core_state(state: tauri::State<'_, AppState>) -> Result<String, String> {
    let s = state.core_state.lock().await;
    Ok(match &*s {
        CoreState::Starting => "starting".into(),
        CoreState::Running { pid } => format!("running:{pid}"),
        CoreState::Restarting { attempt, in_ms } => format!("restarting:{attempt}:{in_ms}"),
        CoreState::SafeMode => "safe_mode".into(),
        CoreState::Stopped => "stopped".into(),
    })
}

#[tauri::command]
async fn overview(state: tauri::State<'_, AppState>) -> Result<tw_api::Overview, String> {
    state.control.overview().await.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn probe_upstream(
    state: tauri::State<'_, AppState>,
    base_url: String,
    key: String,
) -> Result<tw_api::ProbeResponse, String> {
    state
        .control
        .probe(&base_url, &key)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// L1 测速。零成本，所以不需要任何确认 —— L3 才需要（§4.6）。
#[tauri::command]
async fn speed_test(
    state: tauri::State<'_, AppState>,
    provider: Option<String>,
    proxy: Option<String>,
) -> Result<Vec<tw_api::L1Result>, String> {
    state
        .control
        .l1(tw_api::L1Request {
            provider,
            proxy,
            base_url: None,
        })
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn get_config(state: tauri::State<'_, AppState>) -> Result<tw_api::ConfigText, String> {
    state.control.config().await.map_err(|e| format!("{e:#}"))
}

/// 改一个字段。**总是带 `base_version`** —— 用户在编辑器里改了什么，
/// 界面无从知道（§3.8）。
#[tauri::command]
async fn patch_config(
    state: tauri::State<'_, AppState>,
    ops: Vec<tw_api::PatchOp>,
    base_version: String,
) -> Result<tw_api::ConfigWritten, String> {
    state
        .control
        .patch_config(ops, base_version)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn put_config(
    state: tauri::State<'_, AppState>,
    text: String,
    base_version: String,
) -> Result<tw_api::ConfigWritten, String> {
    state
        .control
        .put_config(text, base_version)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn config_history(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<tw_api::ConfigVersion>, String> {
    state
        .control
        .config_history()
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn rollback_config(
    state: tauri::State<'_, AppState>,
    version: String,
) -> Result<tw_api::ConfigWritten, String> {
    state
        .control
        .rollback(version)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn setup_first_provider(
    state: tauri::State<'_, AppState>,
    name: String,
    base_url: String,
    key: String,
) -> Result<tw_api::SetupResponse, String> {
    let r = state
        .control
        .setup(&name, &base_url, &key)
        .await
        .map_err(|e| format!("{e:#}"))?;
    // **不再重启 core。**M2 的热重载让这一步变成了纯粹的浪费 ——
    // 一次重启是两秒的断线，而配置在 `/setup` 返回之前就已经生效了
    // （它走的是和别的改动同一扇门，§3.8）。
    Ok(r)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(
            // LaunchAgent 模式：往 ~/Library/LaunchAgents 写一个 plist。
            // 不是 SMAppService、也不是登录项 API —— 插件在 macOS 上就是
            // 写文件（§2.4，读过源码）。
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // 注册时塞这个标记，启动时靠它判断是不是开机拉起来的。
            Some(vec![autostart::AUTOSTART_FLAG]),
        ))
        .invoke_handler(tauri::generate_handler![
            core_status,
            core_state,
            overview,
            probe_upstream,
            speed_test,
            get_config,
            patch_config,
            put_config,
            config_history,
            rollback_config,
            setup_first_provider
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let binary = locate_core(&handle)?;
            let socket = default_socket();
            let sup = Arc::new(Supervisor::new(binary, None));
            let core_state = sup.state_handle();

            app.manage(AppState {
                control: ControlClient::new(socket),
                core_state: core_state.clone(),
                supervisor: sup.clone(),
            });

            // 守护循环。**它跑在后台任务里而不是阻塞 setup** —— core 起
            // 不来的时候，界面必须还能打开，否则用户连错误都看不到。
            let h = handle.clone();
            let sup_for_loop = sup.clone();
            tauri::async_runtime::spawn(async move {
                supervise(sup_for_loop, h).await;
            });

            // 自启的路径校验。插件把 `enable()` 那一刻的绝对路径快照写
            // 进 plist，用户把 App 挪个位置就静默失效 —— 而它的
            // `is_enabled()` 只看文件在不在，仍然说「开着呢」（§2.4）。
            check_autostart_path(&handle);

            // 菜单栏。**在守护之前建**，这样 core 还没起来的那几秒里
            // 用户就已经看到它了 —— 开机自启时尤其重要（§2.4）。
            let tray = build_tray(&handle)?;
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                menubar_loop(tray, h).await;
            });

            // 心跳。三信号里最慢的那条，但**唯一能抓到「活着但卡死」**
            // —— 一个死锁的进程既不退出也不关 socket，前两条信号都看
            // 不见它，而它对用户的表现和挂了一模一样。
            let h = handle.clone();
            let sock = default_socket();
            tauri::async_runtime::spawn(async move {
                heartbeat_loop(sock, sup, h).await;
            });

            // 静默启动（§2.4）：开机拉起来的时候屏幕上什么都不该出现，
            // 只有菜单栏多一个图标。**图标已经在上面建好了** —— 它不等
            // core 就绪，否则用户开机后会有一段「到底启没启」的空白期。
            if autostart::launched_by_autostart(std::env::args()) {
                tracing::info!("开机自启，不开窗口");
                #[cfg(target_os = "macos")]
                become_accessory(&handle);
                maybe_notify_first_autostart(&handle);
            } else {
                show_main_window(&handle)?;
            }

            // 事件桥：控制面的 SSE → Tauri 事件 → 前端。
            let h = handle.clone();
            let sock = default_socket();
            tauri::async_runtime::spawn(async move {
                bridge_events(sock, h).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 点红点只是关窗口，进程留在菜单栏（§7.5）。macOS 上
            // 「关窗不等于退出应用」本来就是标准行为，不需要额外提示。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
                #[cfg(target_os = "macos")]
                become_accessory(&window.app_handle().clone());
            }
        })
        .build(tauri::generate_context!())
        .expect("Tauri 起不来")
        .run(|app, event| {
            // 点 Dock 图标 / 从 ⌘Tab 回来时把窗口叫回来。没有这条，一个
            // 已经隐藏窗口的菜单栏应用在 Dock 上点了没反应。
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                let _ = show_main_window(app);
            }
            if let tauri::RunEvent::ExitRequested { code, api, .. } = event {
                // 没有存活窗口不等于要退出 —— 那正是「关窗口留菜单栏」
                // 的状态。只有真的收到退出码才走清理。
                if code.is_none() {
                    api.prevent_exit();
                } else {
                    // core 是我们 spawn 的子进程，`kill_on_drop` 会带走它。
                    // 但显式说一句，因为这条是「一个程序」原则的另一半。
                    tracing::info!("退出，core 跟着走");
                    let _ = app.emit("app-exiting", ());
                }
            }
        });
}

/// 心跳循环。
async fn heartbeat_loop(socket: PathBuf, sup: Arc<Supervisor>, app: tauri::AppHandle) {
    use supervisor::{HealthTracker, Verdict, health};
    let client = ControlClient::new(socket);
    let mut tracker = HealthTracker::new();
    let mut was_running = false;

    loop {
        tokio::time::sleep(health::INTERVAL).await;

        // 只在 core 应该在跑的时候探。启动中、重启中、安全模式下探测
        // 失败是**预期的**，把它算进连续失败会让守护自己制造重启循环。
        let running = matches!(&*sup.state_handle().lock().await, CoreState::Running { .. });
        if !running {
            tracker.reset();
            was_running = false;
            continue;
        }
        if !was_running {
            // 刚起来。控制面 socket 可能还没建好，这一轮先不判。
            tracker.reset();
            was_running = true;
            continue;
        }

        let verdict = match client.ping(health::TIMEOUT).await {
            Ok(()) => tracker.on_ok(),
            Err(e) => {
                tracing::debug!("心跳失败：{e:#}");
                tracker.on_fail()
            }
        };
        match verdict {
            Verdict::Healthy => {}
            Verdict::Degraded { consecutive } => {
                tracing::warn!(consecutive, "core 没回心跳");
            }
            Verdict::Wedged => {
                let _ = app.emit("core-wedged", ());
                if let Err(e) = sup.report_wedged().await {
                    tracing::debug!("换掉卡死的 core 失败：{e:#}");
                }
                // 杀完就清零，等它重起来再重新计数。
                tracker.reset();
                was_running = false;
            }
        }
    }
}

/// 把控制面的事件流搬给前端。
///
/// 断线就重连，但**退避要克制**：core 重启期间 socket 必然连不上，这是
/// 预期状态而不是故障。1 秒一次的重试既不会刷屏，也不会让用户在 core
/// 恢复后还盯着一个空列表等太久。
async fn bridge_events(socket: PathBuf, app: tauri::AppHandle) {
    loop {
        let client = ControlClient::new(socket.clone());
        let a = app.clone();
        let r = client
            .subscribe_events(move |ev| {
                let _ = a.emit("core-event", &ev);
            })
            .await;
        if let Err(e) = r {
            tracing::debug!("事件流断开：{e:#}");
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}

/// 第一次开机自启之后提示一次「我在菜单栏这儿」，之后永不再弹。
///
/// **每次开机都弹是噪音**，而噪音的代价是用户学会忽略通知 —— 包括那些
/// 真该看的（§2.4，和守护的分级告知同一条理由）。
fn maybe_notify_first_autostart(app: &tauri::AppHandle) {
    let dir = data_dir();
    let marker = dir.join(".autostart-notified");
    if marker.exists() {
        return;
    }
    let _ = std::fs::create_dir_all(&dir);
    // 先写标记再发通知。反过来的话，发通知失败会让它每次开机都重试，
    // 而那正是我们要避免的噪音。
    if std::fs::write(&marker, "1").is_err() {
        return;
    }
    let _ = app.emit("first-autostart", ());
    tracing::info!("首次开机自启，已提示一次");
}

/// plist 里的路径还指着现在这个二进制吗。
///
/// 不一致就重新注册一次。这件事插件不做，而它的失败模式是**静默的**：
/// 开机之后什么都没发生，而设置里显示自启是开着的。
fn check_autostart_path(app: &tauri::AppHandle) {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if !matches!(mgr.is_enabled(), Ok(true)) {
        return;
    }
    let Ok(exe) = std::env::current_exe() else {
        return;
    };
    let exe = exe.display().to_string();
    let Some(plist) = autostart::plist_path(&app.config().identifier) else {
        return;
    };
    let Ok(contents) = std::fs::read_to_string(&plist) else {
        return;
    };
    if autostart::plist_path_matches(&contents, &exe) {
        return;
    }
    tracing::warn!(
        plist = %plist.display(),
        current = %exe,
        "自启的 plist 指向旧路径（App 被挪过？），重新注册"
    );
    let _ = mgr.disable();
    if let Err(e) = mgr.enable() {
        tracing::error!("重新注册自启失败：{e}");
    }
}

/// 主窗口用时才建。
///
/// **「根本不创建」不是「创建后隐藏」**（§2.4）：后者省不了内存也省不了
/// 启动时间，而且窗口会有一帧闪烁 —— 开机的时候屏幕上什么都不该出现。
fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    let w = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("ThinkWatch Lite")
        .inner_size(1100.0, 720.0)
        .min_inner_size(820.0, 560.0)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .build()?;
    w.set_focus()?;
    // 有窗口了就该出现在 Dock 和 ⌘Tab 里
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    Ok(())
}

/// 没有窗口时退回菜单栏应用：不占 Dock、不进 ⌘Tab。
#[cfg(target_os = "macos")]
fn become_accessory(app: &tauri::AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}

/// 建托盘。图标先画一个「启动中」的状态。
///
/// **不在 tauri.conf.json 里配 `trayIcon`** —— 配了的话 Tauri 会自己再
/// 建一个，菜单栏上就出现两个图标。图标是运行时画出来的（§7.4：两行
/// 必须自己渲染成图片），配置里那份静态图没有意义。
fn build_tray(app: &tauri::AppHandle) -> anyhow::Result<tauri::tray::TrayIcon> {
    let s = menubar::MenuBarState::default();
    let (rgba, w, h) = menubar::render_rgba(
        &s.line1(),
        &s.line2(),
        s.is_template(),
        menubar::Appearance::Dark,
    );
    // 托盘菜单。**「退出」在这里，而 ⌘Q 只隐藏窗口**（§2.4）—— 这个
    // 应用退出的代价很高（所有 AI 客户端立刻失联），一个手滑的 ⌘Q 不
    // 该造成那个后果。
    let open = MenuItem::with_id(app, "open", "打开主界面", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 ThinkWatch Lite", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;

    let tray = TrayIconBuilder::new()
        .icon(Image::new_owned(rgba, w, h))
        // 模板图靠 alpha 自动跟随菜单栏亮暗反色
        .icon_as_template(true)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => {
                if let Err(e) = show_main_window(app) {
                    tracing::error!("开窗口失败：{e}");
                }
            }
            "quit" => {
                // 真的退。不问「要不要保留后台代理」—— 那个问题本身就
                // 暴露了内部有两个进程（§2.2.1）。
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;
    Ok(tray)
}

/// 每秒更新一次菜单栏。
///
/// **空闲时跳过渲染**（§7.4）：文字没变就不重画。菜单栏是这个应用唯一
/// 常驻的东西，它自己耗电就直接违反了「空闲 CPU 约等于零」。
async fn menubar_loop(tray: tauri::tray::TrayIcon, app: tauri::AppHandle) {
    let mut prev = menubar::MenuBarState::default();
    // 第一帧无条件画，之后靠 needs_redraw
    let mut first = true;
    loop {
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;

        let next = match app.try_state::<AppState>() {
            Some(state) => collect_menubar_state(&state).await,
            None => continue,
        };
        if !first && !next.needs_redraw(&prev) {
            continue;
        }
        first = false;

        let template = next.is_template();
        let (rgba, w, h) = menubar::render_rgba(
            &next.line1(),
            &next.line2(),
            template,
            menubar::Appearance::Dark,
        );
        let _ = tray.set_icon(Some(Image::new_owned(rgba, w, h)));
        // **模板标志要跟着状态一起切**（§7.4）：告警时关掉它才能上色，
        // 恢复时再打开才能重新自动适配亮暗。
        let _ = tray.set_icon_as_template(template);
        prev = next;
    }
}

async fn collect_menubar_state(state: &tauri::State<'_, AppState>) -> menubar::MenuBarState {
    let core = state.core_state.lock().await.clone();
    let status = match core {
        CoreState::Running { .. } => menubar::Status::Normal,
        CoreState::Starting | CoreState::Restarting { .. } => menubar::Status::Starting,
        CoreState::SafeMode | CoreState::Stopped => menubar::Status::Disconnected,
    };
    // 花费和速率要等 M3 的计价才有真数（§4.3）。**现在如实显示「不知道」**
    // ——画一个 $0.00 会是一个断言：今天没花钱。那不是我们知道的事。
    menubar::MenuBarState {
        cost_today: None,
        tokens_per_sec: None,
        active: 0,
        status,
    }
}

/// 数据目录。**只有这一处**决定它在哪 —— 写第二遍就会漂，而漂掉的那处
/// 大概率是忘了看 `THINKWATCH_HOME` 的那处（测试就是靠它隔离的）。
fn data_dir() -> PathBuf {
    std::env::var_os("THINKWATCH_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".thinkwatch")))
        .unwrap_or_else(|| PathBuf::from(".thinkwatch"))
}

fn default_socket() -> PathBuf {
    data_dir().join("twcore.sock")
}

/// 起、看着、它死了、按策略决定下一步。
async fn supervise(sup: Arc<Supervisor>, app: tauri::AppHandle) {
    let mut safe = false;
    loop {
        match sup.run_once(safe).await {
            Ok(true) => {
                let _ = app.emit("core-restarting", ());
                continue;
            }
            Ok(false) => {
                if safe {
                    break;
                }
                // 进安全模式：**必须打断用户并自动开窗**。这时候网关
                // 已经不转发了，他所有的 AI 客户端都在瞎。
                safe = true;
                let _ = app.emit("core-safe-mode", ());
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                continue;
            }
            Err(e) => {
                // 起不来（多半是二进制路径不对）。这不是「core 在崩」，
                // 别用重启循环去掩盖它。
                tracing::error!("core 起不来：{e:#}");
                let _ = app.emit("core-failed", format!("{e:#}"));
                break;
            }
        }
    }
}
