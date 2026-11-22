//! 选择 Lite 的界面语言，并注入各窗口。
//!
//! **语言由这里决定，界面只是照着用。**设置里选过的优先，没选过就看系统
//! 的首选语言列表，找不到支持的语言时用英文。托盘菜单和系统通知
//! 在没有窗口的时候也要说话，所以这个判断不能放在网页里。
//!
//! 网页拿到的是加载之前注入的 `window.__TW_LANG__`（见 [`init_script`]），
//! 不是一次异步查询 —— 否则每次开窗都会先用错的语言画一帧。
//!
//! **core 不做翻译，只说英文。**它发来的每一句给人看的话都是一条
//! `tw_api::Msg`：一个稳定的码、填进句子的参数，以及英文原句。界面拿码去
//! `src/i18n/core.i18n.ts` 里找翻译；码不在表里就显示英文原句。
//!
//! Rust 自己的文案用 `tr!`，Core 的消息交给 `core_text`。

use std::sync::atomic::{AtomicU8, Ordering};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
#[repr(u8)]
pub enum Lang {
    #[default]
    Zh,
    En,
    Ja,
    #[serde(rename = "zh-Hant")]
    ZhHant,
    Ko,
    Es,
}

impl Lang {
    /// 网页和设置文件里用的写法
    pub fn as_str(self) -> &'static str {
        match self {
            Lang::Zh => "zh",
            Lang::En => "en",
            Lang::Ja => "ja",
            Lang::ZhHant => "zh-Hant",
            Lang::Ko => "ko",
            Lang::Es => "es",
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
        2 => Lang::Ja,
        3 => Lang::ZhHant,
        4 => Lang::Ko,
        5 => Lang::Es,
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
    CURRENT.store(lang as u8, Ordering::Relaxed);
}

/// 设置里的选择落到实际用哪种语言。
pub fn effective(setting: Option<Lang>) -> Lang {
    setting.unwrap_or_else(system)
}

/// 按一个语言标签（`zh-Hans-CN`、`en-US`、`zh_TW.UTF-8`）挑语言。
///
fn from_tag(tag: &str) -> Option<Lang> {
    let tag = tag.trim().to_ascii_lowercase();
    let mut parts = tag.split(['-', '_', '.', '@']);
    match parts.next()? {
        "zh" if matches!(parts.next(), Some("hant" | "tw" | "hk" | "mo")) => Some(Lang::ZhHant),
        "zh" => Some(Lang::Zh),
        "en" => Some(Lang::En),
        "ja" => Some(Lang::Ja),
        "ko" => Some(Lang::Ko),
        "es" => Some(Lang::Es),
        _ => None,
    }
}

#[cfg(any(target_os = "macos", windows, test))]
fn preferred_language<T: AsRef<str>>(tags: impl IntoIterator<Item = T>) -> Lang {
    tags.into_iter()
        .find_map(|tag| from_tag(tag.as_ref()))
        .unwrap_or(Lang::En)
}

/// 系统的首选语言。
///
/// **读 `NSLocale.preferredLanguages`，不读网页的 `navigator.language`。**
/// 后者是按应用声明过的本地化和系统偏好算出来的，而这个应用没有声明任何
/// 本地化 —— 中文系统上网页里拿到的也可能是 `en-US`。
pub fn system() -> Lang {
    #[cfg(target_os = "macos")]
    use objc2_foundation::NSLocale;
    #[cfg(target_os = "macos")]
    return preferred_language(
        NSLocale::preferredLanguages()
            .iter()
            .map(|tag| tag.to_string()),
    );
    #[cfg(windows)]
    return preferred_language(user_ui_languages());
    #[cfg(not(any(target_os = "macos", windows)))]
    from_env(|k| std::env::var(k).ok())
}

/// unix 的语言环境变量，按 POSIX 规定的先后：`LC_ALL` 盖过一切，其次是管
/// 消息文字的 `LC_MESSAGES`，最后才是 `LANG`。**空值等于没设**（规范如此，
/// 会话脚本里 `LC_ALL=` 这种写法并不少见）。
///
/// `C` / `POSIX` 是「不要本地化」的那一档：直接英文，不再往下找 —— 用户在
/// 前面那一级明确关掉了语言，不该再去 `LANG` 里翻出一个中文来。
#[cfg(any(not(any(target_os = "macos", windows)), test))]
fn from_env(var: impl Fn(&str) -> Option<String>) -> Lang {
    ["LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|k| var(k).filter(|v| !v.is_empty()))
        .and_then(|tag| from_tag(&tag))
        .unwrap_or(Lang::En)
}

/// Windows 的显示语言和首选语言列表。
#[cfg(windows)]
fn user_ui_languages() -> Vec<String> {
    use windows_sys::Win32::Globalization::{GetUserPreferredUILanguages, MUI_LANGUAGE_NAME};

    let mut count = 0;
    let mut size = 0;
    // SAFETY: A null buffer requests the required size in UTF-16 units.
    let ok = unsafe {
        GetUserPreferredUILanguages(
            MUI_LANGUAGE_NAME,
            &mut count,
            std::ptr::null_mut(),
            &mut size,
        )
    };
    if ok == 0 || size == 0 {
        return Vec::new();
    }
    let mut buf = vec![0u16; size as usize];
    // SAFETY: buf has the capacity given in size and all output pointers are valid.
    let ok = unsafe {
        GetUserPreferredUILanguages(MUI_LANGUAGE_NAME, &mut count, buf.as_mut_ptr(), &mut size)
    };
    if ok == 0 {
        return Vec::new();
    }
    buf.split(|unit| *unit == 0)
        .take(count as usize)
        .map(String::from_utf16_lossy)
        .collect()
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

/// 按当前语言选择文案。日文缺失时使用英文。
///
/// **两种说法写在一起。**分开放在两份词表里的话，改了一边忘了另一边是
/// 迟早的事；并排写着，漏一边在代码评审里一眼就能看见。
#[macro_export]
macro_rules! tr {
    ($zh:expr, $en:expr $(,)?) => {
        match $crate::i18n::current() {
            $crate::i18n::Lang::Zh | $crate::i18n::Lang::ZhHant => $zh,
            _ => $en,
        }
    };
    ($zh:expr, $en:expr, $ja:expr $(,)?) => {
        match $crate::i18n::current() {
            $crate::i18n::Lang::Zh | $crate::i18n::Lang::ZhHant => $zh,
            $crate::i18n::Lang::Ja => $ja,
            _ => $en,
        }
    };
    ($zh:expr, $en:expr $(, $ja:expr)?; $hant:expr, $ko:expr, $es:expr $(,)?) => {
        match $crate::i18n::current() {
            $crate::i18n::Lang::ZhHant => $hant,
            $crate::i18n::Lang::Ko => $ko,
            $crate::i18n::Lang::Es => $es,
            _ => $crate::tr!($zh, $en $(, $ja)?),
        }
    };
    ($zh:expr, $en:expr $(, $ja:expr)?; $hant:expr $(,)?) => {
        match $crate::i18n::current() {
            $crate::i18n::Lang::ZhHant => $hant,
            _ => $crate::tr!($zh, $en $(, $ja)?),
        }
    };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn language_tags_and_preference_order() {
        for tag in ["zh", "zh-Hans", "zh-Hans-CN", "zh_CN.UTF-8", "zh-Hans-TW"] {
            assert_eq!(from_tag(tag), Some(Lang::Zh), "{tag}");
        }
        for tag in ["ja", "ja-JP", " JA_jp.UTF-8 "] {
            assert_eq!(from_tag(tag), Some(Lang::Ja), "{tag}");
        }
        for tag in ["zh-Hant", "zh-Hant-TW", "zh_TW.UTF-8", "ZH-hk", "zh-MO"] {
            assert_eq!(from_tag(tag), Some(Lang::ZhHant), "{tag}");
        }
        assert_eq!(from_tag("ko_KR.UTF-8"), Some(Lang::Ko));
        assert_eq!(from_tag("es-419"), Some(Lang::Es));
        assert_eq!(from_tag("es-MX"), Some(Lang::Es));
        assert_eq!(preferred_language(["fr-FR", "ja-JP", "en-US"]), Lang::Ja);
        assert_eq!(preferred_language(["en-US", "ja-JP"]), Lang::En);
        assert_eq!(preferred_language(["fr-FR", "zhuang", ""]), Lang::En);
    }

    #[test]
    fn a_choice_in_settings_wins_over_the_system() {
        assert_eq!(effective(Some(Lang::En)), Lang::En);
        assert_eq!(effective(Some(Lang::Zh)), Lang::Zh);
        assert_eq!(effective(Some(Lang::Ja)), Lang::Ja);
    }

    /// **断言的是「里面有什么」，不是「一字不差是什么」。**这一行还会再长
    /// —— 每加一样首帧之前就要知道的东西就多一段 —— 而一条把整行写死的断言
    /// 每次都要跟着改，改的时候没人会重新想一遍它到底在保证什么。
    #[test]
    fn the_injected_line_names_the_language_and_the_platform() {
        for (lang, tag) in [
            (Lang::En, "en"),
            (Lang::Zh, "zh"),
            (Lang::Ja, "ja"),
            (Lang::ZhHant, "zh-Hant"),
            (Lang::Ko, "ko"),
            (Lang::Es, "es"),
        ] {
            assert_eq!(serde_json::to_value(lang).unwrap(), tag);
            assert_eq!(
                serde_json::from_value::<Lang>(serde_json::json!(tag)).unwrap(),
                lang
            );
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
        assert_eq!(pick(&[("LANG", "ja_JP.UTF-8")]), Lang::Ja);
        assert_eq!(
            pick(&[("LC_MESSAGES", "en_US.UTF-8"), ("LANG", "zh_CN.UTF-8")]),
            Lang::En
        );
        assert_eq!(
            pick(&[("LC_ALL", "zh_TW.UTF-8"), ("LC_MESSAGES", "en_US.UTF-8")]),
            Lang::ZhHant
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
        assert_eq!(with_lang(Lang::Ja, || tr!("关闭", "Close")), "Close");
        assert_eq!(
            with_lang(Lang::Ja, || tr!("关闭", "Close", "閉じる")),
            "閉じる"
        );
    }
}
