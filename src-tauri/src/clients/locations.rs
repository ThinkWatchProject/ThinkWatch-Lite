//! 客户端的配置位置：接管改的文件、MCP 管理读写的文件、安全扫描看的目录。
//!
//! 用户在客户端页或 MCP 页换过的存在 `app.json`（`client_locations`，按客户端 id），
//! **只管这台电脑**。三项跟着同一个目录一起换（`tw_adopt::locations`）：改其中一项，
//! 界面先把几项一起列出来（[`plan`]），确认之后一起生效（[`set`]）。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tw_adopt::locations::{Layout, Places, Role};
use tw_types::{Msg, msg};

use crate::wire;

/// 用户为这台电脑上的客户端换过的位置，按客户端 id。
///
/// **`home` 不是这台电脑的就是空的**：WSL 里的、测试用的临时目录，都用默认位置 ——
/// 和 `tw_adopt::paths::Loc::resolve` 只在这台电脑上认 XDG 变量是同一个道理。
pub fn moved(home: &Path) -> BTreeMap<String, Places> {
    if home.as_os_str().is_empty() || home != super::home_dir() {
        return BTreeMap::new();
    }
    crate::prefs::load(&crate::data_dir()).client_locations
}

fn role(r: Role) -> wire::LocationRole {
    match r {
        Role::Config => wire::LocationRole::Config,
        Role::Mcp => wire::LocationRole::Mcp,
        Role::Scan => wire::LocationRole::Scan,
    }
}

fn unrole(r: wire::LocationRole) -> Role {
    match r {
        wire::LocationRole::Config => Role::Config,
        wire::LocationRole::Mcp => Role::Mcp,
        wire::LocationRole::Scan => Role::Scan,
    }
}

/// 对话框里的几行：一处位置一行，同一个文件的几项并成一行（Codex 的 `config.toml`
/// 既是接管的也是 MCP 的）。只有一个文件的客户端，扫描看的就是 MCP 那个文件。
fn rows(l: &Layout, p: &Places) -> Vec<(Vec<Role>, bool, PathBuf)> {
    let mut out = Vec::new();
    if let Some(c) = &p.config {
        let mut roles = vec![Role::Config];
        if l.shared {
            roles.push(Role::Mcp);
            if !l.scan_dir {
                roles.push(Role::Scan);
            }
        }
        out.push((roles, false, c.clone()));
    }
    if !l.shared
        && let Some(m) = &p.mcp
    {
        let mut roles = vec![Role::Mcp];
        if !l.scan_dir {
            roles.push(Role::Scan);
        }
        out.push((roles, false, m.clone()));
    }
    if let Some(s) = &p.scan {
        out.push((vec![Role::Scan], true, s.clone()));
    }
    out
}

fn layout(id: &str) -> Result<Layout, Msg> {
    tw_adopt::locations::layout(id).ok_or_else(|| {
        msg!(
            "adopt.path.fixed", client = name_of(id) =>
            "The configuration file of {client} cannot be moved."
        )
    })
}

/// 界面上的名字：客户端表里的，没有就是 MCP 表里的
fn name_of(id: &str) -> String {
    tw_adopt::clients::adoptable()
        .into_iter()
        .find(|c| c.id == id)
        .map(|c| c.name)
        .or_else(|| tw_adopt::mcp::target(id).ok().map(|t| t.name))
        .or_else(|| {
            tw_adopt::clients::manual_only()
                .into_iter()
                .find(|m| m.id == id)
                .map(|m| m.name)
        })
        .unwrap_or(id)
        .to_string()
}

/// 接管着吗。**接管着的不换位置**：接管的文件跟着换，而接管记录和能还原的原文都在
/// 原来那个文件旁边 —— 先还原
fn adopted(home: &Path, id: &str) -> bool {
    super::ops::find(id, home).is_ok_and(|c| {
        tw_adopt::detect::detect_one(&c, home)
            .adopted_at_ms
            .is_some()
    })
}

/// 「更改路径…」那个对话框要的：此刻的几处位置和各自的默认位置。
pub fn view(home: &Path, id: &str) -> Result<wire::ClientLocations, Msg> {
    let l = layout(id)?;
    let set = moved(home);
    let now = l.now(home, set.get(id));
    let defaults = rows(&l, &l.defaults(home));
    Ok(wire::ClientLocations {
        client: id.to_string(),
        name: name_of(id),
        adopted: adopted(home, id),
        rows: rows(&l, &now)
            .into_iter()
            .zip(defaults)
            .map(|((roles, dir, path), (_, _, default))| wire::LocationView {
                roles: roles.into_iter().map(role).collect(),
                dir,
                path: path.display().to_string(),
                default: default.display().to_string(),
            })
            .collect(),
    })
}

/// 界面填的那一串核对之后是哪儿：`~/…` 按 home 展开，要完整路径；扫描那一项要是一个
/// 在的文件夹，别的是一个文件 —— 它所在的文件夹得在，后缀得是这一项读的格式
/// （免得把 TOML 写进一个 `.json`）。
fn checked(id: &str, home: &Path, edit: &wire::LocationEdit) -> Result<PathBuf, Msg> {
    let raw = edit.path.trim();
    let p = match raw.strip_prefix('~') {
        Some("") => home.to_path_buf(),
        Some(rest) if rest.starts_with(['/', '\\']) => {
            tw_adopt::paths::under(home, &rest[1..].replace('\\', "/"))
        }
        _ => PathBuf::from(raw),
    };
    if raw.is_empty() || !p.is_absolute() {
        return Err(msg!(
            "adopt.path.not_absolute", path = raw =>
            "{path} is not a full path."
        ));
    }
    if unrole(edit.role) == Role::Scan {
        if !p.is_dir() {
            return Err(msg!(
                "adopt.path.not_folder", path = p.display().to_string() =>
                "{path} is not a folder."
            ));
        }
        return Ok(p);
    }
    if p.is_dir() {
        return Err(msg!(
            "adopt.path.folder", path = p.display().to_string() =>
            "{path} is a folder. Enter the path of the configuration file."
        ));
    }
    if let Some(dir) = p.parent().filter(|d| !d.is_dir()) {
        return Err(msg!(
            "adopt.path.no_folder", folder = dir.display().to_string() =>
            "The folder {folder} does not exist."
        ));
    }
    let format = match unrole(edit.role) {
        Role::Config => tw_adopt::clients::adoptable()
            .into_iter()
            .find(|c| c.id == id)
            .map(|c| c.format),
        _ => tw_adopt::mcp::target(id).ok().map(|t| t.format),
    };
    if let Some(format) = format {
        let exts = format.extensions();
        let ext = p
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase);
        if !ext.is_some_and(|e| exts.contains(&e.as_str())) {
            let ext = exts
                .iter()
                .map(|e| format!(".{e}"))
                .collect::<Vec<_>>()
                .join(" / ");
            return Err(msg!(
                "adopt.path.format", client = name_of(id), ext = ext =>
                "{client} reads a {ext} file."
            ));
        }
    }
    Ok(p)
}

/// 改一项之后（`edit` 为空是全部回到默认位置）三项各在哪：此刻的和改之后的。
fn planned(
    home: &Path,
    id: &str,
    edit: Option<&wire::LocationEdit>,
) -> Result<(Layout, Places, Places), Msg> {
    let l = layout(id)?;
    let now = l.now(home, moved(home).get(id));
    let next = match edit {
        Some(e) => {
            let to = checked(id, home, e)?;
            l.relocate(home, &now, unrole(e.role), &to)
        }
        None => l.defaults(home),
    };
    if next.config != now.config && adopted(home, id) {
        return Err(msg!(
            "adopt.path.adopted", client = name_of(id) =>
            "{client} is connected. Restore it before changing the path."
        ));
    }
    Ok((l, now, next))
}

/// 改之前要说的：哪几处换到哪儿。**不写任何东西。**
pub fn plan(
    home: &Path,
    id: &str,
    edit: Option<&wire::LocationEdit>,
) -> Result<Vec<wire::LocationChange>, Msg> {
    let (l, now, next) = planned(home, id, edit)?;
    Ok(rows(&l, &now)
        .into_iter()
        .zip(rows(&l, &next))
        .filter(|((_, _, from), (_, _, to))| from != to)
        .map(|((roles, dir, from), (_, _, to))| wire::LocationChange {
            roles: roles.into_iter().map(role).collect(),
            dir,
            from: from.display().to_string(),
            to: to.display().to_string(),
        })
        .collect())
}

/// 核对并存下。只存和默认位置不一样的几项；全回到默认位置就整条删掉。
pub fn set(
    home: &Path,
    data: &Path,
    id: &str,
    edit: Option<&wire::LocationEdit>,
) -> Result<(), Msg> {
    let (l, _, next) = planned(home, id, edit)?;
    let keep = next.beyond(&l.defaults(home));
    crate::prefs::update(data, |p| {
        if keep.is_empty() {
            p.client_locations.remove(id);
        } else {
            p.client_locations.insert(id.to_string(), keep);
        }
    })
    .map(|_| ())
    .map_err(|e| {
        msg!(
            "adopt.path.unsaved", detail = format!("{e:#}") =>
            "The location could not be saved: {detail}"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn edit(r: wire::LocationRole, path: &str) -> wire::LocationEdit {
        wire::LocationEdit {
            role: r,
            path: path.into(),
        }
    }

    /// 核对：完整路径、文件夹在不在、后缀对不对；扫描那一项要是文件夹
    #[test]
    fn a_new_location_is_checked_before_anything_is_planned() {
        let d = tempfile::tempdir().unwrap();
        let h = d.path();
        std::fs::create_dir_all(h.join("work")).unwrap();
        let code = |e: wire::LocationEdit| plan(h, "claude-code", Some(&e)).unwrap_err().code;
        use wire::LocationRole::{Config, Mcp, Scan};
        assert_eq!(
            code(edit(Config, "work/settings.json")),
            "adopt.path.not_absolute"
        );
        assert_eq!(code(edit(Config, " ")), "adopt.path.not_absolute");
        assert_eq!(code(edit(Config, "~/work")), "adopt.path.folder");
        assert_eq!(
            code(edit(Config, "~/nope/settings.json")),
            "adopt.path.no_folder"
        );
        assert_eq!(
            code(edit(Config, "~/work/settings.toml")),
            "adopt.path.format"
        );
        assert_eq!(code(edit(Mcp, "~/work/.claude.toml")), "adopt.path.format");
        assert_eq!(
            code(edit(Scan, "~/work/settings.json")),
            "adopt.path.not_folder"
        );
        assert_eq!(
            plan(
                h,
                tw_adopt::desktop::ID,
                Some(&edit(Config, "~/work/x.json"))
            )
            .unwrap_err()
            .code,
            "adopt.path.fixed"
        );
    }

    /// 改一项，三处一起列出来：Claude Code 的接管、MCP、扫描各是一行
    #[test]
    fn changing_one_lists_all_three() {
        let d = tempfile::tempdir().unwrap();
        let h = d.path();
        std::fs::create_dir_all(h.join("work")).unwrap();
        let changes = plan(
            h,
            "claude-code",
            Some(&edit(wire::LocationRole::Scan, "~/work")),
        )
        .unwrap();
        let tos: Vec<_> = changes
            .iter()
            .map(|c| (c.roles.clone(), c.to.clone()))
            .collect();
        assert_eq!(
            tos,
            vec![
                (
                    vec![wire::LocationRole::Config],
                    h.join("work").join("settings.json").display().to_string()
                ),
                (
                    vec![wire::LocationRole::Mcp],
                    h.join("work").join(".claude.json").display().to_string()
                ),
                (
                    vec![wire::LocationRole::Scan],
                    h.join("work").display().to_string()
                ),
            ]
        );
        // 回到默认位置：此刻就在默认位置，没什么要改的
        assert!(plan(h, "claude-code", None).unwrap().is_empty());
    }

    /// 同一个文件的几项并成一行（Codex 的 `config.toml`）
    #[test]
    fn a_shared_file_is_one_row() {
        let d = tempfile::tempdir().unwrap();
        let v = view(d.path(), "codex").unwrap();
        let roles: Vec<_> = v.rows.iter().map(|r| r.roles.clone()).collect();
        assert_eq!(
            roles,
            vec![
                vec![wire::LocationRole::Config, wire::LocationRole::Mcp],
                vec![wire::LocationRole::Scan],
            ]
        );
        assert!(v.rows[1].dir);
        assert_eq!(v.rows[0].path, v.rows[0].default);
    }

    /// 接管着的不换：接管的文件会跟着换，而接管记录在原来那个文件旁边
    #[test]
    fn an_adopted_client_keeps_its_locations_until_restored() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".claude")).unwrap();
        std::fs::create_dir_all(home.path().join("work")).unwrap();
        let backups = home.path().join("backups");
        super::super::ops::adopt(
            home.path(),
            &backups,
            "claude-code",
            "http://127.0.0.1:8788",
            "tw-k",
            Vec::new(),
        )
        .unwrap();
        assert_eq!(
            plan(
                home.path(),
                "claude-code",
                Some(&edit(wire::LocationRole::Mcp, "~/work/.claude.json"))
            )
            .unwrap_err()
            .code,
            "adopt.path.adopted"
        );
        assert!(view(home.path(), "claude-code").unwrap().adopted);
    }

    /// 存下的只有和默认不一样的几项；这台电脑以外的 home 读不到它们
    #[test]
    fn only_what_differs_is_kept_and_only_for_this_computer() {
        let home = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join("work")).unwrap();
        set(
            home.path(),
            data.path(),
            "cursor",
            Some(&edit(wire::LocationRole::Mcp, "~/work/mcp.json")),
        )
        .unwrap();
        let saved = crate::prefs::load(data.path()).client_locations;
        assert_eq!(
            saved.get("cursor"),
            Some(&Places {
                config: None,
                mcp: Some(home.path().join("work").join("mcp.json")),
                scan: None,
            })
        );
        // 回到默认位置：整条删掉
        set(home.path(), data.path(), "cursor", None).unwrap();
        assert!(crate::prefs::load(data.path()).client_locations.is_empty());
        assert!(moved(home.path()).is_empty());
    }
}
