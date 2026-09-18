//! 通知往哪儿投。
//!
//! **投递是可替换的，判定不是。**Windows 要加的是一个 sink，而不是另一套分级、
//! 去重和限流 —— 那套东西一旦有两份，两个平台上「什么时候打断用户」就会不一样。

use tauri::{Emitter, Manager};

use super::{Level, Notice};

/// 一个投递端。**每个方法都不该阻塞** —— 调用方在判定的路径上
pub trait Sink: Send + Sync {
    /// 新的一条，或者升级成了更要紧的一条
    fn show(&self, notice: &Notice);
    /// 同一件事又发生了：只更新，不再打断
    fn update(&self, _notice: &Notice) {}
    /// 事情好了，或者用户划掉了
    fn withdraw(&self, _key: &str) {}
    /// 现在开着的全部。界面按这一份重画
    fn listed(&self, _all: &[Notice]) {}
}

/// 界面里的通知中心。**窗口关着时照样调**：内容在 Rust 这边留着，
/// 下次开窗时界面自己来取
pub struct AppSink {
    app: tauri::AppHandle,
}

impl AppSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl Sink for AppSink {
    // 界面重画的依据只有一份完整列表：单条「新来了一条」会让两边的顺序和计数各说各的
    fn show(&self, _notice: &Notice) {}
    fn listed(&self, all: &[Notice]) {
        let _ = self.app.emit("notices-changed", all);
    }
}

/// 系统通知的退路：`tauri-plugin-notification`。
///
/// **装好的 macOS 应用不走这里**，走 `macos::NativeSink`。这个插件在桌面端只能「发出即
/// 不管」—— 不能按 id 原地更新、不能撤回、点了没有回调，所以 `update` 和 `withdraw`
/// 是空的。留着它是给 `tauri dev`（不在应用包里，原生通知中心拿不到）和还没有原生
/// 实现的平台用。
pub struct SystemSink {
    app: tauri::AppHandle,
}

impl SystemSink {
    pub fn new(app: tauri::AppHandle) -> Self {
        Self { app }
    }
}

impl Sink for SystemSink {
    fn show(&self, notice: &Notice) {
        use tauri_plugin_notification::NotificationExt;
        if !matches!(notice.level, Level::Warning | Level::Critical) {
            return;
        }
        // **窗口在前台时不弹**：用户正看着界面，应用内那条就够了。
        // 换成原生实现之后这一条要自己判（现在的插件在 App active 时本来就不弹横幅）
        if self
            .app
            .get_webview_window("main")
            .and_then(|w| w.is_focused().ok())
            .unwrap_or(false)
        {
            return;
        }
        let _ = self
            .app
            .notification()
            .builder()
            .title(&notice.title)
            .body(&notice.body)
            .show();
    }
}
