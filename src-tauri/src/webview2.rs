//! 启动之前确认 WebView2 运行时在。
//!
//! 没有它就开不了任何窗口。安装程序会替用户装上，绿色版不会；系统里被卸掉的
//! 情况两边都可能有。缺的时候用系统对话框说明，并给出微软的下载页。
//!
//! **问的是框架自己用的那一个函数**（`tauri::webview_version`，Windows 上就是 WebView2
//! 加载器的 `GetAvailableCoreWebView2BrowserVersionString`）：建窗口时找运行时走的是
//! 同一条路，它说有，窗口就开得出来。

/// 微软的 WebView2 运行时下载页，安装程序缺运行时时下载的也是它
#[cfg(windows)]
const DOWNLOAD: &str = "https://go.microsoft.com/fwlink/p/?LinkId=2124703";

/// 缺 WebView2 时弹系统对话框并退出进程。不缺、或者不是 Windows，什么都不做。
pub fn ensure() {
    #[cfg(windows)]
    if missing(tauri::webview_version()) {
        refuse();
    }
}

/// 问到的版本说明没有运行时：报错，或者答了一个空的版本号（找不到运行时的时候，
/// 有的加载器版本不报错、只是什么都不填）
#[cfg_attr(not(windows), allow(dead_code))]
fn missing<E>(version: Result<String, E>) -> bool {
    !matches!(version, Ok(v) if !v.trim().is_empty())
}

/// 说明缺什么、给下载页，然后退出。「前往下载」用默认浏览器打开微软的下载页
#[cfg(windows)]
fn refuse() -> ! {
    let picked = crate::dialog::show(
        "ThinkWatch Lite",
        tr!(
            "缺少 Microsoft Edge WebView2 运行时",
            "The Microsoft Edge WebView2 Runtime is missing"
        ),
        tr!(
            "ThinkWatch Lite 无法启动。",
            "ThinkWatch Lite cannot start."
        ),
        &[tr!("前往下载", "Download"), tr!("退出", "Quit")],
    );
    if picked == Some(0)
        && let Err(e) = tauri_plugin_opener::open_url(DOWNLOAD, None::<&str>)
    {
        tracing::warn!("打不开 WebView2 的下载页：{e}");
    }
    std::process::exit(1);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_error_or_an_empty_version_means_the_runtime_is_missing() {
        assert!(missing::<()>(Err(())));
        assert!(missing::<()>(Ok(String::new())));
        assert!(missing::<()>(Ok("  ".into())));
        assert!(!missing::<()>(Ok("131.0.2903.70".into())));
    }

    /// CI 的 Windows 机器上装着 WebView2：问得到版本号，`ensure` 放行
    #[cfg(windows)]
    #[test]
    fn the_runtime_on_this_machine_is_found() {
        let v = tauri::webview_version();
        assert!(!missing(tauri::webview_version()), "{v:?}");
    }
}
