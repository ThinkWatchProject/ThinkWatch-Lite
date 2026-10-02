//! Linux：GTK 的 `MessageDialog`（Tauri 在 Linux 上本来就是 GTK 的窗口）。
//!
//! 主文字和次要文字都是纯文本：`MessageDialog::new` 按 `%s` 填，`secondary-text` 不开
//! `secondary-use-markup`，插件名里写的标记不会被解释。
//!
//! 弹框那一段在 [`dialog`] 里（`linux/dialog.rs`），只用 gtk。

use tauri::Manager;

use super::super::words::Ask;

mod dialog;

/// 在主线程上调（`run_on_main_thread`）。主窗口是对话框的主人：对话框开着时它不接受点击
pub(super) fn confirm(app: &tauri::AppHandle, ask: &Ask) -> bool {
    let parent = app
        .get_webview_window("main")
        .and_then(|w| w.gtk_window().ok());
    dialog::run(
        parent.as_ref(),
        &dialog::Text {
            title: &ask.title,
            message: &ask.message,
            detail: &ask.detail,
            accept: &ask.accept,
            cancel: tr!("取消", "Cancel"),
        },
        ask.danger,
    )
}
