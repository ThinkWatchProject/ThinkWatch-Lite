//! 插件：要在系统的确认框里点头的那几步（约定附录 4 §3）。
//!
//! **只有一种情形要点头**：插件改得了回答里的工具调用（原来的或者新的代码里有
//! `reply_tool_calls`），而这次要装上它、打开它、改它的代码，或者批准它磁盘上改过的文件。
//! 这时网页那条路（`CreatePlugin`、`SavePlugin`、`ApprovePluginFile`）答 403
//! `control.plugin.needs_confirmation`，点头之后发的那三个端点（`…Confirmed`）**不在网页的
//! 白名单里**（见 `call.rs`）：网页里的脚本自己就能点网页上的「确定」，所以只能请这里去做。
//! 而这里不信网页给的任何关于插件的说法：
//!
//! 1. **自己再读一遍**：代码交给 core 的 `PluginInspect`（不写任何东西）；装着的插件从
//!    `Plugins` 读，确认过的那一份代码从 `PluginSourceDiff` 取、再读一遍。名字、权限、处理
//!    哪几种请求、SHA-256、这次改了什么都从这几次读出来。网页给的只有代码本身、ID 和开关。
//! 2. 在系统的确认框里写明插件名、它能做什么、这次改什么，以及 SHA-256 的前几位（应用里
//!    写的是同一段，对得上就是同一份代码）。**默认按钮是取消**。
//! 3. 用户点了确认，才把**给人看过的那同一份**交给 core。
//!
//! 用户在对话框里取消不是失败：回执是 `cancelled`，网页那边什么都不用报，界面照原样。

use std::collections::BTreeMap;

use tw_api::{ManifestView, Permission, PluginInspection, PluginView, SettingValue, ep};

use crate::AppState;
use crate::control::ControlClient;
use crate::error::{CmdError, Out, text};
use crate::wire::{PluginApproveRequest, PluginInstallRequest, PluginSaveRequest, PluginWrite};

mod confirm;
pub mod defaults;
pub mod words;

use words::{Change, ScopePart};

/// 插件文件的上限，和 core 一样
const MAX_SOURCE: usize = 1024 * 1024;

/// 装一个插件（改得了工具调用的那种）
#[tauri::command]
pub async fn plugin_install_confirmed(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: PluginInstallRequest,
) -> Out<PluginWrite> {
    let c = &state.control;
    let read = inspect(c, &req.source).await?;
    let m = &read.manifest;
    let ask = words::install(
        &defaults::name(req.id.as_deref(), &m.name),
        &m.permissions,
        &m.requests,
        &m.scope,
        &read.sha256,
    );
    if !confirmed(&app, ask).await? {
        return Ok(PluginWrite::Cancelled);
    }
    let w = c
        .call::<ep::CreatePluginConfirmed>(
            &[],
            &tw_api::PluginCreate {
                source: req.source,
                id: req.id,
                enabled: req.enabled,
                base_version: req.base_version,
            },
        )
        .await
        .map_err(text)?;
    Ok(PluginWrite::Done { version: w.version })
}

/// 保存一个插件：整份代码和开关。打开改得了工具调用的插件、改它的代码时用。
///
/// 这次改什么**由这里比出来**：开关和 core 那边现在的比；代码和确认过的那一份比 —— 按新代码
/// 里的值改写确认过的那一份（`PluginRewrite`），正好得到交上来的这一份，就只是改了数据（出错
/// 时、适用范围、设置的值），逐项写出来；不然就是改了代码，写出新旧两个 SHA-256。
#[tauri::command]
pub async fn plugin_save_confirmed(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: PluginSaveRequest,
) -> Out<PluginWrite> {
    let c = &state.control;
    let before = installed(c, &req.id).await?;
    let read = inspect(c, &req.source).await?;
    let approved = approved_code(c, &before).await;
    let old = match approved.as_deref() {
        Some(src) => inspect(c, src).await.ok().map(|r| r.manifest),
        None => None,
    };
    let mut changes = Vec::new();
    match (before.enabled, req.enabled) {
        (false, true) => changes.push(Change::TurnOn),
        (true, false) => changes.push(Change::TurnOff),
        _ => {}
    }
    if read.sha256 != before.sha256 {
        let data_only = match (approved.as_deref(), &old) {
            (Some(src), Some(_)) => rewrite(c, src, &read.manifest)
                .await
                .is_some_and(|s| s == req.source),
            _ => false,
        };
        if !data_only {
            changes.push(Change::Code {
                from: before.sha256.clone(),
                to: read.sha256.clone(),
            });
        }
        if let Some(old) = &old {
            changes.extend(data_changes(&before.id, old, &read.manifest));
        }
    }
    let previous = match &old {
        Some(m) => Some(m.permissions.as_slice()),
        None => known(&before),
    };
    let m = &read.manifest;
    let ask = words::save(
        &shown_name(&before),
        &defaults::name(Some(&req.id), &m.name),
        &m.permissions,
        &m.requests,
        previous,
        &changes,
    );
    if !confirmed(&app, ask).await? {
        return Ok(PluginWrite::Cancelled);
    }
    let w = c
        .call::<ep::SavePluginConfirmed>(
            &[&req.id],
            &tw_api::PluginSave {
                source: req.source,
                enabled: req.enabled,
                base_version: req.base_version,
            },
        )
        .await
        .map_err(text)?;
    Ok(PluginWrite::Done { version: w.version })
}

/// 批准一个插件磁盘上改过的文件。**文件由这里自己去取**（`PluginSourceDiff`），读的、给人看的、
/// 交给 core 认的是同一个 SHA-256；在这期间文件又变了的话，core 那边对不上就不认
#[tauri::command]
pub async fn plugin_approve_confirmed(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: PluginApproveRequest,
) -> Out<PluginWrite> {
    let c = &state.control;
    let before = installed(c, &req.id).await?;
    let source = c
        .call::<ep::PluginSourceDiff>(&[&req.id], &())
        .await
        .map_err(text)?;
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
    let m = &read.manifest;
    let ask = words::approve(
        &shown_name(&before),
        &defaults::name(Some(&req.id), &m.name),
        &m.permissions,
        &m.requests,
        known(&before),
        &source.approved_sha256,
        &sha,
    );
    if !confirmed(&app, ask).await? {
        return Ok(PluginWrite::Cancelled);
    }
    let w = c
        .call::<ep::ApprovePluginFileConfirmed>(
            &[&req.id],
            &tw_api::PluginApprove {
                sha256: sha,
                base_version: req.base_version,
            },
        )
        .await
        .map_err(text)?;
    Ok(PluginWrite::Done { version: w.version })
}

/// 两份 manifest 的数据改了什么，按确认框里的先后：设置（按声明的顺序）、适用范围（每一项
/// 单独说）、出错时怎么办。设置的标签按新代码里写的（默认插件按界面语言）；范围不看顺序、
/// 空白和重复
fn data_changes(id: &str, old: &ManifestView, new: &ManifestView) -> Vec<Change> {
    let mut out = Vec::new();
    let was: BTreeMap<&str, &SettingValue> = old
        .settings_schema
        .iter()
        .map(|s| (s.key.as_str(), &s.value))
        .collect();
    for s in &new.settings_schema {
        let Some(&from) = was.get(s.key.as_str()) else {
            continue;
        };
        if from == &s.value {
            continue;
        }
        out.push(Change::Setting {
            label: defaults::label(id, &new.name, &s.key, &s.label),
            from: words::setting_value(from),
            to: words::setting_value(&s.value),
        });
    }
    for part in ScopePart::ALL {
        let (a, b) = (norm(part.of(&old.scope)), norm(part.of(&new.scope)));
        if a != b {
            out.push(Change::Scope {
                part,
                from: a,
                to: b,
            });
        }
    }
    if old.on_error != new.on_error {
        out.push(Change::OnError {
            from: old.on_error,
            to: new.on_error,
        });
    }
    out
}

/// 范围的一张名单：去掉两头的空白，排好、去重
fn norm(list: &[String]) -> Vec<String> {
    let mut v: Vec<String> = list.iter().map(|x| x.trim().to_string()).collect();
    v.sort_unstable();
    v.dedup();
    v
}

/// core 读过一遍的代码：manifest 和 SHA-256（都是 core 读出来的，不是网页说的）
struct Read {
    manifest: ManifestView,
    sha256: String,
}

/// 交给 core 读一遍。读不了（语法、清单不对）就停在这里：应用里已经说过原因，
/// 走到这一步只可能是网页没照规矩来
async fn inspect(c: &ControlClient, source: &str) -> Out<Read> {
    if source.len() > MAX_SOURCE {
        return Err(CmdError::plain(tr!(
            "插件文件超过 1 MB 的上限。",
            "The plugin file is over the 1 MB limit."
        )));
    }
    let i: PluginInspection = c
        .call::<ep::PluginInspect>(
            &[],
            &tw_api::PluginSource {
                source: source.to_string(),
            },
        )
        .await
        .map_err(text)?;
    if let Some(e) = i.error {
        // core 的那一句带着码（语法错还带行列），界面照码说
        return Err(e.message.into());
    }
    let manifest = i.manifest.ok_or_else(|| {
        CmdError::plain(tr!(
            "代码里没有可用的插件清单。",
            "The code has no usable plugin manifest."
        ))
    })?;
    Ok(Read {
        manifest,
        sha256: i.sha256,
    })
}

/// 确认过的那一份代码：底稿，或者没被改过的插件文件（哈希和配置里确认的一样）。都没有是 `None`
async fn approved_code(c: &ControlClient, p: &PluginView) -> Option<String> {
    let src = c.call::<ep::PluginSourceDiff>(&[&p.id], &()).await.ok()?;
    if !src.approved.is_empty() && src.approved_sha256 == p.sha256 {
        Some(src.approved)
    } else if src.current_sha256.as_deref() == Some(p.sha256.as_str()) {
        src.current
    } else {
        None
    }
}

/// 按这份 manifest 里的值改写一段代码（每一个设置项都给）。没成是 `None`
async fn rewrite(c: &ControlClient, source: &str, m: &ManifestView) -> Option<String> {
    let req = tw_api::PluginRewriteRequest {
        source: source.to_string(),
        on_error: m.on_error,
        scope: m.scope.clone(),
        settings: m
            .settings_schema
            .iter()
            .map(|s| (s.key.clone(), s.value.clone()))
            .collect(),
    };
    c.call::<ep::PluginRewrite>(&[], &req)
        .await
        .ok()
        .map(|r| r.source)
}

/// 装着的那一个插件现在的样子（core 说的）
async fn installed(c: &ControlClient, id: &str) -> Out<PluginView> {
    let all = c.call::<ep::Plugins>(&[], &()).await.map_err(text)?;
    all.into_iter().find(|p| p.id == id).ok_or_else(|| {
        CmdError::plain(tr!(
            format!("插件「{id}」不存在，可能已被删除。"),
            format!("Plugin “{id}” does not exist; it may have been deleted.")
        ))
    })
}

/// 装着的插件在确认框里叫什么：默认插件按界面语言说（和插件页上一样），别的照它自己写的
fn shown_name(p: &PluginView) -> String {
    defaults::name(Some(&p.id), &p.name)
}

/// 装着的那一版申请的权限。读不出来（core 那边没有它的 manifest）是 `None`：不知道哪一项
/// 是新的，就不标「新增」
fn known(p: &PluginView) -> Option<&[Permission]> {
    (!p.permissions.is_empty()).then_some(p.permissions.as_slice())
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

#[cfg(test)]
mod tests {
    use super::*;
    use tw_api::{
        OnError, PluginHooks, PluginScope, ReplyMode, RequestKind, SettingKind, SettingSpecView,
    };

    #[test]
    fn the_receipt_says_done_or_cancelled() {
        let done = serde_json::to_value(PluginWrite::Done {
            version: "v9".into(),
        })
        .unwrap();
        assert_eq!(done, serde_json::json!({ "kind": "done", "version": "v9" }));
        let no = serde_json::to_value(PluginWrite::Cancelled).unwrap();
        assert_eq!(no, serde_json::json!({ "kind": "cancelled" }));
    }

    /// 网页给的安装请求里**没有清单**：多给了也不读（名字、权限、范围由这里自己读）
    #[test]
    fn an_install_request_carries_no_manifest() {
        let req: PluginInstallRequest = serde_json::from_value(serde_json::json!({
            "source": "export const manifest = {}",
            "id": "x",
            "enabled": true,
            "base_version": null,
            "manifest": { "name": "伪造的名字", "permissions": [] },
            "scope": { "clients": ["伪造的范围"], "models": [], "upstreams": [] }
        }))
        .unwrap();
        assert_eq!(req.id.as_deref(), Some("x"));
        let shown = format!("{req:?}");
        assert!(
            !shown.contains("伪造的名字") && !shown.contains("伪造的范围"),
            "{shown}"
        );
    }

    fn manifest() -> ManifestView {
        ManifestView {
            name: "Answer in a chosen language".into(),
            description: None,
            permissions: vec![Permission::System],
            requests: vec![RequestKind::Conversation],
            scope: PluginScope::default(),
            on_error: OnError::Reject,
            reply_mode: ReplyMode::Block,
            hooks: PluginHooks {
                request: true,
                ..PluginHooks::default()
            },
            settings_schema: vec![SettingSpecView {
                key: "language".into(),
                kind: SettingKind::String,
                label: "Answer language".into(),
                value: SettingValue::String("简体中文".into()),
            }],
        }
    }

    /// 只改了数据：每一项单独说，设置的标签按界面语言（默认插件），两个值都写出来；
    /// 范围不看顺序和空白
    #[test]
    fn data_changes_name_each_setting_scope_part_and_on_error() {
        crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
            let old = ManifestView {
                scope: PluginScope {
                    models: vec!["b*".into(), "a*".into()],
                    ..PluginScope::default()
                },
                ..manifest()
            };
            let mut new = manifest();
            new.scope.models = vec![" a*".into(), "b*".into(), "a*".into()];
            assert!(data_changes("reply-language", &old, &new).is_empty());

            new.settings_schema[0].value = SettingValue::String("English".into());
            new.scope.upstreams = vec!["deepseek".into()];
            new.on_error = OnError::Skip;
            assert_eq!(
                data_changes("reply-language", &old, &new),
                [
                    Change::Setting {
                        label: "回答语言".into(),
                        from: "简体中文".into(),
                        to: "English".into()
                    },
                    Change::Scope {
                        part: ScopePart::Upstreams,
                        from: vec![],
                        to: vec!["deepseek".into()]
                    },
                    Change::OnError {
                        from: OnError::Reject,
                        to: OnError::Skip
                    },
                ]
            );
        });
    }

    /// 新代码里才有的设置项不算一项改动（它在「改了代码」里）
    #[test]
    fn a_new_setting_is_part_of_the_code_change() {
        let old = manifest();
        let mut new = manifest();
        new.settings_schema.push(SettingSpecView {
            key: "tone".into(),
            kind: SettingKind::String,
            label: "Tone".into(),
            value: SettingValue::String("formal".into()),
        });
        assert!(data_changes("reply-language", &old, &new).is_empty());
    }
}
