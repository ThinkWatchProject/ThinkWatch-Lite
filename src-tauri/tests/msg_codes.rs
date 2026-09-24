//! 界面的译文表和钉着的那版 core 发得出的消息码对得上。
//!
//! core 在 `tw_api::MSG_CODES` 里列出它发得出的每一个码。界面按码翻译
//! （`src/i18n/core.i18n.ts` 的 `ZH` 表），查不到就整句退回英文 —— 那条退路
//! 让一个漏翻的码不会坏掉任何东西，也正因为如此没有人会发现它漏了。这条测试
//! 在升级 core 的那个 PR 上把两个方向都拦住：
//!
//! - 清单里有、表里没有：中文界面上会冒出一句英文；
//! - 表里有、清单里没有：core 已经不发它了，那条译文是死的（多半是换了码，
//!   新码在上一条里）。
//!
//! 清单的写法：一行一个码，`#` 开头是说明；码后面的 `passthrough` 是只有
//! 占位符的句子（系统或上游的原话），照原文显示，翻不翻都行；`test` 是只在
//! core 的测试里出现的，不管。

use std::collections::BTreeSet;

/// `lite.` 开头的是界面自己造的（比如 core 停了、请求被掐断），不在 core 的清单里
const LITE_PREFIX: &str = "lite.";

struct Manifest {
    /// 要翻的
    translate: BTreeSet<String>,
    /// 可翻可不翻的
    passthrough: BTreeSet<String>,
}

fn manifest() -> Manifest {
    let mut m = Manifest {
        translate: BTreeSet::new(),
        passthrough: BTreeSet::new(),
    };
    for line in tw_api::MSG_CODES.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.split_whitespace();
        let code = parts.next().unwrap().to_string();
        match parts.next() {
            None => m.translate.insert(code),
            Some("passthrough") => m.passthrough.insert(code),
            Some("test") => continue,
            Some(other) => panic!("清单里有不认识的标记 `{other}`：{line}"),
        };
    }
    assert!(m.translate.len() > 100, "清单读出来几乎是空的");
    m
}

/// `ZH` 表的键。表是一个对象字面量，一个码一行、两格缩进、带引号 ——
/// 这里只认这一种写法，写法变了下面的断言会先失败。
fn translated() -> BTreeSet<String> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/i18n/core.i18n.ts");
    // Windows 上检出的是 CRLF
    let src = std::fs::read_to_string(path).unwrap().replace("\r\n", "\n");
    let start = src
        .find("\nconst ZH: Record<string, Say> = {\n")
        .expect("core.i18n.ts 里找不到 ZH 表");
    let body = &src[start..];
    let end = body.find("\n};\n").expect("ZH 表没有结尾");
    let keys: BTreeSet<String> = body[..end]
        .lines()
        .filter_map(|l| l.strip_prefix("  \""))
        .filter_map(|l| l.split_once('"'))
        .filter(|(_, rest)| rest.starts_with(':'))
        .map(|(k, _)| k.to_string())
        .collect();
    assert!(keys.len() > 100, "ZH 表几乎是空的，多半是写法变了");
    keys
}

#[test]
fn every_code_core_emits_has_a_chinese_sentence() {
    let m = manifest();
    let zh = translated();
    let missing: Vec<_> = m.translate.difference(&zh).collect();
    assert!(
        missing.is_empty(),
        "这些码 core 发得出、ZH 表里没有，中文界面上会是英文：{missing:#?}"
    );
}

#[test]
fn no_translation_for_a_code_core_no_longer_emits() {
    let m = manifest();
    let stale: Vec<_> = translated()
        .into_iter()
        .filter(|k| !k.starts_with(LITE_PREFIX))
        .filter(|k| !m.translate.contains(k) && !m.passthrough.contains(k))
        .collect();
    assert!(
        stale.is_empty(),
        "这些码 core 已经不发了，译文是死的：{stale:#?}"
    );
}
