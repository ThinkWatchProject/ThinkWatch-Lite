//! 系统原生的确认对话框（I12）。
//!
//! **为什么不能在网页里问。**安装插件、更换代码、确认文件变更，是把一段会改写每一个请求的
//! 代码放进网关。网页里的「确定」，网页里的脚本自己就能点 —— 一段混进页面的脚本可以一声
//! 不响地装上一个插件。系统的对话框画在网页之外，脚本点不到、键盘事件也伪造不到。
//!
//! 三个平台各用自己的：macOS 是 `NSAlert`，Windows 是 `MessageBoxW`，Linux 是 GTK 的
//! `MessageDialog`（都是应用本来就链接着的东西，不多一个依赖）。
//!
//! 共同的规矩：
//!
//! - **默认按钮是「取消」**：对话框弹出的那一刻，用户的手可能正按在回车上。确认要明确地点。
//! - Esc、关窗、对话框没弹出来（主线程不接、窗口不在）一律算取消。
//! - **一次只问一件事**：上一个还开着时，再来的请求直接失败，不在背后排队 —— 否则一段脚本
//!   能连发十次，用户关掉一个又冒出一个。

use std::sync::atomic::{AtomicBool, Ordering};

use super::words::Ask;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
// 只用 std 和 windows-sys，不引 `crate::`：在别的平台上能摘进一个小 crate 交叉编译检查
#[cfg(windows)]
mod windows;

/// 正在问。一次只问一件事（见模块说明）
static ASKING: AtomicBool = AtomicBool::new(false);

/// 问的时候占着，问完（包括中途出错、future 被丢掉）放开
struct Turn;

impl Turn {
    fn take() -> Option<Self> {
        ASKING
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
            .then_some(Turn)
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        ASKING.store(false, Ordering::SeqCst);
    }
}

/// 已经有一个确认对话框开着
#[derive(Debug)]
pub struct Busy;

/// 问一句，等用户回答。`Ok(true)` 是点了确认；取消、Esc、弹不出来都是 `Ok(false)`。
pub async fn ask(app: &tauri::AppHandle, ask: Ask) -> Result<bool, Busy> {
    let Some(_turn) = Turn::take() else {
        return Err(Busy);
    };
    let (tx, rx) = tokio::sync::oneshot::channel::<bool>();
    show(app, ask, tx);
    // 发送端被丢掉（主线程没接、窗口没了）就是没点确认
    Ok(rx.await.unwrap_or(false))
}

#[cfg(target_os = "macos")]
fn show(_app: &tauri::AppHandle, ask: Ask, tx: tokio::sync::oneshot::Sender<bool>) {
    macos::show(ask, tx);
}

#[cfg(windows)]
fn show(app: &tauri::AppHandle, ask: Ask, tx: tokio::sync::oneshot::Sender<bool>) {
    use tauri::Manager;
    // 主窗口是对话框的主人：对话框开着时它不接受点击，对话框也浮在它上面
    let owner = app
        .get_webview_window("main")
        .and_then(|w| w.hwnd().ok())
        .map_or(0, |h| h.0 as isize);
    let text = format!("{}\n\n{}\n\n{}", ask.message, ask.detail, ask.ok_hint);
    // 消息框自己转一个消息循环，阻塞调用它的线程：不占异步运行时的线程
    tauri::async_runtime::spawn_blocking(move || {
        let _ = tx.send(windows::confirm(owner, &ask.title, &text, ask.danger));
    });
}

#[cfg(target_os = "linux")]
fn show(app: &tauri::AppHandle, ask: Ask, tx: tokio::sync::oneshot::Sender<bool>) {
    let a = app.clone();
    // GTK 只能在主线程上用。投递失败时 `tx` 跟着闭包一起被丢掉，那边就当取消
    let _ = app.run_on_main_thread(move || {
        let _ = tx.send(linux::confirm(&a, &ask));
    });
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
fn show(_app: &tauri::AppHandle, _ask: Ask, tx: tokio::sync::oneshot::Sender<bool>) {
    // 没有原生对话框的平台：不确认就不写
    let _ = tx.send(false);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_one_question_at_a_time() {
        let first = Turn::take();
        assert!(first.is_some());
        assert!(Turn::take().is_none(), "开着一个的时候第二个要失败");
        drop(first);
        assert!(Turn::take().is_some(), "关掉之后又能问");
    }
}
