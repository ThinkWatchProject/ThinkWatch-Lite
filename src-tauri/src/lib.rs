//! ThinkWatch Lite 的 UI 侧。
//!
//! 它做三件事：起 core 并看着它、把控制面的数据搬给前端、以及在 core
//! 挂掉时悄悄修好。用户眼里这一切和 core 是**同一个程序**。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

// 第一个声明：`tr!` 要在后面每个模块里都能用
#[macro_use]
pub mod i18n;
pub mod autostart;
pub mod call;
pub mod chatgpt;
pub mod clients;
pub mod connection;
pub mod control;
pub mod core_text;
pub mod dashboard;
/// Linux 上 AppImage 自己写的应用菜单条目，理由见模块头上。
#[cfg(target_os = "linux")]
pub mod desktop_entry;
pub mod diagnostics;
#[cfg(target_os = "macos")]
/// 从 DMG 里取出 `.app`，给更新器用。**只有 macOS 有** —— 它整个是 `hdiutil`，
/// 而发布页上那个 DMG 本来就只给那个平台。Windows 上更新器直接装 NSIS 包。
#[cfg(target_os = "macos")]
pub mod dmg;
pub mod error;
pub mod gateway;
pub mod keys;
/// 量 webview 占多少的那个诊断工具。**只有 macOS 有**，它靠 `ps`。
///
/// **只在开发构建里。**它是回答一次性问题的测量工具，发布包不需要一个能从命令行
/// 让应用关窗、退出的开关。
#[cfg(all(target_os = "macos", debug_assertions))]
pub mod memcheck;
pub mod menubar;
pub mod notices;
pub mod prefs;
/// 建只有自己能读的数据目录，见模块头上
pub mod private_dir;
pub mod settings;
pub mod supervisor;
pub mod theme;
mod token;
pub mod uninstall;
pub mod update;
pub mod updater;
pub mod upstreams;
pub mod window;
pub mod zai;

use control::ControlClient;
use gateway::{CORE_EXE, bridge_events, control_address, heartbeat_loop, locate_core, supervise};
use settings::{check_autostart_path, maybe_notify_first_autostart};
use supervisor::Supervisor;
use updater::{Updates, announce_update, update_loop};
#[cfg(target_os = "macos")]
use window::become_accessory;
use window::{open_urls, show_main_window};

pub struct AppState {
    /// 控制面客户端，**指着当前连接的那个 core**：本机的，或者远程的。切换连接时
    /// 由 `connection` 换掉它的目标，各处拿着的克隆一起跟着换
    pub control: ControlClient,
    /// 当前连哪个 core、连到了哪一步。见 `connection`
    pub link: Arc<connection::Link>,
    pub supervisor: Arc<Supervisor>,
    /// 连 twcore 都没找到时，那句话。
    ///
    /// **找不到不该让应用起不来。**在此之前这里是 `locate_core(&handle)?`
    /// —— `setup` 返回 Err 会让 Tauri 中止启动，**窗口根本不开**，用户
    /// 看到的是「点了没反应」。而这正是最需要把话说清楚的一种失败：
    /// 消息里写着找过哪些路径。
    pub core_missing: Option<String>,
    /// 守护循环还在跑吗。
    ///
    /// 它会退出：安全模式下的 core 也退了，或者 core 根本起不来。
    /// 退了之后没人再拉它 —— 界面上那个「重新启动」要能把它接回来，
    /// 而**不能接出第二条循环**。
    pub supervising: Arc<std::sync::atomic::AtomicBool>,
    /// 菜单栏该重新收一次数了。
    ///
    /// **菜单栏原来是每秒醒一次的**，而它每醒一次就走两趟控制面（额度、
    /// 汇总）。那两个数字只在请求落地或者额度头出现之后才会变 —— 也就是
    /// 说，一台闲着的机器上每秒两次往返问到的全是上一次的同一个答案，
    /// 而菜单栏是这个应用唯一常驻的东西。
    ///
    /// 现在由事件叫醒。`Notify` 攒一个许可，所以一串请求只会换来一次
    /// 重收，不是一串。
    pub menubar: Arc<tokio::sync::Notify>,
    /// **立刻**重收一次，不等攒够三秒：菜单刚打开、换了菜单栏的样式或界面语言
    pub menubar_now: Arc<tokio::sync::Notify>,
}

pub fn run() {
    // 继承来的 AppImage 变量不是自己的，先清掉，理由见 `update::foreign_appimage_vars`
    #[cfg(target_os = "linux")]
    for var in update::foreign_appimage_vars(tauri::utils::platform::bundle_type()) {
        // SAFETY: 这是 `run()` 的第一件事，在 Tauri、tokio、任何插件起线程之前；
        // `main` 在这之前只装了日志订阅器，它不起线程。进程里此刻只有主线程，
        // 没有别的线程可能同时读写环境变量。
        unsafe { std::env::remove_var(var) };
    }
    // 在单实例插件把这个进程判成「第二个」之前放下激活令牌
    #[cfg(target_os = "linux")]
    window::relaunch_token::stash();
    let builder = tauri::Builder::default();
    // **单实例要第一个注册**，插件自己的文档如此要求：它得在别的插件把端口、
    // socket、注册表项占上之前就判断出「已经有一个在跑」。
    //
    // macOS 不注册它：同一个 bundle 由系统保证只跑一份，点第二次 Dock 图标
    // 发的是 `RunEvent::Reopen`。别处没有这个保证 ——
    //
    // - 托盘里开着，用户又去开始菜单点一下 → 第二个进程、两个托盘图标、
    //   两个 core 抢同一把锁；
    // - `thinkwatch://` 被 shell 拉起来时（授权回调，以后还有点开通知），
    //   deep-link 要靠它把 URL 转给已经在跑的那个实例。没有它，每点一次
    //   就新起一个进程，而那个进程起来之后发现锁被占着。
    //
    // `deep-link` 这个特性让插件把第二个实例 argv 里的 URL 交回
    // `on_open_url` —— 和第一次启动走同一条路径，不是另开一条。
    #[cfg(not(target_os = "macos"))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
        // 已经有一个在跑：把它叫到前面来。**用户点第二次，想要的是看见它**，
        // 不是被告知它已经开着。
        let _ = show_main_window(app);
        // Wayland 上还得有新进程带来的激活令牌，窗口才会真的到前面，见
        // `window::relaunch_token`
        #[cfg(target_os = "linux")]
        if let Some(token) = window::relaunch_token::take() {
            window::activate_with_token(app, "main", token);
        }
    }));
    let builder = builder
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init());
    // Linux 上不注册：自启项是自己写的（见 `autostart::linux`）。插件在那边
    // 初始化时只是建个对象、不碰磁盘，留着它就是第二份说法 —— 它认的是另一个
    // 文件名，`is_enabled` 也不看桌面有没有把它关掉
    #[cfg(not(target_os = "linux"))]
    let builder = builder.plugin(tauri_plugin_autostart::init(
        // LaunchAgent 模式：往 ~/Library/LaunchAgents 写一个 plist。
        // 不是 SMAppService、也不是登录项 API —— 插件在 macOS 上就是
        // 写文件（读过源码）。
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        // 注册时塞这个标记，启动时靠它判断是不是开机拉起来的。
        Some(vec![autostart::AUTOSTART_FLAG]),
    ));
    builder
        .invoke_handler(tauri::generate_handler![
            call::call,
            gateway::core_status,
            gateway::core_state,
            window::reveal_main_window,
            connection::connections,
            connection::set_connection_startup,
            connection::test_connection,
            connection::save_connection,
            connection::delete_connection,
            connection::switch_preflight,
            connection::switch_connection,
            connection::retry_connection,
            connection::pick_connection,
            connection::picker_fit,
            gateway::restart_core,
            dashboard::dashboard,
            upstreams::upstream_stats,
            notices::commands::notices_list,
            notices::commands::mark_notice_read,
            notices::commands::mark_all_notices_read,
            notices::commands::clear_notices,
            settings::notice_mode,
            settings::set_notice_mode,
            settings::menubar_style,
            settings::set_menubar_style,
            notices::commands::take_pending_view,
            keys::copy_key,
            keys::copy_gateway_base,
            keys::key_usage,
            chatgpt::start_chatgpt_login,
            chatgpt::reopen_chatgpt_login,
            chatgpt::copy_chatgpt_code,
            chatgpt::cancel_chatgpt_login,
            zai::start_zai_login,
            zai::reopen_zai_login,
            zai::cancel_zai_login,
            settings::app_info,
            updater::update_state,
            updater::set_update_check,
            settings::app_language,
            settings::set_language,
            settings::app_theme,
            settings::set_theme,
            updater::update_check,
            updater::update_pending,
            updater::update_fit,
            updater::update_copy_command,
            updater::update_install,
            settings::autostart_enabled,
            settings::set_autostart,
            uninstall::restore_all,
            uninstall::uninstall,
            clients::copy_client_endpoint,
            clients::reveal_client_config,
            diagnostics::save_diagnostics,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // **语言最先定。**托盘、通知、窗口都要用它，而它们在下面陆续出现
            let saved = prefs::load(&data_dir());
            i18n::set(i18n::effective(saved.language));
            // 外观在窗口出现之前就设好，不然会先画一帧系统那一档的颜色
            theme::init(&handle, saved.theme);
            // **找不到 core 也要把窗口开起来。**这里原来是 `?` ——
            // 而它把「找不到一个文件」变成了「应用打不开」。
            let located = locate_core(&handle);
            // 控制面听在哪由平台决定，凭据这一次启动生成一个。**两样都只在
            // 这里定一次**，守护拿它去 spawn core，客户端拿它去连。
            let at = control_address();
            let token = token::generate();
            // 起好了没有，问控制面：`/status` 答得上来才算。半秒答不上这一次就
            // 算没答应，守护隔一会儿再问
            let ready = {
                let (at, token) = (at.clone(), token.clone());
                supervisor::probe(move || {
                    let control = ControlClient::new(at.clone(), token.clone());
                    async move {
                        control
                            .ping(std::time::Duration::from_millis(500))
                            .await
                            .is_ok()
                    }
                })
            };
            let sup = Arc::new(
                Supervisor::new(
                    located
                        .as_ref()
                        .cloned()
                        .unwrap_or_else(|_| PathBuf::from(CORE_EXE)),
                    None,
                    ready,
                    at.clone(),
                    token.clone(),
                )
                .with_user_env(),
            );
            let supervising = Arc::new(std::sync::atomic::AtomicBool::new(false));

            app.manage(Updates::default());
            // 上一次是被更新重启的话，现在说一声
            announce_update(&handle);

            // 通知总线。**判定在这里，不在界面** —— 关窗即销毁 webview
            // 系统通知：装好的应用用原生的（能原地更新、撤回、点开落到对应页面），
            // `tauri dev` 这种不在应用包里的退回插件
            #[cfg(target_os = "macos")]
            let system: Box<dyn notices::Sink> = if notices::macos::available() {
                notices::macos::install(handle.clone());
                Box::new(notices::macos::NativeSink)
            } else {
                Box::new(notices::SystemSink::new(handle.clone()))
            };
            // Windows 上「装好的」是指开始菜单里有带 AUMID 的快捷方式，见 `notices::windows`。
            // 点开走协议激活（下面的 `on_open_url`），不用在这里接回调
            #[cfg(windows)]
            let system: Box<dyn notices::Sink> = if notices::windows::available(&handle) {
                Box::new(notices::windows::NativeSink::new(handle.clone()))
            } else {
                Box::new(notices::SystemSink::new(handle.clone()))
            };
            // Linux 上开发构建也用原生的：D-Bus 不挑发送方，见 `notices::linux`
            #[cfg(target_os = "linux")]
            let system: Box<dyn notices::Sink> =
                Box::new(notices::linux::NativeSink::new(handle.clone()));
            #[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
            let system: Box<dyn notices::Sink> = Box::new(notices::SystemSink::new(handle.clone()));
            // 菜单栏在通知列表一变时要重画：它也是通知总线的一个投递端
            let menubar_wake = Arc::new(tokio::sync::Notify::new());
            let notices = notices::Notices::new(
                vec![
                    Box::new(notices::sink::AppSink::new(handle.clone())),
                    Box::new(menubar::Wake(menubar_wake.clone())),
                    system,
                ],
                Some(data_dir()),
                saved.notices,
            );
            app.manage(notices.clone());
            // 这次连哪个。**按住 ⌥ 启动，或者上两次启动都没走到就绪**，先让人选
            let dir = data_dir();
            let attempts = connection::launch::begin(&dir);
            let pick = connection::launch::why(attempts, connection::launch::option_held());
            let conns = connection::store::load(&dir);
            let start_id = conns.startup_target();
            let local = control::Target::Local {
                at: at.clone(),
                token: token.clone(),
            };
            let link = Arc::new(connection::Link::new(
                handle.clone(),
                local.clone(),
                connection::Current::Local,
            ));
            app.manage(AppState {
                control: ControlClient::to(local),
                link: link.clone(),
                supervisor: sup.clone(),
                core_missing: located.as_ref().err().map(|e| format!("{e:#}")),
                supervising: supervising.clone(),
                menubar: menubar_wake,
                menubar_now: Arc::new(tokio::sync::Notify::new()),
            });

            // **状态变化推给界面，不要让它来问。**「core 起来没、是不是
            // 在重启、有没有进安全模式」一天变不了几次，而界面原来是每
            // 两秒问一遍的 —— 那三次 IPC 往返里绝大多数得到的是同一个
            // 答案。字符串和 `core_state` 命令走同一个函数，两条路不会
            // 说出不一样的话。
            {
                let h = handle.clone();
                let mut rx = sup.watch();
                tauri::async_runtime::spawn(async move {
                    while rx.changed().await.is_ok() {
                        let now = rx.borrow().clone();
                        if let Some(n) = h.try_state::<Arc<notices::Notices>>() {
                            n.on_core_state(&now);
                        }
                        connection::on_supervisor(&h, &now);
                        // 界面收到的是**当前连接**的状态：连着远程时本机 core 停下，
                        // 界面上不该出现「已停止」
                        connection::emit_core_state(&h);
                    }
                });
            }

            // 守护循环。**它跑在后台任务里而不是阻塞 setup** —— core 起
            // 不来的时候，界面必须还能打开，否则用户连错误都看不到。
            //
            // **只在连本机时起。**连远程时本机的 core 不跑；要先让人选的话，选好了再起
            let remote_start = pick.is_some() || conns.remote(&start_id).is_some();
            if remote_start {
                if pick.is_some() {
                    link.wait_for_pick();
                } else {
                    connection::start(&handle, &start_id);
                }
            } else if located.is_ok() {
                supervising.store(true, std::sync::atomic::Ordering::SeqCst);
                let h = handle.clone();
                let sup_for_loop = sup.clone();
                let flag = supervising.clone();
                tauri::async_runtime::spawn(async move {
                    supervise(sup_for_loop, h).await;
                    flag.store(false, std::sync::atomic::Ordering::SeqCst);
                });
            } else if let Err(e) = &located {
                tracing::error!("找不到 core：{e:#}");
            }

            // 自启的路径校验。插件把 `enable()` 那一刻的绝对路径快照写
            // 进 plist，用户把 App 挪个位置就静默失效 —— 而它的
            // `is_enabled()` 只看文件在不在，仍然说「开着呢」。
            check_autostart_path(&handle);

            // 菜单栏。**在守护之前建**，这样 core 还没起来的那几秒里
            // 用户就已经看到它了 —— 开机自启时尤其重要。
            menubar::install(&handle)?;

            // 心跳。三信号里最慢的那条，但**唯一能抓到「活着但卡死」**
            // —— 一个死锁的进程既不退出也不关 socket，前两条信号都看
            // 不见它，而它对用户的表现和挂了一模一样。
            let h = handle.clone();
            let (at2, tok2) = (at.clone(), token.clone());
            tauri::async_runtime::spawn(async move {
                heartbeat_loop(at2, tok2, sup, h).await;
            });

            // 静默启动：开机拉起来的时候屏幕上什么都不该出现，
            // 只有菜单栏多一个图标。**图标已经在上面建好了** —— 它不等
            // core 就绪，否则用户开机后会有一段「到底启没启」的空白期。
            if let Some(why) = pick {
                // 连接选择先出来，主窗口等选好了再开。**开机自启时也出来**：只有
                // 连着两次没走到就绪才会走到这里，那时再悄悄撞一次不如问一句
                tracing::info!(?why, "启动时先显示连接选择");
                connection::show_picker(&handle, why)?;
            } else if autostart::launched_by_autostart(std::env::args()) {
                tracing::info!("开机自启，不开窗口");
                #[cfg(target_os = "macos")]
                become_accessory(&handle);
                maybe_notify_first_autostart(&handle);
            } else {
                show_main_window(&handle)?;
            }

            // 量 webview 占多少。**它不是一个功能，是一个回答
            // 不了就只能猜的问题的工具** —— 「关窗之后隐藏还是销毁」
            // 取决于隐藏到底放不放得掉那部分内存。
            #[cfg(all(target_os = "macos", debug_assertions))]
            if memcheck::requested(std::env::args()) {
                memcheck::run(handle.clone());
            }

            // `thinkwatch://` 被点开：浏览器里授权完成之后的「返回 ThinkWatch」，
            // 和 Windows 上点了一条 toast（`thinkwatch://notice/<键>`）。
            // **窗口这时可能根本不存在**（菜单栏模式下关窗即销毁）
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let h = handle.clone();
                handle.deep_link().on_open_url(move |event| {
                    let urls: Vec<String> = event.urls().iter().map(|u| u.to_string()).collect();
                    open_urls(&h, &urls);
                });
                // **被这个链接拉起来的那一次**：插件初始化时就把它发出去了，那时这里还
                // 没在听，只剩 `get_current` 里存着的一份。点一条 toast 时应用没在跑，
                // 就是这种情况。macOS 的链接在启动之后才到，这里取到的是空的
                if let Ok(Some(urls)) = handle.deep_link().get_current() {
                    let urls: Vec<String> = urls.iter().map(|u| u.to_string()).collect();
                    open_urls(&handle, &urls);
                }
                #[cfg(target_os = "linux")]
                {
                    desktop_entry::integrate(&handle);
                    // 留下来的是这个实例：它自己启动时放下的令牌不该被当成
                    // 下一次再启动带来的
                    let _ = window::relaunch_token::take();
                }
            }

            // 事件桥：控制面的 SSE → Tauri 事件 → 前端。
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                bridge_events(h).await;
            });

            // 有没有新版本。**循环无条件起，开关在循环里读** —— 用户在
            // 运行中打开自动检查时，不该要求他重启应用才生效。
            let h = handle.clone();
            tauri::async_runtime::spawn(async move {
                update_loop(h).await;
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // 点红点只是关窗口，进程留在菜单栏。macOS 上
            // 「关窗不等于退出应用」本来就是标准行为，不需要额外提示。
            //
            // **销毁窗口，不是隐藏。**这是实测出来的（那条「据此
            // 定隐藏还是销毁」）：
            //
            //   窗口没开过   107 MB
            //   窗口开着     239 MB
            //   隐藏之后     235 MB   ← 几乎没降，等三十秒也不降
            //
            // 隐藏留下的 128 MB 全是 WebKit 的三个 XPC 进程。而这是一个
            // 用户开着一整天、一天点开两三次的菜单栏应用 —— 为那两三次
            // 常驻 128 MB 不划算。销毁的代价是重开时要重新加载一次页面
            // （几百毫秒），`show_main_window` 本来就会在窗口不存在时
            // 重建它。
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let closing = window.label().to_string();
                let _ = window.destroy();
                // **只有最后一个窗口关掉时才退回菜单栏应用。**更新窗口关掉
                // 的时候主窗口可能还开着 —— 那时把 Dock 图标收掉，用户就没法
                // 用 ⌘Tab 切回那个窗口了。
                #[cfg(target_os = "macos")]
                if app.webview_windows().keys().all(|l| *l == closing) {
                    become_accessory(&app);
                }
                #[cfg(not(target_os = "macos"))]
                let _ = (&app, &closing);
            }
        })
        .build(tauri::generate_context!())
        .expect("Tauri 起不来")
        .run(|app, event| {
            // Dock 和 ⌘Tab 是 macOS 的概念，下面那一段只在那里有事做。
            #[cfg(not(target_os = "macos"))]
            let _ = app;
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
                }
            }
        });
}

/// 数据目录。
///
/// **问契约层要，不自己算。**core 和这里必须落到同一个目录 —— 端口文件、凭据、
/// 配置都在里面。以前这里自己只看 `HOME`，Windows 上那个变量默认不存在，于是
/// 落到当前目录下的 `.thinkwatch`，而 core 在 `%APPDATA%\ThinkWatch`：界面找不到
/// 一个正在跑的网关。`THINKWATCH_HOME` 照旧最优先（测试靠它隔离）。
pub(crate) fn data_dir() -> PathBuf {
    tw_api::data::dir()
}
