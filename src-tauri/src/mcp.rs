//! MCP 页的命令：哪些客户端的 MCP 配置能写，以及在矩阵上搬一个、删一个。
//!
//! **改的是这台机器上客户端自己读的配置**，不经过网关，也不问 core。和接管一样，
//! 算一份改动和落盘是两步，中间夹一次人的确认。

use std::path::Path;

use tw_adopt::mcp;
use tw_types::Msg;

use crate::clients::home_dir;
use crate::error::Out;
use crate::wire;

/// MCP 表里的那一个，带着用户为这台电脑上的它换过的文件（见
/// [`crate::clients::locations`]）
fn target(id: &str, home: &Path) -> Result<mcp::Target, Msg> {
    let mut t = mcp::target(id).map_err(|e| e.msg())?;
    t.custom_path = crate::clients::locations::moved(home)
        .get(id)
        .and_then(|p| p.mcp.clone());
    Ok(t)
}

fn plan(home: &Path, req: &wire::McpOpRequest) -> Result<mcp::Plan, Msg> {
    let to = target(&req.to, home)?;
    match req.op {
        wire::McpOp::Remove => mcp::plan_remove(&to, home, &req.name).map_err(|e| e.msg()),
        wire::McpOp::Copy => {
            let from = target(req.from.as_deref().unwrap_or_default(), home)?;
            let v = mcp::read_server(&from, home, &req.name).map_err(|e| e.msg())?;
            mcp::plan_copy(&to, home, &req.name, &v).map_err(|e| e.msg())
        }
    }
}

/// 能写和不能写的分别是哪些，路径按用户换过的写。
pub fn targets(home: &Path) -> Vec<wire::McpTargetView> {
    let moved = crate::clients::locations::moved(home);
    mcp::targets()
        .into_iter()
        .map(|mut t| {
            t.custom_path = moved.get(t.client).and_then(|p| p.mcp.clone());
            wire::McpTargetView {
                client: t.client.to_string(),
                name: t.name.to_string(),
                path: t.shown(),
                copyable: t.copyable,
                why_not: t.why_not(),
                movable: tw_adopt::locations::layout(t.client).is_some(),
            }
        })
        .collect()
}

/// 算一份改动。**不写任何东西。**
pub fn plan_op(home: &Path, req: &wire::McpOpRequest) -> Result<wire::PlanView, Msg> {
    let p = plan(home, req)?;
    Ok(wire::PlanView {
        client: p.client,
        path: p.path.display().to_string(),
        before: p.before,
        after: p.after,
        notes: Vec::new(),
        shadows: Vec::new(),
        noop: p.noop,
        // MCP 的 env 里可能有密钥，而我们正把它抄进另一个文件
        carries_secret: true,
        fields: vec![wire::FieldChange {
            op: if p.remove {
                wire::FieldOp::Remove
            } else {
                wire::FieldOp::Set
            },
            path: p.field.join("."),
            // 值是一整段 server 配置，里面可能有密钥，diff 里已经能看到打过码的样子
            value: None,
            secret: false,
        }],
        key: None,
        key_created: false,
        also: Vec::new(),
    })
}

/// 落盘。**用户在 diff 上点过确认之后才该到这里。**
pub fn apply(
    home: &Path,
    backups: &Path,
    req: &wire::McpOpRequest,
) -> Result<wire::AdoptResponse, Msg> {
    let to = target(&req.to, home)?;
    let p = plan(home, req)?;
    let a = mcp::apply(&to, &p, backups).map_err(|e| e.msg())?;
    Ok(wire::AdoptResponse {
        real: a.real.display().to_string(),
        backup: a.backup.display().to_string(),
        created: a.created,
        warnings: a.warnings,
        // 客户端只在启动时读 MCP 配置
        takes_effect: wire::TakesEffect::OnRestart,
    })
}

#[tauri::command]
pub async fn mcp_targets() -> Out<Vec<wire::McpTargetView>> {
    Ok(targets(&home_dir()))
}

#[tauri::command]
pub async fn plan_mcp(req: wire::McpOpRequest) -> Out<wire::PlanView> {
    Ok(plan_op(&home_dir(), &req)?)
}

#[tauri::command]
pub async fn apply_mcp(req: wire::McpOpRequest) -> Out<wire::AdoptResponse> {
    Ok(apply(&home_dir(), &tw_adopt::foreign::backup_root(), &req)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(op: wire::McpOp, name: &str, from: Option<&str>, to: &str) -> wire::McpOpRequest {
        wire::McpOpRequest {
            op,
            name: name.into(),
            from: from.map(str::to_string),
            to: to.into(),
        }
    }

    /// 一台 Claude Code 里配了一个 MCP server、Cursor 里什么都没有的机器
    fn home() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(
            d.path().join(".claude.json"),
            r#"{ "mcpServers": { "fs": { "command": "npx", "args": ["-y", "fs"], "env": { "TOKEN": "t" } } } }"#,
        )
        .unwrap();
        std::fs::create_dir_all(d.path().join(".cursor")).unwrap();
        d
    }

    #[test]
    fn copying_a_server_between_clients_is_a_plan_then_an_apply() {
        let h = home();
        let r = req(wire::McpOp::Copy, "fs", Some("claude-code"), "cursor");
        let p = plan_op(h.path(), &r).unwrap();
        assert!(!p.noop);
        assert!(p.carries_secret);
        assert_eq!(p.fields[0].op, wire::FieldOp::Set);
        // 算的那一步不写
        assert!(!h.path().join(".cursor/mcp.json").exists());

        let a = apply(h.path(), &h.path().join("backups"), &r).unwrap();
        assert_eq!(a.takes_effect, wire::TakesEffect::OnRestart);
        let text = std::fs::read_to_string(h.path().join(".cursor/mcp.json")).unwrap();
        assert!(text.contains("\"fs\""), "{text}");
    }

    #[test]
    fn removing_a_server_is_the_emergency_switch_and_it_really_deletes() {
        let h = home();
        let r = req(wire::McpOp::Remove, "fs", None, "claude-code");
        apply(h.path(), &h.path().join("backups"), &r).unwrap();
        let text = std::fs::read_to_string(h.path().join(".claude.json")).unwrap();
        assert!(!text.contains("\"fs\""), "{text}");
    }

    #[test]
    fn a_client_whose_mcp_shape_we_have_not_verified_refuses_and_explains() {
        let h = home();
        let bad = targets(Path::new(""))
            .into_iter()
            .find(|t| !t.copyable)
            .unwrap();
        assert!(bad.why_not.is_some());
        let r = req(wire::McpOp::Copy, "fs", Some("claude-code"), &bad.client);
        assert!(plan_op(h.path(), &r).is_err());
    }

    #[test]
    fn a_client_we_do_not_know_is_refused() {
        let h = home();
        let e = plan_op(h.path(), &req(wire::McpOp::Remove, "fs", None, "../x")).unwrap_err();
        assert_eq!(e.code, "adopt.mcp.unknown_client");
    }
}
