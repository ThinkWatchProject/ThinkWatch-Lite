//! 网关进程：找到 twcore、起它、看着它，以及把它的事件接到界面和菜单栏上。

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Emitter, Manager};
use tw_api::ep;

#[cfg(windows)]
use crate::update;
use crate::{
    AppState,
    control::ControlClient,
    data_dir,
    error::{Out, text},
    notices, supervisor,
    supervisor::{CoreState, Supervisor},
};

/// 网关那个可执行文件叫什么。
///
/// **Windows 上带 `.exe`。**`CreateProcess` 见到一个没有扩展名的路径，会去找
/// 同名的 `.exe`；所以一个就叫 `twcore` 的文件在那里根本起不来。而在那之前的
/// 每一步 —— 打包放进去、构建期校验它在不在、`locate_core` 找到它 —— 都会说
/// 一切正常，坏在最后一步，表现为界面永远停在连接页上。
///
/// 声明「包里装什么」的那份 JSON 不能分支，所以 Windows 另有一份
/// `tauri.windows.conf.json`。**它是合并进来的，不是替换**（RFC 7386 的
/// merge patch）—— 所以除了加上带 `.exe` 的那条，还要把基础配置里不带扩展名
/// 的那条显式设成 `null`。不然两条同时生效，而其中一条指着一个在那个平台上
/// 根本不存在的文件，构建期就停在「resource path doesn't exist」。
pub const CORE_EXE: &str = if cfg!(windows) {
    "twcore.exe"
} else {
    "twcore"
};

/// twcore 在哪。
///
/// 开发时它在 core 仓库的 target 里；打包后它在 app bundle 的
/// Resources 下。**两条路径都要试，而且找不到时要说清楚找过哪儿** ——
/// 「二进制不存在」是安装期最常见的失败，而默认的错误信息只会说
/// No such file or directory。
/// 打包之后，core 只可能在一个地方。
///
/// macOS 的 `.app/Contents/MacOS/<exe>` 到 `.app/Contents/Resources/`
/// 是 bundle 布局定死的关系。
///
/// **Windows 上装好的那一份，网关就在自己旁边**：NSIS 把资源放进安装目录
/// （`tauri.windows.conf.json` 把它映射成 `twcore.exe`）。「是不是装好的那
/// 一份」和自更新问的是同一件事，所以同一个判断（旁边有没有卸载程序）。
///
/// 以前这里只认 macOS 的布局，Windows 上装好的应用于是被当成开发构建，往下
/// 走到了开发那几条候选 —— 包里缺了 `twcore.exe` 的时候，它会去环境变量、
/// 工作目录、PATH 里找一个来跑，正是下面那段注释说要堵上的口子。界面上显示
/// 的路径也因此是框架给的 `\\?\C:\…` 那种写法。
///
/// **Linux 上看打包时写进二进制的标记**（`bundle_type()`，deb 和 AppImage
/// 各打一份）。资源在 `<可执行文件>/../lib/<产品名>/`：deb 是
/// `/usr/lib/ThinkWatch Lite/`，AppImage 是挂载点下同样的相对位置（挂载点
/// 每次启动都换，所以界面上的路径会变，这是正常的）。**从可执行文件的位置
/// 推，不用框架的 `resource_dir()`**：它在那个目录不存在时改看 `APPDIR`
/// 环境变量 —— 又是一个让环境变量决定执行哪个二进制的口子。
pub(crate) fn bundled_core(product: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    if dir.ends_with("Contents/MacOS") {
        return Some(dir.parent()?.join("Resources").join(CORE_EXE));
    }
    #[cfg(windows)]
    if update::nsis_installed(&exe) == update::Install::Standalone {
        return Some(dir.join(CORE_EXE));
    }
    #[cfg(target_os = "linux")]
    if tauri::utils::platform::bundle_type().is_some() {
        return Some(dir.parent()?.join("lib").join(product).join(CORE_EXE));
    }
    #[cfg(not(target_os = "linux"))]
    let _ = product;
    None
}

/// twcore 在哪。
///
/// **装好的应用和开发布局走两条完全不同的路，中间没有回退。**
///
/// 装好之后只认包里那一份：找不到就是安装包坏了，说出来让人重装。
/// 开发时才去试环境变量、隔壁仓库、PATH。
///
/// 这条分界不是整洁，是安全。开发那几条候选里有
/// `<当前工作目录>/../thinkwatch-core/target/release/twcore` —— 它相对
/// 的是**进程启动时的工作目录**。把这条留在发出去的应用里，等于让
/// 「用户从哪个目录启动」决定它执行哪个二进制；而这个进程握着用户全部
/// 的 API key。同理，装好之后也不再看 `THINKWATCH_CORE_BIN` 和 PATH：
/// 让环境变量替换掉网关本体，在开发机上是便利，在用户机器上是一个口子。
pub fn locate_core(app: &tauri::AppHandle) -> anyhow::Result<PathBuf> {
    if let Some(inside) = bundled_core(&app.package_info().name) {
        if inside.exists() {
            return Ok(inside);
        }
        // **不往下走。**这里不是「再找找别处」，是这份安装包缺东西。
        anyhow::bail!(tr!(
            "安装包缺少 twcore 组件，请重新下载并安装。",
            "The app bundle is missing the twcore component. Download and install ThinkWatch Lite again."
        ));
    }

    let mut tried = Vec::new();

    // 别的平台以后会有自己的打包形态，框架这条留着 —— 它在 macOS 的
    // `.app` 里实测返回 `unknown path`，所以上面那一段不能指望它。
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join(CORE_EXE);
        if p.exists() {
            return Ok(p);
        }
        tried.push(p);
    }

    // 显式覆盖优先。**core 放在哪儿是开发者的选择** —— 之前这里写死了
    // 一个 $HOME 下的固定目录，那是写这段代码的那台机器的布局，换一台
    // 机器就直接失败，而失败信息会指向一个用户从没听说过的路径。
    if let Some(explicit) = std::env::var_os("THINKWATCH_CORE_BIN") {
        let p = PathBuf::from(explicit);
        if p.exists() {
            return Ok(p);
        }
        tried.push(p);
    }

    // 开发时：core 是隔壁仓库。cwd 在 `tauri dev` 下是 `src-tauri/`，
    // 直接跑 `cargo run` 时是仓库根 —— 两种都试，不假设是哪一种。
    if let Ok(cwd) = std::env::current_dir() {
        for up in ["../..", ".."] {
            for profile in ["release", "debug"] {
                let p = cwd
                    .join(up)
                    .join("thinkwatch-core/target")
                    .join(profile)
                    .join(CORE_EXE);
                if p.exists() {
                    // 相对路径能用，但报错信息和日志里出现 `../..` 很难
                    // 读，所以归一化之后再交出去。
                    return Ok(p.canonicalize().unwrap_or(p));
                }
                tried.push(p);
            }
        }
    }

    // 最后：装在 PATH 上的那个。`cargo install -p twcore` 之后就是这条。
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            let p = dir.join(CORE_EXE);
            if p.exists() {
                return Ok(p);
            }
        }
    }

    let searched = tried
        .iter()
        .map(|p| format!("  · {}", p.display()))
        .collect::<Vec<_>>()
        .join("\n");
    anyhow::bail!(tr!(
        format!(
            "未找到 twcore。已查找以下位置及 PATH：\n{searched}\n\n\
             可通过 THINKWATCH_CORE_BIN 指定绝对路径，或在 core 仓库中执行 \
             `cargo build -p twcore`。"
        ),
        format!(
            "twcore was not found. Searched these locations and PATH:\n{searched}\n\n\
             Set THINKWATCH_CORE_BIN to an absolute path, or run \
             `cargo build -p twcore` in the core repository."
        )
    ))
}

/// core 的状态。**不走 `call`**：这里多一步，协议版本对不上时说一句人话。
#[tauri::command]
pub async fn core_status(state: tauri::State<'_, AppState>) -> Out<tw_api::Status> {
    state.control.status().await.map_err(text)
}

#[tauri::command]
pub async fn core_state(state: tauri::State<'_, AppState>) -> Out<String> {
    // 连 core 都没找到时，守护状态说什么都没意义 —— 那句话才是答案
    if let Some(why) = &state.core_missing {
        return Ok(format!("missing:{why}"));
    }
    Ok(describe_state(&state.supervisor.state()))
}

/// 把 core 拉起来。
///
/// 两种情形：守护还在跑，那这就是一次普通的重启；守护已经退出了
/// （安全模式下的 core 也退了、或者 core 根本起不来），那要把循环接
/// 回来 —— 而**不能接出第二条**，所以用一个标志守着。
#[tauri::command]
pub async fn restart_core(app: tauri::AppHandle) -> Out<()> {
    restart_gateway(&app).await
}

/// 界面上的「重新启动」和菜单栏里的「重新启动网关」走的都是这里
pub(crate) async fn restart_gateway(app: &tauri::AppHandle) -> Out<()> {
    use std::sync::atomic::Ordering;
    let state = app.state::<AppState>();
    if let Some(why) = &state.core_missing {
        return Err(why.clone().into());
    }
    if state.supervising.swap(true, Ordering::SeqCst) {
        return state.supervisor.request_restart().await.map_err(text);
    }
    let sup = state.supervisor.clone();
    let flag = state.supervising.clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        supervise(sup, app).await;
        flag.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// 守护状态说成界面认得的那个字符串。
///
/// **只有这一处。**开窗时问一次、之后每次转换推一条，两条路必须说出
/// 一模一样的话 —— 各写一遍的话，「重启中（第 3 次）」和「重启中」会
/// 在某次改动之后悄悄分岔。
pub(crate) fn describe_state(s: &CoreState) -> String {
    match s {
        CoreState::Starting => "starting".into(),
        CoreState::Running { pid } => format!("running:{pid}"),
        CoreState::Restarting { attempt, in_ms } => format!("restarting:{attempt}:{in_ms}"),
        CoreState::SafeMode => "safe_mode".into(),
        CoreState::Stopped => "stopped".into(),
        CoreState::Failed { reason } => format!("failed:{reason}"),
    }
}

/// 心跳循环。
pub(crate) async fn heartbeat_loop(
    at: tw_api::control::Address,
    token: String,
    sup: Arc<Supervisor>,
    app: tauri::AppHandle,
) {
    use supervisor::{HealthTracker, Verdict, health};
    let client = ControlClient::new(at, token);
    let mut tracker = HealthTracker::new();

    loop {
        tokio::time::sleep(health::INTERVAL).await;

        // 只在 core 应该在跑的时候探。启动中、重启中、安全模式下探测
        // 失败是**预期的**，把它算进连续失败会让守护自己制造重启循环。
        // 「运行中」是控制面答应了之后才报的，这时候探不到就是真的没回话
        if !matches!(sup.state(), CoreState::Running { .. }) {
            tracker.reset();
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
                // 自己好了的一次卡顿不打断人（和偶发崩溃一个待遇），但在提醒列表里
                // 留一条：用户那几秒看到的失败，要有地方说得清是为什么
                if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
                    n.ingest(notices::rules::wedged(), notices::now_ms());
                }
                if let Err(e) = sup.report_wedged().await {
                    tracing::debug!("换掉卡死的 core 失败：{e:#}");
                }
                // 杀完就清零，等它重起来再重新计数。
                tracker.reset();
            }
        }
    }
}

/// 把控制面的事件流搬给前端。
///
/// 断线就重连，但**退避要克制**：core 重启期间 socket 必然连不上，这是
/// 预期状态而不是故障。1 秒一次的重试既不会刷屏，也不会让用户在 core
/// 恢复后还盯着一个空列表等太久。
///
/// **重新连上时补报一条「丢过事件」**（`EventsDropped`，条数记 0：丢了多少不知道）。
/// 断开的那一段里发生的事，事件流不会再说一遍 —— 界面要对一次账，否则那段时间
/// 里结束的请求，会一直显示成进行中。菜单栏的实时数是问 core 要的（`/live`），
/// 叫醒它重收一次就对了。
pub(crate) async fn bridge_events(
    at: tw_api::control::Address,
    token: String,
    app: tauri::AppHandle,
) {
    let mut connected_before = false;
    loop {
        let client = ControlClient::new(at.clone(), token.clone());
        let opened = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (a, b, o) = (app.clone(), app.clone(), opened.clone());
        let resumed = connected_before;
        let r = client
            .subscribe_events(
                move || {
                    o.store(true, std::sync::atomic::Ordering::SeqCst);
                    // **每次接上都按现状对一次账**：接上之前 core 报过的（启动时的凭据
                    // 失效、断线那段里被拒的配置），事件流不会再说一遍
                    reconcile_notices(&b);
                    if resumed {
                        let lost = tw_api::Event::EventsDropped {
                            id: 0,
                            count: 0,
                            at_ms: notices::now_ms(),
                        };
                        if let Some(st) = b.try_state::<AppState>() {
                            st.menubar.notify_one();
                        }
                        let _ = b.emit("core-event", &lost);
                    }
                },
                move |ev| {
                    // **在客户端弹批准提示的同一瞬间弹一条通知**。
                    // 这是网关位置独有的能力：只有我们同时知道「这个调用长
                    // 什么样」和「它来自哪个上游」。用户看到批准提示的同时
                    // 看到这条，判断质量完全不一样。
                    if let Some(n) = a.try_state::<Arc<notices::Notices>>() {
                        n.on_event(&ev);
                    }
                    // 菜单栏上那几个数只跟这几种事件有关：花了多少（请求
                    // 落地之后存储层才算得出来）、额度还剩多少、进行中几个。
                    // 别的事件叫醒它只是让它白跑一趟。**事件只是叫醒它，数
                    // 由 core 给**（`/live`）：掉过队的话（`EventsDropped`）
                    // 重收一次也就对上了
                    if let Some(st) = a.try_state::<AppState>()
                        && matches!(
                            ev,
                            tw_api::Event::RequestStarted { .. }
                                | tw_api::Event::RequestFinished { .. }
                                | tw_api::Event::RequestFailed { .. }
                                | tw_api::Event::RequestCancelled { .. }
                                | tw_api::Event::QuotaSeen { .. }
                                | tw_api::Event::ConfigReloaded { .. }
                                | tw_api::Event::EventsDropped { .. }
                        )
                    {
                        st.menubar.notify_one();
                    }
                    // core 说这个订阅者掉过队：掉的那几条里可能有该提醒的事
                    if matches!(ev, tw_api::Event::EventsDropped { .. }) {
                        reconcile_notices(&a);
                    }
                    let _ = a.emit("core-event", &ev);
                },
            )
            .await;
        if let Err(e) = r {
            tracing::debug!("事件流断开：{e:#}");
        }
        // 接通过才算连上过：core 重启期间那几轮连不上的不算
        connected_before |= opened.load(std::sync::atomic::Ordering::SeqCst);
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
}

/// 提醒按 core 的现状对账（见 [`notices::Notices::reconcile`]）。问不到就算了：
/// 下一次接上还会再问，事件流上来的照常处理。
pub(crate) fn reconcile_notices(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let (Some(st), Some(n)) = (
            app.try_state::<AppState>(),
            app.try_state::<Arc<notices::Notices>>(),
        ) else {
            return;
        };
        let asked_at = notices::now_ms();
        let c = &st.control;
        let (status, overview, quotas) = tokio::join!(
            c.status(),
            c.call::<ep::Overview>(&[], &()),
            c.call::<ep::Quota>(&[], &())
        );
        let (Ok(status), Ok(overview), Ok(quotas)) = (status, overview, quotas) else {
            tracing::debug!("提醒对账：没问到 core 的现状");
            return;
        };
        let snap = notices::rules::Snapshot {
            status: &status,
            overview: &overview,
            quotas: &quotas,
        };
        n.reconcile(notices::rules::from_snapshot(&snap, asked_at), asked_at);
    });
}

/// 控制面听在哪。
///
/// **问契约层要，不自己拼。**以前这里是 `data_dir().join("twcore.sock")`，
/// 而 core 那边也拼一次 —— 两份能对上只是因为那一行短到不容易写错。
/// Windows 上这个答案要分岔（那里没有 unix socket），两份各写一次就是两份
/// 会漂，而漂掉的表现是界面连不上一个正在跑的网关。
pub(crate) fn control_address() -> tw_api::control::Address {
    tw_api::control::Address::in_dir(&data_dir())
}

/// 起、看着、它死了、按策略决定下一步。
pub(crate) async fn supervise(sup: Arc<Supervisor>, app: tauri::AppHandle) {
    // 接起一条新的守护循环，意思就是要 core 跑着。之前为了退出（或者为了
    // 一次没装成的更新）停过它的话，那个「按要求停止」的记号不能留到这一条
    // 里来 —— 留着的话，这之后 core 每一次崩溃都会被当成按要求停止
    sup.resume();
    let mut safe = false;
    loop {
        // 每一次转换都随 `core-state` 推给界面（见 setup 里那一段），这里不再另发
        match sup.run_once(safe).await {
            Ok(supervisor::Next::Again) => continue,
            Ok(supervisor::Next::Stop) => break,
            Ok(supervisor::Next::SafeMode) => {
                // 进安全模式：**必须打断用户并自动开窗**。这时候网关
                // 已经不转发了，他所有的 AI 客户端都在瞎。
                safe = true;
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                continue;
            }
            Err(e) => {
                // 起不来（多半是二进制路径不对）。这不是「core 在崩」，
                // 别用重启循环去掩盖它：守护停下，状态是 `Failed`，界面上
                // 说原因、给重试
                tracing::error!("core 起不来：{e:#}");
                break;
            }
        }
    }
}
