//! 插件：要在系统的确认框里点头的那几步（I12）。
//!
//! 装插件（`CreatePlugin`）、更换代码（`ReplacePluginSource`）、确认变了的文件
//! （`ApprovePluginFile`），以及打开改得了回答里工具调用的插件、改它的设置或范围
//! （`UpdatePluginConfirmed`）**不在网页的白名单里**（见 `call.rs`）。网页只能请这里去做，
//! 而这里不信网页给的任何关于插件的说法：
//!
//! 1. **自己再读一遍**：代码交给 core 的 `PluginInspect`（不写任何东西）；装着的插件从
//!    `Plugins` 读，读不出它要什么权限的（core 那边没有它的 manifest），把批准的那份代码
//!    再交给 core 编一遍。名字、权限、处理哪几种请求、SHA-256 都从这一次读出来。网页给的
//!    只有代码本身和用户的选择（ID、范围、设置项、出错时、开关）。
//! 2. 在系统的确认框里写明插件名、它能做什么，以及 SHA-256 的前几位（审核窗口里写的是同一
//!    段，对得上就是同一份代码）或者这次改什么。**默认按钮是取消**。
//! 3. 用户点了确认，才把**给人看过的那同一份**交给 core。
//!
//! 用户在对话框里取消不是失败：回执是 `cancelled`，网页那边什么都不用报，界面照原样。
//!
//! 其余插件端点（列出、读代码、开关和设置、删除、排序、试运行、日志）网页直接经过 `call`
//! 走；改得了工具调用的插件，core 在那条路上只许停用、改出错时怎么办，别的改动答
//! `control.plugin.needs_confirmation`，网页再请这里。

use std::collections::BTreeMap;

use tw_api::{ManifestView, PluginUpdate, PluginView, SettingSpecView, SettingValue, ep};

use crate::AppState;
use crate::control::ControlClient;
use crate::error::{CmdError, Out, text};
use crate::wire::{
    PluginApproveRequest, PluginInstallRequest, PluginReplaceRequest, PluginUpdateRequest,
    PluginWrite,
};

mod confirm;
pub mod defaults;
pub mod words;

use words::{Can, Change, ScopePart};

/// 插件文件的上限，和 core 一样
const MAX_SOURCE: usize = 1024 * 1024;

/// 安装一个插件
#[tauri::command]
pub async fn plugin_install(
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
        &req.scope,
        &read.sha256,
    );
    if !confirmed(&app, ask).await? {
        return Ok(PluginWrite::Cancelled);
    }
    let w = c
        .call::<ep::CreatePlugin>(
            &[],
            &tw_api::PluginCreate {
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
    Ok(PluginWrite::Done { version: w.version })
}

/// 更换一个插件的代码
#[tauri::command]
pub async fn plugin_replace_source(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: PluginReplaceRequest,
) -> Out<PluginWrite> {
    let c = &state.control;
    let before = installed(c, &req.id).await?;
    let read = inspect(c, &req.source).await?;
    let m = &read.manifest;
    let ask = words::replace(
        &shown_name(&before),
        &defaults::name(Some(&req.id), &m.name),
        &m.permissions,
        &m.requests,
        known(&before),
        &read.sha256,
    );
    if !confirmed(&app, ask).await? {
        return Ok(PluginWrite::Cancelled);
    }
    let w = c
        .call::<ep::ReplacePluginSource>(
            &[&req.id],
            &tw_api::PluginSourceReplace {
                source: req.source,
                base_version: req.base_version,
            },
        )
        .await
        .map_err(text)?;
    Ok(PluginWrite::Done { version: w.version })
}

/// 确认一个插件变了的文件。**文件由这里自己去取**（`PluginSourceDiff`），读的、给人看的、
/// 交给 core 认的是同一个 SHA-256；在这期间文件又变了的话，core 那边对不上就不认
#[tauri::command]
pub async fn plugin_approve(
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
        .call::<ep::ApprovePluginFile>(
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

/// 打开一个改得了回答里工具调用的插件，或者改它的设置、范围（addendum 1 B）。
///
/// 网页那条路（`UpdatePlugin`）对这种插件只许停用、改出错时怎么办：网页里注入的脚本要是
/// 能打开它、改它的设置，就能借它改客户端要执行的命令。这里**从 core 读这个插件现在的
/// 样子**，和网页交来的那一份比出这次改什么，连同它能做什么一起摆进系统的确认框，点了头
/// 才发 `UpdatePluginConfirmed` —— 发的就是比过、给人看过的那一份。
#[tauri::command]
pub async fn plugin_update_confirmed(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    req: PluginUpdateRequest,
) -> Out<PluginWrite> {
    let c = &state.control;
    let before = installed(c, &req.id).await?;
    // 读不出权限的（core 那边没有它的 manifest）：把批准的那份代码再编一遍
    let reread = if before.permissions.is_empty() {
        reread(c, &before).await
    } else {
        None
    };
    let (name, perms, kinds, schema) = match &reread {
        Some(m) => (&m.name, &m.permissions, &m.requests, &m.settings_schema),
        None => (
            &before.name,
            &before.permissions,
            &before.requests,
            &before.settings_schema,
        ),
    };
    let can = if perms.is_empty() {
        Can::Unknown
    } else {
        Can::Known { perms, kinds }
    };
    let ask = words::update(
        &defaults::name(Some(&before.id), name),
        can,
        &changes(&before, name, schema, &req.update),
    );
    if !confirmed(&app, ask).await? {
        return Ok(PluginWrite::Cancelled);
    }
    let w = c
        .call::<ep::UpdatePluginConfirmed>(&[&req.id], &req.update)
        .await
        .map_err(text)?;
    Ok(PluginWrite::Done { version: w.version })
}

/// 这次改了什么，按确认框里的先后：开关、设置、范围（每一项单独说）、出错时怎么办。
///
/// **设置按生效的值比**（和 core 一样）：没写进去的按默认值算，所以表单原样交回来的默认值
/// 不算一次改动。范围不看顺序、空白和重复。`name` 是 manifest 里的名字（认默认插件、
/// 取它的标签用），`schema` 是它的设置项。
fn changes(
    before: &PluginView,
    name: &str,
    schema: &[SettingSpecView],
    next: &PluginUpdate,
) -> Vec<Change> {
    let mut out = Vec::new();
    match (before.enabled, next.enabled) {
        (false, true) => out.push(Change::TurnOn),
        (true, false) => out.push(Change::TurnOff),
        _ => {}
    }
    let effective = |given: &BTreeMap<String, SettingValue>| {
        let mut all = given.clone();
        for s in schema {
            all.entry(s.key.clone())
                .or_insert_with(|| s.default.clone());
        }
        all
    };
    let (was, will) = (effective(&before.settings), effective(&next.settings));
    // 声明的那几项按声明的顺序，声明之外的（读不出 manifest 时）跟在后面
    let mut keys: Vec<&String> = schema.iter().map(|s| &s.key).collect();
    for k in was.keys().chain(will.keys()) {
        if !keys.contains(&k) {
            keys.push(k);
        }
    }
    for key in keys {
        let (a, b) = (was.get(key), will.get(key));
        if a == b {
            continue;
        }
        let label = schema
            .iter()
            .find(|s| &s.key == key)
            .map(|s| defaults::label(&before.id, name, key, &s.label))
            .unwrap_or_else(|| key.clone());
        let value = |v: Option<&SettingValue>| {
            words::setting_value(v.unwrap_or(&SettingValue::String(String::new())))
        };
        out.push(Change::Setting {
            label,
            from: value(a),
            to: value(b),
        });
    }
    for part in ScopePart::ALL {
        let (a, b) = (norm(part.of(&before.scope)), norm(part.of(&next.scope)));
        if a != b {
            out.push(Change::Scope {
                part,
                from: a,
                to: b,
            });
        }
    }
    if before.on_error != next.on_error {
        out.push(Change::OnError {
            from: before.on_error,
            to: next.on_error,
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

/// 交给 core 读一遍。读不了（语法、清单不对）就停在这里：审核窗口里已经说过原因，
/// 走到这一步只可能是网页没照规矩来
async fn inspect(c: &ControlClient, source: &str) -> Out<Read> {
    if source.len() > MAX_SOURCE {
        return Err(CmdError::plain(tr!(
            "插件文件超过 1 MB 的上限。",
            "The plugin file is over the 1 MB limit."
        )));
    }
    let i = c
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

/// 读不出权限的插件：把**批准的那一份**代码交给 core 再编一遍。只认哈希和配置里批准的
/// 一样的那一份（底稿，或者没被改过的插件文件）；读不成是 `None`，确认框按读不出说
async fn reread(c: &ControlClient, p: &PluginView) -> Option<ManifestView> {
    let src = c.call::<ep::PluginSourceDiff>(&[&p.id], &()).await.ok()?;
    let code = if !src.approved.is_empty() && src.approved_sha256 == p.sha256 {
        src.approved
    } else if src.current_sha256.as_deref() == Some(p.sha256.as_str()) {
        src.current?
    } else {
        return None;
    };
    let i = c
        .call::<ep::PluginInspect>(&[], &tw_api::PluginSource { source: code })
        .await
        .ok()?;
    if i.sha256 != p.sha256 {
        return None;
    }
    i.manifest
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
fn known(p: &PluginView) -> Option<&[tw_api::Permission]> {
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
        OnError, Permission, PluginScope, PluginStats, PluginStatus, ReplyMode, RequestKind,
        SettingKind,
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

    /// 网页给的安装请求里**没有清单**：多给了也不读（名字、权限由这里自己读）
    #[test]
    fn an_install_request_carries_no_manifest() {
        let req: PluginInstallRequest = serde_json::from_value(serde_json::json!({
            "source": "export const manifest = {}",
            "id": "x",
            "enabled": true,
            "on_error": "reject",
            "scope": { "clients": [], "models": [], "upstreams": [] },
            "settings": { "note": "今天", "n": 3, "on": true },
            "base_version": null,
            "manifest": { "name": "伪造的名字", "permissions": [] }
        }))
        .unwrap();
        assert_eq!(req.id.as_deref(), Some("x"));
        assert!(!format!("{req:?}").contains("伪造的名字"));
        assert_eq!(req.settings["n"], SettingValue::Number(3.0));
    }

    fn view() -> PluginView {
        PluginView {
            id: "reply-language".into(),
            name: "Answer in a chosen language".into(),
            description: None,
            enabled: false,
            on_error: OnError::Reject,
            permissions: vec![Permission::System],
            requests: vec![RequestKind::Conversation],
            scope: PluginScope::default(),
            reply_mode: ReplyMode::Block,
            settings_schema: vec![SettingSpecView {
                key: "language".into(),
                kind: SettingKind::String,
                label: "回答语言".into(),
                default: SettingValue::String("简体中文".into()),
            }],
            settings: BTreeMap::from([(
                "language".to_string(),
                SettingValue::String("简体中文".into()),
            )]),
            sha256: "aa".into(),
            status: PluginStatus::Disabled,
            stats: PluginStats::default(),
        }
    }

    fn update_of(p: &PluginView) -> PluginUpdate {
        PluginUpdate {
            enabled: p.enabled,
            on_error: p.on_error,
            scope: p.scope.clone(),
            settings: p.settings.clone(),
            base_version: None,
        }
    }

    /// 只拨开关：确认框里只有「启用」这一项
    #[test]
    fn turning_on_is_the_only_change_when_only_the_switch_moves() {
        let p = view();
        let next = PluginUpdate {
            enabled: true,
            ..update_of(&p)
        };
        assert_eq!(
            changes(&p, &p.name, &p.settings_schema, &next),
            [Change::TurnOn]
        );
    }

    /// 设置按生效的值比：表单不交默认值、交回原样的默认值，都不算改动；范围不看顺序
    #[test]
    fn defaults_and_reordered_scopes_are_not_changes() {
        let mut p = view();
        p.scope.models = vec!["b*".into(), "a*".into()];
        let mut next = update_of(&p);
        next.settings.clear();
        next.scope.models = vec!["a*".into(), " b* ".into(), "a*".into()];
        assert!(changes(&p, &p.name, &p.settings_schema, &next).is_empty());
    }

    #[test]
    fn a_changed_setting_names_its_label_and_both_values() {
        crate::i18n::with_lang(crate::i18n::Lang::Zh, || {
            let p = view();
            let mut next = update_of(&p);
            next.settings
                .insert("language".into(), SettingValue::String("English".into()));
            next.scope.upstreams = vec!["deepseek".into()];
            next.on_error = OnError::Skip;
            let c = changes(&p, &p.name, &p.settings_schema, &next);
            assert_eq!(
                c,
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
}
