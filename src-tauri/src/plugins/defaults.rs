//! core 自带的默认插件在这一侧的说法：系统的确认框、通知、core 消息的中文里的名字，和设置项
//! 的标签。
//!
//! **表只有一张，在 `src/i18n/plugin-defaults.json`**，界面（`src/plugins/defaults.ts`）
//! 读的是同一份，这里 `include_str!`。默认插件的 manifest 里名字、说明和标签都是英文；
//! 界面上看到「指定回答语言」，系统的确认框里也得是这几个字，用户才认得出是同一个
//! 插件。
//!
//! **按 id 认，manifest 的名字也得对得上**（core 发的那一个）：用户删掉默认插件之后自己
//! 装了一个、恰好用了同一个 id 的，照它自己写的名字说 —— 不能拿默认插件的名字替一个
//! 别人写的插件作保。**只有名字的按名字认**：core 的消息里嵌着的插件名（`{plugin}`）不带
//! id，和 core 发的英文名一字不差的按默认插件的名字说。设置项的标签一律要 id。

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

use crate::i18n::Lang;

const SOURCE: &str = include_str!("../../../src/i18n/plugin-defaults.json");

#[derive(Deserialize)]
struct Table {
    plugins: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    id: String,
    /// core 发的那一版 manifest 里的名字
    manifest_name: String,
    zh: Words,
    en: Words,
}

#[derive(Deserialize)]
struct Words {
    /// 没有就照 manifest（英文界面就是这样）
    #[serde(default)]
    name: Option<String>,
    /// 设置项的键 → 标签
    #[serde(default)]
    settings: HashMap<String, String>,
}

fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    // 表随代码一起编进来，读不出来是开发时的错，测试会先挂
    T.get_or_init(|| serde_json::from_str(SOURCE).expect("plugin-defaults.json 读不出来"))
}

/// 是 core 自带的那一个插件：manifest 的名字是 core 发的那一个，知道 id 的 id 也对得上
fn entry(id: Option<&str>, name: &str) -> Option<&'static Entry> {
    table()
        .plugins
        .iter()
        .find(|e| e.manifest_name == name && id.is_none_or(|id| e.id == id))
}

fn words(e: &Entry, lang: Lang) -> &Words {
    match lang {
        Lang::Zh => &e.zh,
        Lang::En => &e.en,
    }
}

/// 插件在某种语言里叫什么：确认框、通知、core 的消息里（`{plugin}`）**都用这一个**。知道 id
/// 的按 id 认（manifest 的名字也得对得上）；只知道名字的（`id` 是 `None`）按 core 发的英文名
/// 认，一字不差才算。别的照它自己写的
pub fn name_in(lang: Lang, id: Option<&str>, name: &str) -> String {
    entry(id, name)
        .and_then(|e| words(e, lang).name.clone())
        .unwrap_or_else(|| name.to_string())
}

/// 同 [`name_in`]，按当前语言
pub fn name(id: Option<&str>, name: &str) -> String {
    name_in(crate::i18n::current(), id, name)
}

/// 一个设置项的标签，按当前语言。`id`、`name` 是插件的（**一定要 id**），`key` 是设置项的
/// 键，`label` 是 manifest 写的
pub fn label(id: &str, name: &str, key: &str, label: &str) -> String {
    entry(Some(id), name)
        .and_then(|e| words(e, crate::i18n::current()).settings.get(key).cloned())
        .unwrap_or_else(|| label.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 两种语言都有一份，id 不重复 —— 读得出来就是这一条
    #[test]
    fn the_table_reads_and_names_each_plugin_once() {
        let mut seen = std::collections::HashSet::new();
        for e in &table().plugins {
            assert!(seen.insert(e.id.as_str()), "{} 出现了两次", e.id);
            assert!(e.zh.name.is_some(), "{} 缺中文名", e.id);
        }
        assert!(seen.contains("reply-language"));
    }

    const REPLY: &str = "Answer in a chosen language";

    #[test]
    fn a_default_plugin_is_named_in_the_ui_language() {
        use crate::i18n::{Lang, with_lang};
        with_lang(Lang::Zh, || {
            assert_eq!(name(Some("reply-language"), REPLY), "指定回答语言");
            assert_eq!(label("reply-language", REPLY, "language", "x"), "回答语言");
        });
        // 英文界面的名字照 manifest，标签取表里的英文（不看 manifest 写的是什么）
        with_lang(Lang::En, || {
            assert_eq!(name(Some("reply-language"), REPLY), REPLY);
            assert_eq!(
                label("reply-language", REPLY, "language", "回答语言"),
                "Answer language"
            );
        });
    }

    /// 同一个 id、别人写的插件：照它自己写的说。用了默认插件的英文名、id 却不一样的，知道
    /// id 时也照它自己写的说
    #[test]
    fn someone_elses_plugin_under_a_default_id_keeps_its_own_name() {
        crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
            assert_eq!(name(Some("wsl-paths"), "路径小工具"), "路径小工具");
            assert_eq!(
                label("wsl-paths", "路径小工具", "windows_client", "开关"),
                "开关"
            );
            let wsl = "Convert WSL and Windows paths";
            assert_eq!(name(Some("my-paths"), wsl), wsl);
            assert_eq!(label("my-paths", wsl, "windows_client", "开关"), "开关");
        });
    }

    /// 只知道名字（core 的消息里那样）：和 core 发的英文名一字不差才换，大小写、空白不同的不算
    #[test]
    fn a_name_alone_is_matched_exactly() {
        let wsl = "Convert WSL and Windows paths";
        assert_eq!(name_in(Lang::Zh, None, wsl), "WSL 路径转换");
        assert_eq!(name_in(Lang::En, None, wsl), wsl);
        for near in [
            "convert wsl and windows paths",
            " Convert WSL and Windows paths",
            "WSL 路径转换",
        ] {
            assert_eq!(name_in(Lang::Zh, None, near), near);
        }
        // 不看当前语言：按码说中文的那一边（`core_text`）传的是 Zh
        crate::i18n::with_lang(Lang::En, || {
            assert_eq!(name_in(Lang::Zh, None, wsl), "WSL 路径转换");
            assert_eq!(name(None, wsl), wsl);
        });
    }

    /// 默认插件的英文名不会是一个 id：消息里 `{plugin}` 有时是 id（`config.plugin.*` 这些），
    /// 按名字认的时候不会把一个 id 认成默认插件
    #[test]
    fn no_manifest_name_reads_as_an_id() {
        for e in &table().plugins {
            let id_like = !e.manifest_name.is_empty()
                && e.manifest_name
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
            assert!(!id_like, "{}", e.manifest_name);
        }
    }
}
