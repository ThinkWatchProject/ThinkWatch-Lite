//! 界面语言：简体中文或英文。
//!
//! **语言由这里决定，界面只是照着用。**设置里选过的优先，没选过就看系统
//! 的首选语言：中文（`zh-*`）用中文，其余一律英文。托盘菜单和系统通知
//! 在没有窗口的时候也要说话，所以这个判断不能放在网页里。
//!
//! 网页拿到的是加载之前注入的 `window.__TW_LANG__`（见 [`init_script`]），
//! 不是一次异步查询 —— 否则每次开窗都会先用错的语言画一帧。
//!
//! **core 不做翻译，从 v0.10.0 起也不再说中文。**它发来的每一句给人看的
//! 话都是一条 `tw_api::Msg`：一个稳定的码、填进句子的参数，以及英文原句。
//! 界面拿码去 `src/i18n/core.i18n.ts` 里找中文；码不在表里就显示那句英文
//! —— core 比界面新、或者是加码之前落库的老记录时，一句英文总好过一个码。
//!
//! 这个模块只管 Rust 这一侧（托盘、系统通知）自己要说的话。core 的码在
//! 这里只翻一处：通知里「卡在哪一步」那几个词（见 `notices::rules`）。

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Lang {
    #[default]
    Zh,
    En,
}

impl Lang {
    fn code(self) -> u8 {
        match self {
            Lang::Zh => 0,
            Lang::En => 1,
        }
    }

    /// 网页和设置文件里用的写法
    pub fn as_str(self) -> &'static str {
        match self {
            Lang::Zh => "zh",
            Lang::En => "en",
        }
    }
}

static CURRENT: AtomicU8 = AtomicU8::new(0);

#[cfg(test)]
thread_local! {
    /// 测试用：只改这一个线程看到的语言。**不能改全局那个** —— 测试是并行
    /// 跑的，一条测试切到英文，别的测试里的中文断言就会随机失败。
    static OVERRIDE: std::cell::Cell<Option<Lang>> = const { std::cell::Cell::new(None) };
}

/// 现在用的语言。
pub fn current() -> Lang {
    #[cfg(test)]
    if let Some(lang) = OVERRIDE.with(|o| o.get()) {
        return lang;
    }
    match CURRENT.load(Ordering::Relaxed) {
        1 => Lang::En,
        _ => Lang::Zh,
    }
}

/// 在这一个线程上按某种语言跑一段。测试用。
#[cfg(test)]
pub fn with_lang<R>(lang: Lang, f: impl FnOnce() -> R) -> R {
    OVERRIDE.with(|o| o.set(Some(lang)));
    let out = f();
    OVERRIDE.with(|o| o.set(None));
    out
}

pub fn set(lang: Lang) {
    CURRENT.store(lang.code(), Ordering::Relaxed);
}

/// 设置里的选择落到实际用哪种语言。
pub fn effective(setting: Option<Lang>) -> Lang {
    setting.unwrap_or_else(system)
}

/// 按一个语言标签（`zh-Hans-CN`、`en-US`、`zh_TW.UTF-8`）挑语言。
///
/// **繁体也归中文。**界面只有简体一种中文，而读繁体的人读简体，比读英文
/// 近得多。
pub fn from_tag(tag: &str) -> Lang {
    let tag = tag.trim().to_ascii_lowercase();
    if tag == "zh" || tag.starts_with("zh-") || tag.starts_with("zh_") {
        Lang::Zh
    } else {
        Lang::En
    }
}

/// 系统的首选语言。
///
/// **读 `NSLocale.preferredLanguages`，不读网页的 `navigator.language`。**
/// 后者是按应用声明过的本地化和系统偏好算出来的，而这个应用没有声明任何
/// 本地化 —— 中文系统上网页里拿到的也可能是 `en-US`。
pub fn system() -> Lang {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::NSLocale;
        if let Some(first) = NSLocale::preferredLanguages().firstObject() {
            return from_tag(&first.to_string());
        }
    }
    std::env::var("LANG")
        .map(|l| from_tag(&l))
        .unwrap_or(Lang::En)
}

/// 注进每个窗口的那一行：页面加载之前就知道用哪种语言。
pub fn init_script() -> String {
    script_for(current())
}

fn script_for(lang: Lang) -> String {
    format!("window.__TW_LANG__ = \"{}\";", lang.as_str())
}

/// 按当前语言二选一。
///
/// **两种说法写在一起。**分开放在两份词表里的话，改了一边忘了另一边是
/// 迟早的事；并排写着，漏一边在代码评审里一眼就能看见。
#[macro_export]
macro_rules! tr {
    ($zh:expr, $en:expr $(,)?) => {
        match $crate::i18n::current() {
            $crate::i18n::Lang::Zh => $zh,
            $crate::i18n::Lang::En => $en,
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chinese_tags_pick_chinese_and_everything_else_english() {
        for tag in [
            "zh",
            "zh-Hans",
            "zh-Hans-CN",
            "zh-Hant-TW",
            "zh_CN.UTF-8",
            "ZH-hk",
        ] {
            assert_eq!(from_tag(tag), Lang::Zh, "{tag}");
        }
        for tag in ["en", "en-US", "ja-JP", "fr_FR.UTF-8", "zhuang", ""] {
            assert_eq!(from_tag(tag), Lang::En, "{tag}");
        }
    }

    #[test]
    fn a_choice_in_settings_wins_over_the_system() {
        assert_eq!(effective(Some(Lang::En)), Lang::En);
        assert_eq!(effective(Some(Lang::Zh)), Lang::Zh);
    }

    #[test]
    fn the_injected_line_names_the_language() {
        assert_eq!(script_for(Lang::En), "window.__TW_LANG__ = \"en\";");
        assert_eq!(script_for(Lang::Zh), "window.__TW_LANG__ = \"zh\";");
    }

    #[test]
    fn tr_picks_by_the_language_of_this_thread() {
        assert_eq!(with_lang(Lang::En, || tr!("关闭", "Close")), "Close");
        assert_eq!(with_lang(Lang::Zh, || tr!("关闭", "Close")), "关闭");
    }
}
