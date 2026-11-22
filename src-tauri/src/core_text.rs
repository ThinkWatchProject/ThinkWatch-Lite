//! 系统通知和菜单栏使用的 core 消息翻译。
//!
//! 界面和 Rust 共用 `src/i18n/core.*.json`。
//! 句子的写法（参数、查词表、可有可无的一段）和界面 `src/i18n/template.ts` 是
//! 同一套，两边跑同一份用例（`src/i18n/core.zh.cases.json`）。
//!
//! 英文界面照旧用 core 给的 `text`；中文说不出来（码不在表里、缺参数、词表里
//! 查不到）也退回 `text` —— 一句完整的英文好过一句缺了主语的中文。

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use serde::Deserialize;
use tw_api::Msg;

use crate::i18n::Lang;

type Tables = HashMap<String, HashMap<String, String>>;

#[derive(Deserialize)]
struct Table {
    tables: Tables,
    #[serde(default)]
    contexts: Vec<Context>,
    messages: HashMap<String, String>,
}

/// 原因外面套的一层场合（core 的 `Msg::in_context`）：英文前面多一句「`{lead}: `」
#[derive(Deserialize)]
struct Context {
    arg: String,
    en: String,
    #[serde(flatten)]
    copy: HashMap<String, String>,
}

const SOURCE: &str = include_str!("../../src/i18n/core.zh.json");

#[derive(Deserialize)]
struct GuardCopy {
    rules: HashMap<String, RuleCopy>,
    // Only needed to check coverage against the pinned Core catalog.
    #[cfg(test)]
    kinds: HashMap<String, String>,
}

#[derive(Deserialize)]
struct RuleCopy {
    name: String,
    why: Option<String>,
    #[cfg(test)]
    about: Option<String>,
}

fn guards(lang: Lang) -> Option<&'static HashMap<String, GuardCopy>> {
    static ZH: OnceLock<HashMap<String, GuardCopy>> = OnceLock::new();
    static HANT: OnceLock<HashMap<String, GuardCopy>> = OnceLock::new();
    let (cell, source) = match lang {
        Lang::Zh => (&ZH, include_str!("../../src/i18n/guard.zh.json")),
        Lang::ZhHant => (&HANT, include_str!("../../src/i18n/guard.zh-Hant.json")),
        _ => return None,
    };
    Some(cell.get_or_init(|| serde_json::from_str(source).expect("guard catalog is valid")))
}

pub fn rule_name(lang: Lang, guard: &str, id: &str) -> Option<&'static str> {
    Some(&guards(lang)?.get(guard)?.rules.get(id)?.name)
}

fn table() -> &'static Table {
    catalog(Lang::Zh).expect("Chinese catalog is available")
}

fn catalog(lang: Lang) -> Option<&'static Table> {
    static ZH: OnceLock<Table> = OnceLock::new();
    static HANT: OnceLock<Table> = OnceLock::new();
    static JA: OnceLock<Table> = OnceLock::new();
    static KO: OnceLock<Table> = OnceLock::new();
    static ES: OnceLock<Table> = OnceLock::new();
    let (cell, source) = match lang {
        Lang::Zh => (&ZH, SOURCE),
        Lang::ZhHant => (&HANT, include_str!("../../src/i18n/core.zh-Hant.json")),
        Lang::Ja => (&JA, include_str!("../../src/i18n/core.ja.json")),
        Lang::Ko => (&KO, include_str!("../../src/i18n/core.ko.json")),
        Lang::Es => (&ES, include_str!("../../src/i18n/core.es.json")),
        Lang::En => return None,
    };
    Some(cell.get_or_init(|| {
        let mut table: Table = serde_json::from_str(source).expect("Core message catalog is valid");
        let Some(guards) = guards(lang) else {
            return table;
        };
        for (key, guard) in [("scan_rule", "inspect_tools"), ("content_rule", "content")] {
            table.tables.insert(
                key.into(),
                guards[guard]
                    .rules
                    .iter()
                    .map(|(id, copy)| (id.clone(), copy.name.clone()))
                    .collect(),
            );
        }
        table.tables.insert(
            "rule_why".into(),
            guards["inspect_tools"]
                .rules
                .iter()
                .filter_map(|(id, copy)| Some((id.clone(), copy.why.clone()?)))
                .collect(),
        );
        table
    }))
}

/// 一条 core 消息在当前语言下怎么说
pub fn text(m: &Msg) -> String {
    localized(m, crate::i18n::current()).unwrap_or_else(|| m.text.clone())
}

/// 词表里的一项（`guard`、`content_rule`…），中文。表或项不在是 `None`
pub fn table_word(lang: Lang, table: &str, key: &str) -> Option<String> {
    catalog(lang)?.tables.get(table)?.get(key).cloned()
}

/// 同 [`text`]，去掉句末的句号：后面还要接自己的一句时用
pub fn clause(m: &Msg) -> String {
    let s = text(m);
    s.strip_suffix('。')
        .or_else(|| s.strip_suffix('.'))
        .map(str::to_string)
        .unwrap_or(s)
}

/// 按码说中文，连同外面套的场合。说不出来是 None
///
/// **插件名按中文说**：`{plugin}` 是默认插件 core 发的英文名时，换成它的中文名（和插件页上
/// 一样，见 `plugins::defaults::name_in`）。消息里只有名字，按名字认
#[cfg(test)]
fn zh(m: &Msg) -> Option<String> {
    localized(m, Lang::Zh)
}

fn localized(m: &Msg, lang: Lang) -> Option<String> {
    let t = catalog(lang)?;
    if m.code.starts_with("//") {
        return None;
    }
    let say = t.messages.get(&m.code)?;
    // 识别场合时仍使用英文原句及其参数。
    let mut local_args = m.args.clone();
    if let Some(p) = local_args.get_mut("plugin") {
        *p = crate::plugins::defaults::name_in(lang, None, p);
    }
    let mut leads = String::new();
    let mut rest = m.text.as_str();
    'peel: loop {
        for c in &table().contexts {
            if !m.args.contains_key(&c.arg) {
                continue;
            }
            let Some(en) = render(&c.en, &m.args, &table().tables) else {
                continue;
            };
            let Some(after) = rest
                .strip_prefix(en.as_str())
                .and_then(|r| r.strip_prefix(": "))
            else {
                continue;
            };
            let copy = c.copy.get(lang.as_str())?;
            leads.push_str(&render(copy, &local_args, &t.tables)?);
            leads.push('：');
            rest = after;
            continue 'peel;
        }
        break;
    }
    Some(leads + &render(say, &local_args, &t.tables)?)
}

// ------------------------------------------------------------ 写法

#[derive(Debug)]
enum Node {
    Text(String),
    Arg {
        arg: String,
        table: Option<String>,
        list: bool,
        names: bool,
        fallback: Option<Vec<Node>>,
    },
    If {
        arg: String,
        then: Vec<Node>,
        other: Vec<Node>,
    },
}

struct Parser<'a> {
    s: &'a [char],
    i: usize,
}

impl Parser<'_> {
    fn peek(&self, k: usize) -> Option<char> {
        self.s.get(self.i + k).copied()
    }

    fn nodes(&mut self, stops: &[char]) -> Result<Vec<Node>, String> {
        let mut out = Vec::new();
        let mut text = String::new();
        while let Some(c) = self.peek(0) {
            if c == '{' && self.peek(1) == Some('{') {
                text.push('{');
                self.i += 2;
            } else if c == '}' && self.peek(1) == Some('}') && !stops.contains(&'}') {
                // 字面的右括号只在最外层：占位符里的 `}` 一律是收尾
                text.push('}');
                self.i += 2;
            } else if stops.contains(&c) {
                break;
            } else if c == '{' {
                if !text.is_empty() {
                    out.push(Node::Text(std::mem::take(&mut text)));
                }
                self.i += 1;
                out.push(self.placeholder()?);
            } else {
                text.push(c);
                self.i += 1;
            }
        }
        if !text.is_empty() {
            out.push(Node::Text(text));
        }
        Ok(out)
    }

    fn name(&mut self) -> Result<String, String> {
        let start = self.i;
        while let Some(c) = self.peek(0) {
            let ok = c.is_ascii_lowercase() || c == '_' || (self.i > start && c.is_ascii_digit());
            if !ok {
                break;
            }
            self.i += 1;
        }
        if self.i == start {
            return Err(format!("bad name at {start}"));
        }
        Ok(self.s[start..self.i].iter().collect())
    }

    fn expect(&mut self, c: char) -> Result<(), String> {
        if self.peek(0) != Some(c) {
            return Err(format!("expected {c} at {}", self.i));
        }
        self.i += 1;
        Ok(())
    }

    fn placeholder(&mut self) -> Result<Node, String> {
        if self.peek(0) == Some('?') {
            self.i += 1;
            let arg = self.name()?;
            self.expect(':')?;
            let then = self.nodes(&['|', '}'])?;
            let mut other = Vec::new();
            if self.peek(0) == Some('|') {
                self.i += 1;
                other = self.nodes(&['}'])?;
            }
            self.expect('}')?;
            return Ok(Node::If { arg, then, other });
        }
        let arg = self.name()?;
        let (mut table, mut list, mut names, mut fallback) = (None, false, false, None);
        match self.peek(0) {
            Some('!') => {
                self.i += 1;
                let f = self.name()?;
                if f != "names" {
                    return Err(format!("unknown filter {f}"));
                }
                names = true;
            }
            Some(':') => {
                self.i += 1;
                table = Some(self.name()?);
                if self.peek(0) == Some('*') {
                    list = true;
                    self.i += 1;
                }
                if self.peek(0) == Some('|') {
                    self.i += 1;
                    fallback = Some(self.nodes(&['}'])?);
                }
            }
            _ => {}
        }
        self.expect('}')?;
        Ok(Node::Arg {
            arg,
            table,
            list,
            names,
            fallback,
        })
    }
}

fn compile(src: &str) -> Result<Vec<Node>, String> {
    let chars: Vec<char> = src.chars().collect();
    let mut p = Parser { s: &chars, i: 0 };
    let nodes = p.nodes(&[])?;
    if p.i != chars.len() {
        return Err(format!("unbalanced template: {src}"));
    }
    Ok(nodes)
}

/// core 用反引号括的名字换成「」，并列用顿号。**成对的才换**，落单的反引号原样留着
fn names(v: &str) -> String {
    let mut out = String::new();
    let mut rest = v;
    while let Some(a) = rest.find('`') {
        let Some(b) = rest[a + 1..].find('`') else {
            break;
        };
        out.push_str(&rest[..a]);
        out.push('「');
        out.push_str(&rest[a + 1..a + 1 + b]);
        out.push('」');
        rest = &rest[a + 2 + b..];
    }
    out.push_str(rest);
    out.replace(", ", "、")
}

fn run(nodes: &[Node], args: &BTreeMap<String, String>, tables: &Tables) -> Option<String> {
    let mut out = String::new();
    for n in nodes {
        match n {
            Node::Text(s) => out.push_str(s),
            Node::If { arg, then, other } => {
                let on = args.get(arg).is_some_and(|v| !v.is_empty());
                out.push_str(&run(if on { then } else { other }, args, tables)?);
            }
            Node::Arg {
                arg,
                table,
                list,
                names: nm,
                fallback,
            } => {
                let v = args.get(arg)?;
                if *nm {
                    out.push_str(&names(v));
                    continue;
                }
                let Some(table) = table else {
                    out.push_str(v);
                    continue;
                };
                let t = tables.get(table)?;
                if *list {
                    let words: Option<Vec<&str>> = v
                        .split(", ")
                        .map(|k| t.get(k).map(String::as_str))
                        .collect();
                    out.push_str(&words?.join("、"));
                } else if let Some(w) = t.get(v) {
                    out.push_str(w);
                } else {
                    out.push_str(&run(fallback.as_ref()?, args, tables)?);
                }
            }
        }
    }
    Some(out)
}

/// 按写法填一句话。说不出来（写法坏了、缺参数、查不到）是 None
fn render(src: &str, args: &BTreeMap<String, String>, tables: &Tables) -> Option<String> {
    run(&compile(src).ok()?, args, tables)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_pinned_core_rule_and_group_has_client_copy() {
        let view = tw_guard::view::detail(&Default::default());
        for (guard, detail) in [
            ("redact", view.redact),
            ("inspect_tools", view.inspect_tools),
            ("content", view.content),
        ] {
            let copy = &guards(Lang::Zh).unwrap()[guard];
            for rule in &detail.rules {
                let r = copy
                    .rules
                    .get(&rule.id)
                    .unwrap_or_else(|| panic!("{guard}: {}", rule.id));
                assert!(!r.name.is_empty(), "{guard}: {}", rule.id);
                assert!(
                    rule.why.is_empty() || r.why.as_ref().is_some_and(|s| !s.is_empty()),
                    "{guard}: {} why",
                    rule.id
                );
                if !rule.about.is_empty()
                    && !matches!(
                        rule.matcher,
                        tw_guard::view::Matcher::Prefix { .. }
                            | tw_guard::view::Matcher::Prefixes { .. }
                    )
                {
                    assert!(
                        r.about.as_ref().is_some_and(|s| !s.is_empty()),
                        "{guard}: {} about",
                        rule.id
                    );
                }
            }
            for kind in &detail.kinds {
                assert!(
                    copy.kinds.get(&kind.slug).is_some_and(|k| !k.is_empty()),
                    "{guard}: {}",
                    kind.slug
                );
            }
        }
        for rule in &tw_guard::tools::rules::builtin().injection {
            assert!(
                rule_name(Lang::Zh, "inspect_tools", &rule.id).is_some(),
                "{}",
                rule.id
            );
        }
    }

    /// 表里每一句、每一层场合都写得对：写坏了的那句会悄悄退回英文
    #[test]
    fn every_template_in_the_table_parses() {
        for lang in [Lang::Zh, Lang::ZhHant, Lang::Ja, Lang::Ko, Lang::Es] {
            for (code, s) in &catalog(lang).unwrap().messages {
                compile(s).unwrap_or_else(|e| panic!("{lang:?} {code}: {e}"));
            }
        }
        for c in &table().contexts {
            compile(&c.en).unwrap();
            for copy in c.copy.values() {
                compile(copy).unwrap();
            }
        }
    }

    #[derive(Deserialize)]
    struct Case {
        msg: Msg,
        zh: String,
    }

    /// 默认插件的英文名在中文里换成插件页上的名字；英文照 core 的原句。别人的插件照它写的
    #[test]
    fn a_default_plugin_is_named_like_on_the_plugins_page() {
        let m = |plugin: &str| Msg {
            code: "control.plugin.needs_confirmation".into(),
            args: BTreeMap::from([("plugin".into(), plugin.into())]),
            text: format!("Plugin `{plugin}` can change the tool calls in replies, so …"),
        };
        let wsl = m("Convert WSL and Windows paths");
        crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
            assert!(
                text(&wsl).starts_with("插件「WSL 路径转换」可以修改"),
                "{}",
                text(&wsl)
            );
            let theirs = m("Rename tools");
            assert!(
                text(&theirs).starts_with("插件「Rename tools」"),
                "{}",
                text(&theirs)
            );
        });
        crate::i18n::with_lang(crate::i18n::Lang::En, || {
            assert_eq!(text(&wsl), wsl.text);
            // 中文那一句不看当前语言
            assert!(zh(&wsl).unwrap().contains("「WSL 路径转换」"));
        });
    }

    /// 和界面跑同一份用例：两份实现对同一条消息说同一句话
    #[test]
    fn the_shared_cases_say_the_same_as_the_interface() {
        let cases: Vec<Case> =
            serde_json::from_str(include_str!("../../src/i18n/core.zh.cases.json")).unwrap();
        assert!(cases.len() > 5);
        for c in cases {
            assert_eq!(
                zh(&c.msg).unwrap_or_else(|| c.msg.text.clone()),
                c.zh,
                "{}",
                c.msg.code
            );
        }
    }

    #[test]
    fn japanese_renders_a_common_error_with_context_and_falls_back_to_english() {
        let mut message = Msg {
            code: "gw.oauth.unreachable".into(),
            text: "the credential of upstream `example`: Cannot reach https://example.com: timeout"
                .into(),
            args: BTreeMap::from([
                ("upstream".into(), "example".into()),
                ("endpoint".into(), "https://example.com".into()),
                ("detail".into(), "timeout".into()),
            ]),
        };
        crate::i18n::with_lang(Lang::Ja, || {
            assert_eq!(
                text(&message),
                "アップストリーム「example」の認証情報：トークンエンドポイント https://example.com に接続できません：timeout"
            );
            message.code = "l1.tcp.refused".into();
            message.text = "Connection refused".into();
            assert_eq!(text(&message), "Connection refused");
        });
    }
}
