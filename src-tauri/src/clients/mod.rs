//! 客户端页的命令：检测、接管、还原、诊断，以及手动配置要的地址和密钥。
//!
//! **改的是这台机器上别的软件的配置**，所以在这里做，不在 core 里（[`ops`]）。
//! 要问 core 的只有两件事：客户端该连哪个网关（[`gateway_base`]），和网关密钥
//! （列表，以及为某个客户端发一把）。连着哪个 core，这两件事就问哪个。
//!
//! **界面只说是哪个客户端**，要写进剪贴板的地址、要打开的文件、要写的配置都由
//! 这一层按 id 找出来再动手 —— 界面递一段任意文字进剪贴板、递一个任意路径给
//! 访达，都是不该开的口子。

pub mod ops;
mod reveal;

use std::path::PathBuf;

use tw_api::ep;

use crate::AppState;
use crate::control::ControlClient;
use crate::error::{CmdError, Out, text};
use crate::wire;

/// 用户的 home。各家客户端的配置都顺着它去找：`~/.claude`、`~/.codex`、
/// `~/.cursor`，这些点开头的目录在 Windows 上同样躺在 `%USERPROFILE%` 下。
///
/// **不是数据目录**（那个是 `tw_api::data::dir`）。取不到时给一个空路径，而不是
/// `/` —— 空路径会让后续的「文件不存在」自然发生，`/` 则会让我们去翻系统根目录。
pub fn home_dir() -> PathBuf {
    #[cfg(windows)]
    const VAR: &str = "USERPROFILE";
    #[cfg(not(windows))]
    const VAR: &str = "HOME";
    std::env::var_os(VAR).map(PathBuf::from).unwrap_or_default()
}

/// 改别人的配置之前留的那份全文备份放在哪（数据目录下的 `backups/`）
fn backups() -> PathBuf {
    tw_adopt::foreign::backup_root()
}

/// 客户端要连的那台机器。
///
/// **本地模式下是回环**：网关就在这台机器上，监听地址（可能是 `0.0.0.0`）填进
/// 客户端配置里是连不上的。连远程 core 时是连接里填的那个服务器地址 —— 这台机器
/// 就是用它够到服务器的（服务器自己报的监听地址可能是 `0.0.0.0`）。客户端页写进
/// 配置、复制出去的地址都从这一个地方来。
pub(crate) fn gateway_host(state: &AppState) -> String {
    match state.link.current() {
        crate::connection::Current::Remote(r) => r.host,
        crate::connection::Current::Local => "127.0.0.1".to_string(),
    }
}

/// 客户端该连的地址：`http://主机:网关端口`。端口按 core 的配置（`listen.gateway.port`），
/// 不按它此刻监听着的 —— 换端口没换成功时，客户端要指的仍是配置里的那一个
pub async fn gateway_base(control: &ControlClient, host: &str) -> Out<String> {
    let ov = control.call::<ep::Overview>(&[], &()).await.map_err(text)?;
    Ok(base_url(host, ov.listen.port))
}

fn base_url(host: &str, port: u16) -> String {
    // IPv6 的地址在 URL 里要加方括号
    if host.contains(':') && !host.starts_with('[') {
        format!("http://[{host}]:{port}")
    } else {
        format!("http://{host}:{port}")
    }
}

async fn keys(control: &ControlClient) -> Out<Vec<tw_api::ClientView>> {
    control.call::<ep::Keys>(&[], &()).await.map_err(text)
}

/// 接管要从 core 那里知道的两件事，一起问
async fn gateway(state: &AppState) -> Out<ops::Gateway> {
    let host = gateway_host(state);
    let (base, keys) = tokio::join!(gateway_base(&state.control, &host), keys(&state.control));
    Ok(ops::Gateway {
        base: base?,
        keys: keys?,
    })
}

/// 请 core 为这个客户端发一把专用密钥：为它留着的，没有就新建一把绑给它。
///
/// **先认客户端再去要**：core 发密钥时不认得客户端（客户端清单在这边），一个随手
/// 写的 id 在 config.yaml 里留下一把没人用的钥匙
async fn prepare_key(control: &ControlClient, id: &str) -> Out<tw_api::ClientKey> {
    if !ops::known(id) {
        return Err(ops::unknown(id).into());
    }
    control
        .call::<ep::ClientKey>(&[id], &())
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn list_clients(state: tauri::State<'_, AppState>) -> Out<wire::ClientsResponse> {
    let gw = gateway(&state).await?;
    Ok(ops::list(&home_dir(), &gw))
}

/// 算一份接管改动。**不写任何东西。**
#[tauri::command]
pub async fn plan_adopt(state: tauri::State<'_, AppState>, id: String) -> Out<wire::PlanView> {
    ops::find(&id)?;
    let gw = gateway(&state).await?;
    Ok(ops::plan_adopt(&home_dir(), &id, &gw)?)
}

/// 落盘。**用户在 diff 上点过确认之后才该到这里。**
///
/// 落盘这一步才要钥匙：**先有钥匙再写对方的配置** —— 反过来的话，中间那一刻
/// 对方配置里写着一把 config.yaml 里没有的钥匙。
#[tauri::command]
pub async fn adopt_client(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<wire::AdoptResponse> {
    ops::find(&id)?;
    let base = gateway_base(&state.control, &gateway_host(&state)).await?;
    let key = prepare_key(&state.control, &id).await?;
    Ok(ops::adopt(&home_dir(), &backups(), &id, &base, &key.key)?)
}

/// 算一份还原改动。**不写任何东西。**密钥只拿来给 diff 打码，问不到 core 也照样能算
#[tauri::command]
pub async fn plan_restore(state: tauri::State<'_, AppState>, id: String) -> Out<wire::PlanView> {
    let keys = keys(&state.control).await.unwrap_or_default();
    Ok(ops::plan_restore(&home_dir(), &id, &keys)?)
}

/// 还原。**不问 core**：退路不该依赖网关还在不在
#[tauri::command]
pub async fn restore_client(id: String) -> Out<wire::AdoptResponse> {
    Ok(ops::restore(&home_dir(), &backups(), &id)?)
}

/// 「我明明配了，为什么没生效」—— 走一遍优先级链。
#[tauri::command]
pub async fn diagnose_client(id: String) -> Out<Vec<wire::FindingView>> {
    Ok(ops::diagnose(&home_dir(), &id)?)
}

/// 为这个客户端准备它的专用密钥（手动配置时用）。**只交回名字**：复制走
/// `copy_key`，明文不经过界面
#[tauri::command]
pub async fn prepare_client_key(state: tauri::State<'_, AppState>, id: String) -> Out<String> {
    Ok(prepare_key(&state.control, &id).await?.name)
}

/// 复制这个客户端要填的网关地址（它要的那种写法，有的带 `/v1`）。
#[tauri::command]
pub async fn copy_client_endpoint(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let gw = tw_adopt::clients::Gateway {
        base: gateway_base(&state.control, &gateway_host(&state)).await?,
        key: None,
    };
    let endpoint = tw_adopt::clients::adoptable()
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.endpoint(&gw))
        .or_else(|| {
            tw_adopt::clients::manual_only()
                .iter()
                .find(|m| m.id == id)
                .map(|m| m.endpoint(&gw))
        })
        .ok_or_else(|| CmdError::from(ops::unknown(&id)))?;
    app.clipboard()
        .write_text(endpoint)
        .map_err(|e| e.to_string().into())
}

/// 在文件管理器里选中这个客户端的配置文件 —— 跟完符号链接的那一份，那才是
/// 真正会被改的。
#[tauri::command]
pub async fn reveal_client_config(id: String) -> Out<()> {
    let c = ops::find(&id)?;
    let d = tw_adopt::detect::detect_one(&c, &home_dir());
    Ok(reveal::reveal(&d.real.display().to_string())?)
}

/// 把这台机器上接管着、**还指着本机网关**的客户端改为指向 `control` 那个 core 的
/// 网关（`host` 是它的地址），用它为每个客户端发的那把密钥。
///
/// 从本机切到远程 core 时，确认框里「同时将这些客户端改为指向…」勾上就走这里；连着
/// 远程时客户端页上的「改为指向服务器」也是这一步。**一个失败不影响其余的**，逐个报。
pub async fn retarget_adopted(control: &ControlClient, host: &str) -> Out<wire::Retargeted> {
    let base = gateway_base(control, host).await?;
    let home = home_dir();
    let mut out = wire::Retargeted {
        synced: Vec::new(),
        failed: Vec::new(),
    };
    for (c, _) in ops::adopted_on_this_machine(&home) {
        let key = match prepare_key(control, c.id).await {
            Ok(k) => k.key,
            Err(e) => {
                out.failed.push(wire::KeySyncFailed {
                    client: c.id.to_string(),
                    name: c.name.to_string(),
                    error: e.into_msg(),
                });
                continue;
            }
        };
        match ops::repoint(&home, &backups(), &c, &base, &key) {
            Ok(s) => out.synced.push(s),
            Err(f) => out.failed.push(f),
        }
    }
    Ok(out)
}

/// 客户端页上的「改为指向服务器」：还指着本机网关的，改为指向此刻连着的那个 core。
/// **连着本机时什么都不做** —— 指着本机网关本来就是对的
#[tauri::command]
pub async fn retarget_clients(state: tauri::State<'_, AppState>) -> Out<wire::Retargeted> {
    if !state.link.is_remote() {
        return Ok(wire::Retargeted {
            synced: Vec::new(),
            failed: Vec::new(),
        });
    }
    retarget_adopted(&state.control, &gateway_host(&state)).await
}

/// 这台机器上已接管、还指着本机网关的客户端。切到远程之前的确认里说（「已接管的 3 个
/// 客户端仍指向本机网关 127.0.0.1:8788」）
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Adopted {
    pub count: usize,
    /// 它们指着的那个地址（`127.0.0.1:8788`）
    pub local_addr: Option<String>,
}

/// 数一数这台机器上已接管、还指着本机网关的客户端。**按这台机器上的文件数**，不问
/// 哪个 core：连着远程、本机 core 停着的时候也数得出来
pub fn adopted_pointing_at_local() -> Adopted {
    let here = ops::adopted_on_this_machine(&home_dir());
    Adopted {
        count: here.len(),
        local_addr: here
            .first()
            .and_then(|(_, e)| ops::host_port(e))
            .map(str::to_string),
    }
}

/// 更换密钥之后，把新值写进正在用它的那个客户端的配置。
pub(crate) async fn sync_rotated(
    state: &AppState,
    owner: &tw_adopt::clients::Client,
    fresh: &str,
) -> Result<wire::KeySynced, wire::KeySyncFailed> {
    let base = match gateway_base(&state.control, &gateway_host(state)).await {
        Ok(b) => b,
        Err(e) => {
            return Err(wire::KeySyncFailed {
                client: owner.id.to_string(),
                name: owner.name.to_string(),
                error: e.into_msg(),
            });
        }
    };
    ops::repoint(&home_dir(), &backups(), owner, &base, fresh)
}

/// 删之前、换之前要知道：这把密钥的主人此刻接管着吗
pub(crate) fn adopted_owner(
    keys: &[tw_api::ClientView],
    name: &str,
) -> Option<tw_adopt::clients::Client> {
    ops::adopted_owner(&home_dir(), keys, name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_base_is_a_url_a_client_can_connect_to() {
        assert_eq!(base_url("127.0.0.1", 8788), "http://127.0.0.1:8788");
        assert_eq!(base_url("::1", 8788), "http://[::1]:8788");
        assert_eq!(base_url("[::1]", 8788), "http://[::1]:8788");
        assert_eq!(
            base_url("home-server.local", 8788),
            "http://home-server.local:8788"
        );
    }
}
