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

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tw_adopt::locations::{Places, Role};
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

/// `~/.agents/skills`（和项目里的 `.agents/skills`）算在谁名下：**谁都不是**。
///
/// 它是 Agent Skills 约定的共用目录，Pi、oh-my-pi、DeepSeek Harness、Antigravity CLI、
/// Copilot、Kimi、Goose、Crush、Kilo、Cline、MiMo 都读它。算在其中一家名下，清单上就像是
/// 那一家独有的，删掉那一家的人会以为它也跟着没了。界面按这个标识显示成「共用目录」。
pub const SHARED_SKILLS: &str = "agents";

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

/// 换过位置的按换过的找（见 [`user_level`]），没换过就是默认的那一个
fn placed(moved: &BTreeMap<String, Places>, client: &str, role: Role, default: PathBuf) -> PathBuf {
    moved
        .get(client)
        .and_then(|p| p.get(role).cloned())
        .unwrap_or(default)
}

/// 扫描要看的几个目录（换过位置的按换过的）。[`candidates`] 和 [`roots`] 从同一处取，
/// 两边说的才是同一批目录
struct Dirs {
    claude: PathBuf,
    codex: PathBuf,
    /// agy 的全局配置都在 `~/.gemini/config/` 下：hooks、MCP、subagent
    agy: PathBuf,
    dsh: PathBuf,
    /// Pi 的 `~/.pi/agent`：skills、prompts（斜杠命令）、AGENTS.md
    pi: PathBuf,
    /// oh-my-pi 的 `~/.omp/agent`：skills、commands、prompts、AGENTS.md
    omp: PathBuf,
    /// 各家共用的那一个，见 [`SHARED_SKILLS`]
    shared_skills: PathBuf,
}

fn scan_dirs(home: &Path, moved: &BTreeMap<String, Places>) -> Dirs {
    let at = |client: &str, default: tw_adopt::paths::Loc| {
        placed(moved, client, Role::Scan, default.resolve(home))
    };
    Dirs {
        claude: placed(moved, "claude-code", Role::Scan, under(home, ".claude")),
        codex: placed(moved, "codex", Role::Scan, under(home, ".codex")),
        agy: placed(
            moved,
            "antigravity-cli",
            Role::Scan,
            under(home, ".gemini/config"),
        ),
        dsh: tw_adopt::paths::DSH_DIR.resolve(home),
        pi: at("pi", tw_adopt::paths::PI_DIR),
        omp: at("omp", tw_adopt::paths::OMP_DIR),
        shared_skills: under(home, ".agents/skills"),
    }
}

/// 用户级的那一小撮。**数量有限**，所以可以无条件全看一遍。
///
/// 位置默认是各家客户端的默认位置；用户在客户端页或 MCP 页换过位置的（`moved`，按
/// 客户端 id，见 [`tw_adopt::locations`]），按换过的找：扫描看的目录（hooks、skills、
/// 指令文件）和 MCP 那一份都跟着走。
pub fn user_level(home: &Path, moved: &BTreeMap<String, Places>) -> Vec<Source> {
    let mut v = candidates(home, moved);
    v.retain(|s| s.path.exists());
    v
}

/// [`user_level`]，还不在的也列着：固定位置的那几份文件在不在都算（监听要等它们出现，
/// 见 [`crate::watch::Plan`]）。按形状找的 skill、斜杠命令只列得出已经在的；它们会在
/// 哪儿冒出来，见 [`roots`]。
pub fn candidates(home: &Path, moved: &BTreeMap<String, Places>) -> Vec<Source> {
    let at = |client: &str, role: Role, default: PathBuf| placed(moved, client, role, default);
    let Dirs {
        claude,
        codex,
        agy,
        dsh,
        pi,
        omp,
        shared_skills,
    } = scan_dirs(home, moved);
    let mut v = vec![
        // 危险度第一：hooks 直接执行 shell
        f("claude-code", Kind::Hooks, claude.join("settings.json")),
        f(
            "claude-code",
            Kind::Hooks,
            claude.join("settings.local.json"),
        ),
        f("antigravity-cli", Kind::Hooks, agy.join("hooks.json")),
        // 危险度第二：MCP
        f(
            "claude-code",
            Kind::Mcp,
            at("claude-code", Role::Mcp, under(home, ".claude.json")),
        ),
        // Claude Desktop 的 MCP 配置是危险度第二高的攻击面，漏掉它等于
        // 扫描留了个洞
        f(
            "claude-desktop",
            Kind::Mcp,
            tw_adopt::paths::CLAUDE_DESKTOP_CONFIG.resolve(home),
        ),
        f(
            "cursor",
            Kind::Mcp,
            at("cursor", Role::Mcp, under(home, ".cursor/mcp.json")),
        ),
        f(
            "codex",
            Kind::Mcp,
            at("codex", Role::Mcp, under(home, ".codex/config.toml")),
        ),
        // JSONC，按 JSON 读（扫描器跳过注释和尾逗号）
        f(
            "antigravity-cli",
            Kind::Mcp,
            at(
                "antigravity-cli",
                Role::Mcp,
                tw_adopt::paths::AGY_MCP_CONFIG.resolve(home),
            ),
        ),
        f(
            "zed",
            Kind::Mcp,
            at(
                "zed",
                Role::Mcp,
                tw_adopt::paths::ZED_SETTINGS.resolve(home),
            ),
        ),
        // Pi 0.99 起的 MCP，和 oh-my-pi 自己的那两份（`.mcp.json` 是它为兼容也读的）
        f(
            "pi",
            Kind::Mcp,
            at("pi", Role::Mcp, tw_adopt::paths::PI_MCP.resolve(home)),
        ),
        f(
            "omp",
            Kind::Mcp,
            at("omp", Role::Mcp, tw_adopt::paths::OMP_MCP.resolve(home)),
        ),
        f("omp", Kind::Mcp, omp.join(".mcp.json")),
        // 指令类
        f("claude-code", Kind::Instructions, claude.join("CLAUDE.md")),
        f("codex", Kind::Instructions, codex.join("AGENTS.md")),
    ];
    // Pi 和 oh-my-pi 每次都读进上下文的：用户级的指令、换掉或补在系统提示词后面的那一份
    for name in [
        "AGENTS.md",
        "AGENTS.override.md",
        "CLAUDE.md",
        "SYSTEM.md",
        "APPEND_SYSTEM.md",
    ] {
        v.push(f("pi", Kind::Instructions, pi.join(name)));
    }
    for name in ["AGENTS.md", "SYSTEM.md", "RULES.md"] {
        v.push(f("omp", Kind::Instructions, omp.join(name)));
    }
    // opencode 两个文件都读、逐层合并，哪个里都可能有 MCP；指定了就只看那一个
    match moved.get("opencode").and_then(|p| p.mcp.clone()) {
        Some(p) => v.push(f("opencode", Kind::Mcp, p)),
        None => {
            for l in tw_adopt::paths::OPENCODE_CONFIGS {
                v.push(f("opencode", Kind::Mcp, l.resolve(home)));
            }
        }
    }
    for p in skills_in(&claude.join("skills")) {
        v.push(f("claude-code", Kind::Skill, p));
    }
    // DeepSeek Harness：MCP server 是补丁里的插件行。家目录这一层，加上每个
    // profile 自己那一层 —— 两层都会被读进去
    v.push(f(
        "dsh",
        Kind::Mcp,
        tw_adopt::paths::DSH_PATCH.resolve(home),
    ));
    for p in profile_patches(&dsh) {
        v.push(f("dsh", Kind::Mcp, p));
    }
    for p in skills_in(&dsh.join("skills")) {
        v.push(f("dsh", Kind::Skill, p));
    }
    // 各家共用的那一个，不算在哪一家名下
    for p in skills_in(&shared_skills) {
        v.push(f(SHARED_SKILLS, Kind::Skill, p));
    }
    for p in skills_in(&pi.join("skills")) {
        v.push(f("pi", Kind::Skill, p));
    }
    for p in skills_in(&omp.join("skills")) {
        v.push(f("omp", Kind::Skill, p));
    }
    // Pi 的 prompt 模板就是它的斜杠命令；oh-my-pi 两样都有
    for p in md_in(&pi.join("prompts")) {
        v.push(f("pi", Kind::Command, p));
    }
    for p in md_in(&omp.join("commands"))
        .into_iter()
        .chain(md_in(&omp.join("prompts")))
    {
        v.push(f("omp", Kind::Command, p));
    }
    for p in md_in(&claude.join("commands")) {
        v.push(f("claude-code", Kind::Command, p));
    }
    for p in md_in(&claude.join("agents")) {
        v.push(f("claude-code", Kind::Agent, p));
    }
    for p in skills_in(&agy.join("skills")) {
        v.push(f("antigravity-cli", Kind::Skill, p));
    }
    for p in md_in(&agy.join("agents")) {
        v.push(f("antigravity-cli", Kind::Agent, p));
    }
    v
}

/// 按形状找的来源（skill、斜杠命令、subagent、dsh 的 profile）会在哪个目录里冒出来。
/// **在不在都列**：新装一个 skill 时，这个目录可能正是这一刻才建出来的，监听要等着它
/// （见 [`crate::watch::Plan`]）。和 [`candidates`] 里找它们的地方一一对应。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Root {
    pub dir: PathBuf,
    /// 底下**每个子目录**各装着一份来源（`skills/<名>/SKILL.md`、
    /// `profiles/<名>/cordis.patch.yml`）；否则来源就是它里面的文件（`commands/*.md`）
    pub nested: bool,
}

pub fn roots(home: &Path, moved: &BTreeMap<String, Places>) -> Vec<Root> {
    let d = scan_dirs(home, moved);
    let root = |dir: PathBuf, nested: bool| Root { dir, nested };
    vec![
        root(d.claude.join("skills"), true),
        root(d.claude.join("commands"), false),
        root(d.claude.join("agents"), false),
        root(d.dsh.join("profiles"), true),
        root(d.dsh.join("skills"), true),
        root(d.shared_skills, true),
        root(d.agy.join("skills"), true),
        root(d.agy.join("agents"), false),
        root(d.pi.join("skills"), true),
        root(d.pi.join("prompts"), false),
        root(d.omp.join("skills"), true),
        root(d.omp.join("commands"), false),
        root(d.omp.join("prompts"), false),
    ]
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
        f("pi", Kind::Mcp, under(dir, ".pi/mcp.json")),
        f("omp", Kind::Mcp, under(dir, ".omp/mcp.json")),
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
    // 项目里共用的 `.agents/skills`：和用户级的那一个一样，谁都不是
    for p in skills_in(&under(dir, ".agents/skills")) {
        v.push(f(SHARED_SKILLS, Kind::Skill, p));
    }
    for p in md_in(&under(dir, ".agents/agents")) {
        v.push(f("antigravity-cli", Kind::Agent, p));
    }
    for (client, sub) in [
        ("dsh", ".dsh/skills"),
        ("pi", ".pi/skills"),
        ("omp", ".omp/skills"),
    ] {
        for p in skills_in(&under(dir, sub)) {
            v.push(f(client, Kind::Skill, p));
        }
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
        assert_eq!(user_level(d.path(), &BTreeMap::new()), Vec::new());
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
        let got = user_level(d.path(), &BTreeMap::new());
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].client, "claude-desktop");
        assert_eq!(got[0].kind, Kind::Mcp);
    }

    /// 按形状找到的每一份来源都在某个 [`roots`] 目录里：监听等的就是这些目录，两边
    /// 对不上的话，新装的那一种就等不到
    #[test]
    fn every_source_found_by_shape_sits_in_a_root() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path();
        let dsh = tw_adopt::paths::DSH_DIR.resolve(home);
        let profile = dsh.join("profiles/work/cordis.patch.yml");
        for p in [
            home.join(".claude/skills/a/SKILL.md"),
            home.join(".claude/commands/b.md"),
            home.join(".claude/agents/c.md"),
            profile.clone(),
            dsh.join("skills/d/SKILL.md"),
            home.join(".agents/skills/e/SKILL.md"),
            home.join(".gemini/config/skills/f/SKILL.md"),
            home.join(".gemini/config/agents/g.md"),
            home.join(".pi/agent/skills/h/SKILL.md"),
            home.join(".pi/agent/prompts/i.md"),
            home.join(".omp/agent/skills/j/SKILL.md"),
            home.join(".omp/agent/commands/k.md"),
            home.join(".omp/agent/prompts/l.md"),
        ] {
            touch(&p);
        }
        let roots = roots(home, &BTreeMap::new());
        let found: Vec<_> = user_level(home, &BTreeMap::new())
            .into_iter()
            .filter(|s| {
                matches!(s.kind, Kind::Skill | Kind::Command | Kind::Agent) || s.path == profile
            })
            .collect();
        assert_eq!(found.len(), 13, "{found:?}");
        for s in found {
            let dir = s.path.parent().unwrap();
            assert!(
                roots.iter().any(|r| if r.nested {
                    dir.parent() == Some(r.dir.as_path())
                } else {
                    dir == r.dir
                }),
                "{} 不在任何一个 root 里",
                s.path.display()
            );
        }
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
        let got = user_level(d.path(), &BTreeMap::new());
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
        let got = user_level(d.path(), &BTreeMap::new());
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
        // `.agents/skills` 是各家共用的，不算在 agy 名下
        for s in &got {
            let want = if s.kind == Kind::Skill {
                SHARED_SKILLS
            } else {
                "antigravity-cli"
            };
            assert_eq!(s.client, want, "{s:?}");
        }
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
        assert_eq!(
            names(user_level(d.path(), &BTreeMap::new())),
            ["a.md", "m.md", "z.md"]
        );
        assert_eq!(
            names(user_level(d.path(), &BTreeMap::new())),
            names(user_level(d.path(), &BTreeMap::new()))
        );
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
        let got: Vec<_> = user_level(d.path(), &BTreeMap::new())
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
                // `~/.agents/skills` 不是 dsh 独有的
                (SHARED_SKILLS, Kind::Skill),
            ]
        );
        let p = tempfile::tempdir().unwrap();
        touch(&p.path().join(".dsh/skills/a/SKILL.md"));
        touch(&p.path().join(".agents/skills/b/SKILL.md"));
        assert_eq!(in_project(p.path()).len(), 2);
    }

    /// Pi 和 oh-my-pi：MCP、skills、斜杠命令、每次读进上下文的指令文件
    #[test]
    fn pi_and_omp_are_scanned_at_both_levels() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path();
        for p in [
            ".pi/agent/mcp.json",
            ".pi/agent/AGENTS.md",
            ".pi/agent/SYSTEM.md",
            ".pi/agent/skills/审查/SKILL.md",
            ".pi/agent/prompts/fix.md",
            ".omp/agent/mcp.json",
            ".omp/agent/.mcp.json",
            ".omp/agent/RULES.md",
            ".omp/agent/skills/a/SKILL.md",
            ".omp/agent/commands/b.md",
            // 不是它读的：models.json 不在扫描里
            ".pi/agent/models.json",
        ] {
            touch(&home.join(p));
        }
        let got: Vec<_> = user_level(home, &BTreeMap::new())
            .into_iter()
            .map(|s| (s.client, s.kind))
            .collect();
        let count = |client: &str, kind: Kind| got.iter().filter(|g| **g == (client, kind)).count();
        assert_eq!(count("pi", Kind::Mcp), 1, "{got:?}");
        assert_eq!(count("pi", Kind::Instructions), 2, "{got:?}");
        assert_eq!(count("pi", Kind::Skill), 1, "{got:?}");
        assert_eq!(count("pi", Kind::Command), 1, "{got:?}");
        assert_eq!(count("omp", Kind::Mcp), 2, "{got:?}");
        assert_eq!(count("omp", Kind::Instructions), 1, "{got:?}");
        assert_eq!(count("omp", Kind::Skill), 1, "{got:?}");
        assert_eq!(count("omp", Kind::Command), 1, "{got:?}");
        assert_eq!(got.len(), 10, "{got:?}");

        let p = tempfile::tempdir().unwrap();
        touch(&p.path().join(".pi/mcp.json"));
        touch(&p.path().join(".pi/skills/x/SKILL.md"));
        touch(&p.path().join(".omp/mcp.json"));
        touch(&p.path().join(".omp/skills/y/SKILL.md"));
        let got: Vec<_> = in_project(p.path())
            .into_iter()
            .map(|s| (s.client, s.kind))
            .collect();
        assert_eq!(
            got,
            [
                ("pi", Kind::Mcp),
                ("omp", Kind::Mcp),
                ("pi", Kind::Skill),
                ("omp", Kind::Skill),
            ]
        );
    }

    /// `~/.agents/skills` 谁都读：清单上不算在哪一家名下
    #[test]
    fn the_shared_skills_folder_belongs_to_no_single_client() {
        let d = tempfile::tempdir().unwrap();
        touch(&d.path().join(".agents/skills/共用/SKILL.md"));
        let got = user_level(d.path(), &BTreeMap::new());
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(got[0].client, SHARED_SKILLS);
        assert_eq!(got[0].kind, Kind::Skill);
        // 这个标识不是哪个客户端的 id
        assert!(
            !tw_adopt::clients::adoptable()
                .iter()
                .any(|c| c.id == SHARED_SKILLS)
                && tw_adopt::mcp::target(SHARED_SKILLS).is_err()
        );
    }

    /// 换过位置的客户端：扫描看的目录和 MCP 那一份都按换过的找，默认位置的不再看
    #[test]
    fn a_moved_client_is_scanned_where_it_was_moved() {
        let d = tempfile::tempdir().unwrap();
        let home = d.path().join("home");
        let work = d.path().join("work").join("claude");
        std::fs::create_dir_all(home.join(".claude")).unwrap();
        std::fs::create_dir_all(work.join("commands")).unwrap();
        std::fs::write(home.join(".claude").join("settings.json"), "{}").unwrap();
        std::fs::write(work.join("settings.json"), "{}").unwrap();
        std::fs::write(work.join(".claude.json"), "{}").unwrap();
        std::fs::write(work.join("commands").join("go.md"), "go").unwrap();
        let moved = BTreeMap::from([(
            "claude-code".to_string(),
            Places {
                config: Some(work.join("settings.json")),
                mcp: Some(work.join(".claude.json")),
                scan: Some(work.clone()),
            },
        )]);
        let got: Vec<_> = user_level(&home, &moved)
            .into_iter()
            .map(|s| (s.kind, s.path))
            .collect();
        assert_eq!(
            got,
            vec![
                (Kind::Hooks, work.join("settings.json")),
                (Kind::Mcp, work.join(".claude.json")),
                (Kind::Command, work.join("commands").join("go.md")),
            ]
        );
    }
}
