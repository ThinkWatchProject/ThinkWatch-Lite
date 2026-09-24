//! 连哪个 core：本机的，或者另一台机器上的。
//!
//! 应用同一时间只连一个 core。**几条原则，都来自同一种要避开的失败**：远程连不上，
//! 界面就初始化不了，只能重装或者把远程修好才能切回本机。
//!
//! - 界面外壳不依赖 core。连接列表归应用自己存（`store`），密钥另存一个只有自己能读的
//!   文件（`secrets`）。
//! - 「本机」内置、删不掉，任何状态下一步就能切回来。
//! - 先试连，再切换（`connector::test`）。失败就留在原来的连接上，说明原因。
//! - **绝不悄悄退回本机。**连不上远程时不自动拉起本机的 core：两边配置不同，客户端又
//!   指着服务器，用户会分不清请求走的是哪边。
//! - 远程模式下本机 core 停掉（等在途请求结束），本机数据原样保留，切回本机时再拉起。
//! - 断线只报一次：一条系统通知，界面上一条横幅；连上后按现有的对账机制补齐。

pub mod connector;
pub mod launch;
pub mod secrets;
pub mod store;

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager};
use tokio::sync::{Notify, watch};

use crate::control::Target;
use crate::error::{CmdError, Out};
use crate::supervisor::CoreState;
use crate::{AppState, data_dir, notices};
use connector::{ConnectError, RemoteTarget, ServerInfo};
use store::{LOCAL, Remote};

/// 此刻的连接走到了哪一步。
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LinkState {
    /// 连的是本机：状态看守护（`core-state`），这一层不另说
    Local,
    /// 还没开始连：连接选择开着
    Waiting,
    /// 正在连，第几次。`ever`：这次运行里连上过它
    Connecting {
        attempt: u32,
        ever: bool,
    },
    Connected {
        info: ServerInfo,
    },
    /// 连不上，隔一会儿再试。`retry_in_ms` 从 `at_ms` 算起
    Down {
        error: ConnectError,
        attempt: u32,
        at_ms: u64,
        retry_in_ms: u64,
        ever: bool,
    },
}

/// 当前连接是哪一条
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Current {
    Local,
    Remote(Remote),
}

impl Current {
    fn id(&self) -> &str {
        match self {
            Current::Local => LOCAL,
            Current::Remote(r) => &r.id,
        }
    }
}

pub struct Link {
    app: tauri::AppHandle,
    /// 本机 core 的控制面在哪、凭据是什么。切回本机时控制面客户端指回这里
    local: Target,
    current: std::sync::Mutex<Current>,
    state: watch::Sender<LinkState>,
    /// 「立即重试」
    retry: Arc<Notify>,
    /// 事件流断了（连着远程时）
    lost: Arc<Notify>,
    /// 连远程的那条循环
    task: std::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    /// 切换一次做完再做下一次。**停本机 core 的那一步也拿它**：切走之后又马上切
    /// 回来时，不能出现「刚拉起来的 core 被上一次切换停掉」
    switching: tokio::sync::Mutex<()>,
}

/// 远程断线重连的间隔：第几次失败之后等多久
fn backoff(attempt: u32) -> Duration {
    const STEPS: [u64; 6] = [2, 4, 8, 15, 30, 60];
    Duration::from_secs(STEPS[(attempt.saturating_sub(1) as usize).min(STEPS.len() - 1)])
}

/// 连着远程时多久问一次它还在不在，连着几次不答算断线
const PING_EVERY: Duration = Duration::from_secs(5);
const PING_FAILS: u32 = 3;

impl Link {
    pub fn new(app: tauri::AppHandle, local: Target, current: Current) -> Self {
        Self {
            app,
            local,
            current: std::sync::Mutex::new(current),
            state: watch::channel(LinkState::Local).0,
            retry: Arc::new(Notify::new()),
            lost: Arc::new(Notify::new()),
            task: std::sync::Mutex::new(None),
            switching: tokio::sync::Mutex::new(()),
        }
    }

    pub fn state(&self) -> LinkState {
        self.state.borrow().clone()
    }

    pub fn watch(&self) -> watch::Receiver<LinkState> {
        self.state.subscribe()
    }

    pub fn current(&self) -> Current {
        self.current.lock().expect("锁未中毒").clone()
    }

    pub fn is_remote(&self) -> bool {
        matches!(self.current(), Current::Remote(_))
    }

    fn set(&self, s: LinkState) {
        self.state.send_replace(s);
        announce(&self.app);
    }

    /// 「立即重试」：连着远程时马上再连一次，不等退避
    pub fn retry_now(&self) {
        self.retry.notify_one();
    }

    /// 事件流断了。连着远程时它就是断线的信号
    pub fn stream_lost(&self) {
        if matches!(self.state(), LinkState::Connected { .. }) && self.is_remote() {
            self.lost.notify_one();
        }
    }

    fn stop_task(&self) {
        if let Some(h) = self.task.lock().expect("锁未中毒").take() {
            h.abort();
        }
    }

    /// 启动时先让人选：什么都不连，等选好
    pub fn wait_for_pick(&self) {
        self.set(LinkState::Waiting);
    }
}

/// 状态变了：界面、菜单栏都说一声
fn announce(app: &tauri::AppHandle) {
    let _ = app.emit("connection", view(app));
    emit_core_state(app);
    if let Some(st) = app.try_state::<AppState>() {
        st.menubar_now.notify_one();
    }
}

/// 界面认得的那个 core 状态字符串，**按当前连接说**。
///
/// 连本机时就是守护的状态。连远程时只有两种：连上了是 `running:0`（各处见到
/// `running:` 就去取数、对账，和本机 core 重启回来走同一条路），没连上是 `unlinked`，
/// 细节在 `connection` 事件里
pub fn describe_active(link: &LinkState, sup: &CoreState) -> String {
    match link {
        LinkState::Local => crate::gateway::describe_state(sup),
        LinkState::Connected { .. } => "running:0".into(),
        _ => "unlinked".into(),
    }
}

pub(crate) fn emit_core_state(app: &tauri::AppHandle) {
    if let Some(st) = app.try_state::<AppState>() {
        let _ = app.emit(
            "core-state",
            describe_active(&st.link.state(), &st.supervisor.state()),
        );
    }
}

/// 守护换了状态。**连本机时本机 core 起来了就算走到了就绪**，见 `launch`
pub(crate) fn on_supervisor(app: &tauri::AppHandle, s: &CoreState) {
    if let Some(st) = app.try_state::<AppState>()
        && !st.link.is_remote()
        && matches!(s, CoreState::Running { .. })
    {
        launch::ready(&data_dir());
    }
}

// ------------------------------------------------------------------ 界面看到的

/// 连接列表里的一条。**没有密钥**
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProfileView {
    pub id: String,
    pub name: String,
    pub local: bool,
    pub host: Option<String>,
    pub port: Option<u16>,
    /// `host:port`，本机没有
    pub addr: Option<String>,
    pub last_connected_at: Option<u64>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ConnView {
    /// 本机在最前，其余按添加的顺序
    pub profiles: Vec<ProfileView>,
    pub current: String,
    /// 上次用的那一条。启动时连接选择里标「上次使用」
    pub last_used: String,
    pub startup: store::Startup,
    pub link: LinkState,
    /// 这一版应用配的 core 版本
    pub required_core: &'static str,
    /// 数据目录，「本机」那一行的说明
    pub data_dir: String,
}

fn profile(r: &Remote) -> ProfileView {
    ProfileView {
        id: r.id.clone(),
        name: r.name.clone(),
        local: false,
        host: Some(r.host.clone()),
        port: Some(r.port),
        addr: Some(connector::display_addr(&r.host, r.port)),
        last_connected_at: r.last_connected_at,
    }
}

/// 数据目录写成用户认得的样子：家目录下的写成 `~/…`
fn home_relative(p: &std::path::Path) -> String {
    #[cfg(unix)]
    if let Some(home) = std::env::var_os("HOME")
        && let Ok(rest) = p.strip_prefix(&home)
    {
        return format!("~/{}", rest.display());
    }
    p.display().to_string()
}

pub fn view(app: &tauri::AppHandle) -> ConnView {
    let c = store::load(&data_dir());
    let mut profiles = vec![ProfileView {
        id: LOCAL.into(),
        name: tr!("本机", "This Mac").into(),
        local: true,
        host: None,
        port: None,
        addr: None,
        last_connected_at: None,
    }];
    profiles.extend(c.remotes.iter().map(profile));
    let (current, link) = match app.try_state::<AppState>() {
        Some(st) => (st.link.current().id().to_string(), st.link.state()),
        None => (LOCAL.to_string(), LinkState::Local),
    };
    ConnView {
        profiles,
        current,
        last_used: c.last_used,
        startup: c.startup,
        link,
        required_core: connector::REQUIRED_CORE,
        data_dir: home_relative(&data_dir()),
    }
}

// ------------------------------------------------------------------ 启动与切换

/// 还在等连接选择（启动时先让人选、还没选）
pub fn waiting(app: &tauri::AppHandle) -> bool {
    app.try_state::<AppState>()
        .is_some_and(|st| st.link.state() == LinkState::Waiting)
}

/// 启动时连上选定的那一个。**不在这里等**：守护、远程连接都在后台，窗口照常打开
pub fn start(app: &tauri::AppHandle, id: &str) {
    let Some(st) = app.try_state::<AppState>() else {
        return;
    };
    let c = store::load(&data_dir());
    match c.remote(id).cloned() {
        Some(r) => begin_remote(app, &st.link, r, None),
        None => begin_local(app, &st.link),
    }
}

/// 选定了连哪个：启动时的连接选择要是还开着，就收起来 —— 别处（菜单栏的「连接」
/// 子菜单）已经替它选了
fn close_picker(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window(PICKER_WINDOW) {
        let _ = w.destroy();
    }
}

fn begin_local(app: &tauri::AppHandle, link: &Link) {
    close_picker(app);
    link.stop_task();
    *link.current.lock().expect("锁未中毒") = Current::Local;
    if let Some(st) = app.try_state::<AppState>() {
        st.control.retarget(link.local.clone());
    }
    link.set(LinkState::Local);
    if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
        n.ingest(notices::rules::remote_back(), notices::now_ms());
    }
    // 守护没在跑就接回来（远程模式下它停了）。在跑的话什么都不做
    crate::gateway::ensure_supervising(app);
}

/// 开始连一个远程。`first`：切换时刚试连成功的结果，不再连第二遍
fn begin_remote(app: &tauri::AppHandle, link: &Link, r: Remote, first: Option<ServerInfo>) {
    close_picker(app);
    link.stop_task();
    *link.current.lock().expect("锁未中毒") = Current::Remote(r.clone());
    let key = secrets::load(&data_dir(), &r.id).unwrap_or_default();
    let target = RemoteTarget {
        host: r.host.clone(),
        port: r.port,
        key,
    };
    if let Some(st) = app.try_state::<AppState>() {
        st.control.retarget(Target::Remote(target.clone()));
    }
    link.set(LinkState::Connecting {
        attempt: 1,
        ever: false,
    });
    let app2 = app.clone();
    let h = tauri::async_runtime::spawn(async move { remote_loop(app2, r, target, first).await });
    *link.task.lock().expect("锁未中毒") = Some(h);
}

/// 连着一个远程：连上、看着、断了再连。**不会自己退回本机**
async fn remote_loop(
    app: tauri::AppHandle,
    remote: Remote,
    target: RemoteTarget,
    mut first: Option<ServerInfo>,
) {
    let Some(st) = app.try_state::<AppState>() else {
        return;
    };
    let link = &st.link;
    let mut attempt = 0u32;
    let mut ever = false;
    loop {
        let tried = match first.take() {
            Some(info) => Ok(info),
            None => {
                attempt += 1;
                link.set(LinkState::Connecting { attempt, ever });
                connector::test(&Target::Remote(target.clone())).await
            }
        };
        match tried {
            Ok(info) => {
                attempt = 0;
                ever = true;
                connected(&app, &remote.id);
                link.set(LinkState::Connected { info });
                watch_until_lost(link, &st.control).await;
                tracing::warn!("与 {} 的连接断开", remote.name);
                if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
                    n.ingest(notices::rules::remote_lost(&remote.name), notices::now_ms());
                }
            }
            Err(error) => {
                let wait = backoff(attempt);
                tracing::info!(?error, attempt, ?wait, "连不上 {}", remote.name);
                link.set(LinkState::Down {
                    error,
                    attempt,
                    at_ms: notices::now_ms(),
                    retry_in_ms: wait.as_millis() as u64,
                    ever,
                });
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    _ = link.retry.notified() => {}
                }
            }
        }
    }
}

/// 连着的时候看着它：事件流断了，或者连着几次问不到状态，就算断线
async fn watch_until_lost(link: &Link, control: &crate::control::ControlClient) {
    let mut fails = 0;
    loop {
        tokio::select! {
            _ = link.lost.notified() => return,
            _ = tokio::time::sleep(PING_EVERY) => {
                match control.ping(Duration::from_secs(3)).await {
                    Ok(()) => fails = 0,
                    Err(_) => {
                        fails += 1;
                        if fails >= PING_FAILS {
                            return;
                        }
                    }
                }
            }
        }
    }
}

/// 连上了：记下时刻、清掉断线那条提醒、这次启动算走到了就绪
fn connected(app: &tauri::AppHandle, id: &str) {
    let dir = data_dir();
    launch::ready(&dir);
    let now = notices::now_ms();
    let id2 = id.to_string();
    if let Err(e) = store::update(&dir, |c| {
        if let Some(r) = c.remotes.iter_mut().find(|r| r.id == id2) {
            r.last_connected_at = Some(now);
        }
    }) {
        tracing::warn!("连接列表写不进去：{e:#}");
    }
    if let Some(n) = app.try_state::<Arc<notices::Notices>>() {
        n.ingest(notices::rules::remote_back(), now);
    }
}

/// 切到另一个连接。
///
/// 切到本机：直接切，拉起本机 core。切到远程：**先试连**，通过了才提交 —— 没通过就
/// 留在原来的连接上，把原因交给界面。提交之后本机 core 在手上的请求结束后停掉。
pub async fn switch(
    app: &tauri::AppHandle,
    id: &str,
    retarget_clients: bool,
) -> Result<(), SwitchError> {
    let st = app.state::<AppState>();
    let dir = data_dir();
    let c = store::load(&dir);
    if id == LOCAL {
        let _g = st.link.switching.lock().await;
        begin_local(app, &st.link);
        remember(&dir, LOCAL);
        return Ok(());
    }
    let r = c.remote(id).cloned().ok_or(SwitchError::Unknown)?;
    let key = secrets::load(&dir, &r.id).map_err(|e| SwitchError::KeyUnreadable {
        detail: format!("{e:#}"),
    })?;
    let target = RemoteTarget {
        host: r.host.clone(),
        port: r.port,
        key,
    };
    let info = connector::test(&Target::Remote(target))
        .await
        .map_err(|error| SwitchError::Connect { error })?;
    // 要改指向的话，趁本机 core 还在跑先把名单拿到
    let retarget = if retarget_clients {
        info.gateway_addr.clone()
    } else {
        None
    };
    {
        let _g = st.link.switching.lock().await;
        begin_remote(app, &st.link, r.clone(), Some(info));
        remember(&dir, &r.id);
    }
    if let Some(addr) = retarget {
        match crate::clients::retarget_adopted_clients(app, &addr).await {
            Ok(n) => tracing::info!(n, "已接管的客户端改为指向 {addr}"),
            Err(e) => tracing::warn!("改指向没做成：{e:#}"),
        }
    }
    stop_local_when_quiet(app.clone());
    Ok(())
}

fn remember(dir: &std::path::Path, id: &str) {
    let id = id.to_string();
    if let Err(e) = store::update(dir, |c| c.last_used = id) {
        tracing::warn!("连接列表写不进去：{e:#}");
    }
}

/// 本机 core 在手上的请求结束后停掉，**并且守护不再拉它**。等的这段时间里又切回了
/// 本机，就不停了
fn stop_local_when_quiet(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let Some(st) = app.try_state::<AppState>() else {
            return;
        };
        if !matches!(st.supervisor.state(), CoreState::Running { .. }) {
            // 没在跑（启动中、安全模式、起不来）：直接停，不必等请求
            let _g = st.link.switching.lock().await;
            if st.link.is_remote() {
                st.supervisor.stop_and_wait(Duration::from_secs(5)).await;
            }
            return;
        }
        crate::updater::wait_for_quiet(st.supervisor.control(), |_| {}).await;
        let _g = st.link.switching.lock().await;
        if st.link.is_remote() {
            tracing::info!("已切到远程，停掉本机 core");
            st.supervisor.stop_and_wait(Duration::from_secs(5)).await;
        }
    });
}

/// 切换没做成的原因
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SwitchError {
    /// 列表里没有这一条（别处刚删掉）
    Unknown,
    /// 保存的密钥读不出来
    KeyUnreadable { detail: String },
    /// 试连没通过
    Connect { error: ConnectError },
}

// ------------------------------------------------------------------ 命令

#[tauri::command]
pub fn connections(app: tauri::AppHandle) -> ConnView {
    view(&app)
}

#[tauri::command]
pub fn set_connection_startup(app: tauri::AppHandle, startup: store::Startup) -> Out<ConnView> {
    store::update(&data_dir(), |c| c.startup = startup).map_err(saving)?;
    announce(&app);
    Ok(view(&app))
}

/// 对话框里填的
#[derive(Debug, Clone, serde::Deserialize)]
pub struct ProfileInput {
    /// 编辑时是那一条的 id，新建时没有
    pub id: Option<String>,
    pub name: String,
    pub host: String,
    pub port: u16,
    /// 新建时必填；编辑时不填就是沿用已经保存的那一把
    pub key: Option<String>,
}

/// 对话框里的一项不对。`field` 是哪一格
#[derive(Debug, Clone, serde::Serialize)]
pub struct Invalid {
    pub field: &'static str,
    pub reason: &'static str,
}

fn check(c: &store::Connections, p: &ProfileInput) -> Result<(), Invalid> {
    let bad = |field, reason| Err(Invalid { field, reason });
    if p.name.trim().is_empty() {
        return bad("name", "empty");
    }
    if c.name_taken(&p.name, p.id.as_deref()) {
        return bad("name", "taken");
    }
    let host = p.host.trim();
    if host.is_empty() || host.contains(char::is_whitespace) || host.contains('/') {
        return bad("host", "invalid");
    }
    if p.port == 0 {
        return bad("port", "invalid");
    }
    match &p.key {
        Some(k) if secrets::normalize(k).is_none() => bad("key", "invalid"),
        None if p.id.is_none() => bad("key", "empty"),
        _ => Ok(()),
    }
}

/// 试连对话框里填的这一条。**还没存**：编辑时没换密钥，就用已经保存的那一把
#[tauri::command]
pub async fn test_connection(input: ProfileInput) -> Out<Tested> {
    let key = match (&input.key, &input.id) {
        (Some(k), _) => secrets::normalize(k).unwrap_or_default(),
        (None, Some(id)) => secrets::load(&data_dir(), id).map_err(|e| key_error(&e))?,
        (None, None) => String::new(),
    };
    let target = RemoteTarget {
        host: input.host.trim().to_string(),
        port: input.port,
        key,
    };
    Ok(match connector::test(&Target::Remote(target)).await {
        Ok(info) => Tested::Ok { info },
        Err(error) => Tested::Failed { error },
    })
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum Tested {
    Ok { info: ServerInfo },
    Failed { error: ConnectError },
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum Saved {
    Ok { profile: ProfileView },
    Invalid { invalid: Invalid },
}

/// 存一条连接：密钥先存好，名字和地址再进列表。**当前连着的那一条改了地址或
/// 密钥，要重新连一次才生效** —— 这里顺手重连
#[tauri::command]
pub async fn save_connection(app: tauri::AppHandle, input: ProfileInput) -> Out<Saved> {
    let dir = data_dir();
    let c = store::load(&dir);
    if let Err(invalid) = check(&c, &input) {
        return Ok(Saved::Invalid { invalid });
    }
    let id = input.id.clone().unwrap_or_else(store::new_id);
    if let Some(k) = input.key.as_deref().and_then(secrets::normalize) {
        secrets::store(&dir, &id, &k).map_err(|e| key_error(&e))?;
    }
    let remote = Remote {
        id: id.clone(),
        name: input.name.trim().to_string(),
        host: input.host.trim().to_string(),
        port: input.port,
        last_connected_at: c.remote(&id).and_then(|r| r.last_connected_at),
    };
    let r2 = remote.clone();
    store::update(&dir, |c| {
        match c.remotes.iter_mut().find(|r| r.id == r2.id) {
            Some(old) => *old = r2,
            None => c.remotes.push(r2),
        }
    })
    .map_err(saving)?;
    let st = app.state::<AppState>();
    if st.link.current().id() == id {
        let _g = st.link.switching.lock().await;
        begin_remote(&app, &st.link, remote.clone(), None);
    } else {
        announce(&app);
    }
    Ok(Saved::Ok {
        profile: profile(&remote),
    })
}

/// 删一条连接。**当前连着的删不掉**，要先切走；本机本来就删不掉
#[tauri::command]
pub fn delete_connection(app: tauri::AppHandle, id: String) -> Out<ConnView> {
    let st = app.state::<AppState>();
    if id == LOCAL || st.link.current().id() == id {
        return Err(CmdError::plain(tr!(
            "当前连接不能删除，请先切换到其他连接。",
            "The current connection cannot be deleted. Switch to another connection first."
        )));
    }
    store::update(&data_dir(), |c| {
        c.remotes.retain(|r| r.id != id);
        if c.last_used == id {
            c.last_used = LOCAL.into();
        }
    })
    .map_err(saving)?;
    if let Err(e) = secrets::remove(&data_dir(), &id) {
        tracing::warn!("保存的密钥没删掉：{e:#}");
    }
    announce(&app);
    Ok(view(&app))
}

/// 切过去之前要告诉用户的：这台机器上已接管、还指着本机网关的客户端
#[tauri::command]
pub async fn switch_preflight(state: tauri::State<'_, AppState>) -> Out<crate::clients::Adopted> {
    // 问本机的 core：已接管的客户端指着的是它。连着远程时它停着，数出来是 0
    Ok(crate::clients::adopted_pointing_at_local(state.supervisor.control()).await)
}

#[tauri::command]
pub async fn switch_connection(
    app: tauri::AppHandle,
    id: String,
    retarget_clients: bool,
) -> Result<ConnView, SwitchError> {
    switch(&app, &id, retarget_clients).await?;
    Ok(view(&app))
}

#[tauri::command]
pub fn retry_connection(state: tauri::State<'_, AppState>) {
    state.link.retry_now();
}

fn saving(e: anyhow::Error) -> CmdError {
    CmdError::plain(tr!(
        format!("无法保存连接列表：{e:#}"),
        format!("The connection list could not be saved: {e:#}")
    ))
}

fn key_error(e: &anyhow::Error) -> CmdError {
    CmdError::plain(tr!(
        format!("无法读写保存的密钥：{e:#}"),
        format!("The saved key could not be read or written: {e:#}")
    ))
}

// ------------------------------------------------------------------ 连接选择

/// 连接选择的小窗口
pub const PICKER_WINDOW: &str = "picker";

/// 启动时先显示连接选择。**不依赖 core 的任何数据**：列表来自应用自己存的那一份
pub fn show_picker(app: &tauri::AppHandle, why: launch::Why) -> tauri::Result<()> {
    let reason = match why {
        launch::Why::Option => "option",
        launch::Why::Unfinished => "unfinished",
    };
    tauri::WebviewWindowBuilder::new(app, PICKER_WINDOW, tauri::WebviewUrl::default())
        .title(tr!("选择连接", "Choose a Connection"))
        .initialization_script(format!(
            "{} window.__TW_PICK__ = {:?};",
            crate::i18n::init_script(),
            reason
        ))
        .inner_size(PICKER_WIDTH, 300.0)
        .resizable(false)
        .minimizable(false)
        .maximizable(false)
        .center()
        .visible(false)
        .build()?;
    Ok(())
}

pub(crate) const PICKER_WIDTH: f64 = 420.0;

/// 连接选择里选好了：连它，打开主界面（`settings`：落到设置页的「连接」一节）
#[tauri::command]
pub fn pick_connection(app: tauri::AppHandle, id: String, then: Option<String>) -> Out<()> {
    remember(&data_dir(), &id);
    start(&app, &id);
    match then {
        Some(view) => notices::open_view(&app, view),
        None => {
            crate::window::show_main_window(&app).map_err(|e| CmdError::plain(e.to_string()))?
        }
    }
    Ok(())
}

#[tauri::command]
pub fn picker_fit(window: tauri::Window, height: f64) -> tauri::Result<()> {
    crate::window::fit(&window, PICKER_WIDTH, height)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 交给界面的几种结果**序列化得出来**。内部标签的枚举里装一个字符串、或者装另一个
    /// 同样用 `kind` 当标签的枚举，serde 在运行时才报错 —— 界面收到的是一句「序列化失败」
    #[test]
    fn results_for_the_interface_serialize() {
        let e = ConnectError::Timeout { addr: "h:1".into() };
        let v = serde_json::to_value(SwitchError::Connect { error: e.clone() }).unwrap();
        assert_eq!(v["kind"], "connect");
        assert_eq!(v["error"]["kind"], "timeout");
        let v = serde_json::to_value(SwitchError::KeyUnreadable { detail: "x".into() }).unwrap();
        assert_eq!(v["detail"], "x");
        let v = serde_json::to_value(Tested::Failed { error: e }).unwrap();
        assert_eq!(v["result"], "failed");
        let v = serde_json::to_value(LinkState::Down {
            error: ConnectError::WrongKey,
            attempt: 2,
            at_ms: 1,
            retry_in_ms: 4000,
            ever: true,
        })
        .unwrap();
        assert_eq!(v["kind"], "down");
        assert_eq!(v["error"]["kind"], "wrong_key");
        let v = serde_json::to_value(Saved::Invalid {
            invalid: Invalid {
                field: "name",
                reason: "taken",
            },
        })
        .unwrap();
        assert_eq!(v["invalid"]["field"], "name");
    }

    #[test]
    fn retries_back_off_and_stop_growing() {
        assert_eq!(backoff(1), Duration::from_secs(2));
        assert_eq!(backoff(2), Duration::from_secs(4));
        assert_eq!(backoff(6), Duration::from_secs(60));
        assert_eq!(backoff(40), Duration::from_secs(60));
        assert_eq!(backoff(0), Duration::from_secs(2));
    }

    /// 连远程时界面只见到两种：连上了照「运行中」取数、对账；没连上是 `unlinked`，
    /// **不会是守护的「已停止」** —— 本机 core 在远程模式下本来就停着
    #[test]
    fn the_active_state_follows_the_connection() {
        let stopped = CoreState::Stopped;
        assert_eq!(describe_active(&LinkState::Local, &stopped), "stopped");
        let info = ServerInfo {
            core_version: "0.48.0".into(),
            gateway_addr: None,
        };
        assert!(describe_active(&LinkState::Connected { info }, &stopped).starts_with("running:"));
        let down = LinkState::Down {
            error: ConnectError::WrongKey,
            attempt: 1,
            at_ms: 0,
            retry_in_ms: 2000,
            ever: false,
        };
        assert_eq!(describe_active(&down, &stopped), "unlinked");
        assert_eq!(describe_active(&LinkState::Waiting, &stopped), "unlinked");
    }

    fn input(
        id: Option<&str>,
        name: &str,
        host: &str,
        port: u16,
        key: Option<&str>,
    ) -> ProfileInput {
        ProfileInput {
            id: id.map(Into::into),
            name: name.into(),
            host: host.into(),
            port,
            key: key.map(Into::into),
        }
    }

    #[test]
    fn the_dialog_is_checked_field_by_field() {
        let c = store::Connections::default();
        let key = "a".repeat(64);
        let field = |p: ProfileInput| check(&c, &p).err().map(|i| (i.field, i.reason));
        assert_eq!(
            field(input(None, "nas", "10.0.3.7", 8789, Some(&key))),
            None
        );
        assert_eq!(
            field(input(None, " ", "h", 1, Some(&key))),
            Some(("name", "empty"))
        );
        assert_eq!(
            field(input(None, "本机", "h", 1, Some(&key))),
            Some(("name", "taken"))
        );
        assert_eq!(
            field(input(None, "n", "a b", 1, Some(&key))),
            Some(("host", "invalid"))
        );
        assert_eq!(
            field(input(None, "n", "h", 0, Some(&key))),
            Some(("port", "invalid"))
        );
        assert_eq!(
            field(input(None, "n", "h", 1, Some("short"))),
            Some(("key", "invalid"))
        );
        assert_eq!(
            field(input(None, "n", "h", 1, None)),
            Some(("key", "empty"))
        );
        // 编辑时不填密钥就是沿用
        assert_eq!(field(input(Some("x"), "n", "h", 1, None)), None);
    }
}
