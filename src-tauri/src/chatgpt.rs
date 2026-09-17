//! ChatGPT 账号的命令：登录、用量、额度重置卡。
//!
//! 登录本身在 core：它给出授权地址、在本机等浏览器回调、把凭据写进配置。这一层做
//! core 做不到的两件事 —— **打开浏览器**，以及授权完成后**把应用带回前台**。
//!
//! 授权地址存在这里而不是交给界面：界面拿着它，就等于多了一条「界面传来一个地址、
//! 应用去打开它」的路径。重新打开授权页只按登录 ID 找。

use std::sync::Mutex;

use tauri_plugin_opener::OpenerExt;

use crate::AppState;

type Out<T> = Result<T, String>;

fn text(e: anyhow::Error) -> String {
    format!("{e:#}")
}

/// 授权完成后回到应用的地址。core 只接受应用自己的协议
const RETURN_TO: &str = "thinkwatch://chatgpt/login";

/// 正在等的那次登录：(登录 ID, 授权地址)。**同一时刻只有一次**，core 那边也是
static PENDING: Mutex<Option<(String, String)>> = Mutex::new(None);

#[tauri::command]
pub async fn start_chatgpt_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: Option<String>,
    proxy: Option<String>,
) -> Out<tw_api::ChatgptLogin> {
    let login = state
        .control
        .start_chatgpt_login(&tw_api::ChatgptLoginStart {
            name,
            proxy,
            return_to: Some(RETURN_TO.to_string()),
        })
        .await
        .map_err(text)?;
    if let Ok(mut g) = PENDING.lock() {
        *g = Some((login.id.clone(), login.authorize_url.clone()));
    }
    open_page(&app, &login.authorize_url)?;
    Ok(login)
}

/// 浏览器被关掉、或者授权页打不开时再打开一次。**只认还在等的那一次**
#[tauri::command]
pub async fn reopen_chatgpt_login(app: tauri::AppHandle, id: String) -> Out<()> {
    let url = PENDING
        .lock()
        .ok()
        .and_then(|g| g.clone())
        .filter(|(pending, _)| *pending == id)
        .map(|(_, url)| url)
        .ok_or_else(|| "这次登录已经结束，请重新发起".to_string())?;
    open_page(&app, &url)
}

fn open_page(app: &tauri::AppHandle, url: &str) -> Out<()> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("无法打开浏览器：{e}"))
}

#[tauri::command]
pub async fn chatgpt_login_status(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<tw_api::ChatgptLoginStatus> {
    state.control.chatgpt_login_status(&id).await.map_err(text)
}

#[tauri::command]
pub async fn cancel_chatgpt_login(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<tw_api::ChatgptLoginStatus> {
    forget(&id);
    state.control.cancel_chatgpt_login(&id).await.map_err(text)
}

pub fn forget(id: &str) {
    if let Ok(mut g) = PENDING.lock()
        && g.as_ref().is_some_and(|(pending, _)| pending == id)
    {
        *g = None;
    }
}

#[tauri::command]
pub async fn chatgpt_usage(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Out<tw_api::ChatgptUsage> {
    state.control.chatgpt_usage(&name).await.map_err(text)
}

#[tauri::command]
pub async fn chatgpt_resets(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Out<tw_api::ResetCredits> {
    state.control.chatgpt_resets(&name).await.map_err(text)
}

/// 用掉一张额度重置卡。**界面上必须先让用户确认**：卡用掉就回不来
#[tauri::command]
pub async fn use_chatgpt_reset(
    state: tauri::State<'_, AppState>,
    name: String,
    credit_id: Option<String>,
    idempotency_key: String,
) -> Out<tw_api::ResetCreditUsed> {
    state
        .control
        .use_chatgpt_reset(
            &name,
            &tw_api::ResetCreditUse {
                idempotency_key,
                credit_id,
            },
        )
        .await
        .map_err(text)
}

/// 浏览器里点了「返回 ThinkWatch」。**窗口可能已经被销毁**（菜单栏模式下关窗即销毁），
/// 所以这里要能把它重新建起来，而不只是 `show()`
pub fn handle_return(app: &tauri::AppHandle, urls: &[String]) {
    if !urls.iter().any(|u| u.starts_with("thinkwatch://")) {
        return;
    }
    let _ = crate::show_main_window(app);
}
