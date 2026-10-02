//! 插件：要在系统原生对话框里确认的那三步（I12）。
//!
//! 安装插件（`CreatePlugin`）、更换代码（`ReplacePluginSource`）、确认变了的文件
//! （`ApprovePluginFile`）**不在网页的白名单里**（见 `call.rs`）。网页只能请这里去做，
//! 而这里不信网页给的任何关于插件的说法：
//!
//! 1. **自己再读一遍代码**：交给 core 的 `PluginInspect`（不写任何东西），名字、权限、SHA-256
//!    都从这一次读出来。网页给的只有代码本身和用户的选择（ID、范围、设置项、出错时）。
//! 2. 在原生对话框里写明插件名、权限、SHA-256 的前几位（审核窗口里写的是同一段，对得上
//!    就是同一份代码），**默认按钮是取消**。
//! 3. 用户点了确认，才把**读过的那同一份代码**交给 core 写配置。
//!
//! 用户在对话框里取消不是失败：回执是 `cancelled`，网页那边什么都不用报。
//!
//! 其余插件端点（列出、读代码、设置、删除、排序、试运行、日志）网页直接经过 `call` 走
//! （白名单的 `provisional` 那一组）。它们的类型现在在 [`wire`]，core 发版之后换成生成的。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::AppState;
use crate::control::ControlClient;
use crate::error::{CmdError, Out, text};

mod confirm;
pub mod wire;
pub mod words;

use wire::{Inspection, Installed, OnError, Permission, PluginScope, SourceView};

/// 插件文件的上限，和 core 一样
const MAX_SOURCE: usize = 1024 * 1024;

/// 网页给的安装请求：代码，和用户在审核窗口里选的。**没有清单** —— 名字和权限这里自己读
#[derive(Debug, Deserialize)]
pub struct InstallRequest {
    source: String,
    id: Option<String>,
    enabled: bool,
    on_error: OnError,
    scope: PluginScope,
    settings: BTreeMap<String, Value>,
    base_version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ReplaceRequest {
    id: String,
    source: String,
    base_version: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ApproveRequest {
    id: String,
    base_version: Option<String>,
}

/// 写成了（配置的新版本），或者用户在原生对话框里取消了（什么都没写）
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Written {
    Done { version: String },
    Cancelled,
}

/// 安装一个插件
#[tauri::command]
pub async fn plugin_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: InstallRequest,
) -> Out<Written> {
    let c = &state.control;
    let read = inspect(c, &req.source).await?;
    let ask = words::install(&read.name, &read.permissions, &req.scope, &read.sha256);
    if !confirmed(&app, ask).await? {
        return Ok(Written::Cancelled);
    }
    let w = c
        .call::<wire::CreatePlugin>(
            &[],
            &wire::PluginCreate {
                source: req.source,
                id: req.id,
                enabled: req.enabled,
                on_error: req.on_error,
                scope: req.scope,
                settings: req.settings,
                base_version: req.base_version,
            },
        )
        .await
        .map_err(text)?;
    Ok(Written::Done { version: w.version })
}

/// 更换一个插件的代码
#[tauri::command]
pub async fn plugin_replace_source(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: ReplaceRequest,
) -> Out<Written> {
    let c = &state.control;
    let before = installed(c, &req.id).await?;
    let read = inspect(c, &req.source).await?;
    let ask = words::replace(
        &before.name,
        &read.name,
        &read.permissions,
        &before.permissions,
        &read.sha256,
    );
    if !confirmed(&app, ask).await? {
        return Ok(Written::Cancelled);
    }
    let w = c
        .call::<wire::ReplacePluginSource>(
            &[&req.id],
            &wire::PluginSourceReplace {
                source: req.source,
                base_version: req.base_version,
            },
        )
        .await
        .map_err(text)?;
    Ok(Written::Done { version: w.version })
}

/// 确认一个插件变了的文件。**文件由这里自己去取**（`PluginSourceDiff`），读的、给人看的、
/// 交给 core 认的是同一个 SHA-256；在这期间文件又变了的话，core 那边对不上就不认
#[tauri::command]
pub async fn plugin_approve(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: ApproveRequest,
) -> Out<Written> {
    let c = &state.control;
    let before = installed(c, &req.id).await?;
    let source: SourceView = decode(
        c.call::<wire::PluginSourceDiff>(&[&req.id], &())
            .await
            .map_err(text)?,
    )?;
    let (Some(current), Some(sha)) = (source.current, source.current_sha256) else {
        return Err(CmdError::plain(tr!(
            "插件文件已不存在或无法读取。",
            "The plugin file no longer exists or cannot be read."
        )));
    };
    let read = inspect(c, &current).await?;
    // 两次问 core 之间文件又变了：读的不是要认的那一份
    if read.sha256 != sha {
        return Err(changed_meanwhile());
    }
    let ask = words::approve(
        &before.name,
        &read.name,
        &read.permissions,
        &before.permissions,
        &source.approved_sha256,
        &sha,
    );
    if !confirmed(&app, ask).await? {
        return Ok(Written::Cancelled);
    }
    let w = c
        .call::<wire::ApprovePluginFile>(
            &[&req.id],
            &wire::PluginApprove {
                sha256: sha,
                base_version: req.base_version,
            },
        )
        .await
        .map_err(text)?;
    Ok(Written::Done { version: w.version })
}

/// 读过一遍的代码：名字、权限、SHA-256（都是 core 读出来的，不是网页说的）
struct Read {
    name: String,
    permissions: Vec<Permission>,
    sha256: String,
}

/// 交给 core 读一遍。读不了（语法、清单不对）就停在这里：审核窗口里已经说过原因，
/// 走到这一步只可能是网页没照规矩来
async fn inspect(c: &ControlClient, source: &str) -> Out<Read> {
    if source.len() > MAX_SOURCE {
        return Err(CmdError::plain(tr!(
            "插件文件超过 1 MB 的上限。",
            "The plugin file is over the 1 MB limit."
        )));
    }
    let i: Inspection = decode(
        c.call::<wire::PluginInspect>(
            &[],
            &wire::PluginSource {
                source: source.to_string(),
            },
        )
        .await
        .map_err(text)?,
    )?;
    if let Some(e) = i.error {
        let at = match (e.line, e.column) {
            (Some(l), Some(col)) => tr!(
                format!("（第 {l} 行第 {col} 列）"),
                format!(" (line {l}, column {col})")
            ),
            (Some(l), None) => tr!(format!("（第 {l} 行）"), format!(" (line {l})")),
            _ => String::new(),
        };
        return Err(CmdError::plain(tr!(
            format!("代码无法加载{at}：{}", e.message),
            format!("The code cannot be loaded{at}: {}", e.message)
        )));
    }
    let m = i.manifest.ok_or_else(|| {
        CmdError::plain(tr!(
            "代码里没有可用的插件清单。",
            "The code has no usable plugin manifest."
        ))
    })?;
    Ok(Read {
        name: m.name,
        permissions: m.permissions,
        sha256: i.sha256,
    })
}

/// 装着的那一个插件原来的样子（更换代码、确认变更时和它比权限）
async fn installed(c: &ControlClient, id: &str) -> Out<Installed> {
    let all: Vec<Installed> = decode(c.call::<wire::Plugins>(&[], &()).await.map_err(text)?)?;
    all.into_iter().find(|p| p.id == id).ok_or_else(|| {
        CmdError::plain(tr!(
            format!("插件「{id}」不存在，可能已被删除。"),
            format!("Plugin “{id}” does not exist; it may have been deleted.")
        ))
    })
}

/// 问一句。**已经有一个确认窗口开着时直接失败**，不在背后排队
async fn confirmed(app: &tauri::AppHandle, ask: words::Ask) -> Out<bool> {
    confirm::ask(app, ask).await.map_err(|confirm::Busy| {
        CmdError::plain(tr!(
            "另一个确认窗口尚未关闭。",
            "Another confirmation dialog is still open."
        ))
    })
}

fn changed_meanwhile() -> CmdError {
    CmdError::plain(tr!(
        "插件文件在确认过程中再次被改动，请重新打开审核窗口。",
        "The plugin file changed again during the review. Open the review again."
    ))
}

/// core 的响应按这里要的样子读。读不了说明 core 和这份约定对不上
fn decode<T: serde::de::DeserializeOwned>(v: Value) -> Out<T> {
    serde_json::from_value(v).map_err(|e| {
        CmdError::plain(tr!(
            format!("core 返回的插件信息无法识别：{e}"),
            format!("The plugin information from core is not in the expected shape: {e}")
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_receipt_says_done_or_cancelled() {
        let done = serde_json::to_value(Written::Done {
            version: "v9".into(),
        })
        .unwrap();
        assert_eq!(done, serde_json::json!({ "kind": "done", "version": "v9" }));
        let no = serde_json::to_value(Written::Cancelled).unwrap();
        assert_eq!(no, serde_json::json!({ "kind": "cancelled" }));
    }

    /// 网页给的安装请求里**没有清单**：多给了也不读（名字、权限由这里自己读）
    #[test]
    fn an_install_request_carries_no_manifest() {
        let req: InstallRequest = serde_json::from_value(serde_json::json!({
            "source": "export const manifest = {}",
            "id": "x",
            "enabled": true,
            "on_error": "reject",
            "scope": { "clients": [], "models": [], "upstreams": [] },
            "settings": {},
            "base_version": null,
            "manifest": { "name": "伪造的名字", "permissions": [] }
        }))
        .unwrap();
        assert_eq!(req.id.as_deref(), Some("x"));
        assert!(!format!("{req:?}").contains("伪造的名字"));
    }

    #[test]
    fn core_inspection_is_read_like_the_contract() {
        let i: Inspection = decode(serde_json::json!({
            "manifest": {
                "name": "附加当前日期", "description": null, "permissions": ["system", "reply_tool_calls"],
                "scope": { "clients": [], "models": [], "upstreams": [] }, "reply_mode": "block",
                "settings_schema": [], "hooks": { "request": true, "reply_text": false, "tool_call": true }
            },
            "sha256": "6f1c",
            "error": null
        }))
        .unwrap();
        let m = i.manifest.unwrap();
        assert_eq!(
            m.permissions,
            [Permission::System, Permission::ReplyToolCalls]
        );
        let bad: Inspection = decode(serde_json::json!({
            "manifest": null, "sha256": "00",
            "error": { "message": "SyntaxError: unexpected token", "line": 3, "column": 7 }
        }))
        .unwrap();
        assert_eq!(bad.error.unwrap().line, Some(3));
    }
}
