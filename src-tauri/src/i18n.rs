//! 界面语言：简体中文或英文。
//!
//! **语言由这里决定，界面只是照着用。**设置里选过的优先，没选过就看系统
//! 的首选语言：中文（`zh-*`）用中文，其余一律英文。托盘菜单和系统通知
//! 在没有窗口的时候也要说话，所以这个判断不能放在网页里。
//!
//! 网页拿到的是加载之前注入的 `window.__TW_LANG__`（见 [`init_script`]），
//! 不是一次异步查询 —— 否则每次开窗都会先用错的语言画一帧。
//!
//! **core 不做翻译，只说英文。**它发来的每一句给人看的话都是一条
//! `tw_api::Msg`：一个稳定的码、填进句子的参数，以及英文原句。界面拿码去
//! `src/i18n/core.i18n.ts` 里找中文；码不在表里就显示那句英文 —— 一句英文
//! 总好过一个码。
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
    #[cfg(windows)]
    if let Some(tag) = user_locale() {
        return from_tag(&tag);
    }
    // **这几个变量是 unix 的东西。**Windows 上它们通常根本不存在，上面那一支
    // 答不出来时落到这里，而那时英文是唯一诚实的默认。
    from_env(|k| std::env::var(k).ok())
}

/// unix 的语言环境变量，按 POSIX 规定的先后：`LC_ALL` 盖过一切，其次是管
/// 消息文字的 `LC_MESSAGES`，最后才是 `LANG`。**空值等于没设**（规范如此，
/// 会话脚本里 `LC_ALL=` 这种写法并不少见）。
///
/// `C` / `POSIX` 是「不要本地化」的那一档：直接英文，不再往下找 —— 用户在
/// 前面那一级明确关掉了语言，不该再去 `LANG` 里翻出一个中文来。
fn from_env(var: impl Fn(&str) -> Option<String>) -> Lang {
    let Some(tag) = ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|k| var(k).filter(|v| !v.is_empty()))
    else {
        return Lang::En;
    };
    // `C.UTF-8` 也是它
    let base = tag.split(['.', '@']).next().unwrap_or_default();
    if base == "C" || base == "POSIX" {
        Lang::En
    } else {
        from_tag(&tag)
    }
}

/// 这个用户在 Windows 里选的语言，形如 `zh-CN`。
///
/// **问 `GetUserDefaultLocaleName`，不看 `LANG`。**后者在 Windows 上只有装了
/// Git Bash 之类的机器才有，而它记的是那套工具的偏好，不是用户在系统设置里
/// 选的那个 —— 照它走的话，一台中文系统会因为装过 Git 而说英文。
#[cfg(windows)]
fn user_locale() -> Option<String> {
    use windows_sys::Win32::Globalization::GetUserDefaultLocaleName;

    // `LOCALE_NAME_MAX_LENGTH` 是 85，连 NUL 在内。
    let mut buf = [0u16; 85];
    // SAFETY: 缓冲区是本地数组，长度如实告知。
    let n = unsafe { GetUserDefaultLocaleName(buf.as_mut_ptr(), buf.len() as i32) };
    if n <= 0 {
        return None;
    }
    // 返回的长度**含结尾的 NUL**，所以要去掉一个
    Some(String::from_utf16_lossy(&buf[..(n as usize) - 1]))
}

/// 注进每个窗口的那一行：页面加载之前就知道用哪种语言。
pub fn init_script() -> String {
    script_for(current())
}

/// 界面按平台分叉的地方不多，但**有几处必须在首帧之前就知道**（比如设置页
/// 里那一节该不该出现）。跟着语言一起注进去，理由也一样：一次异步查询会让
/// 第一帧画错。
pub const PLATFORM: &str = if cfg!(target_os = "macos") {
    "macos"
} else if cfg!(windows) {
    "windows"
} else if cfg!(target_os = "linux") {
    "linux"
} else {
    "other"
};

fn script_for(lang: Lang) -> String {
    format!(
        "window.__TW_LANG__ = \"{}\"; window.__TW_PLATFORM__ = \"{PLATFORM}\";",
        lang.as_str()
    )
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

    /// **断言的是「里面有什么」，不是「一字不差是什么」。**这一行还会再长
    /// —— 每加一样首帧之前就要知道的东西就多一段 —— 而一条把整行写死的断言
    /// 每次都要跟着改，改的时候没人会重新想一遍它到底在保证什么。
    #[test]
    fn the_injected_line_names_the_language_and_the_platform() {
        for (lang, tag) in [(Lang::En, "en"), (Lang::Zh, "zh")] {
            let line = script_for(lang);
            assert!(
                line.contains(&format!("window.__TW_LANG__ = \"{tag}\"")),
                "{line}"
            );
            assert!(
                line.contains(&format!("window.__TW_PLATFORM__ = \"{PLATFORM}\"")),
                "{line}"
            );
            // 注进去的是一段会被执行的 JS：每一句都要有分号收尾
            assert!(line.trim_end().ends_with(';'), "{line}");
        }
    }

    /// 这台机器编出来的那个值。写错了界面上按平台分叉的地方会全部走错支。
    #[test]
    fn the_platform_is_the_one_this_was_built_for() {
        #[cfg(target_os = "macos")]
        assert_eq!(PLATFORM, "macos");
        #[cfg(windows)]
        assert_eq!(PLATFORM, "windows");
        #[cfg(target_os = "linux")]
        assert_eq!(PLATFORM, "linux");
    }

    /// 按 POSIX 的先后取第一个非空的；`C` / `POSIX` 是英文，不再往下找。
    #[test]
    fn the_locale_variables_are_read_in_posix_order() {
        fn pick(pairs: &[(&str, &str)]) -> Lang {
            from_env(|k| {
                pairs
                    .iter()
                    .find(|(name, _)| *name == k)
                    .map(|(_, v)| v.to_string())
            })
        }
        assert_eq!(pick(&[("LANG", "zh_CN.UTF-8")]), Lang::Zh);
        assert_eq!(
            pick(&[("LC_MESSAGES", "en_US.UTF-8"), ("LANG", "zh_CN.UTF-8")]),
            Lang::En
        );
        assert_eq!(
            pick(&[("LC_ALL", "zh_TW.UTF-8"), ("LC_MESSAGES", "en_US.UTF-8")]),
            Lang::Zh
        );
        // 空值等于没设
        assert_eq!(pick(&[("LC_ALL", ""), ("LANG", "zh_CN.UTF-8")]), Lang::Zh);
        for c in ["C", "C.UTF-8", "POSIX"] {
            assert_eq!(
                pick(&[("LC_ALL", c), ("LANG", "zh_CN.UTF-8")]),
                Lang::En,
                "{c}"
            );
        }
        assert_eq!(pick(&[]), Lang::En);
    }

    #[test]
    fn tr_picks_by_the_language_of_this_thread() {
        assert_eq!(with_lang(Lang::En, || tr!("关闭", "Close")), "Close");
        assert_eq!(with_lang(Lang::Zh, || tr!("关闭", "Close")), "关闭");
    }
}
