//! 界面外观：浅色、深色，或者跟随系统。
//!
//! **换的是窗口的外观，不是一套 CSS。**shadcn 的常规做法是在 `<html>` 上
//! 挂一个 `.dark` 类，并把 Tailwind 的 `dark:` 重定义成「祖先有这个类」；
//! 这个项目没有那个类，两百多处 `dark:` 走的是 `prefers-color-scheme`
//! （`src/index.css` 开头那段说的就是这件事）。改成类切换，等于把那两百多
//! 处一起作废，再补一段在首屏之前跑的内联脚本。
//!
//! 所以这里换的是 `NSApp` 的外观：WKWebView 继承它，网页里的
//! `prefers-color-scheme` 跟着翻，**界面一行 CSS 都不用改**。
//!
//! 代价是它在 macOS 上是应用级的（Tauri 的 `set_theme` 文档写明了），不是
//! 单个窗口的 —— 对一个只有一个窗口的应用来说，正是想要的那个范围。菜单栏
//! 上那个图标不受影响：它是模板图，靠 alpha 跟随菜单栏自己的亮暗。

use tauri::Manager;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}

impl From<Theme> for tauri::Theme {
    fn from(t: Theme) -> Self {
        match t {
            Theme::Light => tauri::Theme::Light,
            Theme::Dark => tauri::Theme::Dark,
        }
    }
}

/// 系统现在是深色还是浅色。
///
/// **读 `AppleInterfaceStyle`，不问窗口。**窗口的 `theme()` 返回的是当前
/// 生效的那个 —— 一旦设过覆盖，它答的就是我们自己刚写进去的值，而设置页
/// 要说的是「跟随系统会得到什么」。这个用户默认项只反映系统的设置。
pub fn system() -> Theme {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSString, NSUserDefaults};
        let defaults = NSUserDefaults::standardUserDefaults();
        let key = NSString::from_str("AppleInterfaceStyle");
        // 浅色时这一项根本不存在，深色时是 "Dark"
        let dark = defaults
            .stringForKey(&key)
            .is_some_and(|v| v.to_string().eq_ignore_ascii_case("dark"));
        if dark { Theme::Dark } else { Theme::Light }
    }
    #[cfg(not(target_os = "macos"))]
    Theme::Light
}

/// 设置里的选择落到实际用哪一种。
pub fn effective(setting: Option<Theme>) -> Theme {
    setting.unwrap_or_else(system)
}

/// 把选择应用到窗口上。`None` 是交还给系统。
///
/// **传 `None` 而不是 `Some(system())`。**两者当下画出来一样，但前者之后
/// 跟着系统走，后者会把这一刻的样子钉死 —— 用户在系统设置里切换时，界面
/// 不动。
pub fn apply(app: &tauri::AppHandle, setting: Option<Theme>) {
    let want = setting.map(Into::into);
    for (_, w) in app.webview_windows() {
        let _ = w.set_theme(want);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_choice_wins_over_the_system_and_no_choice_follows_it() {
        assert_eq!(effective(Some(Theme::Dark)), Theme::Dark);
        assert_eq!(effective(Some(Theme::Light)), Theme::Light);
        assert_eq!(effective(None), system());
    }

    /// 设置文件里存的是 `"light"` / `"dark"`，网页发过来的也是这两个词。
    /// 换了写法，存量用户的选择会在下一次启动时静悄悄退回跟随系统。
    #[test]
    fn it_is_written_as_the_word_the_web_side_sends() {
        assert_eq!(serde_json::to_string(&Theme::Dark).unwrap(), "\"dark\"");
        assert_eq!(serde_json::to_string(&Theme::Light).unwrap(), "\"light\"");
        assert_eq!(
            serde_json::from_str::<Option<Theme>>("null").unwrap(),
            None,
            "跟随系统存成 null"
        );
    }
}
