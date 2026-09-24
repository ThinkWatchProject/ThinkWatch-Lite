//! 主窗口：打开、显示、收回菜单栏，以及 `thinkwatch://` 链接。

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

use crate::{AppState, chatgpt, i18n, notices, supervisor::CoreState};

/// 分拣一批 `thinkwatch://` 链接：点开通知的落到那一条的页面，其余的交给授权回调
pub(crate) fn open_urls(app: &tauri::AppHandle, urls: &[String]) {
    let mut rest = Vec::new();
    for url in urls {
        match notices::key_from_url(url) {
            Some(key) => notices::open_from_notification(app, &key),
            None => rest.push(url.clone()),
        }
    }
    chatgpt::handle_return(app, &rest);
}

/// 把激活令牌交给这扇窗：Wayland 上合成器只给带着有效 xdg-activation 令牌的请求
/// 把窗口提到前面（X11 上同一个调用带的是启动通知的时间戳）。排在主线程上已经
/// 排着的开窗之后，所以那时窗口已经在了。来由见 `notices/linux.rs` 模块头
#[cfg(target_os = "linux")]
pub(crate) fn activate_with_token(app: &tauri::AppHandle, label: &'static str, token: String) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || {
        use gtk::prelude::GtkWindowExt;
        if let Some(w) = a.get_webview_window(label)
            && let Ok(g) = w.gtk_window()
        {
            g.set_startup_id(&token);
        }
    });
}

/// 再次启动时带来的激活令牌，转交给已经在跑的那个实例。
///
/// 从应用菜单再点一次、浏览器把 `thinkwatch://` 交给我们，都是**新起一个进程**，
/// 令牌在这个新进程的环境变量里（`XDG_ACTIVATION_TOKEN`，X11 上是
/// `DESKTOP_STARTUP_ID`）。单实例插件只把 argv 和 cwd 转过去（2.4.5
/// `platform_impl/linux.rs` 的 `ExecuteCallback`），令牌就丢了 —— GNOME 于是
/// 不把窗口提到前面，只弹一句「ThinkWatch Lite 已就绪」。托盘不可见时（Fedora
/// 原生 GNOME），再点一次应用图标是唯一的入口，所以得把令牌带过去。
///
/// 做法：每个进程一开始就把自己的令牌放进 `$XDG_RUNTIME_DIR`（只有本用户能进）；
/// 留下来的那个实例在 setup 里清掉自己那份，之后单实例回调取到的就是新进程放的。
/// 新进程先写文件、再经 D-Bus 调回调，顺序有保证。
#[cfg(target_os = "linux")]
pub(crate) mod relaunch_token {
    use std::path::PathBuf;

    fn file() -> Option<PathBuf> {
        let dir = PathBuf::from(std::env::var_os("XDG_RUNTIME_DIR")?);
        dir.is_absolute()
            .then(|| dir.join("thinkwatch-lite.activation-token"))
    }

    /// 进程一开始调：有令牌就放下
    pub fn stash() {
        let Some(token) = std::env::var("XDG_ACTIVATION_TOKEN")
            .ok()
            .or_else(|| std::env::var("DESKTOP_STARTUP_ID").ok())
            .filter(|t| !t.is_empty())
        else {
            return;
        };
        let Some(path) = file() else { return };
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let _ = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(path)
            .and_then(|mut f| f.write_all(token.as_bytes()));
    }

    /// 取走（并删掉）放着的那份
    pub fn take() -> Option<String> {
        let path = file()?;
        let token = std::fs::read_to_string(&path).ok();
        let _ = std::fs::remove_file(&path);
        token.filter(|t| !t.is_empty())
    }
}

/// 主窗口用时才建。
///
/// **「根本不创建」不是「创建后隐藏」**：后者省不了内存也省不了
/// 启动时间，而且窗口会有一帧闪烁 —— 开机的时候屏幕上什么都不该出现。
///
/// **热启动先藏着建。**关窗即销毁 webview，所以重开窗口页面要重新加载一次。
/// 开窗时 core 已经在跑（关了再开，或者开机自启之后第一次点开），启动画面
/// 就没什么可说的了：窗口建好先不露面，首屏的数据取好了界面调
/// `reveal_main_window` 再出现 —— 一出现就是完整的界面，数字也是对的。
/// 数据迟迟不到也只等 [`WARM_REVEAL_CAP`]，之后交给那一页自己的骨架。
///
/// 冷启动（core 还没到运行中）照旧马上出现，由启动画面说网关走到了哪一步。
pub(crate) fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window("main") {
        // 热启动还藏着的时候又点了一次，也是这里：不等了，直接出来
        return reveal(app, &w);
    }
    // 「core 已经在跑」按当前连接算：连着远程时本机的 core 本来就停着
    let warm = app
        .try_state::<AppState>()
        .is_some_and(|s| match s.link.state() {
            crate::connection::LinkState::Local => {
                matches!(s.supervisor.state(), CoreState::Running { .. })
            }
            state => matches!(state, crate::connection::LinkState::Connected { .. }),
        });
    let b = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("ThinkWatch Lite")
        .initialization_script(format!(
            "{} window.__TW_WARM__ = {warm};",
            i18n::init_script()
        ))
        .inner_size(1100.0, 720.0)
        .min_inner_size(820.0, 560.0)
        .visible(!warm);
    // 把内容顶到标题栏里、藏掉标题：**这两样只有 macOS 有**，那里红绿灯
    // 浮在内容上，界面顶部那几处 `data-tauri-drag-region` 就是为它留的。
    // Windows 上用系统标题栏，所以那些留白按平台去掉了（见 App.tsx 里用
    // `isMac` 分开的那几处）—— 不去的话顶上会多出一条空的。
    #[cfg(target_os = "macos")]
    let b = b
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    let w = b.build()?;
    if !warm {
        return reveal(app, &w);
    }
    // 保底放在这边，不交给页面：页面加载出了岔子就永远不会来叫
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WARM_REVEAL_CAP).await;
        if let Some(w) = app.get_webview_window("main")
            && !w.is_visible().unwrap_or(true)
        {
            let _ = reveal(&app, &w);
        }
    });
    Ok(())
}

/// 热启动最多藏多久。点了之后超过这个数还没反应，会被当成没点中
pub(crate) const WARM_REVEAL_CAP: std::time::Duration = std::time::Duration::from_millis(300);

/// 热启动的界面首屏取好了，让窗口出现。
///
/// **已经出现了就什么都不做。**保底先到的话窗口已经在了，用户可能已经切到
/// 别的应用 —— 这时再 `set_focus` 就是抢焦点。
#[tauri::command]
pub fn reveal_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(w) = app.get_webview_window("main") else {
        return Ok(());
    };
    if w.is_visible().unwrap_or(false) {
        return Ok(());
    }
    reveal(&app, &w).map_err(|e| e.to_string())
}

pub(crate) fn reveal(app: &tauri::AppHandle, w: &tauri::WebviewWindow) -> tauri::Result<()> {
    // 有窗口了就该出现在 Dock 和 ⌘Tab 里
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    w.show()?;
    w.set_focus()
}

/// 把一扇小窗调成网页量出来的那么大（更新窗口、连接选择）。
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
pub(crate) fn fit(window: &tauri::Window, width: f64, height: f64) -> tauri::Result<()> {
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
            ns.setContentSize(objc2_foundation::NSSize::new(width, height + titlebar));
        })
    }
    #[cfg(not(target_os = "macos"))]
    window.set_size(tauri::LogicalSize::new(width, height))
}

/// 没有窗口时退回菜单栏应用：不占 Dock、不进 ⌘Tab。
#[cfg(target_os = "macos")]
pub(crate) fn become_accessory(app: &tauri::AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}
