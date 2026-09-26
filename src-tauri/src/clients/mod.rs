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
///
/// 每一组说它用哪种网络、此刻能不能接管（[`wsl::network`]）。本机时 WSL 2 的情况
/// 全机只问一次：读注册表、`.wslconfig`，起 `wsl.exe` 问版本和此刻的网络 —— 所有
/// WSL 2 发行版在同一台虚拟机里，问一个开着的就够。
#[tauri::command]
pub async fn list_wsl(state: tauri::State<'_, AppState>) -> Out<wire::WslResponse> {
    let distros = wsl::distros();
    if distros.is_empty() {
        return Ok(wire::WslResponse {
            distros: Vec::new(),
        });
    }
    let gw = gateway(&state).await?;
    let remote = state.link.is_remote();
    let opened: Vec<(tw_adopt::wsl::Distro, Result<WslHome, Msg>)> = distros
        .into_iter()
        .map(|d| (d.clone(), wsl::open(d)))
        .collect();
    // 问一个读得到的（此刻开着的）WSL 2 发行版
    let probe = opened
        .iter()
        .find(|(d, w)| d.version != 1 && w.is_ok())
        .map(|(d, _)| d.name.clone());
    let wsl2 = if !remote && opened.iter().any(|(d, _)| d.version != 1) {
        Some(
            tokio::task::spawn_blocking(move || wsl::wsl2(probe))
                .await
                .map_err(|e| CmdError::plain(e.to_string()))?,
        )
    } else {
        None
    };
    let config = wsl::config_mode();
    let out = opened
        .into_iter()
        .map(|(d, w)| {
            let (network, adoptable) = wsl::network(remote, &d, config, || {
                wsl2.clone()
                    .unwrap_or(tw_adopt::wsl::Wsl2::Nat { version: None })
            });
            let (clients, error) = match w {
                Ok(w) => (ops::list_wsl(&w, &gw), None),
                Err(e) => (Vec::new(), Some(e)),
            };
            wire::WslGroup {
                distro: d.name,
                network,
                adoptable,
                error,
                clients,
                gateway_base: gw.base.clone(),
            }
        })
        .collect();
    Ok(wire::WslResponse { distros: out })
}

/// 把 WSL 2 改成 mirrored 网络：算一份 `.wslconfig` 的改动。**不写任何东西。**
///
/// 只动 `networkingMode` 那一项，别的原样留着（`tw_adopt::wslconfig`）。给人看的
/// 两份文字换行统一成 `\n`：这个文件多半是 `\r\n`，差异按行比，行尾那个 `\r` 只会
/// 碍事；写进去的仍是原来的换行
#[tauri::command]
pub async fn plan_wsl_mirrored() -> Out<wire::WslConfigPlan> {
    wsl::ensure_any()?;
    let p = tw_adopt::wslconfig::plan_mirrored(&wsl::wslconfig())?;
    let lf = |t: &str| t.replace("\r\n", "\n");
    Ok(wire::WslConfigPlan {
        path: p.path.display().to_string(),
        noop: p.is_noop(),
        before: p.before_text.as_deref().map(lf),
        after: lf(&p.after_text),
        field: p.field,
    })
}

/// 落盘 [`plan_wsl_mirrored`] 那一份。**用户在差异上点过确认之后才该到这里。**
/// 写之前全文备份（和接管客户端同一个备份目录）；交回不至于失败、但该说一声的事
/// （`.wslconfig` 是个符号链接）。重启 WSL 之后才生效，那一步另有按钮
#[tauri::command]
pub async fn set_wsl_mirrored() -> Out<Vec<Msg>> {
    wsl::ensure_any()?;
    let p = tw_adopt::wslconfig::plan_mirrored(&wsl::wslconfig())?;
    if p.is_noop() {
        return Ok(Vec::new());
    }
    Ok(tw_adopt::wslconfig::apply(&p, &backups())?.warnings)
}

/// 重启 WSL：`wsl --shutdown`，所有正在运行的发行版都会停下。**确认框里说过这件事
/// 之后才该到这里**
#[tauri::command]
pub async fn shutdown_wsl() -> Out<()> {
    wsl::ensure_any()?;
    tokio::task::spawn_blocking(wsl::shutdown)
        .await
        .map_err(|e| CmdError::plain(e.to_string()))??;
    Ok(())
}

/// 完全卸载的确认框要说的：`.wslconfig` 是在这里改成 mirrored 的，卸载不改回它
#[tauri::command]
pub async fn wslconfig_kept() -> Out<Option<wire::WslConfigKept>> {
    Ok(wsl::kept())
}

/// 算一份接管改动。**不写任何东西。**
///
/// WSL 里的那一份：此刻够不着网关（NAT 这些）的拒绝；确认框里多一句请求经由
/// Windows 上的网关（[`wsl::plan_notes`]）。
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
            let gw = ops::Gateway {
                base: wsl::target(&state, w).await?,
                keys: keys(&state.control).await?,
            };
            let owner = place.owner(&id);
            // 写进去的地址和这台电脑上的一样，模型清单就从这台电脑上问
            let models = match ops::key_for(&gw, &owner) {
                Ok((_, key, _)) => models_for(&c, &gw.base, &key).await?,
                Err(_) => Vec::new(),
            };
            let mut v = ops::plan_adopt_as(&w.home, &id, &owner, &gw, models)?;
            v.path = w.shown(Path::new(&v.path));
            v.notes
                .extend(wsl::plan_notes(c.name, w, state.link.is_remote()));
            Ok(v)
        }
    }
}

/// 落盘。**用户在 diff 上点过确认之后才该到这里。**
///
/// 落盘这一步才要钥匙：**先有钥匙再写对方的配置** —— 反过来的话，中间那一刻
/// 对方配置里写着一把 config.yaml 里没有的钥匙。WSL 里的那一份此刻够不着网关的
/// 拒绝（确认框打开之后网络可能变了），不留一把没人用的钥匙。
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
        Place::Wsl(w) => wsl::target(&state, w).await?,
    };
    let key = prepare_key(&state.control, &place.owner(&id)).await?;
    let models = models_for(&c, &base, &key.key).await?;
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
        Place::Wsl(w) => wsl::target(&state, &w).await?,
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

/// 在文件管理器里选中这个客户端的配置文件 —— 跟完符号链接的那一份，那才是
/// 真正会被改的。WSL 里的在资源管理器里打开的是 `\\wsl.localhost\…` 那条路径。
#[tauri::command]
pub async fn reveal_client_config(id: String, env: Option<String>) -> Out<()> {
    let place = Place::of(env.as_deref())?;
    let c = place.find(&id)?;
    let d = tw_adopt::detect::detect_one(&c, &place.home());
    Ok(reveal::reveal(&d.real.display().to_string())?)
}

/// 要改为指向服务器的是哪几处。
#[derive(Debug, Clone)]
pub enum Scope {
    /// 这台电脑上的，和每个 WSL 发行版里的：从本机切到远程 core 时
    All,
    /// 这台电脑上的：客户端页上这台电脑那几个的「改为指向服务器」
    Here,
    /// 这个 WSL 发行版里的：客户端页上那一组的「改为指向服务器」
    Wsl(String),
}

/// 一处（这台电脑，或者一个 WSL 发行版）接管着、还指着本机网关的客户端。
struct Behind {
    place: Place,
    /// 那一处的 home：这台电脑上是用户目录，WSL 里是 `\\wsl.localhost\…` 下的那个
    home: PathBuf,
    /// 连同它此刻指着的地址
    clients: Vec<(tw_adopt::clients::Client, String)>,
}

impl Behind {
    fn distro(&self) -> Option<String> {
        match &self.place {
            Place::Here => None,
            Place::Wsl(w) => Some(w.name().to_string()),
        }
    }
}

/// 读不到的 WSL 发行版：不知道里面有没有要改的，连同原因报出来。
struct Unread {
    distro: String,
    error: Msg,
}

impl Unread {
    /// 结果里的那一条：没有具体哪个客户端，名字写发行版
    fn failed(self) -> wire::KeySyncFailed {
        wire::KeySyncFailed {
            client: String::new(),
            name: wsl::place_name(&self.distro),
            error: self.error,
        }
    }
}

/// 接管着、还指着本机网关的客户端，按所在的地方：这台电脑在前，再是各个 WSL 发行版
/// （注册表里的顺序），读不到的发行版也在它那个位置上。
///
/// 连着远程 core 时，它们的请求落在一个停了的网关上。切换确认框里数的（[`Adopted`]）、
/// 「改为指向服务器」改的（[`retarget_adopted`]）都是它们。
struct LeftBehind(Vec<Result<Behind, Unread>>);

impl LeftBehind {
    /// 找一遍。**读 WSL 会唤醒发行版**，所以只在用户正要切换、或者点了「改为指向
    /// 服务器」的时候找。阻塞：读的都是文件，WSL 里的经过 `\\wsl.localhost`
    fn find(scope: &Scope) -> LeftBehind {
        let here = matches!(scope, Scope::All | Scope::Here).then(home_dir);
        let opened = match scope {
            Scope::Here => Vec::new(),
            Scope::All => wsl::distros()
                .into_iter()
                .map(|d| {
                    let distro = d.name.clone();
                    wsl::open(d).map_err(|error| Unread { distro, error })
                })
                .collect(),
            // 那个发行版已经不在了也照「读不到」报：界面上那一组是刚才读到的
            Scope::Wsl(name) => vec![wsl::find(name).map_err(|error| Unread {
                distro: name.clone(),
                error,
            })],
        };
        Self::of(here, opened)
    }

    /// [`find`](Self::find) 的本体：这台电脑的 home（不看这台电脑时不给），和读过的
    /// 发行版
    fn of(here: Option<PathBuf>, wsl: Vec<Result<WslHome, Unread>>) -> LeftBehind {
        let here = here.map(|home| {
            Ok(Behind {
                clients: ops::adopted_on_this_machine(&home),
                place: Place::Here,
                home,
            })
        });
        let wsl = wsl.into_iter().map(|w| {
            w.map(|w| Behind {
                clients: ops::adopted_on_this_machine_wsl(&w),
                home: w.home.clone(),
                place: Place::Wsl(w),
            })
        });
        LeftBehind(here.into_iter().chain(wsl).collect())
    }

    /// 切换确认框里说的：一共几个、指着哪个地址、各在哪一处。读不到的发行版数不出来，
    /// 不在里面
    fn adopted(&self) -> Adopted {
        let found: Vec<&Behind> = self
            .0
            .iter()
            .filter_map(|s| s.as_ref().ok())
            .filter(|b| !b.clients.is_empty())
            .collect();
        Adopted {
            count: found.iter().map(|b| b.clients.len()).sum(),
            local_addr: found
                .iter()
                .flat_map(|b| &b.clients)
                .find_map(|(_, e)| ops::host_port(e))
                .map(str::to_string),
            places: found
                .iter()
                .map(|b| AdoptedAt {
                    distro: b.distro(),
                    count: b.clients.len(),
                })
                .collect(),
        }
    }

    /// 都改为指向 `base`。每一份写进去的密钥和模型清单由 `prepare(owner, client)` 给：
    /// 线上是 core 为这一份发的那把（WSL 里的归在 `tw_adopt::wsl::key_id` 名下），和
    /// 网关对它答的模型。走的是接管那一套（[`ops::repoint`]）：写之前全文备份，接管记录里
    /// 的原值不变。**一个失败不影响其余的**，逐个报；读不到的发行版各记一条
    async fn retarget<P, F>(self, base: &str, backups: &Path, prepare: P) -> wire::Retargeted
    where
        P: Fn(String, tw_adopt::clients::Client) -> F,
        F: std::future::Future<Output = Result<(String, Vec<String>), Msg>>,
    {
        let mut out = wire::Retargeted {
            synced: Vec::new(),
            failed: Vec::new(),
        };
        for spot in self.0 {
            let b = match spot {
                Ok(b) => b,
                Err(u) => {
                    out.failed.push(u.failed());
                    continue;
                }
            };
            for (c, _) in b.clients {
                let name = b.place.name(&c);
                match prepare(b.place.owner(c.id), c.clone()).await {
                    Ok((key, models)) => {
                        match ops::repoint(&b.home, backups, &c, base, &key, models) {
                            Ok(s) => out.synced.push(wire::KeySynced { name, ..s }),
                            Err(f) => out.failed.push(wire::KeySyncFailed { name, ..f }),
                        }
                    }
                    Err(error) => out.failed.push(wire::KeySyncFailed {
                        client: c.id.to_string(),
                        name,
                        error,
                    }),
                }
            }
        }
        out
    }

    /// 服务器的网关地址没问到：每一个该改的都记一条失败，原因就是没问到的那一句；读不到
    /// 的发行版照它自己的原因
    fn all_failed(self, error: Msg) -> wire::Retargeted {
        let mut failed = Vec::new();
        for spot in self.0 {
            match spot {
                Ok(b) => failed.extend(b.clients.iter().map(|(c, _)| wire::KeySyncFailed {
                    client: c.id.to_string(),
                    name: b.place.name(c),
                    error: error.clone(),
                })),
                Err(u) => failed.push(u.failed()),
            }
        }
        wire::Retargeted {
            synced: Vec::new(),
            failed,
        }
    }
}

/// 改为指向服务器时一份要写进去的：`control` 那个 core 为 `owner` 发的那把密钥，和
/// 网关对它答的模型清单（只有要写模型的客户端才问）
async fn key_and_models(
    control: &ControlClient,
    base: &str,
    owner: String,
    c: tw_adopt::clients::Client,
) -> Result<(String, Vec<String>), Msg> {
    let key = prepare_key(control, &owner)
        .await
        .map_err(CmdError::into_msg)?
        .key;
    let models = models_for(&c, base, &key).await?;
    Ok((key, models))
}

/// 把接管着、**还指着本机网关**的客户端改为指向 `control` 那个 core 的网关（`host` 是
/// 它的地址），用它为每一份发的那把密钥。`scope` 是改哪几处。
///
/// 从本机切到远程 core 时，确认框里「同时将这些客户端改为指向…」勾上就走这里，改全部；
/// 连着远程时客户端页上的「改为指向服务器」也是这一步，改这台电脑上的或者某个 WSL
/// 发行版里的。**一个失败不影响其余的**，逐个报；服务器的网关地址没问到，就是每一个
/// 都没改成。
///
/// WSL 里的也在这里：**读它们会唤醒发行版**，而这一步是用户切换或者点了按钮才做的。
/// 读不到的发行版跳过，结果里记一条它为什么读不到
pub async fn retarget_adopted(
    control: &ControlClient,
    host: &str,
    scope: Scope,
) -> wire::Retargeted {
    // 读文件、唤醒 WSL 都是阻塞的，不占着异步线程；同时问服务器的网关地址
    let find = tokio::task::spawn_blocking(move || LeftBehind::find(&scope));
    let (found, base) = tokio::join!(find, gateway_base(control, host));
    // 找的那一步 panic 了：照原样抛出去，和在这里直接找一样
    let found = found.unwrap_or_else(|e| std::panic::resume_unwind(e.into_panic()));
    match base {
        Ok(base) => {
            found
                .retarget(&base, &backups(), |owner, c| {
                    key_and_models(control, &base, owner, c)
                })
                .await
        }
        Err(e) => found.all_failed(e.into_msg()),
    }
}

/// 客户端页上的「改为指向服务器」：还指着本机网关的，改为指向此刻连着的那个 core。
/// `env` 和页上别的命令一样：那一组所在的 WSL 发行版，不带就是这台电脑上的那几个。
/// **连着本机时什么都不做** —— 指着本机网关本来就是对的
#[tauri::command]
pub async fn retarget_clients(
    state: tauri::State<'_, AppState>,
    env: Option<String>,
) -> Out<wire::Retargeted> {
    if !state.link.is_remote() {
        return Ok(wire::Retargeted {
            synced: Vec::new(),
            failed: Vec::new(),
        });
    }
    let scope = match env {
        None => Scope::Here,
        Some(distro) => Scope::Wsl(distro),
    };
    Ok(retarget_adopted(&state.control, &gateway_host(&state), scope).await)
}

/// 接管着、还指着本机网关的客户端。切到远程之前的确认里说（「已接管的客户端仍指向本机
/// 网关 127.0.0.1:8788：这台电脑 2 个、WSL · Ubuntu 1 个」）
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Adopted {
    /// 一共几个
    pub count: usize,
    /// 它们指着的那个地址（`127.0.0.1:8788`）
    pub local_addr: Option<String>,
    /// 各在哪一处：这台电脑在前，再是各个 WSL 发行版。一个都没有的地方不列
    pub places: Vec<AdoptedAt>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct AdoptedAt {
    /// WSL 发行版的名字；这台电脑上的没有
    pub distro: Option<String>,
    pub count: usize,
}

/// 数一数接管着、还指着本机网关的客户端：这台电脑上的，和各个 WSL 发行版里的。**按这台
/// 机器上的文件数**，不问哪个 core：连着远程、本机 core 停着的时候也数得出来。**会唤醒
/// WSL 发行版**：用户正要切换。阻塞
pub fn adopted_pointing_at_local() -> Adopted {
    LeftBehind::find(&Scope::All).adopted()
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
///
/// WSL 里的那一份也照写，**哪怕此刻 WSL 够不着网关**：旧的那把已经作废，留在它
/// 配置里只会让它在网络改好之后照样用不了。地址和这台电脑上的一样
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
    let base = gateway_base(&state.control, &gateway_host(state))
        .await
        .map_err(|e| failed(e.into_msg()))?;
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
    use ops::tests::{key, wsl_home};
    use tw_adopt::wsl::Distro;

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

    /// 服务器的网关，和本机的
    const SERVER: &str = "http://10.0.3.7:8788";
    const LOCAL: &str = "http://127.0.0.1:8788";

    /// 服务器为每一份发的密钥：按主人起名，看得出写进去的是哪一把。这两个客户端不写模型
    async fn issued(
        owner: String,
        _c: tw_adopt::clients::Client,
    ) -> Result<(String, Vec<String>), Msg> {
        Ok((format!("tw-{owner}"), Vec::new()))
    }

    /// 这台电脑那一份假的 home：Claude Code 和 Codex 都装了
    fn here_home() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".claude")).unwrap();
        std::fs::create_dir_all(d.path().join(".codex")).unwrap();
        d
    }

    /// 一个读不到的发行版：根目录下没有 `/etc/passwd`
    fn unreadable(root: &Path) -> Unread {
        let d = Distro {
            name: "Debian".into(),
            version: 1,
            uid: 1000,
        };
        Unread {
            error: WslHome::read(d, root.join("Debian")).unwrap_err(),
            distro: "Debian".into(),
        }
    }

    fn read(p: &Path) -> String {
        std::fs::read_to_string(p).unwrap()
    }

    /// 切到远程：WSL 里接管着、指着本机的，改成服务器的地址和为这个发行版发的那把密钥，
    /// 这台电脑上的同一个客户端用它自己的那把。改之前全文备份；写进去的就是照服务器
    /// 接管时算出的那一份改动；还原照样回到接管之前
    #[tokio::test]
    async fn switching_to_a_server_points_wsl_copies_at_it_with_their_own_keys() {
        let here = here_home();
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        let settings = w.home.join(".claude").join("settings.json");
        let original =
            r#"{ "model": "opus", "env": { "ANTHROPIC_BASE_URL": "https://api.anthropic.com" } }"#;
        std::fs::write(&settings, original).unwrap();
        ops::adopt(&w.home, &b, "claude-code", LOCAL, "tw-local", Vec::new()).unwrap();
        ops::adopt(
            here.path(),
            &b,
            "claude-code",
            LOCAL,
            "tw-local",
            Vec::new(),
        )
        .unwrap();
        let adopted = read(&settings);

        let found = LeftBehind::of(Some(here.path().to_path_buf()), vec![Ok(w.clone())]);
        let r = found.retarget(SERVER, &b, issued).await;
        assert!(r.failed.is_empty(), "{:?}", r.failed);
        let names: Vec<_> = r
            .synced
            .iter()
            .map(|s| (s.client.as_str(), s.name.as_str()))
            .collect();
        assert_eq!(
            names,
            [
                ("claude-code", "Claude Code"),
                ("claude-code", "Claude Code (WSL · Ubuntu)")
            ]
        );

        let now = read(&settings);
        assert!(
            now.contains(SERVER) && now.contains("\"tw-claude-code-wsl-ubuntu\""),
            "{now}"
        );
        assert!(
            !now.contains("127.0.0.1") && !now.contains("tw-local"),
            "{now}"
        );
        let windows = read(&here.path().join(".claude").join("settings.json"));
        assert!(
            windows.contains(SERVER) && windows.contains("\"tw-claude-code\""),
            "{windows}"
        );

        // 改之前的那一份全文备份着
        assert_eq!(read(Path::new(&r.synced[1].backup)), adopted);
        // 写进去的就是照服务器和那把密钥接管时会写的：再算一次，没有要改的
        let gw = ops::Gateway {
            base: SERVER.into(),
            keys: vec![key(
                "claude-code-wsl-ubuntu",
                "tw-claude-code-wsl-ubuntu",
                Some("claude-code-wsl-ubuntu"),
                false,
            )],
        };
        let p = ops::plan_adopt_as(
            &w.home,
            "claude-code",
            "claude-code-wsl-ubuntu",
            &gw,
            Vec::new(),
        )
        .unwrap();
        assert!(p.noop, "{}", p.after);
        assert_eq!(p.key.as_deref(), Some("claude-code-wsl-ubuntu"));
        // 接管记录里的原值没被服务器的地址盖掉：还原回到接管之前
        ops::restore(&w.home, &b, "claude-code").unwrap();
        let back: serde_json::Value = serde_json::from_str(&read(&settings)).unwrap();
        let want: serde_json::Value = serde_json::from_str(original).unwrap();
        assert_eq!(back, want);
    }

    /// 已经指着服务器的不再改：文件不动、不多一份备份；再改一遍什么都不做
    #[tokio::test]
    async fn a_wsl_copy_already_on_the_server_is_left_alone() {
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        ops::adopt(
            &w.home,
            &b,
            "claude-code",
            SERVER,
            "tw-claude-code-wsl-ubuntu",
            Vec::new(),
        )
        .unwrap();
        ops::adopt(&w.home, &b, "codex", LOCAL, "tw-local", Vec::new()).unwrap();
        let settings = w.home.join(".claude").join("settings.json");
        let before = read(&settings);
        let real = tw_adopt::foreign::resolve(&settings).unwrap();
        let backups_of = || tw_adopt::foreign::backups_of(&b, &real).len();
        let kept = backups_of();

        let found = LeftBehind::of(None, vec![Ok(w.clone())]);
        // 切换确认框里数的也只有还指着本机的那一个
        let a = found.adopted();
        assert_eq!((a.count, a.places.len()), (1, 1));
        let r = found.retarget(SERVER, &b, issued).await;
        assert!(r.failed.is_empty(), "{:?}", r.failed);
        let ids: Vec<_> = r.synced.iter().map(|s| s.client.as_str()).collect();
        assert_eq!(ids, ["codex"]);
        assert_eq!(read(&settings), before);
        assert_eq!(backups_of(), kept);

        let again = LeftBehind::of(None, vec![Ok(w)])
            .retarget(SERVER, &b, issued)
            .await;
        assert!(again.synced.is_empty() && again.failed.is_empty());
    }

    /// 读不到的发行版跳过，结果里记一条它为什么读不到；别处的照改
    #[tokio::test]
    async fn an_unreadable_distro_is_skipped_and_reported_with_the_reason() {
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        ops::adopt(&w.home, &b, "codex", LOCAL, "tw-local", Vec::new()).unwrap();
        let found = || LeftBehind::of(None, vec![Err(unreadable(d.path())), Ok(w.clone())]);

        // 数不出来的不算进确认框里的数
        let a = found().adopted();
        let places: Vec<_> = a
            .places
            .iter()
            .map(|p| (p.distro.as_deref(), p.count))
            .collect();
        assert_eq!(places, [(Some("Ubuntu"), 1)]);

        let r = found().retarget(SERVER, &b, issued).await;
        let synced: Vec<_> = r.synced.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(synced, ["Codex (WSL · Ubuntu)"]);
        let failed: Vec<_> = r
            .failed
            .iter()
            .map(|f| (f.client.as_str(), f.name.as_str(), f.error.code.as_str()))
            .collect();
        assert_eq!(failed, [("", "WSL · Debian", "wsl.unreadable")]);
        let config = read(&w.home.join(".codex").join("config.toml"));
        assert!(
            config.contains("10.0.3.7:8788") && config.contains("tw-codex-wsl-ubuntu"),
            "{config}"
        );
    }

    /// 服务器的网关地址没问到：每一个该改的都记一条没改成，WSL 里的也在；读不到的
    /// 发行版照它自己的原因
    #[test]
    fn without_the_servers_address_every_client_left_behind_is_reported() {
        let here = here_home();
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        ops::adopt(here.path(), &b, "codex", LOCAL, "tw-x", Vec::new()).unwrap();
        ops::adopt(&w.home, &b, "claude-code", LOCAL, "tw-c", Vec::new()).unwrap();
        let why = CmdError::plain("core is not running").into_msg();
        let r = LeftBehind::of(
            Some(here.path().to_path_buf()),
            vec![Ok(w), Err(unreadable(d.path()))],
        )
        .all_failed(why);
        assert!(r.synced.is_empty());
        let failed: Vec<_> = r
            .failed
            .iter()
            .map(|f| (f.name.as_str(), f.error.code.as_str()))
            .collect();
        assert_eq!(
            failed,
            [
                ("Codex", ""),
                ("Claude Code (WSL · Ubuntu)", ""),
                ("WSL · Debian", "wsl.unreadable")
            ]
        );
    }

    /// 客户端页上某一组的「改为指向服务器」，而那个发行版已经不在了：照读不到报，不是
    /// 悄悄地什么都不做
    #[test]
    fn a_distro_that_is_gone_is_reported_not_skipped_silently() {
        let r = LeftBehind::find(&Scope::Wsl("No-Such-Distro".into()))
            .all_failed(CmdError::plain("unused").into_msg());
        let failed: Vec<_> = r
            .failed
            .iter()
            .map(|f| (f.name.as_str(), f.error.code.as_str()))
            .collect();
        assert_eq!(failed, [("WSL · No-Such-Distro", "wsl.unknown")]);
    }

    /// 切换确认框里的数：这台电脑上的和每个发行版里的分开数，指着服务器的不算，一个
    /// 都没有的地方不列
    #[test]
    fn the_switch_counts_this_computer_and_each_distro_apart() {
        let here = here_home();
        let (d, w) = wsl_home();
        let b = d.path().join("backups");
        ops::adopt(here.path(), &b, "claude-code", LOCAL, "tw-c", Vec::new()).unwrap();
        ops::adopt(here.path(), &b, "codex", LOCAL, "tw-x", Vec::new()).unwrap();
        ops::adopt(&w.home, &b, "claude-code", LOCAL, "tw-w", Vec::new()).unwrap();
        ops::adopt(&w.home, &b, "codex", SERVER, "tw-s", Vec::new()).unwrap();
        let a = LeftBehind::of(Some(here.path().to_path_buf()), vec![Ok(w)]).adopted();
        assert_eq!(a.count, 3);
        assert_eq!(a.local_addr.as_deref(), Some("127.0.0.1:8788"));
        let places: Vec<_> = a
            .places
            .iter()
            .map(|p| (p.distro.as_deref(), p.count))
            .collect();
        assert_eq!(places, [(None, 2), (Some("Ubuntu"), 1)]);
        // 界面按这个形状读：这台电脑上的那一处 `distro` 是 null
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json["places"][0]["distro"], serde_json::Value::Null);
        assert_eq!(json["places"][1]["distro"], "Ubuntu");

        let (_d, empty) = wsl_home();
        let a = LeftBehind::of(None, vec![Ok(empty)]).adopted();
        assert_eq!((a.count, a.places.len(), a.local_addr), (0, 0, None));
    }
}
