//! 一个客户端的配置位置：接管改的文件、MCP 管理读写的文件、安全扫描看的目录。
//!
//! **三项跟着同一个目录走。**Claude Code 的 `CLAUDE_CONFIG_DIR`、Codex 的 `CODEX_HOME`
//! 挪的是整个目录：`settings.json`、MCP 那一份、hooks 和 skills 一起换了地方。所以用户
//! 在客户端页或 MCP 页改其中任意一项，其余几项按这个客户端的布局换到同一个目录下
//! （[`Layout::relocate`]），界面改之前把几项一起列出来，确认之后一起生效。
//!
//! Claude Code 有一处例外：MCP 在 `.claude.json` 里，它默认在 home 下、不在 `~/.claude`
//! 里，配置目录挪了才跟进目录 —— Claude Code 2.1 自己就是这么找的
//! （`join(CLAUDE_CONFIG_DIR || homedir(), ".claude.json")`）。
//!
//! **只管这台电脑。**用户指定的位置由桌面端存着、填进 [`crate::clients::Client`] 和
//! [`crate::mcp::Target`]，扫描那边按 [`Places`] 找来源；WSL 里的照旧是默认位置。

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::paths::Loc;

/// 三项里的哪一项。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    /// 接管改的文件
    Config,
    /// MCP 管理读写的文件
    Mcp,
    /// 安全扫描看的目录：hooks、skills、commands、agents、指令文件
    Scan,
}

/// 三项各在哪。客户端没有的那一项是 `None`。
///
/// 用户指定的也是这个形状，那时只写和默认位置不一样的几项（见 [`Places::beyond`]）。
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Places {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub config: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp: Option<PathBuf>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scan: Option<PathBuf>,
}

impl Places {
    pub fn get(&self, role: Role) -> Option<&PathBuf> {
        match role {
            Role::Config => self.config.as_ref(),
            Role::Mcp => self.mcp.as_ref(),
            Role::Scan => self.scan.as_ref(),
        }
    }

    /// 这几项里和 `defaults` 不一样的那些：用户指定的位置只存这些
    pub fn beyond(&self, defaults: &Places) -> Places {
        let keep = |p: Option<&PathBuf>, d: Option<&PathBuf>| p.filter(|p| Some(*p) != d).cloned();
        Places {
            config: keep(self.config.as_ref(), defaults.config.as_ref()),
            mcp: keep(self.mcp.as_ref(), defaults.mcp.as_ref()),
            scan: keep(self.scan.as_ref(), defaults.scan.as_ref()),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.config.is_none() && self.mcp.is_none() && self.scan.is_none()
    }
}

/// 一个客户端的布局。
#[derive(Debug, Clone)]
pub struct Layout {
    pub client: &'static str,
    /// 配置目录的默认位置
    pub dir: Loc,
    /// 接管改的和 MCP 读写的是同一个文件（Codex 的 `config.toml`、opencode、Zed）
    pub shared: bool,
    /// 安全扫描看整个目录。只有一个文件的客户端（opencode、Zed、Cursor），扫的就是
    /// MCP 那个文件，扫描不单算一处
    pub scan_dir: bool,
}

/// 配置位置能换的客户端。**Claude Desktop 和 DeepSeek Harness 不在这里**：前者一次改
/// 四个文件、位置由它自己的配置库决定，后者的几个文件都在它的家目录下，跟着
/// `$DSH_HOME` 走。
///
/// 接管的文件从 [`crate::clients::adoptable`] 那张表来，MCP 的从 [`crate::mcp::targets`]
/// 来：这里只说目录在哪、哪几项是同一个文件。
pub fn layouts() -> Vec<Layout> {
    vec![
        Layout {
            client: "claude-code",
            dir: Loc::Home(".claude"),
            shared: false,
            scan_dir: true,
        },
        Layout {
            client: "codex",
            dir: Loc::Home(".codex"),
            shared: true,
            scan_dir: true,
        },
        Layout {
            client: "opencode",
            dir: Loc::XdgConfig("opencode"),
            shared: true,
            scan_dir: false,
        },
        Layout {
            client: "zed",
            dir: crate::paths::ZED_DIR,
            shared: true,
            scan_dir: false,
        },
        Layout {
            client: "aider",
            dir: Loc::Home(""),
            shared: false,
            scan_dir: false,
        },
        Layout {
            client: "cursor",
            dir: Loc::Home(".cursor"),
            shared: false,
            scan_dir: false,
        },
        Layout {
            client: "antigravity-cli",
            dir: Loc::Home(".gemini/config"),
            shared: false,
            scan_dir: true,
        },
    ]
}

pub fn layout(client: &str) -> Option<Layout> {
    layouts().into_iter().find(|l| l.client == client)
}

impl Layout {
    /// 三项的默认位置。
    pub fn defaults(&self, home: &Path) -> Places {
        let config = crate::clients::adoptable()
            .into_iter()
            .find(|c| c.id == self.client)
            .map(|c| c.default_config_path(home));
        let mcp = crate::mcp::target(self.client)
            .ok()
            .map(|t| t.default_path(home));
        Places {
            mcp: if self.shared {
                config.clone().or(mcp)
            } else {
                mcp
            },
            config,
            scan: self.scan_dir.then(|| self.dir.resolve(home)),
        }
    }

    /// 此刻的三项：默认位置上叠着用户指定的那几项。
    pub fn now(&self, home: &Path, set: Option<&Places>) -> Places {
        let d = self.defaults(home);
        let pick = |r: Role| set.and_then(|s| s.get(r)).or(d.get(r)).cloned();
        Places {
            config: pick(Role::Config),
            mcp: pick(Role::Mcp),
            scan: pick(Role::Scan),
        }
    }

    /// 把 `role` 那一项改到 `to` 之后，三项各在哪。
    ///
    /// 新的配置目录：改的是扫描那一项就是它，改的是文件就是文件所在的目录；改回的
    /// 正是默认位置时就是默认目录（Claude Code 的 `~/.claude.json` 不在目录里，按
    /// 所在目录算会算成 home）。其余几项在新目录下保持原来的名字；新目录就是默认
    /// 目录的，回到各自的默认位置。同一个文件的两项（[`Layout::shared`]）一起是 `to`。
    pub fn relocate(&self, home: &Path, now: &Places, role: Role, to: &Path) -> Places {
        let defaults = self.defaults(home);
        let default_dir = self.dir.resolve(home);
        let dir = if defaults.get(role).is_some_and(|d| d == to) {
            default_dir.clone()
        } else if role == Role::Scan {
            to.to_path_buf()
        } else {
            to.parent().map_or_else(PathBuf::new, Path::to_path_buf)
        };
        let same_file = |r: Role| {
            self.shared
                && matches!(
                    (r, role),
                    (Role::Config, Role::Mcp) | (Role::Mcp, Role::Config)
                )
        };
        let follow = |r: Role| -> Option<PathBuf> {
            let p = now.get(r)?;
            if r == role || same_file(r) {
                Some(to.to_path_buf())
            } else if dir == default_dir {
                defaults.get(r).cloned()
            } else if r == Role::Scan {
                Some(dir.clone())
            } else {
                Some(dir.join(p.file_name()?))
            }
        };
        Places {
            config: follow(Role::Config),
            mcp: follow(Role::Mcp),
            scan: follow(Role::Scan),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn home() -> PathBuf {
        PathBuf::from("/nowhere/home")
    }
    fn at(rel: &str) -> PathBuf {
        crate::paths::under(&home(), rel)
    }

    /// Claude Code：三项三处，`.claude.json` 默认在 home 下
    #[test]
    fn claude_code_moves_its_mcp_file_into_a_moved_folder_only() {
        let l = layout("claude-code").unwrap();
        let d = l.defaults(&home());
        assert_eq!(d.config, Some(at(".claude/settings.json")));
        assert_eq!(d.mcp, Some(at(".claude.json")));
        assert_eq!(d.scan, Some(at(".claude")));

        // 改接管那一项：MCP 和扫描跟进同一个目录
        let moved = l.relocate(&home(), &d, Role::Config, &at("work/claude/settings.json"));
        assert_eq!(
            moved,
            Places {
                config: Some(at("work/claude/settings.json")),
                mcp: Some(at("work/claude/.claude.json")),
                scan: Some(at("work/claude")),
            }
        );
        // 改扫描那一项也是一样
        assert_eq!(
            l.relocate(&home(), &d, Role::Scan, &at("work/claude")),
            moved
        );
        // 改回默认的 `~/.claude.json`：整个回到默认位置，而不是把 home 当成配置目录
        assert_eq!(
            l.relocate(&home(), &moved, Role::Mcp, &at(".claude.json")),
            d
        );
        assert_eq!(moved.beyond(&d), moved);
        assert!(d.beyond(&d).is_empty());
    }

    /// Codex：接管和 MCP 是同一个 `config.toml`
    #[test]
    fn a_shared_file_stays_one_file() {
        let l = layout("codex").unwrap();
        let d = l.defaults(&home());
        assert_eq!(d.config, d.mcp);
        let moved = l.relocate(&home(), &d, Role::Mcp, &at("x/codex/my.toml"));
        assert_eq!(moved.config, Some(at("x/codex/my.toml")));
        assert_eq!(moved.mcp, Some(at("x/codex/my.toml")));
        assert_eq!(moved.scan, Some(at("x/codex")));
        let by_folder = l.relocate(&home(), &d, Role::Scan, &at("x/codex"));
        assert_eq!(by_folder.config, Some(at("x/codex/config.toml")));
        assert_eq!(by_folder.mcp, by_folder.config);
    }

    /// 只有 MCP 的（Cursor）：没有接管、扫描不单算一处
    #[test]
    fn a_client_without_some_of_the_three_leaves_them_out() {
        let l = layout("cursor").unwrap();
        let d = l.defaults(&home());
        assert_eq!(d.config, None);
        assert_eq!(d.scan, None);
        assert_eq!(d.mcp, Some(at(".cursor/mcp.json")));
        let moved = l.relocate(&home(), &d, Role::Mcp, &at("c/mcp.json"));
        assert_eq!(
            moved,
            Places {
                config: None,
                mcp: Some(at("c/mcp.json")),
                scan: None
            }
        );
    }

    /// 用户指定的叠在默认位置上
    #[test]
    fn what_was_set_is_laid_over_the_defaults() {
        let l = layout("claude-code").unwrap();
        let set = Places {
            mcp: Some(at("w/.claude.json")),
            ..Places::default()
        };
        let now = l.now(&home(), Some(&set));
        assert_eq!(now.mcp, Some(at("w/.claude.json")));
        assert_eq!(now.config, Some(at(".claude/settings.json")));
    }

    /// 能换位置的都在客户端表或 MCP 表里；两个不能换的不在
    #[test]
    fn every_layout_names_a_known_client() {
        for l in layouts() {
            let known = crate::clients::adoptable().iter().any(|c| c.id == l.client)
                || crate::mcp::targets().iter().any(|t| t.client == l.client);
            assert!(known, "{}", l.client);
        }
        assert!(layout(crate::desktop::ID).is_none());
        assert!(layout("dsh").is_none());
    }
}
