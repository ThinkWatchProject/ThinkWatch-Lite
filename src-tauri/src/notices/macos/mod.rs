//! macOS 的系统通知：`UNUserNotificationCenter`。
//!
//! 换掉 `tauri-plugin-notification` 的理由只有一条：那个插件在桌面端**发出即不管** ——
//! 不能按 id 原地更新、不能撤回、点了没有回调，而总线的「同一件事只说一次、恢复时
//! 撤回、点开落到能处理它的那一页」三件事都要靠这些。
//!
//! # 2026-09-18 实测过的前提
//!
//! - **没有团队 ID 的签名也能拿到授权**（临时签名即可；发布用的自签名证书只会更好）。
//!   但应用得装在正式位置、在系统里登记过 —— 放在临时目录里的包，申请授权会被直接拒绝，
//!   连弹窗都没有
//! - 菜单栏模式（没有窗口）照样能弹；同一个 identifier 再发是**原地替换**；
//!   `removeDelivered` 能撤回；点通知能收到回调
//!
//! 真正调通知中心的那几行在 [`un`]，这里只是把它接到总线上。

pub mod un;

use super::{Notice, Sink};

pub use un::available;

/// 接上通知中心：点了通知就把窗口带回来，落到那一条对应的页面
pub fn install(app: tauri::AppHandle) {
    un::install(Box::new(move |key| {
        super::open_from_notification(&app, &key)
    }));
}

/// macOS 原生的系统通知
pub struct NativeSink;

impl Sink for NativeSink {
    fn show(&self, notice: &Notice) {
        un::post(
            notice.key.clone(),
            notice.title.clone(),
            notice.body.clone(),
            thread_of(notice),
            false,
        );
    }

    /// **只更新弹过的那些**：没弹过的（被压下、只进应用内的）不该借更新的名义冒出来
    fn update(&self, notice: &Notice) {
        if !notice.notified {
            return;
        }
        let title = if notice.count > 1 {
            format!("{}（{} 次）", notice.title, notice.count)
        } else {
            notice.title.clone()
        };
        un::post(
            notice.key.clone(),
            title,
            notice.body.clone(),
            thread_of(notice),
            true,
        );
    }

    fn withdraw(&self, key: &str) {
        un::withdraw(key);
    }
}

/// 同一类的归在一起：用类别的标识做 thread
fn thread_of(notice: &Notice) -> String {
    serde_json::to_value(notice.category)
        .ok()
        .and_then(|v| v.as_str().map(str::to_string))
        .unwrap_or_default()
}
