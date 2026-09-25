//! 去哪儿找。
//!
//! 集中清单和安全扫描**是同一件事的两面**：扫描需要
//! 知道去哪儿找，而清单正是那份地址簿。所以两者共用这个文件，不分开
//! 实现。
//!
//! # 范围：只看这些，不扫全盘
//!
//! M4 明确要求「开工前先定一件事：要监听哪些目录」。定下来的
//! 是：
//!
//! | | 扫不扫 |
//! |---|---|
//! | 用户级的那一小撮固定路径 | 扫。数量有限、位置确定 |
//! | **用户显式添加的项目目录** | 扫 |
//! | 全盘搜 `.claude/` | **不扫** |
//!
//! 最后一条是硬约束，不是偷懒。项目级的 `.claude/` 散落全盘，无界的
//! FSEvents 监听既是性能问题，也和「空闲时接近零」的目标直接
//! 冲突。而且一个用户 clone 过的仓库可能有几百个，其中绝大多数他这辈子
//! 都不会再打开 —— 为它们持续烧 CPU 换不到任何东西。

use std::path::{Path, PathBuf};

use tw_adopt::paths::under;

/// 这份文件属于哪类攻击面。**顺序就是危险度**（那张表）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Kind {
    /// `settings.json` 里的 hooks，在工具调用前后**直接执行 shell 命令**。
    ///
    /// 这是攻击面里唯一能**无需任何模型参与**就拿到执行权的 —— 所以它
    /// 排第一，不是因为它最常见，而是因为它最短路。
    Hooks,
    /// MCP server 配置。指定的是可执行程序和参数，等同于「运行这个二进制」
    Mcp,
    /// `SKILL.md`，内容会被注入模型上下文、成为指令
    Skill,
    /// `.claude/commands/*.md`
    Command,
    /// `.claude/agents/*.md`，同上，且可能声明宽松的工具权限
    Agent,
    /// `CLAUDE.md` / `AGENTS.md`，被自动读入上下文
    Instructions,
}

impl Kind {
    pub fn slug(&self) -> &'static str {
        match self {
            Kind::Hooks => "hooks",
            Kind::Mcp => "mcp",
            Kind::Skill => "skill",
            Kind::Command => "command",
            Kind::Agent => "agent",
            Kind::Instructions => "instructions",
        }
    }
    pub fn label(&self) -> &'static str {
        match self {
            Kind::Hooks => "hook",
            Kind::Mcp => "MCP server",
            Kind::Skill => "skill",
            Kind::Command => "slash command",
            Kind::Agent => "subagent",
            Kind::Instructions => "project instructions",
        }
    }
    /// 为什么它危险。**说清「它能干什么」**，别只说「它是什么」。
    pub fn why(&self) -> &'static str {
        match self {
            Kind::Hooks => {
                "A hook runs a shell command before or after a tool call, which is execution without the model taking part."
            }
            Kind::Mcp => {
                "An MCP server entry names an executable and its arguments, which amounts to running that program."
            }
            Kind::Skill => {
                "The content of SKILL.md goes into the model's context and becomes instruction."
            }
            Kind::Command => {
                "The content of a slash command goes into the model's context and becomes instruction."
            }
            Kind::Agent => {
                "A subagent definition goes into the model's context, and it may declare loose tool permissions."
            }
            Kind::Instructions => "This file is read into the model's context automatically.",
        }
    }
}

/// 一份要看的文件。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source {
    /// 哪个客户端的。**同一份 MCP 可能被好几个客户端各配一遍**，矩阵靠它分列
    pub client: &'static str,
    pub kind: Kind,
    pub path: PathBuf,
    /// 用户级还是项目级。诊断「项目级盖住用户级」要用
    pub project: Option<PathBuf>,
}

/// 我们自己留下的文件名里都有这一段。监听要跳过它们（见 [`crate::watch`]）。
pub const SIDECAR_MARK: &str = ".thinkwatch.json";

fn f(client: &'static str, kind: Kind, path: PathBuf) -> Source {
    Source {
        client,
        kind,
        path,
        project: None,
    }
}

/// 目录下所有 `*.md`（不递归）。
fn md_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<_> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|x| x == "md"))
        .collect();
    // 顺序固定，否则界面上的列表每次刷新都在跳
    out.sort();
    out
}

/// `skills/<名字>/SKILL.md`。
fn skills_in(dir: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut out: Vec<_> = rd
        .flatten()
        .map(|e| e.path().join("SKILL.md"))
        .filter(|p| p.is_file())
        .collect();
    out.sort();
    out
}

/// dsh 每个 profile 的补丁：`profiles/<名>/cordis.patch.yml`。
fn profile_patches(dsh: &Path) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(dsh.join("profiles")) else {
        return Vec::new();
    };
    let mut out: Vec<_> = rd
        .flatten()
        .map(|e| e.path().join("cordis.patch.yml"))
        .filter(|p| p.is_file())
        .collect();
    out.sort();
    out
}

/// 用户级的那一小撮。**位置固定、数量有限**，所以可以无条件全看一遍。
pub fn user_level(home: &Path) -> Vec<Source> {
    let mut v = vec![
        // 危险度第一：hooks 直接执行 shell
        f(
            "claude-code",
            Kind::Hooks,
            under(home, ".claude/settings.json"),
        ),
        f(
            "claude-code",
            Kind::Hooks,
            under(home, ".claude/settings.local.json"),
        ),
        // agy 的全局配置都在 `~/.gemini/config/` 下：hooks、MCP、subagent
        f(
            "antigravity-cli",
            Kind::Hooks,
            under(home, ".gemini/config/hooks.json"),
        ),
        // 危险度第二：MCP
        f("claude-code", Kind::Mcp, under(home, ".claude.json")),
        // Claude Desktop 的 MCP 配置是危险度第二高的攻击面，漏掉它等于
        // 扫描留了个洞
        f(
            "claude-desktop",
            Kind::Mcp,
            tw_adopt::paths::CLAUDE_DESKTOP_CONFIG.resolve(home),
        ),
        f("cursor", Kind::Mcp, under(home, ".cursor/mcp.json")),
        f("codex", Kind::Mcp, under(home, ".codex/config.toml")),
        // JSONC，按 JSON 读（扫描器跳过注释和尾逗号）
        f(
            "antigravity-cli",
            Kind::Mcp,
            tw_adopt::paths::AGY_MCP_CONFIG.resolve(home),
        ),
        f(
            "zed",
            Kind::Mcp,
            tw_adopt::paths::ZED_SETTINGS.resolve(home),
        ),
        // 指令类
        f(
            "claude-code",
            Kind::Instructions,
            under(home, ".claude/CLAUDE.md"),
        ),
        f("codex", Kind::Instructions, under(home, ".codex/AGENTS.md")),
    ];
    // opencode 两个文件都读、逐层合并，哪个里都可能有 MCP
    for l in tw_adopt::paths::OPENCODE_CONFIGS {
        v.push(f("opencode", Kind::Mcp, l.resolve(home)));
    }
    for p in skills_in(&under(home, ".claude/skills")) {
        v.push(f("claude-code", Kind::Skill, p));
    }
    // DeepSeek Harness：MCP server 是补丁里的插件行。家目录这一层，加上每个
    // profile 自己那一层 —— 两层都会被读进去
    let dsh = tw_adopt::paths::DSH_DIR.resolve(home);
    v.push(f(
        "dsh",
        Kind::Mcp,
        tw_adopt::paths::DSH_PATCH.resolve(home),
    ));
    for p in profile_patches(&dsh) {
        v.push(f("dsh", Kind::Mcp, p));
    }
    // 它的 skills 目录：自己的一个，加上各家共用的 `~/.agents/skills`
    for p in skills_in(&dsh.join("skills"))
        .into_iter()
        .chain(skills_in(&under(home, ".agents/skills")))
    {
        v.push(f("dsh", Kind::Skill, p));
    }
    for p in md_in(&under(home, ".claude/commands")) {
        v.push(f("claude-code", Kind::Command, p));
    }
    for p in md_in(&under(home, ".claude/agents")) {
        v.push(f("claude-code", Kind::Agent, p));
    }
    for p in skills_in(&under(home, ".gemini/config/skills")) {
        v.push(f("antigravity-cli", Kind::Skill, p));
    }
    for p in md_in(&under(home, ".gemini/config/agents")) {
        v.push(f("antigravity-cli", Kind::Agent, p));
    }
    v.retain(|s| s.path.exists());
    v
}

/// 一个**用户显式添加的**项目目录。
///
/// 名字里的「显式」是这个函数存在的全部理由：我们不去找项目，只看用户
/// 指给我们的那些。
pub fn in_project(dir: &Path) -> Vec<Source> {
    let mut v = vec![
        f(
            "claude-code",
            Kind::Hooks,
            under(dir, ".claude/settings.json"),
        ),
        f(
            "claude-code",
            Kind::Hooks,
            under(dir, ".claude/settings.local.json"),
        ),
        f("claude-code", Kind::Mcp, under(dir, ".mcp.json")),
        f("claude-code", Kind::Instructions, under(dir, "CLAUDE.md")),
        f("codex", Kind::Instructions, under(dir, "AGENTS.md")),
        f("cursor", Kind::Instructions, under(dir, ".cursorrules")),
        // agy 的项目级配置在 `.agents/` 下
        f(
            "antigravity-cli",
            Kind::Hooks,
            under(dir, ".agents/hooks.json"),
        ),
        f(
            "antigravity-cli",
            Kind::Mcp,
            under(dir, ".agents/mcp_config.json"),
        ),
    ];
    for p in md_in(&under(dir, ".claude/commands")) {
        v.push(f("claude-code", Kind::Command, p));
    }
    for p in md_in(&under(dir, ".claude/agents")) {
        v.push(f("claude-code", Kind::Agent, p));
    }
    for p in skills_in(&under(dir, ".claude/skills")) {
        v.push(f("claude-code", Kind::Skill, p));
    }
    for p in skills_in(&under(dir, ".agents/skills")) {
        v.push(f("antigravity-cli", Kind::Skill, p));
    }
    for p in md_in(&under(dir, ".agents/agents")) {
        v.push(f("antigravity-cli", Kind::Agent, p));
    }
    // 项目里共用的 `.agents/skills` 上面已经算在 agy 名下，dsh 这里只加它自己的
    for p in skills_in(&under(dir, ".dsh/skills")) {
        v.push(f("dsh", Kind::Skill, p));
    }
    v.retain(|s| s.path.exists());
    for s in &mut v {
        s.project = Some(dir.to_path_buf());
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn touch(p: &Path) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, "x").unwrap();
    }

    #[test]
    fn nothing_is_reported_for_files_that_do_not_exist() {
        // 一个空目录不该产出十条「找不到」。
        let d = tempfile::tempdir().unwrap();
        assert_eq!(user_level(d.path()), Vec::new());
        assert_eq!(in_project(d.path()), Vec::new());
    }

    #[test]
    fn claude_desktop_is_in_the_scan_whether_or_not_it_is_adopted() {
        // 它的 MCP 配置是危险度第二高的攻击面，接不接管都要扫。漏掉它等于
        // 扫描留了个洞。
        let d = tempfile::tempdir().unwrap();
        // 路径按平台走 —— 写死 macOS 那一条的话，这个测试在 Windows 上
        // 会造一个没人找的文件，然后报告扫描漏了它。
        touch(&tw_adopt::paths::CLAUDE_DESKTOP_CONFIG.resolve(d.path()));
        let got = user_level(d.path());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].client, "claude-desktop");
        assert_eq!(got[0].kind, Kind::Mcp);
    }

    #[test]
    fn hooks_come_first_because_they_are_the_shortest_path_to_execution() {
        // 危险度排序不是装饰：界面按它排，高危项发通知。
        assert!(Kind::Hooks < Kind::Mcp);
        assert!(Kind::Mcp < Kind::Skill);
        assert!(Kind::Hooks.why().contains("without the model taking part"));
    }

    #[test]
    fn skills_and_commands_are_picked_up_by_shape() {
        let d = tempfile::tempdir().unwrap();
        touch(&d.path().join(".claude/skills/格式化/SKILL.md"));
        touch(&d.path().join(".claude/skills/没有清单的/别的.md"));
        touch(&d.path().join(".claude/commands/a.md"));
        touch(&d.path().join(".claude/agents/b.md"));
        touch(&d.path().join(".claude/agents/README.txt"));
        let got = user_level(d.path());
        let kinds: Vec<_> = got.iter().map(|s| s.kind).collect();
        assert_eq!(
            kinds.iter().filter(|k| **k == Kind::Skill).count(),
            1,
            "{got:?}"
        );
        assert_eq!(kinds.iter().filter(|k| **k == Kind::Command).count(), 1);
        assert_eq!(
            kinds.iter().filter(|k| **k == Kind::Agent).count(),
            1,
            "只认 .md"
        );
    }

    #[test]
    fn antigravity_cli_is_scanned_at_both_levels() {
        let d = tempfile::tempdir().unwrap();
        touch(&tw_adopt::paths::AGY_MCP_CONFIG.resolve(d.path()));
        touch(&d.path().join(".gemini/config/hooks.json"));
        touch(&d.path().join(".gemini/config/skills/审查/SKILL.md"));
        touch(&d.path().join(".gemini/config/agents/a.md"));
        let got = user_level(d.path());
        assert!(got.iter().all(|s| s.client == "antigravity-cli"), "{got:?}");
        let mut kinds: Vec<_> = got.iter().map(|s| s.kind).collect();
        kinds.sort();
        assert_eq!(
            kinds,
            [Kind::Hooks, Kind::Mcp, Kind::Skill, Kind::Agent],
            "{got:?}"
        );

        let p = tempfile::tempdir().unwrap();
        touch(&p.path().join(".agents/mcp_config.json"));
        touch(&p.path().join(".agents/hooks.json"));
        touch(&p.path().join(".agents/skills/x/SKILL.md"));
        touch(&p.path().join(".agents/agents/b.md"));
        let got = in_project(p.path());
        assert_eq!(got.len(), 4, "{got:?}");
        assert!(got.iter().all(|s| s.client == "antigravity-cli"));
    }

    #[test]
    fn a_project_scan_records_which_project_it_came_from() {
        // 诊断「项目级盖住用户级」要靠这个。
        let d = tempfile::tempdir().unwrap();
        touch(&d.path().join(".mcp.json"));
        touch(&d.path().join("CLAUDE.md"));
        let got = in_project(d.path());
        assert_eq!(got.len(), 2);
        assert!(got.iter().all(|s| s.project.as_deref() == Some(d.path())));
    }

    #[test]
    fn the_listing_order_is_stable_so_the_ui_does_not_jitter() {
        let d = tempfile::tempdir().unwrap();
        for n in ["z", "a", "m"] {
            touch(&d.path().join(format!(".claude/commands/{n}.md")));
        }
        let names = |v: Vec<Source>| -> Vec<String> {
            v.iter()
                .map(|s| s.path.file_name().unwrap().to_string_lossy().to_string())
                .collect()
        };
        assert_eq!(names(user_level(d.path())), ["a.md", "m.md", "z.md"]);
        assert_eq!(names(user_level(d.path())), names(user_level(d.path())));
    }

    #[test]
    fn dsh_patches_and_skills_are_in_the_scan() {
        let d = tempfile::tempdir().unwrap();
        let dsh = tw_adopt::paths::DSH_DIR.resolve(d.path());
        touch(&dsh.join("cordis.patch.yml"));
        touch(&dsh.join("profiles/default/cordis.patch.yml"));
        touch(&dsh.join("profiles/work/cordis.patch.yml"));
        touch(&dsh.join("skills/审查/SKILL.md"));
        touch(&d.path().join(".agents/skills/共用/SKILL.md"));
        let got: Vec<_> = user_level(d.path())
            .into_iter()
            .map(|s| (s.client, s.kind))
            .collect();
        assert_eq!(
            got,
            [
                ("dsh", Kind::Mcp),
                ("dsh", Kind::Mcp),
                ("dsh", Kind::Mcp),
                ("dsh", Kind::Skill),
                ("dsh", Kind::Skill),
            ]
        );
        let p = tempfile::tempdir().unwrap();
        touch(&p.path().join(".dsh/skills/a/SKILL.md"));
        touch(&p.path().join(".agents/skills/b/SKILL.md"));
        assert_eq!(in_project(p.path()).len(), 2);
    }
}
