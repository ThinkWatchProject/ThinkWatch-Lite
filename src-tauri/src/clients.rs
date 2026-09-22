//! 客户端页的几个命令。
//!
//! **界面只说是哪个客户端**，要写进剪贴板的地址、要打开的文件都由这一层
//! 去问 core 再动手 —— 界面递一段任意文字进剪贴板、递一个任意路径给访达，
//! 都是不该开的口子。

use crate::AppState;

type Out<T> = Result<T, String>;

fn text(e: anyhow::Error) -> String {
    format!("{e:#}")
}

fn unknown(id: &str) -> String {
    tr!(
        format!("未知的客户端「{id}」"),
        format!("`{id}` is not a client we know")
    )
    .to_string()
}

/// 为这个客户端准备它的专用密钥：为它留着的那把，没有就新建一把绑给它。
/// 手动配置时用 —— 填进 Cursor 的应该是只属于 Cursor 的钥匙。
#[tauri::command]
pub async fn prepare_client_key(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<tw_api::ClientKey> {
    state.control.client_key(&id).await.map_err(text)
}

/// 复制这个客户端要填的网关地址（它要的那种写法，有的带 `/v1`）。
#[tauri::command]
pub async fn copy_client_endpoint(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let list = state.control.clients().await.map_err(text)?;
    let endpoint = list
        .clients
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.manual.endpoint.clone())
        .or_else(|| {
            list.manual
                .iter()
                .find(|m| m.id == id)
                .map(|m| m.setup.endpoint.clone())
        })
        .ok_or_else(|| unknown(&id))?;
    app.clipboard()
        .write_text(endpoint)
        .map_err(|e| e.to_string())
}

/// 在访达里选中这个客户端的配置文件 —— 跟完符号链接的那一份，那才是真正会被改的。
#[tauri::command]
pub async fn reveal_client_config(state: tauri::State<'_, AppState>, id: String) -> Out<()> {
    let list = state.control.clients().await.map_err(text)?;
    let c = list
        .clients
        .iter()
        .find(|c| c.id == id)
        .ok_or_else(|| unknown(&id))?;
    let st = std::process::Command::new("open")
        .arg("-R")
        .arg(&c.real)
        .status()
        .map_err(|e| e.to_string())?;
    if st.success() {
        Ok(())
    } else {
        Err(tr!(
            format!("无法在访达中显示 {}", c.real),
            format!("{} could not be shown in Finder", c.real)
        )
        .to_string())
    }
}
