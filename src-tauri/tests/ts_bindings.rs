//! 前端用的类型是生成的，提交在 `src/generated/` 下：
//!
//! - `tw-api.ts`：控制面契约，由钉着的那版 tw-api 生成；
//! - `lite-api.ts`：不经过 core 的那几样（`src/wire.rs`：客户端接管、MCP、扫描、
//!   这台机器上的事件），由这里生成。
//!
//! **生成的文件和源头对得上。**改了类型没重新生成的话，前端照着旧的形状写、
//! 类型检查照样通过 —— 这条测试在那个 PR 上拦住它。
//!
//! 重新生成：`UPDATE_TS=1 cargo test --manifest-path src-tauri/Cargo.toml --test ts_bindings`

use std::any::TypeId;
use std::collections::{BTreeMap, HashSet};

use thinkwatch_lite_lib::wire;
use ts_rs::{Config, TS, TypeVisitor};

fn check(file: &str, want: &str) {
    let path = format!("{}/../src/generated/{file}", env!("CARGO_MANIFEST_DIR"));
    if std::env::var_os("UPDATE_TS").is_some() {
        std::fs::write(&path, want).unwrap();
        return;
    }
    // Windows 上检出的是 CRLF
    let have = std::fs::read_to_string(&path)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    assert!(
        have == want,
        "src/generated/{file} 不是最新的。重新生成：\n  UPDATE_TS=1 cargo test --manifest-path src-tauri/Cargo.toml --test ts_bindings"
    );
}

#[test]
fn the_committed_bindings_match_the_pinned_core() {
    check("tw-api.ts", &tw_api::ts::typescript());
}

#[test]
fn the_committed_bindings_match_the_apps_own_types() {
    check("lite-api.ts", &lite_typescript());
}

/// 和 `tw_api::ts` 同一套导出规则：64 位整数是 `number`，文档注释带过去。
struct Collect {
    cfg: Config,
    seen: HashSet<TypeId>,
    /// 名字 → 声明。按名字排，输出稳定
    decls: BTreeMap<String, String>,
}

impl TypeVisitor for Collect {
    fn visit<T: TS + 'static + ?Sized>(&mut self) {
        // 基本类型、Vec、Option 这些没有自己的声明
        if T::output_path().is_none() || !self.seen.insert(TypeId::of::<T>()) {
            return;
        }
        let mut decl = T::docs().unwrap_or_default();
        decl.push_str("export ");
        decl.push_str(&T::decl(&self.cfg));
        let name = T::ident(&self.cfg);
        assert!(
            self.decls.insert(name.clone(), decl).is_none(),
            "两个类型在 TypeScript 里都叫 `{name}`"
        );
        T::visit_dependencies(self);
    }
}

impl Collect {
    fn root<T: TS + 'static>(&mut self) {
        self.visit::<T>();
        T::visit_generics(self);
    }
}

/// 一段声明去掉文档注释和空白：比的是形状，不是说明文字
fn shape(decl: &str) -> String {
    let mut out = String::new();
    let mut rest = decl;
    while let Some(i) = rest.find("/**") {
        out.push_str(&rest[..i]);
        rest = rest[i..].find("*/").map_or("", |j| &rest[i + j + 2..]);
    }
    out.push_str(rest);
    out.split_whitespace().collect()
}

/// `tw-api.ts` 里这个名字的声明。没有就是 None
fn declared_in<'a>(ts: &'a str, name: &str) -> Option<&'a str> {
    let head = format!("export type {name} = ");
    let start = ts.find(&head)?;
    let rest = &ts[start..];
    Some(&rest[..rest.find(";\n").map_or(rest.len(), |e| e + 1)])
}

/// 这段声明里用到了这个类型名（整词）
fn mentions(decl: &str, name: &str) -> bool {
    let ident = |c: char| c.is_alphanumeric() || c == '_';
    decl.match_indices(name).any(|(i, _)| {
        !decl[..i].chars().next_back().is_some_and(ident)
            && !decl[i + name.len()..].chars().next().is_some_and(ident)
    })
}

fn lite_typescript() -> String {
    let mut c = Collect {
        cfg: Config::new().with_large_int("number"),
        seen: HashSet::new(),
        decls: BTreeMap::new(),
    };
    // 每个命令的请求和响应，连同它们引用到的一切
    c.root::<wire::ClientsResponse>();
    c.root::<wire::PlanView>();
    c.root::<wire::AdoptResponse>();
    c.root::<wire::FindingView>();
    c.root::<wire::KeyRotation>();
    c.root::<wire::KeyUsage>();
    c.root::<wire::Retargeted>();
    c.root::<wire::ScanReport>();
    c.root::<wire::McpTargetView>();
    c.root::<wire::McpOpRequest>();
    c.root::<wire::LocalEvent>();
    c.root::<wire::UninstallStep>();

    // **契约里已经有的名字从那边引用**（`Msg`，以及 core 还在发的同名同形的类型），
    // 不另写一份：两份同名的声明在 `types.ts` 里一起转出去是歧义
    let core = tw_api::ts::typescript();
    let mut imports = Vec::new();
    let mut own = Vec::new();
    for (name, decl) in &c.decls {
        match declared_in(&core, name) {
            Some(theirs) => {
                assert_eq!(
                    shape(theirs),
                    shape(decl),
                    "`{name}` 在 tw-api.ts 里也有，但形状不一样。换个名字，或者让两边一致"
                );
                imports.push(name.as_str());
            }
            None => own.push(decl.as_str()),
        }
    }
    let mut out = String::from(
        "// Generated from src-tauri/src/wire.rs (`tests/ts_bindings.rs`). Do not edit by hand.\n\n",
    );
    // 引用的只是自己的声明里用到的那几个。**不转出去**：`types.ts` 把两个文件都转出去，
    // 同一个名字从两处来就是歧义
    let used: Vec<&str> = imports
        .into_iter()
        .filter(|n| own.iter().any(|d| mentions(d, n)))
        .collect();
    if !used.is_empty() {
        out.push_str(&format!(
            "import type {{ {} }} from \"./tw-api\";\n\n",
            used.join(", ")
        ));
    }
    for d in own {
        out.push_str(d);
        out.push_str("\n\n");
    }
    out
}
