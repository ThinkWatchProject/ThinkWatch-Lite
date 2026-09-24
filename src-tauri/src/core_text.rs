//! core 的消息按码说中文 —— 系统通知、菜单栏用。
//!
//! **表只有一张，在 `src/i18n/core.zh.json`**，界面和这里读的是同一份（这里
//! `include_str!`）。以前这边没有表，通知只好把 core 的英文原句嵌进中文句子里。
//! 句子的写法（参数、查词表、可有可无的一段）和界面 `src/i18n/template.ts` 是
//! 同一套，两边跑同一份用例（`src/i18n/core.zh.cases.json`）。
//!
//! 英文界面照旧用 core 给的 `text`；中文说不出来（码不在表里、缺参数、词表里
//! 查不到）也退回 `text` —— 一句完整的英文好过一句缺了主语的中文。

use std::collections::{BTreeMap, HashMap};
use std::sync::OnceLock;

use serde::Deserialize;
use tw_api::Msg;

type Tables = HashMap<String, HashMap<String, String>>;

#[derive(Deserialize)]
struct Table {
    tables: Tables,
    contexts: Vec<Context>,
    messages: HashMap<String, String>,
}

/// 原因外面套的一层场合（core 的 `Msg::in_context`）：英文前面多一句「`{lead}: `」
#[derive(Deserialize)]
struct Context {
    arg: String,
    en: String,
    zh: String,
}

const SOURCE: &str = include_str!("../../src/i18n/core.zh.json");

fn table() -> &'static Table {
    static T: OnceLock<Table> = OnceLock::new();
    // 表随代码一起编进来，读不出来是开发时的错，测试会先挂
    T.get_or_init(|| serde_json::from_str(SOURCE).expect("core.zh.json 读不出来"))
}

/// 一条 core 消息在当前语言下怎么说
pub fn text(m: &Msg) -> String {
    tr!(zh(m).unwrap_or_else(|| m.text.clone()), m.text.clone())
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
pub fn zh(m: &Msg) -> Option<String> {
    let t = table();
    if m.code.starts_with("//") {
        return None;
    }
    let say = t.messages.get(&m.code)?;
    let mut leads = String::new();
    let mut rest = m.text.as_str();
    'peel: loop {
        for c in &t.contexts {
            if !m.args.contains_key(&c.arg) {
                continue;
            }
            let Some(en) = render(&c.en, &m.args, &t.tables) else {
                continue;
            };
            let Some(after) = rest
                .strip_prefix(en.as_str())
                .and_then(|r| r.strip_prefix(": "))
            else {
                continue;
            };
            leads.push_str(&render(&c.zh, &m.args, &t.tables)?);
            leads.push('：');
            rest = after;
            continue 'peel;
        }
        break;
    }
    Some(leads + &render(say, &m.args, &t.tables)?)
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

    /// 表里每一句、每一层场合都写得对：写坏了的那句会悄悄退回英文
    #[test]
    fn every_template_in_the_table_parses() {
        let t = table();
        for (code, s) in &t.messages {
            compile(s).unwrap_or_else(|e| panic!("{code}: {e}"));
        }
        for c in &t.contexts {
            compile(&c.en).unwrap();
            compile(&c.zh).unwrap();
        }
    }

    #[derive(Deserialize)]
    struct Case {
        msg: Msg,
        zh: String,
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
}
