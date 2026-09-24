//! Z.ai / BigModel 账号的命令：登录。
//!
//! 登录本身在 core：它给出授权地址、自己去问「授权了没有」、把换来的密钥写进配置。
//! 这一层做 core 做不到的那一件事 —— **打开浏览器**。
//!
//! **没有「返回 ThinkWatch」那一步。**授权回的是对方自己的服务端，浏览器最后停在
//! 他们的页面上，那一页不是我们的，我们既关不掉它、也没法在上面放一个跳回来的链接
//! （见 ChatGPT 那条路的 `handle_return`：那是因为回调页是 core 自己发的）。所以登录
//! 成没成只有界面在轮询里知道。
//!
//! 授权地址存在这里而不是交给界面：界面拿着地址，就等于多了一条「界面传来一个地址、
//! 应用去打开它」的路径。重新打开授权页只按登录 ID 找。

use std::sync::Mutex;

use crate::AppState;

use crate::error::{Out, text};

/// 正在等的那次登录。**同一时刻只有一次**，core 那边也是
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

struct Pending {
    id: String,
    /// 要打开的授权地址
    url: String,
}

/// 一次登录里界面该知道的部分。**授权地址不在其中**
#[derive(serde::Serialize)]
pub struct Login {
    id: String,
    expires_in_secs: u64,
}

/// `family`：`zai`（api.z.ai）或 `bigmodel`（open.bigmodel.cn）。
///
/// **这里就把授权页打开**：让用户再点一次「打开授权页」，中间那一步没有任何意义。
#[tauri::command]
pub async fn start_zai_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    family: Option<String>,
    name: Option<String>,
    proxy: Option<String>,
) -> Out<Login> {
    let login = state
        .control
        .call::<tw_api::ep::StartZaiLogin>(
            &[],
            &tw_api::ZaiLoginStart {
                family,
                name,
                proxy,
            },
        )
        .await
        .map_err(text)?;
    if let Ok(mut g) = PENDING.lock() {
        *g = Some(Pending {
            id: login.id.clone(),
            url: login.authorize_url.clone(),
        });
    }
    crate::chatgpt::open_page(&app, &login.authorize_url)?;
    Ok(Login {
        id: login.id,
        expires_in_secs: login.expires_in_secs,
    })
}

/// 浏览器被关掉、或者授权页打不开时再打开一次。**只认还在等的那一次**
#[tauri::command]
pub async fn reopen_zai_login(app: tauri::AppHandle, id: String) -> Out<()> {
    let url = PENDING
        .lock()
        .ok()
        .and_then(|g| g.as_ref().filter(|p| p.id == id).map(|p| p.url.clone()))
        .ok_or_else(|| {
            tr!(
                "这次登录已经结束，请重新发起",
                "This sign-in has ended; start a new one"
            )
            .to_string()
        })?;
    Ok(crate::chatgpt::open_page(&app, &url)?)
}

#[tauri::command]
pub async fn cancel_zai_login(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<tw_api::ZaiLoginStatus> {
    forget(&id);
    state
        .control
        .call::<tw_api::ep::CancelZaiLogin>(&[&id], &())
        .await
        .map_err(text)
}

pub fn forget(id: &str) {
    if let Ok(mut g) = PENDING.lock()
        && g.as_ref().is_some_and(|p| p.id == id)
    {
        *g = None;
    }
}
