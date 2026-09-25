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
pub mod wsl;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use tw_adopt::wsl::WslHome;

use tw_api::ep;
use tw_types::{Msg, msg};

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

pub(crate) fn base_url(host: &str, port: u16) -> String {
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

/// 这把密钥在网关上能用哪些模型：网关的 `GET /v1/models` 对它答的。
///
/// **问的是网关，不是 core 的控制面** —— 同一把密钥在网关上被允许用哪些模型，只有
/// 网关按它的 `allow` 答得准。opencode 要把这份清单写进配置（它不自己去问）。
async fn models_of(base: &str, key: &str) -> Result<Vec<String>, Msg> {
    fetch_models(base, key, false).await
}

/// [`models_of`]。`anthropic` = 按 Anthropic 的方式问（密钥放在 `x-api-key`、带
/// `anthropic-version`）：Claude Desktop 就是这么问的，网关按这个答它说得通的那些
async fn fetch_models(base: &str, key: &str, anthropic: bool) -> Result<Vec<String>, Msg> {
    let url = format!("{}/v1/models", base.trim_end_matches('/'));
    let failed = |detail: String| {
        msg!(
            "control.models_unreadable", url = url.clone(), detail = detail =>
            "The model list could not be read from {url}: {detail}"
        )
    };
    // 和 updater::fetch_text 同一套 TLS：连远程 core 时网关可能在 https 后面
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let mut builder = reqwest::Client::builder()
        .user_agent("ThinkWatch-Lite")
        .timeout(std::time::Duration::from_secs(5));
    // 本机的网关不经过系统代理：代理那头够不到这台机器的回环地址
    if ops::is_loopback(base) {
        builder = builder.no_proxy();
    }
    let client = builder.build().map_err(|e| failed(e.to_string()))?;
    let req = client.get(&url);
    let req = if anthropic {
        req.header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
    } else {
        req.bearer_auth(key)
    };
    let text = req
        .send()
        .await
        .and_then(|r| r.error_for_status())
        .map_err(|e| failed(e.to_string()))?
        .text()
        .await
        .map_err(|e| failed(e.to_string()))?;
    let body: serde_json::Value = serde_json::from_str(&text).map_err(|e| failed(e.to_string()))?;
    Ok(model_ids(&body))
}

/// OpenAI 形状的 `/v1/models`：`data[].id`
fn model_ids(body: &serde_json::Value) -> Vec<String> {
    body.get("data")
        .and_then(|d| d.as_array())
        .map(|xs| {
            xs.iter()
                .filter_map(|x| x.get("id")?.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// 接管这个客户端要写进它配置的模型清单。不写模型的客户端不问网关。
///
/// Claude Desktop 只认名字像 Claude 的模型，写进它配置的那份从这里挑
/// （`tw_adopt::desktop`），按它自己问的方式问
async fn models_for(
    c: &tw_adopt::clients::Client,
    base: &str,
    key: &str,
) -> Result<Vec<String>, Msg> {
    if c.writes_models {
        models_of(base, key).await
    } else if c.id == tw_adopt::desktop::ID {
        fetch_models(base, key, true).await
    } else {
        Ok(Vec::new())
    }
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

/// 客户端装在哪：这台电脑上，或者某个 WSL 发行版里。
///
/// 界面对每个客户端的命令都带着它（`env`：发行版的名字，这台电脑上的不带）。
/// 同一个客户端在两处是两份配置、两把密钥，接管、还原各管各的。
pub enum Place {
    Here,
    Wsl(WslHome),
}

impl Place {
    /// 界面递来的 `env`。WSL 的要现读一次那个发行版 —— **这一步会唤醒它**，而用户
    /// 此刻正要动它
    pub fn of(env: Option<&str>) -> Out<Place> {
        match env {
            None => Ok(Place::Here),
            Some(name) => Ok(Place::Wsl(wsl::find(name)?)),
        }
    }

    pub fn home(&self) -> PathBuf {
        match self {
            Place::Here => home_dir(),
            Place::Wsl(w) => w.home.clone(),
        }
    }

    /// 这一份的专用密钥归在谁名下
    pub fn owner(&self, id: &str) -> String {
        match self {
            Place::Here => id.to_string(),
            Place::Wsl(w) => tw_adopt::wsl::key_id(id, w.name()),
        }
    }

    /// 认得的、能接管的那一个。WSL 里只认第一批的那几个
    fn find(&self, id: &str) -> Out<tw_adopt::clients::Client> {
        let c = ops::find(id)?;
        if matches!(self, Place::Wsl(_)) && !tw_adopt::wsl::CLIENTS.contains(&c.id) {
            return Err(ops::unknown(id).into());
        }
        Ok(c)
    }

    /// 给人看的名字：WSL 里的带上发行版
    pub fn name(&self, c: &tw_adopt::clients::Client) -> String {
        match self {
            Place::Here => c.name.to_string(),
            Place::Wsl(w) => wsl::display_name(c.name, w),
        }
    }
}

#[tauri::command]
pub async fn list_clients(state: tauri::State<'_, AppState>) -> Out<wire::ClientsResponse> {
    let gw = gateway(&state).await?;
    // 把模型写进配置的那几个（opencode），问一下网关此刻给它那把密钥答什么：拿来
    // 判断配置里的清单过没过期，也给手动配置那一栏照着写。还没有它自己的密钥就按
    // 接管时会用的那把问。**问不到就不说** —— 网关停着的时候客户端页照样要打得开
    let mut models = BTreeMap::new();
    for c in tw_adopt::clients::adoptable()
        .iter()
        .filter(|c| c.writes_models)
    {
        if let Ok((_, key, _)) = ops::key_for(&gw, c.id)
            && let Ok(ms) = models_of(&gw.base, &key).await
        {
            models.insert(c.id.to_string(), ms);
        }
    }
    Ok(ops::list(&home_dir(), &gw, &models))
}

/// 客户端页的 WSL 部分：每个发行版一组。
///
/// **读 WSL 会唤醒发行版**，所以它是单独的一个命令，界面只在打开客户端页、动过
/// 某个 WSL 客户端之后取，不跟着请求刷新。读不到的发行版那一组写「无法读取」，
/// 不让整页报错。
#[tauri::command]
pub async fn list_wsl(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Out<wire::WslResponse> {
    let distros = wsl::distros();
    if distros.is_empty() {
        return Ok(wire::WslResponse {
            distros: Vec::new(),
        });
    }
    let keys = keys(&state.control).await?;
    let program = crate::gateway::locate_core(&app).ok();
    let mut out = Vec::new();
    for d in distros {
        let network = wsl::network(&d, wsl::net_mode());
        let name = d.name.clone();
        let w = match wsl::open(d) {
            Ok(w) => w,
            Err(e) => {
                out.push(wire::WslGroup {
                    distro: name,
                    network,
                    error: Some(e),
                    clients: Vec::new(),
                    gateway_base: String::new(),
                    base_error: None,
                    stale: Vec::new(),
                    firewall: None,
                    listen: Vec::new(),
                });
                continue;
            }
        };
        let (target, base_error) = match wsl::target(&state, &w).await {
            Ok(t) => (Some(t), None),
            Err(e) => (None, Some(e)),
        };
        let base = target.as_ref().map(|t| t.base.clone()).unwrap_or_default();
        let gw = ops::Gateway {
            base: base.clone(),
            keys: keys.clone(),
        };
        out.push(wire::WslGroup {
            distro: name,
            network: target.as_ref().map_or(network, |t| t.network),
            error: None,
            clients: ops::list_wsl(&w, &gw),
            stale: if base.is_empty() {
                Vec::new()
            } else {
                ops::stale(&w.home, &base)
                    .iter()
                    .map(|c| c.id.to_string())
                    .collect()
            },
            gateway_base: base,
            base_error,
            firewall: target
                .as_ref()
                .and_then(|t| wsl::firewall_hint(program.as_deref(), t)),
            listen: target
                .as_ref()
                .and_then(|t| t.listen.as_ref())
                .map(|l| l.notes.clone())
                .unwrap_or_default(),
        });
    }
    Ok(wire::WslResponse { distros: out })
}

/// 算一份接管改动。**不写任何东西。**
///
/// WSL 里的那一份，确认框里多几句：请求经由 Windows 上的网关、NAT 下地址会变、
/// 监听要怎么改（[`wsl::plan_notes`]）。
#[tauri::command]
pub async fn plan_adopt(
    state: tauri::State<'_, AppState>,
    id: String,
    env: Option<String>,
) -> Out<wire::PlanView> {
    let place = Place::of(env.as_deref())?;
    let c = place.find(&id)?;
    match &place {
        Place::Here => {
            let gw = gateway(&state).await?;
            // 模型清单按落盘时会写进去的那把密钥问，差异里给的就是会写进去的那一份
            let models = match ops::key_for(&gw, c.id) {
                Ok((_, key, _)) => models_for(&c, &gw.base, &key).await?,
                Err(_) => Vec::new(),
            };
            Ok(ops::plan_adopt(&home_dir(), &id, &gw, models)?)
        }
        Place::Wsl(w) => {
            let t = wsl::target(&state, w).await?;
            let gw = ops::Gateway {
                base: t.base.clone(),
                keys: keys(&state.control).await?,
            };
            // 模型清单只看密钥，不看地址：从这台电脑上问本机能连的那个地址。WSL 那个
            // 地址的监听要确认之后才改，此刻未必有人在听
            let owner = place.owner(&id);
            let models = match ops::key_for(&gw, &owner) {
                Ok((_, key, _)) if c.writes_models => {
                    let here = gateway_base(&state.control, &gateway_host(&state)).await?;
                    models_of(&here, &key).await?
                }
                _ => Vec::new(),
            };
            let mut v = ops::plan_adopt_as(&w.home, &id, &owner, &gw, models)?;
            v.path = w.shown(Path::new(&v.path));
            v.notes.extend(wsl::plan_notes(c.name, w, &t));
            Ok(v)
        }
    }
}

/// 落盘。**用户在 diff 上点过确认之后才该到这里。**
///
/// 落盘这一步才要钥匙：**先有钥匙再写对方的配置** —— 反过来的话，中间那一刻
/// 对方配置里写着一把 config.yaml 里没有的钥匙。WSL 里的那一份要改监听的，也是
/// 在这里、确认之后才改，并且在写客户端配置之前：写完了网关却不在那张网卡上听，
/// 客户端的第一个请求就连不上。
#[tauri::command]
pub async fn adopt_client(
    state: tauri::State<'_, AppState>,
    id: String,
    env: Option<String>,
) -> Out<wire::AdoptResponse> {
    let place = Place::of(env.as_deref())?;
    let c = place.find(&id)?;
    let base = match &place {
        Place::Here => gateway_base(&state.control, &gateway_host(&state)).await?,
        Place::Wsl(w) => {
            let t = wsl::target(&state, w).await?;
            if let Some(l) = &t.listen {
                wsl::save_listen(&state.control, &l.save).await?;
            }
            t.base
        }
    };
    let key = prepare_key(&state.control, &place.owner(&id)).await?;
    // 模型清单只看密钥：WSL 里的那一份也从这台电脑上问本机能连的地址
    let models = match &place {
        Place::Wsl(_) if c.writes_models => {
            let here = gateway_base(&state.control, &gateway_host(&state)).await?;
            models_of(&here, &key.key).await?
        }
        _ => models_for(&c, &base, &key.key).await?,
    };
    let mut r = ops::adopt(&place.home(), &backups(), &id, &base, &key.key, models)?;
    if let Place::Wsl(w) = &place {
        r.real = w.shown(Path::new(&r.real));
    }
    Ok(r)
}

/// 算一份还原改动。**不写任何东西。**密钥只拿来给 diff 打码，问不到 core 也照样能算
#[tauri::command]
pub async fn plan_restore(
    state: tauri::State<'_, AppState>,
    id: String,
    env: Option<String>,
) -> Out<wire::PlanView> {
    let place = Place::of(env.as_deref())?;
    place.find(&id)?;
    let keys = keys(&state.control).await.unwrap_or_default();
    let mut v = ops::plan_restore_as(&place.home(), &id, &place.owner(&id), &keys)?;
    if let Place::Wsl(w) = &place {
        v.path = w.shown(Path::new(&v.path));
    }
    Ok(v)
}

/// 还原。**不问 core**：退路不该依赖网关还在不在
#[tauri::command]
pub async fn restore_client(id: String, env: Option<String>) -> Out<wire::AdoptResponse> {
    let place = Place::of(env.as_deref())?;
    place.find(&id)?;
    Ok(ops::restore(&place.home(), &backups(), &id)?)
}

/// 「我明明配了，为什么没生效」—— 走一遍优先级链。
#[tauri::command]
pub async fn diagnose_client(id: String, env: Option<String>) -> Out<Vec<wire::FindingView>> {
    match Place::of(env.as_deref())? {
        Place::Here => Ok(ops::diagnose(&home_dir(), &id)?),
        Place::Wsl(w) => Ok(ops::diagnose_wsl(&w, &id)?),
    }
}

/// 为这个客户端准备它的专用密钥（手动配置时用）。**只交回名字**：复制走
/// `copy_key`，明文不经过界面。WSL 里的那一份是它自己的一把
#[tauri::command]
pub async fn prepare_client_key(
    state: tauri::State<'_, AppState>,
    id: String,
    env: Option<String>,
) -> Out<String> {
    let owner = match env.as_deref() {
        None => id,
        // 只要名字，用不着读那个发行版
        Some(distro) => tw_adopt::wsl::key_id(&id, distro),
    };
    Ok(prepare_key(&state.control, &owner).await?.name)
}

/// 复制这个客户端要填的网关地址（它要的那种写法，有的带 `/v1`）。
#[tauri::command]
pub async fn copy_client_endpoint(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    id: String,
    env: Option<String>,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let base = match Place::of(env.as_deref())? {
        Place::Here => gateway_base(&state.control, &gateway_host(&state)).await?,
        Place::Wsl(w) => wsl::target(&state, &w).await?.base,
    };
    let gw = tw_adopt::clients::Gateway {
        base,
        key: None,
        models: Vec::new(),
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

/// 复制放行 WSL 的那条防火墙命令（客户端页上规则缺失时的「复制」）。命令由这一侧
/// 按此刻的网卡和网关位置拼好再写进剪贴板，界面只说「复制它」
#[tauri::command]
pub async fn copy_wsl_firewall(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Out<()> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    let nics = state
        .control
        .call::<ep::Interfaces>(&[], &())
        .await
        .map_err(text)?;
    let (_, addr) =
        tw_adopt::wsl::pick_nic(nics.iter().map(|n| (n.name.as_str(), n.addr.as_str())))
            .ok_or_else(|| CmdError::from(wsl::no_adapter()))?;
    let program = crate::gateway::locate_core(&app)?;
    let cmd = tw_adopt::wsl::firewall_command(&program, &tw_adopt::wsl::remote_range(addr));
    app.clipboard()
        .write_text(cmd)
        .map_err(|e| e.to_string().into())
}

/// 在文件管理器里选中这个客户端的配置文件 —— 跟完符号链接的那一份，那才是
/// 真正会被改的。WSL 里的在资源管理器里打开的是 `\\wsl.localhost\…` 那条路径。
#[tauri::command]
pub async fn reveal_client_config(id: String, env: Option<String>) -> Out<()> {
    let place = Place::of(env.as_deref())?;
    let c = place.find(&id)?;
    let d = tw_adopt::detect::detect_one(&c, &place.home());
    Ok(reveal::reveal(&d.real.display().to_string())?)
}

/// 把接管着的几个客户端重新指一次：地址换成 `base`，密钥用 `control` 那个 core 为
/// 每个客户端发的那把。**一个失败不影响其余的**，逐个报。
async fn retarget_in(
    control: &ControlClient,
    place: &Place,
    base: &str,
    cs: Vec<tw_adopt::clients::Client>,
) -> wire::Retargeted {
    let home = place.home();
    let mut out = wire::Retargeted {
        synced: Vec::new(),
        failed: Vec::new(),
    };
    for c in cs {
        let key = match prepare_key(control, &place.owner(c.id)).await {
            Ok(k) => k.key,
            Err(e) => {
                out.failed.push(wire::KeySyncFailed {
                    client: c.id.to_string(),
                    name: place.name(&c),
                    error: e.into_msg(),
                });
                continue;
            }
        };
        let models = match models_for(&c, base, &key).await {
            Ok(m) => m,
            Err(error) => {
                out.failed.push(wire::KeySyncFailed {
                    client: c.id.to_string(),
                    name: place.name(&c),
                    error,
                });
                continue;
            }
        };
        match ops::repoint(&home, &backups(), &c, base, &key, models) {
            Ok(mut s) => {
                s.name = place.name(&c);
                out.synced.push(s);
            }
            Err(mut f) => {
                f.name = place.name(&c);
                out.failed.push(f);
            }
        }
    }
    out
}

/// 把这台机器上接管着、**还指着本机网关**的客户端改为指向 `control` 那个 core 的
/// 网关（`host` 是它的地址），用它为每个客户端发的那把密钥。
///
/// 从本机切到远程 core 时，确认框里「同时将这些客户端改为指向…」勾上就走这里；连着
/// 远程时客户端页上的「改为指向服务器」也是这一步。**一个失败不影响其余的**，逐个报。
///
/// WSL 里的不在这里：改它们要把每个发行版唤醒，它们在客户端页上各自那一组里改
/// （[`retarget_wsl`]）。
pub async fn retarget_adopted(control: &ControlClient, host: &str) -> Out<wire::Retargeted> {
    let base = gateway_base(control, host).await?;
    let cs = ops::adopted_on_this_machine(&home_dir())
        .into_iter()
        .map(|(c, _)| c)
        .collect();
    Ok(retarget_in(control, &Place::Here, &base, cs).await)
}

/// 「WSL · <发行版>」那一组的「重新指向」：还指着旧地址的，改为指向此刻该连的
/// 那一个（NAT 模式下 WSL 重启之后，或者连着远程 core 时）。
///
/// 监听绑在 WSL 网卡上的，先原样再存一次监听，网关才会换到那张网卡的新地址上 ——
/// 否则客户端改过去了，那个地址上却没有人在听。
#[tauri::command]
pub async fn retarget_wsl(state: tauri::State<'_, AppState>, env: String) -> Out<wire::Retargeted> {
    let w = wsl::find(&env)?;
    let t = wsl::target(&state, &w).await?;
    if !state.link.is_remote() {
        wsl::relisten(&state.control, &t).await?;
    }
    let cs = ops::stale(&w.home, &t.base);
    Ok(retarget_in(&state.control, &Place::Wsl(w), &t.base, cs).await)
}

/// 手动配置 WSL 里的客户端之前，把网关的监听改到这个发行版够得到的样子
/// （[`wire::WslGroup::listen`] 说的那几句）。**用户在手动配置对话框里点过才到这里**，
/// 和一键接管确认后改的是同一处设置。已经够得到就什么都不做
#[tauri::command]
pub async fn listen_for_wsl(state: tauri::State<'_, AppState>, env: String) -> Out<()> {
    let w = wsl::find(&env)?;
    let t = wsl::target(&state, &w).await?;
    if let Some(l) = &t.listen {
        wsl::save_listen(&state.control, &l.save).await?;
    }
    Ok(())
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

/// 一把密钥的主人：哪个客户端，在哪一处。
pub(crate) struct Owner {
    pub client: tw_adopt::clients::Client,
    pub place: Place,
}

impl Owner {
    /// 给人看的名字：WSL 里的带上发行版
    pub fn name(&self) -> String {
        self.place.name(&self.client)
    }
}

/// 更换密钥之后，把新值写进正在用它的那个客户端的配置。
pub(crate) async fn sync_rotated(
    state: &AppState,
    owner: &Owner,
    fresh: &str,
) -> Result<wire::KeySynced, wire::KeySyncFailed> {
    let c = &owner.client;
    let failed = |error: tw_api::Msg| wire::KeySyncFailed {
        client: c.id.to_string(),
        name: owner.name(),
        error,
    };
    let base = match &owner.place {
        Place::Here => gateway_base(&state.control, &gateway_host(state))
            .await
            .map_err(|e| failed(e.into_msg()))?,
        Place::Wsl(w) => wsl::target(state, w).await.map_err(failed)?.base,
    };
    let models = models_for(c, &base, fresh).await.map_err(failed)?;
    ops::repoint(&owner.place.home(), &backups(), c, &base, fresh, models)
        .map(|mut s| {
            s.name = owner.name();
            s
        })
        .map_err(|mut f| {
            f.name = owner.name();
            f
        })
}

/// 删之前、换之前要知道：这把密钥的主人此刻接管着吗
///
/// 为 WSL 里的某一份发的密钥（`claude-code-wsl-ubuntu`），要读那个发行版才答得上
/// —— 这会唤醒它，而用户此刻正要删、换这把密钥。**读不出来就说读不出来**，不当
/// 成「没接管」：那样删掉的是它配置里正写着的钥匙，换掉的新值也同步不过去。
pub(crate) fn adopted_owner(keys: &[tw_api::ClientView], name: &str) -> Result<Option<Owner>, Msg> {
    if let Some(client) = ops::adopted_owner(&home_dir(), keys, name) {
        return Ok(Some(Owner {
            client,
            place: Place::Here,
        }));
    }
    let Some(id) = keys
        .iter()
        .find(|k| k.name == name)
        .and_then(|k| k.client.as_deref())
    else {
        return Ok(None);
    };
    let Some((client, _)) = tw_adopt::wsl::split_key_id(id) else {
        return Ok(None);
    };
    // 那个发行版已经不在了：没有谁的配置里还写着它
    let Some(d) = wsl::distros()
        .into_iter()
        .find(|d| tw_adopt::wsl::same_distro(client, &d.name, id))
    else {
        return Ok(None);
    };
    let w = wsl::open(d)?;
    let Ok(c) = ops::find(client) else {
        return Ok(None);
    };
    Ok(tw_adopt::detect::detect_one(&c, &w.home)
        .adopted_at_ms
        .map(|_| Owner {
            client: c,
            place: Place::Wsl(w),
        }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_model_list_is_the_ids_under_data() {
        let body = serde_json::json!({
            "object": "list",
            "data": [{ "id": "gpt-5", "object": "model" }, { "id": "claude-sonnet" }, { "x": 1 }],
        });
        assert_eq!(model_ids(&body), ["gpt-5", "claude-sonnet"]);
        assert!(model_ids(&serde_json::json!({ "models": [] })).is_empty());
    }

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
