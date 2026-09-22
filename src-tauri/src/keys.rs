//! 密钥页的命令。
//!
//! **这一层只转发**，规则全在 core：默认密钥删不得、接管中的密钥删不得、
//! 改名要带着规则一起改、更换要同步给被接管的客户端。界面这边再判断一次，
//! 就多一处和 core 说法不一致的可能。
//!
//! 只有一件事在这里做：**把密钥放进剪贴板**。明文由这一层去问 core，
//! 不经过界面 —— 否则等于给 webview 开一个往剪贴板里写任意内容的口子。

use crate::AppState;

type Out<T> = Result<T, String>;

fn text(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[tauri::command]
pub async fn list_keys(state: tauri::State<'_, AppState>) -> Out<Vec<tw_api::ClientView>> {
    state.control.keys().await.map_err(text)
}

#[tauri::command]
pub async fn create_key(
    state: tauri::State<'_, AppState>,
    save: tw_api::KeySave,
) -> Out<tw_api::ConfigWritten> {
    state.control.create_key(&save).await.map_err(text)
}

#[tauri::command]
pub async fn update_key(
    state: tauri::State<'_, AppState>,
    name: String,
    save: tw_api::KeySave,
) -> Out<tw_api::ConfigWritten> {
    state.control.update_key(&name, &save).await.map_err(text)
}

#[tauri::command]
pub async fn delete_key(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .delete_key(&name, base_version.as_deref())
        .await
        .map_err(text)
}

/// 换一把新的。core 会把新值同步给正在用它的那个客户端。
#[tauri::command]
pub async fn rotate_key(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::KeyRotated> {
    state
        .control
        .rotate_key(&name, base_version.as_deref())
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn set_default_key(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .set_default_key(&name, base_version.as_deref())
        .await
        .map_err(text)
}

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
    let v = state.control.key_value(&name).await.map_err(text)?;
    app.clipboard().write_text(v.key).map_err(|e| e.to_string())
}

/// 保存监听设置（设置页「网关监听」那一节）。
///
/// 放在这里而不是 `lib.rs`：它和密钥是同一件事的两道 —— 地址决定谁能敲门，
/// 密钥决定谁能进来。
#[tauri::command]
pub async fn save_listen(
    state: tauri::State<'_, AppState>,
    save: tw_api::ListenSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.save_listen(&save).await.map_err(text)
}

/// 客户端该连的网关地址。新建密钥之后那一屏要和密钥一起给出来。
#[tauri::command]
pub async fn gateway_base(state: tauri::State<'_, AppState>) -> Out<String> {
    let clients = state.control.clients().await.map_err(text)?;
    Ok(clients.gateway_base)
}

#[tauri::command]
pub async fn copy_gateway_base(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let clients = state.control.clients().await.map_err(text)?;
    app.clipboard()
        .write_text(clients.gateway_base)
        .map_err(|e| e.to_string())
}

/// 每把密钥这段时间发了多少请求。**按密钥算，不是按客户端自报的标识**
#[tauri::command]
pub async fn key_usage(
    state: tauri::State<'_, AppState>,
    since_ms: i64,
) -> Out<Vec<tw_api::CostGroup>> {
    Ok(state
        .control
        .cost_by("client", since_ms)
        .await
        .unwrap_or_default())
}
