//! ChatGPT 账号的命令：登录、用量、额度重置卡。
//!
//! 登录本身在 core：它给出授权地址或者设备码、等授权完成、把凭据写进配置。这一层做
//! core 做不到的两件事 —— **打开浏览器**，以及授权完成后**把应用带回前台**。
//!
//! 地址和登录码**界面只拿来显示**：用户要看得见登录链接、验证网址和设备码，才能抄到
//! 别的浏览器或者别的设备上。打开、复制都在这里做，而且**只按登录 ID 找**这里存着的
//! 那一份 —— 「界面传一个地址进来、应用去打开它」和「界面传一段文字进来、应用写进
//! 剪贴板」这两条路都不存在。

use std::sync::Mutex;

use tauri_plugin_opener::OpenerExt;

use crate::AppState;

use crate::error::{Out, text};

/// 授权完成后回到应用的地址。core 只接受应用自己的协议
const RETURN_TO: &str = "thinkwatch://chatgpt/login";

/// 正在等的那次登录。**同一时刻只有一次**，core 那边也是
static PENDING: Mutex<Option<Pending>> = Mutex::new(None);

struct Pending {
    id: String,
    /// 要打开的网页：浏览器登录是授权地址，设备码登录是输码的验证网址
    url: Option<String>,
    /// 在其他设备上登录：要输的那个码
    code: Option<String>,
}

/// 一次登录里界面该知道的部分。地址只拿来显示，打开和复制都按 ID 回到这里
#[derive(serde::Serialize)]
pub struct Login {
    id: String,
    authorize_url: Option<String>,
    user_code: Option<String>,
    verification_url: Option<String>,
    expires_in_secs: u64,
}

/// 复制一次登录里的哪一项
#[derive(serde::Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Item {
    /// 浏览器登录的授权地址，或设备码登录的验证网址
    Url,
    /// 设备码
    Code,
}

/// `mode`：`browser` 在这台电脑上开浏览器，`device` 拿一个码去别处输。
///
/// **浏览器那条路默认在这里就把页面打开**：让用户再点一次「打开授权页」，中间那一步
/// 没有任何意义。`open: false` 是用户要把登录链接复制到别的浏览器里：不开默认浏览器。
#[tauri::command]
pub async fn start_chatgpt_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    name: Option<String>,
    proxy: Option<String>,
    mode: Option<tw_api::ChatgptLoginMode>,
    open: Option<bool>,
) -> Out<Login> {
    let login = state
        .control
        .call::<tw_api::ep::StartChatgptLogin>(
            &[],
            &tw_api::ChatgptLoginStart {
                name,
                proxy,
                return_to: Some(RETURN_TO.to_string()),
                mode,
            },
        )
        .await
        .map_err(text)?;
    if let Ok(mut g) = PENDING.lock() {
        *g = Some(Pending {
            id: login.id.clone(),
            url: login
                .authorize_url
                .clone()
                .or_else(|| login.verification_url.clone()),
            code: login.user_code.clone(),
        });
    }
    if let Some(url) = &login.authorize_url
        && open != Some(false)
    {
        open_page(&app, url)?;
    }
    Ok(Login {
        id: login.id,
        authorize_url: login.authorize_url,
        user_code: login.user_code,
        verification_url: login.verification_url,
        expires_in_secs: login.expires_in_secs,
    })
}

/// 再打开一次登录的网页：浏览器登录是授权页（浏览器被关掉、或者没打开时），设备码
/// 登录是输码的验证网址。**只认还在等的那一次**
#[tauri::command]
pub async fn reopen_chatgpt_login(app: tauri::AppHandle, id: String) -> Out<()> {
    let url = pending(&id, |p| p.url.clone())?;
    Ok(open_page(&app, &url)?)
}

/// 把登录链接（或验证网址）、设备码放进剪贴板。
///
/// **内容由这里给出，不从界面传进来**：那样等于给 webview 开一个往剪贴板里写任意内容
/// 的口子。在 Rust 这边写也不用看 webview 给不给剪贴板权限 —— 一个「复制」按钮
/// 唯一不能有的表现就是点了没反应。
#[tauri::command]
pub fn copy_chatgpt_login(app: tauri::AppHandle, id: String, item: Item) -> Out<()> {
    let text = match item {
        Item::Url => pending(&id, |p| p.url.clone())?,
        Item::Code => pending(&id, |p| p.code.clone())?,
    };
    Ok(copy_text(&app, text)?)
}

/// 写剪贴板。Z.ai 的登录链接也走这里
pub(crate) fn copy_text(app: &tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// 还在等的那次登录里的某一项。**只认还在等的那一次**
fn pending(id: &str, get: impl Fn(&Pending) -> Option<String>) -> Result<String, String> {
    PENDING
        .lock()
        .ok()
        .and_then(|g| g.as_ref().filter(|p| p.id == id).and_then(&get))
        .ok_or_else(|| {
            tr!(
                "这次登录已经结束，请重新发起",
                "This sign-in has ended; start a new one"
            )
            .to_string()
        })
}

/// 在默认浏览器里打开登录页。**只开 `https://` 的网页**：地址来自 core（Z.ai 的还是
/// 平台接口返回的），而系统的「打开」对 `file://`、别的应用注册的协议一视同仁 ——
/// 一个被改掉的地址不该变成「打开本机上的某个程序」
pub(crate) fn open_page(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    if !is_web_page(url) {
        return Err(tr!(
            format!("登录页地址不是 https 网页：{url}"),
            format!("The sign-in address is not an https web page: {url}")
        )
        .to_string());
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| {
        tr!(
            format!("无法打开浏览器：{e}"),
            format!("The browser could not be opened: {e}")
        )
    })
}

fn is_web_page(url: &str) -> bool {
    tauri::Url::parse(url).is_ok_and(|u| u.scheme() == "https" && u.host_str().is_some())
}

#[tauri::command]
pub async fn cancel_chatgpt_login(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<tw_api::ChatgptLoginStatus> {
    forget(&id);
    state
        .control
        .call::<tw_api::ep::CancelChatgptLogin>(&[&id], &())
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

/// 浏览器里点了「返回 ThinkWatch」。**窗口可能已经被销毁**（菜单栏模式下关窗即销毁），
/// 所以这里要能把它重新建起来，而不只是 `show()`
pub fn handle_return(app: &tauri::AppHandle, urls: &[String]) {
    if !urls.iter().any(|u| u.starts_with("thinkwatch://")) {
        return;
    }
    let _ = crate::window::show_main_window(app);
}

#[cfg(test)]
mod tests {
    use super::is_web_page;

    #[test]
    fn only_https_web_pages_are_opened() {
        assert!(is_web_page("https://auth.openai.com/oauth/authorize?x=1"));
        assert!(!is_web_page("http://auth.openai.com/"));
        assert!(!is_web_page("file:///System/Applications/Calculator.app"));
        assert!(!is_web_page(
            "x-apple.systempreferences:com.apple.preference.security"
        ));
        assert!(!is_web_page("/Applications/Calculator.app"));
    }
}
