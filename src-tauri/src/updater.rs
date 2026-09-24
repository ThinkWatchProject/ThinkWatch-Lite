//! 应用更新：检查、更新窗口、下载安装。「这一份由谁来更新」的判断在 `crate::update`。

use std::sync::Arc;

use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
use crate::dmg;
#[cfg(windows)]
use crate::gateway::restart_gateway;
use crate::{AppState, control::ControlClient, data_dir, error::Out, i18n, notices, prefs, update};

/// 更新这件事的当前状态，一次说完。
///
/// 界面要问的从来不是「有没有新版本」一个问题，而是「我这一份是怎么装
/// 上来的、自动检查开着吗、手上有没有一个查到了还没装的版本」—— 分成几个
/// 命令去问，界面就得自己把答案拼成一句话，而拼错了没有东西会发现。
#[derive(serde::Serialize)]
pub struct UpdateView {
    /// 现在跑的是哪一版
    version: String,
    /// 这一份是怎么装上来的
    install: update::Install,
    /// 自动检查开着吗
    check_updates: bool,
    /// 查到了、还没装的那一版
    offer: Option<Found>,
}

pub(crate) fn update_view(app: &tauri::AppHandle) -> UpdateView {
    UpdateView {
        version: app.package_info().version.to_string(),
        install: update::kind(),
        check_updates: prefs::load(&data_dir()).check_updates,
        offer: app.state::<Updates>().offer.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn update_state(app: tauri::AppHandle) -> UpdateView {
    update_view(&app)
}

#[tauri::command]
pub fn set_update_check(app: tauri::AppHandle, on: bool) -> Out<UpdateView> {
    prefs::update(&data_dir(), |p| p.check_updates = on).map_err(|e| {
        tr!(
            format!("无法保存设置：{e:#}"),
            format!("The setting could not be saved: {e:#}")
        )
    })?;
    Ok(update_view(&app))
}

/// 找到的新版本。
#[derive(Clone, serde::Serialize)]
pub struct Found {
    version: String,
}

/// 更新在内存里的那点状态。
#[derive(Default)]
pub struct Updates {
    /// 查到了、还没装的那一版。更新窗口打开时读它，设置页也读它。
    offer: std::sync::Mutex<Option<Found>>,
    /// 正在装。**连点两下不能下载两份、替换两次。**
    installing: std::sync::atomic::AtomicBool,
}

/// 更新窗口要画的东西。
#[derive(serde::Serialize)]
pub struct OfferView {
    version: String,
    current: String,
    install: update::Install,
    /// Homebrew 那一档要执行的命令。**由这里给出，界面上不再写一遍** ——
    /// 两处各写一份，改了其中一处，弹窗里复制出去的就是另一条。
    command: Option<&'static str>,
}

/// 读发布页上的清单：最新的那一版比现在新吗。
///
/// 读的是一份几百字节的 JSON，不下载任何别的东西。
pub(crate) async fn look(app: &tauri::AppHandle) -> Result<Option<Found>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let u = app.updater().map_err(|e| e.to_string())?;
    let found = u.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|up| Found {
        version: up.version.clone(),
    }))
}

/// 从网上读一段文本。
///
/// **和更新器插件同一套 TLS。**插件在它的第一次请求之前，把 ring 装成进程
/// 默认的加密实现；这里做同样的事 —— 谁先跑到都一样，装过之后再装是空
/// 操作。
pub(crate) async fn fetch_text(url: &str) -> Result<String, String> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let client = reqwest::Client::builder()
        .user_agent("ThinkWatch-Lite")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    client
        .get(url)
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}

/// 这一份现在有没有该装的新版本。
///
/// **Homebrew 那一档问的是 tap，不是发布页。**发版那一刻 latest.json 就有
/// 了新版本，而 cask 要等 tap 的定时任务跟上；在那之前提示用户执行
/// `brew upgrade`，他照做只会看到「已经是最新」。所以那一档以 cask 里的
/// 版本为准。
pub(crate) async fn find(app: &tauri::AppHandle) -> Result<Option<Found>, String> {
    if update::kind() != update::Install::Homebrew {
        return look(app).await;
    }
    let current = app.package_info().version.to_string();
    let cask = fetch_text(update::CASK_URL).await?;
    let Some(version) = update::cask_version(&cask) else {
        return Err(tr!(
            "无法从 Homebrew cask 中读取版本号",
            "The version number could not be read from the Homebrew cask"
        )
        .into());
    };
    if !update::newer(version, &current) {
        return Ok(None);
    }
    Ok(Some(Found {
        version: version.to_string(),
    }))
}

pub(crate) const UPDATE_WINDOW: &str = "update";

/// 更新窗口有多宽。**高度跟着内容走**，宽度是定死的。
///
/// 这个数是被 Homebrew 那条命令定下来的：它要在一行里完整显示出来。一条
/// 要粘进终端去执行的命令，显示成「…upgrade --cask thinkwatc」是不行的
/// —— 用户看不全自己要执行的是什么。
pub(crate) const UPDATE_WIDTH: f64 = 480.0;

/// 更新窗口。
///
/// **一个单独的小窗，不是主窗口里的一个对话框。**这是菜单栏应用：查到新
/// 版本的那一刻，主窗口多半根本不存在 —— 为了说一句话把 1100×720 的整个
/// 界面拉起来，用户点完「稍后」还得再去关一次主窗口。
///
/// **建出来先不显示。**页面画好、量出内容的高度之后，由前端自己亮出来；
/// 否则会先闪一下白窗，再跳一下尺寸。
pub(crate) fn show_update_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(UPDATE_WINDOW) {
        w.show()?;
        w.set_focus()?;
        return Ok(());
    }
    WebviewWindowBuilder::new(app, UPDATE_WINDOW, WebviewUrl::default())
        .title(tr!("软件更新", "Software Update"))
        .initialization_script(i18n::init_script())
        // 高度先随便给一个：网页画完量出内容有多高，再由 `update_fit` 定下来
        .inner_size(UPDATE_WIDTH, 220.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .center()
        .visible(false)
        .build()?;
    Ok(())
}

/// 把更新窗口调成网页量出来的那么高。
///
/// **窗口有多高，不等于网页有多高。**Tauri 在 macOS 上建的是一扇
/// `FullSizeContentView` 的窗：内容视图铺满整扇窗户，标题栏盖在它上面，
/// webview 只摆在标题栏底下那一块。而 `set_size` 说的是整扇窗户
/// （`inner_size()` 和 `outer_size()` 在这里报的也是同一个数，所以标题栏
/// 有多高，从它们之间也减不出来）—— 照着网页量出来的高度设下去，网页拿到
/// 的就少了一条标题栏，内容的最后一截被窗口下沿切掉：底部留白没了，那排
/// 按钮只剩上半截。
///
/// 标题栏多高不写死 —— 各版本不一样（Tahoe 上是 32 点），没有标题栏的窗
/// 是 0。`contentLayoutRect` 给的正是没被标题栏盖住的那一块，和整扇窗户
/// 一减就是要补上的数。
#[tauri::command]
pub fn update_fit(window: tauri::Window, height: f64) -> tauri::Result<()> {
    #[cfg(target_os = "macos")]
    {
        let w = window.clone();
        // **走 Tauri 的主线程队列，不走 GCD。**紧跟在这之后网页会把窗口
        // 亮出来，那一步排在同一条队列上；换一条队列，用户就会先看见一扇
        // 大小还没调好的窗
        window.run_on_main_thread(move || {
            let Ok(ptr) = w.ns_window() else { return };
            // SAFETY: `ns_window()` 给的是这扇窗的 NSWindow，这里在主线程上
            let ns = unsafe { &*ptr.cast::<objc2_app_kit::NSWindow>() };
            let titlebar = ns.frame().size.height - ns.contentLayoutRect().size.height;
            ns.setContentSize(objc2_foundation::NSSize::new(
                UPDATE_WIDTH,
                height + titlebar,
            ));
        })
    }
    #[cfg(not(target_os = "macos"))]
    window.set_size(tauri::LogicalSize::new(UPDATE_WIDTH, height))
}

/// 更新那条系统通知的键。点开它拉起的是更新窗口，不是主界面的某一页
pub(crate) const UPDATE_NOTICE: &str = "update";

/// 把查到的版本记下来。菜单里的「检查更新」跟着换成「安装新版本」
pub(crate) fn record(app: &tauri::AppHandle, found: Found) {
    *app.state::<Updates>().offer.lock().unwrap() = Some(found.clone());
    let _ = app.emit("update-found", found);
    if let Some(st) = app.try_state::<AppState>() {
        st.menubar.notify_one();
    }
}

/// 用户自己点了检查：查到了就把更新窗口拉起来 —— 他在等这个结果。
pub(crate) fn present(app: &tauri::AppHandle, found: Found) {
    record(app, found);
    if let Err(e) = show_update_window(app) {
        tracing::error!("更新窗口打不开：{e}");
    }
}

/// 自动检查查到了：**只发一条系统通知**，点开才拉起更新窗口。
///
/// 这一刻用户在做别的事；一扇自己冒出来、抢走焦点的窗口是打断，通知不是。
/// 选了「只在应用内」或关掉提醒的，就只剩菜单里那一项「安装新版本」和设置页。
pub(crate) fn notify_update(app: &tauri::AppHandle, found: Found) {
    let version = found.version.clone();
    record(app, found);
    if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
        n.announce(
            UPDATE_NOTICE,
            &tr!(
                format!("ThinkWatch Lite {version} 可用"),
                format!("ThinkWatch Lite {version} Is Available")
            ),
            tr!("点按此通知进行更新。", "Click to update."),
        );
    }
}

/// 查到了、还没装的那一版（菜单里「安装新版本」要写版本号）
pub(crate) fn pending_update(app: &tauri::AppHandle) -> Option<String> {
    app.try_state::<Updates>()?
        .offer
        .lock()
        .ok()?
        .as_ref()
        .map(|f| f.version.clone())
}

/// 菜单里点了「安装新版本」：把更新窗口再拉起来
pub(crate) fn show_pending_update(app: &tauri::AppHandle) {
    if let Err(e) = show_update_window(app) {
        tracing::error!("更新窗口打不开：{e}");
    }
}

/// 菜单里的「检查更新…」和设置页的「立即检查」查的是同一处
pub(crate) async fn find_update(app: &tauri::AppHandle) -> Result<Option<Found>, String> {
    find(app).await
}

pub(crate) fn present_update(app: &tauri::AppHandle, found: Found) {
    present(app, found);
}

/// 「立即检查」。查到了就把更新窗口拉起来。
#[tauri::command]
pub async fn update_check(app: tauri::AppHandle) -> Out<Option<Found>> {
    let found = find(&app).await?;
    if let Some(f) = &found {
        present(&app, f.clone());
    }
    Ok(found)
}

/// 更新窗口打开时来读：要画的是哪一版、这一份该怎么装。
#[tauri::command]
pub fn update_pending(app: tauri::AppHandle) -> Option<OfferView> {
    let found = app.state::<Updates>().offer.lock().unwrap().clone()?;
    let install = update::kind();
    Some(OfferView {
        version: found.version,
        current: app.package_info().version.to_string(),
        install,
        command: (install == update::Install::Homebrew).then_some(update::BREW_UPGRADE),
    })
}

/// 把 Homebrew 的更新命令放进剪贴板。
///
/// **在 Rust 这边写，不用网页的剪贴板接口。**后者要看 webview 给不给写入
/// 权限，给不给、什么时候给，各个平台和版本不一样；被拒的时候它什么都不
/// 做 —— 而对一个「一键复制」的按钮，点了没反应是它唯一不能有的表现。
///
/// 命令由这里给出，不从界面传进来：webview 只能复制这一条，拿不到一个
/// 往剪贴板里写任意内容的口子。
#[tauri::command]
pub fn update_copy_command(app: tauri::AppHandle) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard()
        .write_text(update::BREW_UPGRADE)
        .map_err(|e| e.to_string().into())
}

/// 重启之前在数据目录里留一句「从哪一版换过来的」，起来之后读它。
pub(crate) const UPDATED_FROM: &str = ".updated-from";

/// 等手上的请求结束，最多等多久。
///
/// 一次带长思考的回答流上一两分钟是常事；等得比这更久，多半是一直有新
/// 请求接上来 —— 那时候不重启，更新就永远不会发生，而用户按过「下载并
/// 安装」，他要的是它发生。
pub(crate) const DRAIN_LIMIT: std::time::Duration = std::time::Duration::from_secs(180);

/// 更新走到了哪一步。更新窗口按它换文案。
#[derive(Clone, serde::Serialize)]
#[serde(tag = "step", rename_all = "snake_case")]
pub(crate) enum Step {
    Downloading,
    Waiting { in_flight: usize },
    Installing,
    Restarting,
}

/// 等网关手上的请求都结束。
///
/// **重启会掐断所有还没结束的流**：一个正在吐字的 Claude Code 任务，那段
/// 输出就没了，那个请求得从头再发一次。等计数归零，重启就落在两个请求
/// 之间的空档里。
///
/// 问不到（core 不在跑、控制面没答应）就不等 —— 没有网关，也就没有要保护
/// 的请求。
pub(crate) async fn wait_for_quiet(app: &tauri::AppHandle, control: &ControlClient) {
    let started = std::time::Instant::now();
    let mut waited = false;
    loop {
        let s = match control.status().await {
            Ok(s) => s,
            Err(e) => {
                tracing::info!("更新：问不到网关的状态，不等（{e:#}）");
                return;
            }
        };
        if s.in_flight == 0 {
            if waited {
                tracing::info!("更新：请求都结束了，等了 {:?}", started.elapsed());
            }
            return;
        }
        if started.elapsed() >= DRAIN_LIMIT {
            tracing::warn!(
                "更新：等了 {DRAIN_LIMIT:?} 还有 {} 个请求没结束，照常重启",
                s.in_flight
            );
            return;
        }
        if !waited {
            tracing::info!(
                "更新：网关手上还有 {} 个请求，等它们结束再重启",
                s.in_flight
            );
            waited = true;
        }
        let _ = app.emit(
            "update-step",
            Step::Waiting {
                in_flight: s.in_flight,
            },
        );
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

/// 下载、等手上的请求结束、替换、重启。**按一次之后不再问任何问题。**
///
/// **Homebrew 装的一律拒绝。**理由在 `update` 模块开头。这里再挡一次，是
/// 因为这是一条策略 —— 只靠界面上那个按钮不显示来维持，等于让一次渲染的
/// 疏忽去降级用户的安装。
///
/// **先下载，再等，最后才替换。**反过来的话，磁盘上的包在等待的那几分钟
/// 里已经是新版本了 —— 这期间 core 万一退出，守护会从磁盘上拉起一个和
/// 正在运行的界面不是同一版的网关。
#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    hub: tauri::State<'_, Updates>,
) -> Out<()> {
    use std::sync::atomic::Ordering;
    use tauri_plugin_updater::UpdaterExt;

    let install = update::kind();
    if !install.can_self_update() {
        return Err(match install {
            update::Install::Homebrew => tr!(
                format!(
                    "此应用由 Homebrew 管理，请在终端中执行：{}",
                    update::BREW_UPGRADE
                ),
                format!(
                    "This app is managed by Homebrew. Run this command in Terminal: {}",
                    update::BREW_UPGRADE
                )
            )
            .into(),
            _ => tr!(
                "开发构建不执行自动更新",
                "Development builds do not update automatically"
            )
            .into(),
        });
    }
    if hub.installing.swap(true, Ordering::SeqCst) {
        return Err(tr!("更新正在进行中", "An update is already in progress").into());
    }
    // 中途失败要把标记放回去，否则再点一次会被当成「已经在进行中」
    struct Release<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }
    let _release = Release(&hub.installing);

    let up = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or_else(|| tr!("已是最新版本", "Already up to date").to_string())?;

    let _ = app.emit("update-step", Step::Downloading);
    let h = app.clone();
    let bytes = up
        .download(
            move |chunk, total| {
                let _ = h.emit("update-progress", (chunk, total));
            },
            || {},
        )
        .await
        .map_err(|e| tr!(format!("下载失败：{e}"), format!("Download failed: {e}")))?;
    // 发布页上只有 DMG，插件只装 `.app.tar.gz` —— 见 `dmg`。放在等请求之前：
    // 包打不开的话，不该先让用户白等几分钟
    #[cfg(target_os = "macos")]
    let bytes = tauri::async_runtime::spawn_blocking(move || dmg::app_archive(&bytes))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| {
            tr!(
                format!("无法打开更新包：{e}"),
                format!("The update could not be opened: {e}")
            )
        })?;

    wait_for_quiet(&app, &state.control).await;

    let _ = app.emit("update-step", Step::Installing);
    // 起来之后说一声换到了哪一版。写不进去不影响更新本身。
    let marker = data_dir().join(UPDATED_FROM);
    let from = app.package_info().version.to_string();

    // **Windows 上 `install` 不回来。**插件拉起新版本的安装程序之后当场
    // `exit(0)`，排在它后面的每一步都轮不到 —— 所以标记和停 core 都得挪到
    // 它前面。停 core 在那边还是硬要求：`twcore.exe` 还在跑的话，安装程序
    // 覆盖不了一个被占用的文件。
    #[cfg(windows)]
    {
        let _ = std::fs::write(&marker, &from);
        let _ = app.emit("update-step", Step::Restarting);
        state
            .supervisor
            .stop_and_wait(std::time::Duration::from_secs(5))
            .await;
        if let Err(e) = up.install(&bytes) {
            // 最常见的是 UAC 那一下点了「否」。**把刚才做的两件事都撤回来**：
            // 不撤的话，网关就这么停着，而下次启动还会说一句没发生过的「已更新」。
            let _ = std::fs::remove_file(&marker);
            resume_after_failed_update(&app).await;
            return Err(tr!(
                format!("安装失败：{e}"),
                format!("Installation failed: {e}")
            )
            .into());
        }
        // 走到这里说明插件没有照它自己说的那样退出。那就和其他平台一样，自己重启
    }
    #[cfg(not(windows))]
    {
        up.install(&bytes).map_err(|e| {
            tr!(
                format!("安装失败：{e}"),
                format!("Installation failed: {e}")
            )
        })?;
        let _ = std::fs::write(&marker, &from);
        let _ = app.emit("update-step", Step::Restarting);
        // 先停掉 core、等它真的退出，再重启应用 —— 否则新起来的应用会先撞上
        // 旧 core 手里的锁。见 `Supervisor::stop_and_wait`。
        state
            .supervisor
            .stop_and_wait(std::time::Duration::from_secs(5))
            .await;
    }
    app.restart()
}

/// 更新没装成，把为它停掉的网关接回来。
///
/// **先等守护循环真的退干净。**`stop_and_wait` 在 core 翻成「已停止」时就
/// 返回了，而循环要再走一步才把「正在守护」放下；这之间去拉，会被当成
/// 「守护还在，重启一下」，然后因为 core 不在跑而什么也不做。
#[cfg(windows)]
pub(crate) async fn resume_after_failed_update(app: &tauri::AppHandle) {
    use std::sync::atomic::Ordering;
    let state = app.state::<AppState>();
    for _ in 0..40 {
        if !state.supervising.load(Ordering::SeqCst) {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    if let Err(e) = restart_gateway(app).await {
        tracing::error!("更新没装成，网关也没能接回来：{e}");
    }
}

/// 上一次是被更新重启的话，说一声换到了哪一版。
///
/// **只在版本真的变了时说。**标记是重启之前写下的；替换没成功、起来的
/// 还是原来那一版的话，这句话就是假的。
pub(crate) fn announce_update(app: &tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;
    let marker = data_dir().join(UPDATED_FROM);
    let Ok(from) = std::fs::read_to_string(&marker) else {
        return;
    };
    let _ = std::fs::remove_file(&marker);
    let now = app.package_info().version.to_string();
    let from = from.trim();
    if from.is_empty() || from == now {
        return;
    }
    let _ = app
        .notification()
        .builder()
        .title(tr!(format!("已更新到 {now}"), format!("Updated to {now}")))
        .body(tr!(
            format!("ThinkWatch Lite 已从 {from} 更新到 {now}。"),
            format!("ThinkWatch Lite was updated from {from} to {now}.")
        ))
        .show();
}

/// 第一次检查之前先等一会儿。
///
/// **不在启动那一刻查。**冷启动那几秒 CPU 和网络都在忙别的 —— 网关要起
/// 来、控制面要连上；而「有没有新版本」晚两分钟知道，没有任何损失。
pub(crate) const UPDATE_FIRST_LOOK: std::time::Duration = std::time::Duration::from_secs(120);

/// 此后一天查一次。**版本不会一天发好几次**，查得更勤只是多几次请求。
///
/// 点过「稍后」的版本，在下一次检查时再提 —— 也就是一天之后。
pub(crate) const UPDATE_EVERY: std::time::Duration = std::time::Duration::from_secs(24 * 60 * 60);

/// 自动检查。查到了就发一条系统通知。
///
/// **开发构建不自己去查。**每次 `tauri dev` 之后两分钟弹一个窗，写代码的
/// 人学会的只是把它关掉。「立即检查」在开发构建里照样能用。
pub(crate) async fn update_loop(app: tauri::AppHandle) {
    tokio::time::sleep(UPDATE_FIRST_LOOK).await;
    loop {
        // 每一轮都重读设置 —— 用户可能在跑着的时候把它关了，那时这个
        // 循环要立刻听话，而不是等到下次启动。
        if update::kind() != update::Install::Dev && prefs::load(&data_dir()).check_updates {
            match find(&app).await {
                Ok(Some(f)) => notify_update(&app, f),
                Ok(None) => {}
                // 查不到就下次再说。**不告诉用户** —— 网络不通不是他此刻
                // 要处理的事，而一句「检查更新失败」只会打断他在做的事。
                Err(e) => tracing::debug!("检查更新：{e}"),
            }
        }
        tokio::time::sleep(UPDATE_EVERY).await;
    }
}
