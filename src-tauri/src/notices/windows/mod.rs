//! Windows 的系统通知：WinRT 的 `ToastNotificationManager`。
//!
//! 换掉 `tauri-plugin-notification` 的理由和 macOS 那边一样：总线要**原地更新、撤回、
//! 点开落到对应页面**，那个插件在桌面端一样都做不到。
//!
//! # 和 macOS 的对应
//!
//! | 总线 | macOS | 这里 |
//! |---|---|---|
//! | 认出同一条 | identifier = 键 | tag + group，由键**哈希**出来 |
//! | 原地更新 | 同一个 identifier 再发一次，`Passive` | 数据绑定 + `Update`，**不重新弹** |
//! | 撤回 | `removeDelivered` | `History::RemoveGroupedTagWithId` |
//! | 点开 | delegate 回调 | 协议激活 `thinkwatch://notice/<键>` |
//! | 窗口在前台 | delegate 只给 `List` | `SuppressPopup`：直接进操作中心，不弹横幅 |
//!
//! # 前提：AUMID 的登记
//!
//! 未打包的应用发 toast 要给一个 AUMID，系统按它找通知上显示的名字和图标。这里在当前
//! 用户名下登记：`HKCU\Software\Classes\AppUserModelId\<AUMID>` 的 `DisplayName` 和
//! `IconUri`（数据目录里的一张 png，不能是 exe），由 `winreg::claim` 每次启动时写。
//! **不靠开始菜单快捷方式**：绿色版没有快捷方式。Windows App SDK 和社区工具包对未打包
//! 应用也是这么做的。没登记的 AUMID 一样弹得出来，只是名字是原始的 ID、没有图标。
//!
//! 安装版和绿色版各用各的 AUMID（见 [`aumid`]）：两份是两套独立的设置，通知各进各的
//! 分组，清理时也只删自己那一份的登记。
//!
//! 开发构建不登记（不碰注册表），[`available`] 说不能用，退回 `SystemSink` —— 那个插件
//! 在开发时借 PowerShell 的 AUMID，至少弹得出来。
//!
//! 真正调 WinRT 的那几行在 [`toast`]，这里只是把它接到总线上。下面这些纯函数**哪个
//! 平台都编**，测试在 macOS 的 CI 上也跑。

#[cfg(windows)]
pub mod toast;

use super::NOTICE_URL;
use super::sink::thread_of;

/// 发通知用的 AUMID：安装版是应用标识，绿色版在后面加 `.portable`。
///
/// **两份不共用一个**：数据、设置互不相干，通知中心里也该是两组 —— 不然撤回、原地更新
/// 按 tag 找到的可能是另一份发的那一条，清理时删登记也会删掉另一份的名字和图标
pub fn aumid(portable: bool) -> String {
    if portable {
        format!("{}.portable", crate::winreg::IDENTIFIER)
    } else {
        crate::winreg::IDENTIFIER.to_string()
    }
}

/// 键 → tag。**必须哈希**：tag 最长 64 个字符（老一些的系统上只有 16），而键是
/// `upstream:<名字>`，名字是用户起的、可以任意长、多半是中文。
///
/// 16 位十六进制正好卡在老系统的上限上。**纯函数**：撤回时只有键，得从键算回同一个
pub fn tag_of(key: &str) -> String {
    format!("{:016x}", fnv1a(key))
}

/// 键 → group：同一种的归在一起，和 macOS 的 thread 同一个依据
pub fn group_of(key: &str) -> String {
    format!("{:016x}", fnv1a(&thread_of(key)))
}

/// FNV-1a，64 位。**不用 `DefaultHasher`**：它不保证跨 Rust 版本稳定，而操作中心里
/// 那一条是上一个版本发的 —— 升级之后撤不回来，就是一条永远挂着的旧通知
fn fnv1a(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.bytes() {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// 点开这一条的链接。键里的一切都编码掉，只留 RFC 3986 的非保留字符 ——
/// 冒号、斜杠、中文都不能原样进 URL 的路径
pub fn launch_url(key: &str) -> String {
    let mut out = String::from(NOTICE_URL);
    for b in key.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// toast 的 XML。**标题和正文不进 XML**：它们走数据绑定（`{title}`、`{body}`），
/// 初值和后来的更新都从 `NotificationData` 给 —— 要用 `Update` 原地改，只能这样写。
/// 顺带，用户起的上游名字从头到尾没有机会被当成 XML 解析。
///
/// 没有 `appLogoOverride` 图标：toast 标题栏上的图标来自 AUMID 登记里的 `IconUri`
/// （见模块说明），每一条都一样，不必在 XML 里再给
pub fn toast_xml(key: &str) -> String {
    format!(
        concat!(
            r#"<toast activationType="protocol" launch="{}">"#,
            r#"<visual><binding template="ToastGeneric">"#,
            "<text>{{title}}</text><text>{{body}}</text>",
            "</binding></visual></toast>",
        ),
        escape(&launch_url(key))
    )
}

/// XML 转义。进 XML 的只有链接，而链接已经编码过了 —— **照样转**：将来谁往这份
/// XML 里多拼一样东西，不该靠记得这件事才安全
fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(windows)]
pub use native::{NativeSink, available};

#[cfg(windows)]
mod native {
    use tauri::Manager;

    use super::super::sink::counted_title;
    use super::super::{Notice, Sink};
    use super::{aumid, group_of, tag_of, toast, toast_xml};

    /// 能不能用：这次启动登记上了才行（见模块说明里的 AUMID）。开发构建不登记
    pub fn available(_app: &tauri::AppHandle) -> bool {
        crate::winreg::notifications_registered()
    }

    /// Windows 原生的系统通知
    pub struct NativeSink {
        app: tauri::AppHandle,
        /// 这一份登记的那一个，见 [`aumid`]
        aumid: String,
    }

    impl NativeSink {
        pub fn new(app: tauri::AppHandle) -> Self {
            let aumid = aumid(crate::portable::is_portable());
            Self { app, aumid }
        }

        /// **窗口在前台时不弹横幅**：用户正看着界面，应用内那条就够了。
        /// 照样进操作中心 —— 和 macOS 前台时只给 `List` 是同一个意思
        fn focused(&self) -> bool {
            self.app
                .get_webview_window("main")
                .and_then(|w| w.is_focused().ok())
                .unwrap_or(false)
        }

        fn post(&self, key: &str, title: &str, body: &str, quiet: bool) {
            let r = toast::post(
                &self.aumid,
                &toast_xml(key),
                &tag_of(key),
                &group_of(key),
                title,
                body,
                quiet,
            );
            if let Err(e) = r {
                tracing::debug!("系统通知未能发出：{e}");
            }
        }
    }

    impl Sink for NativeSink {
        fn show(&self, notice: &Notice) {
            self.post(&notice.key, &notice.title, &notice.body, self.focused());
        }

        /// **只更新弹过的那些**：没弹过的（被压下、只进应用内的）不该借更新的名义冒出来
        fn update(&self, notice: &Notice) {
            if !notice.notified {
                return;
            }
            let title = counted_title(notice);
            let tag = tag_of(&notice.key);
            let group = group_of(&notice.key);
            match toast::update(&self.aumid, &tag, &group, &title, &notice.body) {
                Ok(true) => {}
                // 操作中心里那一条已经不在了（用户划掉了，或者过期了）：**悄悄放回去，
                // 不再弹** —— 计数从 2 变 3 不是再打断一次的理由
                Ok(false) => self.post(&notice.key, &title, &notice.body, true),
                Err(e) => tracing::debug!("系统通知未能更新：{e}"),
            }
        }

        fn withdraw(&self, key: &str) {
            if let Err(e) = toast::withdraw(&self.aumid, &tag_of(key), &group_of(key)) {
                tracing::debug!("系统通知未能撤回：{e}");
            }
        }

        fn announce(&self, key: &str, title: &str, body: &str) {
            self.post(key, title, body, self.focused());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notices::key_from_url;

    #[test]
    fn tags_fit_the_oldest_limit_whatever_the_key() {
        let long = format!("upstream:{}", "很长的上游名字".repeat(40));
        for key in ["core", "upstream:a", long.as_str()] {
            assert_eq!(tag_of(key).len(), 16);
            assert_eq!(group_of(key).len(), 16);
            assert!(tag_of(key).bytes().all(|b| b.is_ascii_hexdigit()));
        }
    }

    /// 撤回时只有键：**同一个键永远算出同一个 tag**，换一个 Rust 版本也一样。
    /// 这几个数是 FNV-1a 的公开测试向量，变了就是哈希被换掉了
    #[test]
    fn tags_are_stable_across_builds() {
        assert_eq!(tag_of(""), "cbf29ce484222325");
        assert_eq!(tag_of("a"), "af63dc4c8601ec8c");
        assert_eq!(tag_of("foobar"), "85944171f73967e8");
    }

    #[test]
    fn different_things_get_different_tags_and_one_kind_shares_a_group() {
        assert_ne!(tag_of("upstream:甲"), tag_of("upstream:乙"));
        assert_eq!(group_of("upstream:甲"), group_of("upstream:乙"));
        assert_eq!(group_of("upstream:甲"), group_of("upstream:甲:recovered"));
        assert_ne!(group_of("upstream:甲"), group_of("proxy:甲"));
    }

    #[test]
    fn launch_url_encodes_everything_but_unreserved() {
        assert_eq!(
            launch_url("upstream:a b/c"),
            "thinkwatch://notice/upstream%3Aa%20b%2Fc"
        );
        assert_eq!(
            launch_url("upstream:中"),
            "thinkwatch://notice/upstream%3A%E4%B8%AD"
        );
    }

    #[test]
    fn a_launch_url_decodes_back_to_its_key() {
        for key in [
            "core",
            "upstream:我的上游 (备用)",
            "proxy:http://127.0.0.1:7890/?a=1&b=2#x",
            "upstream:<script>'\"%41",
        ] {
            assert_eq!(key_from_url(&launch_url(key)).as_deref(), Some(key));
        }
    }

    #[test]
    fn other_urls_are_not_notices() {
        assert_eq!(key_from_url("thinkwatch://chatgpt/login?x=1"), None);
        assert_eq!(key_from_url("thinkwatch://notice/"), None);
        // 截断的、编码坏了的、解出来不是 UTF-8 的
        assert_eq!(key_from_url("thinkwatch://notice/abc%4"), None);
        assert_eq!(key_from_url("thinkwatch://notice/abc%zz"), None);
        assert_eq!(key_from_url("thinkwatch://notice/%FF"), None);
    }

    #[test]
    fn the_xml_carries_placeholders_not_user_text() {
        let xml = toast_xml("upstream:<b>&'\"");
        assert!(xml.contains("<text>{title}</text><text>{body}</text>"));
        assert!(xml.contains(r#"activationType="protocol""#));
        assert!(xml.contains(r#"launch="thinkwatch://notice/upstream%3A%3Cb%3E%26%27%22""#));
        assert!(!xml.contains("<b>"));
    }

    /// 安装版就是应用标识（开始菜单快捷方式上写的也是它），绿色版另起一个
    #[test]
    fn each_kind_has_its_own_aumid() {
        assert_eq!(aumid(false), "app.thinkwatch.lite");
        assert_eq!(aumid(true), "app.thinkwatch.lite.portable");
    }

    #[test]
    fn escape_covers_all_five() {
        assert_eq!(escape(r#"a&b<c>d"e'f"#), "a&amp;b&lt;c&gt;d&quot;e&apos;f");
    }
}
