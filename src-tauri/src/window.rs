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
    let warm = app
        .try_state::<AppState>()
        .is_some_and(|s| matches!(s.supervisor.state(), CoreState::Running { .. }));
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

/// 没有窗口时退回菜单栏应用：不占 Dock、不进 ⌘Tab。
#[cfg(target_os = "macos")]
pub(crate) fn become_accessory(app: &tauri::AppHandle) {
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Accessory);
}
