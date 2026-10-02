//! macOS：`NSAlert`。和退出前的确认（`menubar::macos::confirm_quit`）同一个做法。

use std::ptr::NonNull;

use block2::RcBlock;
use objc2::MainThreadMarker;
use objc2_app_kit::{
    NSAlert, NSAlertFirstButtonReturn, NSAlertSecondButtonReturn, NSAlertStyle, NSApplication,
    NSEvent, NSEventMask,
};
use objc2_foundation::NSString;

use super::super::words::Ask;

/// Esc 的键码
const KEY_ESCAPE: u16 = 53;

/// 投到主线程上问。**走 GCD 的主队列**：菜单栏的菜单开着时主线程在事件跟踪模式，
/// 别的投递方式要等菜单关了才执行
pub(super) fn show(ask: Ask, tx: tokio::sync::oneshot::Sender<bool>) {
    dispatch2::DispatchQueue::main().exec_async(move || {
        let mtm = MainThreadMarker::new().expect("主队列就在主线程上");
        let _ = tx.send(run(mtm, &ask));
    });
}

fn run(mtm: MainThreadMarker, ask: &Ask) -> bool {
    let app = NSApplication::sharedApplication(mtm);
    #[allow(deprecated)]
    app.activateIgnoringOtherApps(true);
    let alert = NSAlert::new(mtm);
    alert.setAlertStyle(if ask.danger {
        NSAlertStyle::Critical
    } else {
        NSAlertStyle::Warning
    });
    // 两段都是纯文本：NSAlert 不解释标记，插件名里写什么都只是字
    alert.setMessageText(&NSString::from_str(&ask.message));
    alert.setInformativeText(&NSString::from_str(&ask.detail));
    // **取消是默认按钮**（回车）。要明说：标题恰好是英文「Cancel」时，AppKit 给它配的是
    // Esc，对话框里就没有默认按钮了
    let cancel = alert.addButtonWithTitle(&NSString::from_str(tr!("取消", "Cancel")));
    cancel.setKeyEquivalent(&NSString::from_str("\r"));
    let accept = alert.addButtonWithTitle(&NSString::from_str(&ask.accept));
    // 确认没有快捷键：只能用鼠标点（或者 Tab 过去按空格）
    accept.setKeyEquivalent(&NSString::from_str(""));
    if ask.danger {
        accept.setHasDestructiveAction(true);
    }
    // Esc 也是取消。一个按钮只有一个快捷键，所以在对话框开着的这段时间里单独接住它
    let esc = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        if unsafe { event.as_ref() }.keyCode() == KEY_ESCAPE {
            NSApplication::sharedApplication(mtm).stopModalWithCode(NSAlertFirstButtonReturn);
            return std::ptr::null_mut();
        }
        event.as_ptr()
    });
    let monitor = unsafe {
        NSEvent::addLocalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &esc)
    };
    let answer = alert.runModal();
    if let Some(monitor) = monitor {
        unsafe { NSEvent::removeMonitor(&monitor) };
    }
    // 只有点了确认才算：模态被系统收掉之类别的返回值一律当没点
    answer == NSAlertSecondButtonReturn
}
