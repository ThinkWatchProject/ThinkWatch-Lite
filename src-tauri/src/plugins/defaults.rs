//! core 自带的默认插件在这一侧的说法：系统的确认框、通知里的名字和设置项的标签。
//!
//! **表只有一张，在 `src/i18n/plugin-defaults.json`**，界面（`src/plugins/defaults.ts`）
//! 读的是同一份，这里 `include_str!`。默认插件的 manifest 里名字、说明和标签都是英文；
//! 界面上看到「指定回答语言」，系统的确认框里也得是这几个字，用户才认得出是同一个
//! 插件。
//!
//! **按 id 认，manifest 的名字也得对得上**（core 发的那一个）：用户删掉默认插件之后自己
//! 装了一个、恰好用了同一个 id 的，照它自己写的名字说 —— 不能拿默认插件的名字替一个
//! 别人写的插件作保。

use std::collections::HashMap;
use std::sync::OnceLock;

use serde::Deserialize;

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

/// 是 core 自带的那一个插件：id 对得上，manifest 的名字也是 core 发的那一个
fn entry(id: Option<&str>, name: &str) -> Option<&'static Words> {
    let id = id?;
    let e = table()
        .plugins
        .iter()
        .find(|e| e.id == id && e.manifest_name == name)?;
    Some(tr!(&e.zh, &e.en))
}

/// 插件在这一侧叫什么。默认插件按当前语言说，别的照它自己写的
pub fn name(id: Option<&str>, name: &str) -> String {
    entry(id, name)
        .and_then(|w| w.name.clone())
        .unwrap_or_else(|| name.to_string())
}

/// 一个设置项的标签。参数同 [`name`]，`key` 是设置项的键，`label` 是 manifest 写的
pub fn label(id: &str, name: &str, key: &str, label: &str) -> String {
    entry(Some(id), name)
        .and_then(|w| w.settings.get(key).cloned())
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

    /// 同一个 id、别人写的插件：照它自己写的说
    #[test]
    fn someone_elses_plugin_under_a_default_id_keeps_its_own_name() {
        crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
            assert_eq!(name(Some("wsl-paths"), "路径小工具"), "路径小工具");
            assert_eq!(
                label("wsl-paths", "路径小工具", "windows_client", "开关"),
                "开关"
            );
            let wsl = "Convert WSL and Windows paths";
            assert_eq!(name(None, wsl), wsl);
        });
    }
}
