//! 密钥页的命令。
//!
//! **这一层只转发**，规则全在 core：默认密钥删不得、接管中的密钥删不得、
//! 改名要带着规则一起改、更换要同步给被接管的客户端。界面这边再判断一次，
//! 就多一处和 core 说法不一致的可能。
//!
//! 只有一件事在这里做：**把密钥放进剪贴板**。明文由这一层去问 core，
//! 不经过界面 —— 否则等于给 webview 开一个往剪贴板里写任意内容的口子。

use crate::AppState;
use tw_api::ep;

use crate::error::{Out, text};

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

#[tauri::command]
pub async fn copy_gateway_base(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let clients = state
        .control
        .call::<ep::Clients>(&[], &())
        .await
        .map_err(text)?;
    app.clipboard()
        .write_text(clients.gateway_base)
        .map_err(|e| e.to_string().into())
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
