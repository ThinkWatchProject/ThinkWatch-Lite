//! 密钥页的命令。
//!
//! **配置上的规则全在 core**：默认密钥删不得、改名要带着规则一起改。界面这边
//! 再判断一次，就多一处和 core 说法不一致的可能。
//!
//! 在这里做的是**和这台机器上的客户端有关的那一半**，core 答不上来：
//!
//! - 接管中的客户端的密钥删不得（它的配置里写着这把钥匙，删掉的下一个请求就是 401）；
//! - 更换一把被接管的客户端在用的密钥，新值要同步进它的配置；
//! - 把密钥放进剪贴板。明文由这一层去问 core，不经过界面 —— 否则等于给 webview
//!   开一个往剪贴板里写任意内容的口子。

use crate::AppState;
use tw_api::ep;

use crate::error::{Out, text};
use crate::wire;

/// 把这把密钥放进剪贴板。
///
/// **明文不经过界面。**界面拿着它，就等于多了一个「界面传来一段文字、
/// 应用写进剪贴板」的口子；而在 Rust 这边写也不用看 webview 给不给剪贴板
/// 权限 —— 一个「复制」按钮唯一不能有的表现就是点了没反应。
#[tauri::command]
pub async fn copy_key(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: String,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let v = state
        .control
        .call::<ep::KeyValue>(&[&name], &())
        .await
        .map_err(text)?;
    app.clipboard()
        .write_text(v.key)
        .map_err(|e| e.to_string().into())
}

/// 复制客户端该连的网关地址（手动配置时填的那一个）
#[tauri::command]
pub async fn copy_gateway_base(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let base = gateway_base(state).await?;
    app.clipboard()
        .write_text(base)
        .map_err(|e| e.to_string().into())
}

/// 客户端该连的网关地址（密钥页上显示的那一个）
#[tauri::command]
pub async fn gateway_base(state: tauri::State<'_, AppState>) -> Out<String> {
    crate::clients::gateway_base(&state.control, &crate::clients::gateway_host(&state)).await
}

/// 删一把密钥。**写在一个接管着的客户端的配置里的，先不删**：那个客户端的下一个
/// 请求就是 401，而用户刚做的动作是「删一把看起来没用的钥匙」。先还原它
#[tauri::command]
pub async fn delete_key(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    // 接管状态在对方配置旁边的记录里，读它要走文件系统 —— 在改配置之前问，
    // 拿到的是「此刻」的答案
    let keys = state
        .control
        .call::<ep::Keys>(&[], &())
        .await
        .map_err(text)?;
    if let Some(c) = crate::clients::adopted_owner(&keys, &name) {
        return Err(crate::clients::ops::key_used_by(&c).into());
    }
    state
        .control
        .call::<ep::DeleteKey>(&[&name], &tw_api::BaseVersion { base_version })
        .await
        .map_err(text)
}

/// 换一把新的，并且**把新值同步给这台机器上正在用它的那个客户端**。
///
/// 顺序是刻意的：先让 core 换，再改对方的配置。反过来的话，中间那一刻对方配置
/// 里写着一把网关还不认识的钥匙。而按这个顺序，中间那一刻对方用的是一把刚作废
/// 的钥匙 —— 同样是坏的，但**它是在用户刚按下「更换」的那一秒**，界面正看着
/// 结果，而不是几小时后。同步不上的**不把整次更换报成失败**：密钥已经换了，报
/// 失败会让用户以为旧密钥还能用。
#[tauri::command]
pub async fn rotate_key(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<wire::KeyRotation> {
    let keys = state
        .control
        .call::<ep::Keys>(&[], &())
        .await
        .map_err(text)?;
    // 只有被接管的客户端要同步：没接管的那些，密钥根本没写进它们的配置
    let owner = crate::clients::adopted_owner(&keys, &name);
    let r = state
        .control
        .call::<ep::RotateKey>(&[&name], &tw_api::KeyRotate { base_version })
        .await
        .map_err(text)?;
    let mut out = wire::KeyRotation {
        version: r.version,
        key: r.key,
        synced: Vec::new(),
        failed: Vec::new(),
    };
    // 钉着的这一版 core 自己还会同步（它那边的接管代码还在）。它报了的就照它报的
    // 说，不再写一遍 —— 再写一遍会把「接管于」刷成此刻。core 不再同步之后这一段
    // 随它的字段一起删掉
    for s in r.synced {
        out.synced.push(wire::KeySynced {
            client: s.client,
            name: s.name,
            takes_effect: match s.takes_effect {
                tw_api::TakesEffect::Immediately => wire::TakesEffect::Immediately,
                tw_api::TakesEffect::OnRestart => wire::TakesEffect::OnRestart,
            },
            backup: s.backup,
        });
    }
    for f in r.failed {
        out.failed.push(wire::KeySyncFailed {
            client: f.client,
            name: f.name,
            error: f.error,
        });
    }
    let reported = |id: &str| {
        out.synced.iter().any(|s| s.client == id) || out.failed.iter().any(|f| f.client == id)
    };
    if let Some(c) = owner
        && !reported(c.id)
    {
        match crate::clients::sync_rotated(&state, &c, &out.key).await {
            Ok(s) => out.synced.push(s),
            Err(f) => out.failed.push(f),
        }
    }
    Ok(out)
}

/// 每把密钥这段时间发了多少请求。**按密钥算，不是按客户端自报的标识**
#[tauri::command]
pub async fn key_usage(
    state: tauri::State<'_, AppState>,
    since_ms: i64,
) -> Out<Vec<tw_api::CostGroup>> {
    Ok(state
        .control
        .call::<ep::CostBy>(
            &[],
            &tw_api::GroupQuery {
                from_ms: Some(since_ms),
                to_ms: None,
                dim: tw_api::CostDim::Client,
            },
        )
        .await
        .unwrap_or_default())
}
