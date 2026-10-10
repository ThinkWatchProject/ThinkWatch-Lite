//! 控制面客户端：和 core 说话。
//!
//! **传输按平台分。**macOS 上是一个 `0700` 的 unix socket，那里权限是文件
//! 系统给的；Windows 上没有对等物，控制面落在回环端口上，而本机任意进程都
//! 连得上一个回环端口。
//!
//! **每条连接都先握手**（`tw-link`，Noise NNpsk0），钥匙是 config.yaml 里的
//! `listen.control.key`。回环那一侧它是唯一的门，而只在一个平台上生效的防线没
//! 人日常测 —— socket、回环、远程端口走同一份代码，才不会有一半从来没被跑过。
//! **这一侧只读钥匙，不写**：由 core 生成、补上。
//!
//! **端点只有一个入口：[`ControlClient::call`]。**方法、路径、请求和响应的类型
//! 都来自 `tw_api::ep` 里那一行声明，这里不再为每个端点各写一个方法 —— 以前
//! 那样写，路径是字符串、查询串是手拼的，拼错的表现是运行时的 400。

use std::path::Path;

use anyhow::Result;
use http_body_util::BodyExt;
use hyper_util::rt::TokioIo;
use tw_api::{Endpoint, Format, ep};

/// 事件流多久没有一个字节就算断了：core 每 15 秒发一次心跳，这是错过三次
const EVENTS_SILENT_FOR: std::time::Duration = std::time::Duration::from_secs(45);

/// 一条连上控制面的流。
///
/// 两种传输各给一种，而**两种在所有平台上都编译**（只有 unix socket 那一支
/// 本身是 unix 专有的）。装箱是为了让上面那些函数只写一遍 —— 拿到流之后的
/// 每一件事，两边都该一模一样。
pub(crate) trait Stream:
    tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send
{
}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> Stream for T {}

/// 控制面绑到了哪个端口。
///
/// **读不出来和「socket 文件还不存在」是同一种失败：core 还没起来。**core 是
/// 绑成功之后才写这个文件的（先写后绑会在绑失败时留下一个指向别人的号码），
/// 所以刚把它拉起来的那一小段里，文件可能不存在、也可能只写了一半。两种都
/// 当作「还没好」，交给上面本来就有的重试。
fn read_port(f: &Path) -> Result<u16> {
    let text = std::fs::read_to_string(f)?;
    Ok(text.trim().parse::<u16>()?)
}

fn not_running(e: &dyn std::fmt::Display) -> anyhow::Error {
    tracing::debug!("控制面连不上：{e}");
    anyhow::anyhow!(tr!(
        "core 未在运行，或尚未启动完成",
        "core is not running, or has not finished starting"
    ))
}

/// 应用自己的版本，握手时报给 core（只进它的日志）
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

/// 本机那份配置里的钥匙。
///
/// **文件不在、还没有这一项，都当作 core 还没好**：core 在控制面开始监听之前才把
/// 钥匙写进去，刚把它拉起来的那一小段里这两种都是常态，交给上面本来就有的重试。
/// 写了但不是一把钥匙，是配置坏了：说出来
fn local_key(config: &Path) -> Result<tw_link::ControlKey> {
    use tw_link::KeyReadError;
    tw_link::read_key(config).map_err(|e| match e {
        KeyReadError::Io { .. } | KeyReadError::Missing => not_running(&e),
        other => {
            tracing::warn!("本机配置里的控制面钥匙读不出来：{other}");
            anyhow::anyhow!(tr!(
                "配置文件中的控制面密钥（listen.control.key）无效",
                "The control key in the config file (listen.control.key) is not valid"
            ))
        }
    })
}

/// 连上本机的控制面：socket（Windows 上是回环端口），再拿 `key` 握手。
async fn local(
    at: &tw_api::control::Address,
    config: &Path,
    key: &tw_link::ControlKey,
) -> Result<Box<dyn Stream>> {
    match handshake(at, key).await {
        // **钥匙不对就再读一次。**读钥匙和握手之间 core 换了钥匙（`--rotate`），
        // 手上这一把就是旧的；再读到的还是同一把，才是真的不对
        Err(tw_link::LinkError::WrongKey) => {
            let again = local_key(config)?;
            if &again == key {
                return Err(link_failed(tw_link::LinkError::WrongKey));
            }
            handshake(at, &again).await.map_err(link_failed)
        }
        r => r.map_err(link_failed),
    }
}

async fn handshake(
    at: &tw_api::control::Address,
    key: &tw_link::ControlKey,
) -> std::result::Result<Box<dyn Stream>, tw_link::LinkError> {
    use tw_api::control::Address;
    let raw: Box<dyn Stream> = match at {
        #[cfg(unix)]
        Address::Socket(path) => Box::new(
            tokio::net::UnixStream::connect(path)
                .await
                .map_err(tw_link::LinkError::unreachable)?,
        ),
        #[cfg(not(unix))]
        Address::Socket(_) => {
            return Err(tw_link::LinkError::unreachable(std::io::Error::other(
                "这个平台上没有 unix socket",
            )));
        }
        Address::Loopback { port_file } => {
            let port = read_port(port_file)
                .map_err(|e| tw_link::LinkError::unreachable(std::io::Error::other(e)))?;
            Box::new(
                tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
                    .await
                    .map_err(tw_link::LinkError::unreachable)?,
            )
        }
    };
    let (secure, _) = tw_link::connect(raw, key, APP_VERSION).await?;
    Ok(Box::new(secure))
}

/// 本机握手失败说成一句话。连不上、被关、超时都是「core 不在」；钥匙不对和版本
/// 不一致各说各的 —— 等多久都不会自己好
fn link_failed(e: tw_link::LinkError) -> anyhow::Error {
    use tw_link::LinkError;
    match e {
        LinkError::WrongKey => anyhow::anyhow!(tr!(
            "控制面密钥不匹配：core 拒绝了配置文件中的密钥",
            "The control key does not match: core rejected the key in the config file"
        )),
        LinkError::VersionMismatch {
            ours,
            theirs,
            peer_version,
        } => anyhow::anyhow!(tr!(
            format!(
                "控制面协议版本不一致：core {peer_version} 为 {theirs}，界面为 {ours}。请重新构建。"
            ),
            format!(
                "Control plane protocol versions differ: core {peer_version} uses {theirs}, the interface uses {ours}. Rebuild the app."
            )
        )),
        other => not_running(&other),
    }
}

/// 控制面拒绝了这个请求：非 2xx，响应体是一条 [`tw_api::ErrorBody`]。
///
/// **码原样留着**，一路带到界面，界面按码翻（见 `crate::error`）。在这里就
/// 写成一句话的话，码就埋掉了。
#[derive(Debug)]
pub struct Refused(pub tw_api::ErrorBody);

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0.text)
    }
}

impl std::error::Error for Refused {}

/// 非 2xx 的响应变成错误。**协议说响应体一定是 [`tw_api::ErrorBody`]**；
/// 读不成就是对面不是这一版的 core，只剩状态码可说。
fn refused(status: hyper::StatusCode, body: &[u8]) -> anyhow::Error {
    match serde_json::from_slice::<tw_api::ErrorBody>(body) {
        Ok(m) => Refused(m).into(),
        Err(_) => anyhow::anyhow!(tr!(
            format!("控制面返回 {status}"),
            format!("The control plane returned {status}")
        )),
    }
}

/// 控制面在哪、凭什么进去。
#[derive(Clone)]
pub enum Target {
    /// 本机的 core：数据目录里的 socket（Windows 上是回环端口）。钥匙每一问都从
    /// `config` 现读（一个命令里接连几问的，读一次，见 [`Pinned`]）—— 换过钥匙
    /// （`twcore control-key --rotate`），下一问就用新的
    Local {
        at: tw_api::control::Address,
        /// 本机那份 config.yaml
        config: std::path::PathBuf,
    },
    /// 另一台机器上的 core，见 `crate::connection`
    Remote(crate::connection::connector::RemoteTarget),
}

/// 控制面客户端。
///
/// **克隆出来的几份指着同一个地方。**应用同一时间只连一个 core，切换连接时
/// [`ControlClient::retarget`] 换掉的是大家共用的那一份 —— 各页的命令、菜单栏、
/// 事件桥手里拿的都是 `AppState.control` 的克隆，不用一个个去通知。守护和心跳
/// 另外各建一份（[`ControlClient::new`]），它们只管本机那个 core，切到远程也不跟着走。
#[derive(Clone)]
pub struct ControlClient {
    target: std::sync::Arc<std::sync::RwLock<Target>>,
    /// 换过几次地方。事件流靠它知道手上那条订阅已经连错了对象
    moved: std::sync::Arc<tokio::sync::watch::Sender<u64>>,
}

impl ControlClient {
    pub fn new(at: tw_api::control::Address, config: std::path::PathBuf) -> Self {
        Self::to(Target::Local { at, config })
    }

    pub fn to(target: Target) -> Self {
        Self {
            target: std::sync::Arc::new(std::sync::RwLock::new(target)),
            moved: std::sync::Arc::new(tokio::sync::watch::channel(0).0),
        }
    }

    /// 换一个 core 连。**所有克隆一起换**，正在订阅的事件流会被叫醒重连
    pub fn retarget(&self, target: Target) {
        *self.target.write().expect("锁未中毒") = target;
        self.moved.send_modify(|n| *n += 1);
    }

    /// 换地方的通知
    pub fn moved(&self) -> tokio::sync::watch::Receiver<u64> {
        self.moved.subscribe()
    }

    fn target(&self) -> Target {
        self.target.read().expect("锁未中毒").clone()
    }

    /// 取定此刻连哪、拿哪把钥匙（见 [`Pinned`]）。本机那一档在这里读一次钥匙：
    /// 文件不在、还没有钥匙都说 core 不在
    pub fn pin(&self) -> Result<Pinned> {
        Ok(Pinned(match self.target() {
            Target::Local { at, config } => {
                let key = local_key(&config)?;
                Resolved::Local { at, config, key }
            }
            Target::Remote(r) => Resolved::Remote(r),
        }))
    }

    async fn connect(&self) -> Result<Box<dyn Stream>> {
        self.pin()?.connect().await
    }

    /// 调一个端点。
    ///
    /// `params` 按顺序填进路径模板里的参数（`E::PARAMS`），每个值都做百分号
    /// 编码；`req` 在 GET 和 DELETE 上是查询串，其余方法上是 JSON 请求体，
    /// `()` 就是两样都没有。
    ///
    /// 每次新建连接。控制面的调用频率是「用户点一下」的量级，连接复用
    /// 带来的复杂度（连接死了怎么办、什么时候重建）换不来任何东西。
    /// **事件流是例外**，它走 `subscribe_events`，本来就是长连接。
    ///
    /// 一个命令里要接连问好几样的，先 [`ControlClient::pin`] 一次，再同时问
    pub async fn call<E: Endpoint>(&self, params: &[&str], req: &E::Req) -> Result<E::Res> {
        self.pin()?.call::<E>(params, req).await
    }

    /// 带超时的心跳探测。
    ///
    /// **必须有超时**：一个卡死的 core 会让连接一直挂着，而没有超时的
    /// 探测本身就变成了卡死的一部分 —— 守护会永远停在这一行，再也发现
    /// 不了任何东西。
    pub async fn ping(&self, timeout: std::time::Duration) -> Result<()> {
        tokio::time::timeout(timeout, self.call::<ep::Status>(&[], &()))
            .await
            .map_err(|_| anyhow::anyhow!("控制面 {timeout:?} 内没回话"))??;
        Ok(())
    }

    pub async fn status(&self) -> Result<tw_api::Status> {
        same_protocol(self.call::<ep::Status>(&[], &()).await?)
    }

    /// 请网关自己退出。
    ///
    /// **Windows 上这是「停掉 core」唯一温和的办法** —— 那里没有 SIGTERM。
    /// 它比信号还多一样：有应答，所以调用方知道对方收到了，而不是发完去猜。
    ///
    /// 两个平台都走它，理由同 core 那边：只在一个平台上生效的路径没人日常测。
    pub async fn shutdown(&self) -> Result<()> {
        // 202 的响应体是一条 `Msg`，这里不需要它 —— 要的是「收到了」。
        self.call::<ep::Shutdown>(&[], &()).await?;
        Ok(())
    }

    /// 托盘里切 `select` 组（这个策略就是「UI 上点选或托盘里切」）。
    ///
    /// **走和界面同一条路** —— 按字段改配置加乐观并发，于是它同样会
    /// 校验、存历史、防回环。
    pub async fn select_group(&self, group: &str, provider: &str) -> Result<()> {
        let cur = self.call::<ep::GetConfig>(&[], &()).await?;
        self.call::<ep::PatchConfig>(
            &[],
            &tw_api::ConfigPatch {
                base_version: Some(cur.version),
                ops: vec![tw_api::PatchOp::Replace {
                    path: format!("/groups/{group}/selected"),
                    value: tw_api::PatchValue::Str(provider.to_string()),
                }],
            },
        )
        .await?;
        Ok(())
    }

    /// 订阅事件流，逐条交给回调。`on_open` 在流接通的那一刻调一次：调用方据此
    /// 分得清哪一次是重连 —— 断开的那一段里发生的事，流不会再说一遍。
    ///
    /// 断开就返回 —— **重连由调用方决定**。守护那边已经有退避逻辑了，
    /// 这里再来一套会变成两套互相不知道对方存在的重试。
    pub async fn subscribe_events<O, F>(&self, on_open: O, mut on_event: F) -> Result<()>
    where
        O: FnOnce() + Send,
        F: FnMut(tw_api::Event) + Send,
    {
        let stream = self.connect().await?;
        let io = TokioIo::new(stream);
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        let req = hyper::Request::builder()
            .uri(ep::Events::PATH)
            .header(hyper::header::HOST, "localhost")
            .header(hyper::header::ACCEPT, "text/event-stream")
            .body(String::new())?;
        let mut resp = sender.send_request(req).await?;
        // **先看状态码，再说「连上了」。**以前这里拿到响应就报连上 —— 而一个
        // 401 也是响应。那时界面会先显示已连接，然后把空的流当成断线，接着
        // 重连、再断，循环往复，而真正的原因（凭据不对）一次都没说出来。
        let status = resp.status();
        if !status.is_success() {
            let body = resp.collect().await?.to_bytes();
            return Err(refused(status, &body));
        }
        on_open();

        let mut frames = SseFrames::default();
        // **一直没有字节就算断了**，见 [`silent_frame`]
        while let Some(chunk) = silent_frame(&mut resp, "event stream").await? {
            for m in frames.push(&chunk) {
                if let Ok(ev) = serde_json::from_str::<tw_api::Event>(&m.data) {
                    on_event(ev);
                }
            }
        }
        Ok(())
    }

    /// 打开一个在跑的请求的实时内容（`GET /request/{id}/live`），一条一条读见 [`LiveStream`]。
    ///
    /// **先看状态码再交出去**：请求已经结束（或者没有这个请求、是 WebSocket 的）时 core 答
    /// 404，码是 `control.request_not_running`，这里原样是一条 [`Refused`] —— 调用方按码分得
    /// 清「已经结束了，去取存下的」和别的失败。
    ///
    /// 和事件流一样走 [`Pinned::connect`]：本机的 socket（Windows 上是回环端口）和远程的
    /// 加密连接是同一条路，打开之后的每一步两边都一样
    pub async fn open_live(&self, id: u64) -> Result<LiveStream> {
        LiveStream::open(self.connect().await?, id).await
    }
}

/// 读一段响应体，**一直没有字节就算断了**。
///
/// 连着远程的机器睡过一觉、换过网络，TCP 那一头早就不在，这一头却收不到 FIN，会在这里一直
/// 等下去：链接还显示「已连接」，实时的东西再也不来。core 每 15 秒发一次心跳，错过三次还没有
/// 动静就是没了 —— 返回错误，调用方照断线处理（远程的重连一次、再订阅，并补报丢过事件）。
///
/// 流正常结束是 `None`；不是数据的帧（HTTP 的 trailer）跳过
async fn silent_frame(
    resp: &mut hyper::Response<hyper::body::Incoming>,
    what: &str,
) -> Result<Option<hyper::body::Bytes>> {
    loop {
        let frame = match tokio::time::timeout(EVENTS_SILENT_FOR, resp.frame()).await {
            Ok(Some(frame)) => frame?,
            Ok(None) => return Ok(None),
            Err(_) => anyhow::bail!(
                "the {what} was silent for {} seconds",
                EVENTS_SILENT_FOR.as_secs()
            ),
        };
        if let Ok(data) = frame.into_data() {
            return Ok(Some(data));
        }
    }
}

/// 一条 SSE 消息：`event:` 那一行（没写是空串）和 `data:` 的那几行（几行之间换行连起来）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SseMessage {
    pub event: String,
    pub data: String,
}

/// 把 SSE 的字节流切成一条一条消息。
///
/// **按空行切，不按收到的那一块切** —— 一条消息可能被拆在两个 TCP 包里，按块处理会切出
/// 半个 JSON，然后每隔一阵就丢一条而且看不出原因。**也按字节切、切完再解码**：拆在两半
/// 中间的一个汉字，各自解码就成了两个替换符。
///
/// 只有注释（`: keep-alive` 这样的心跳）、什么字段都没有的不算一条。`\r\n` 的换行也认
#[derive(Default)]
pub(crate) struct SseFrames {
    buf: Vec<u8>,
}

impl SseFrames {
    /// 收进一块字节，交出这一块里凑齐了的消息，按先后
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Vec<SseMessage> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        let mut from = 0;
        while let Some((end, sep)) = frame_end(&self.buf[from..]) {
            if let Some(m) = sse_message(&self.buf[from..from + end]) {
                out.push(m);
            }
            from += end + sep;
        }
        self.buf.drain(..from);
        out
    }
}

/// 第一个空行在哪：它前面是一条消息，`.1` 是空行本身占几个字节
fn frame_end(buf: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i + 1 < buf.len() {
        match (buf[i], buf[i + 1]) {
            (b'\n', b'\n') => return Some((i, 2)),
            (b'\r', b'\n') if buf.get(i + 2..i + 4) == Some(b"\r\n") => return Some((i, 4)),
            _ => {}
        }
        i += 1;
    }
    None
}

/// 一条消息（不含结尾的空行）读成字段。冒号后面的一个空格可有可无，`:` 开头的是注释
fn sse_message(raw: &[u8]) -> Option<SseMessage> {
    let text = String::from_utf8_lossy(raw);
    let mut event = None;
    let mut data: Vec<&str> = Vec::new();
    for line in text.lines() {
        let line = line.strip_suffix('\r').unwrap_or(line);
        if line.starts_with(':') {
            continue;
        }
        let (field, value) = match line.split_once(':') {
            Some((f, v)) => (f, v.strip_prefix(' ').unwrap_or(v)),
            None => (line, ""),
        };
        match field {
            "event" => event = Some(value),
            "data" => data.push(value),
            _ => {}
        }
    }
    if event.is_none() && data.is_empty() {
        return None;
    }
    Some(SseMessage {
        event: event.unwrap_or_default().to_string(),
        data: data.join("\n"),
    })
}

/// 一个在跑的请求的实时内容（[`ControlClient::open_live`]）。
///
/// core 先把到目前为止有的补发一遍，再接着发新来的，`end` 之后关掉。[`LiveStream::next`]
/// 一条一条交出来；认不出的消息（新版 core 多出来的种类）跳过。
///
/// **丢掉它就断开**：连接的那个任务跟着它走（`Drop`），界面关了浮层、换了一条请求，core 那边
/// 的订阅随即结束，这一侧不留一个还在读的任务
pub struct LiveStream {
    resp: hyper::Response<hyper::body::Incoming>,
    /// 驱动这条连接的任务
    conn: tokio::task::JoinHandle<()>,
    frames: SseFrames,
    /// 切出来了、还没交出去的
    ready: std::collections::VecDeque<tw_api::LiveContent>,
    /// 交出过 `end`
    ended: bool,
}

impl Drop for LiveStream {
    fn drop(&mut self) {
        self.conn.abort();
    }
}

impl LiveStream {
    /// 在一条已经连上、握过手的流上发出订阅
    async fn open(stream: Box<dyn Stream>, id: u64) -> Result<Self> {
        let io = TokioIo::new(stream);
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        let conn = tokio::spawn(async move {
            if let Err(e) = conn.await {
                tracing::debug!("实时内容的连接结束：{e}");
            }
        });
        let id = id.to_string();
        let req = hyper::Request::builder()
            .uri(tw_api::fill(ep::RequestLive::PATH, &[("id", id.as_str())]))
            .header(hyper::header::HOST, "localhost")
            .header(hyper::header::ACCEPT, "text/event-stream")
            .body(String::new())?;
        let resp = sender.send_request(req).await?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.into_body().collect().await?.to_bytes();
            conn.abort();
            return Err(refused(status, &body));
        }
        Ok(Self {
            resp,
            conn,
            frames: SseFrames::default(),
            ready: Default::default(),
            ended: false,
        })
    }

    /// 下一条。交出 `end` 之后是 `None`。
    ///
    /// **没等到 `end` 流就断了是错误**（core 退了、连接断了、太久没有一个字节）：请求怎么
    /// 收的场这一侧不知道，调用方该去取一次存下的详情。界面上会显示这一句，原话进日志
    pub async fn next(&mut self) -> Result<Option<tw_api::LiveContent>> {
        let cut = |why: &dyn std::fmt::Display| {
            tracing::debug!("实时内容断了：{why}");
            anyhow::anyhow!(tr!(
                "连接在请求结束前中断",
                "The connection closed before the request ended"
            ))
        };
        loop {
            if let Some(c) = self.ready.pop_front() {
                self.ended |= matches!(c, tw_api::LiveContent::End(_));
                return Ok(Some(c));
            }
            if self.ended {
                return Ok(None);
            }
            let chunk = match silent_frame(&mut self.resp, "live content stream").await {
                Ok(Some(chunk)) => chunk,
                Ok(None) => return Err(cut(&"closed")),
                Err(e) => return Err(cut(&format!("{e:#}"))),
            };
            for m in self.frames.push(&chunk) {
                if let Some(c) = tw_api::LiveContent::parse(&m.event, &m.data) {
                    self.ready.push_back(c);
                }
            }
        }
    }
}

/// 连哪、拿哪把钥匙，取定了的一份（[`ControlClient::pin`]）。
///
/// **一个命令里接连问好几样时用它**：本机那一档每一问都要现读一遍 config.yaml、
/// 解析一遍 YAML 才拿得到钥匙，概览一次问九样就是九遍。取定一次，几样同时问。
/// 中途换了钥匙（`--rotate`）照样接得上：握手说钥匙不对就再读一次（见 [`local`]）。
///
/// **它不跟着切换连接走**：拿着它的那几问照旧问取定时的那个 core。一个命令的工夫里
/// 切了连接，界面本来就要整个重新取一遍
#[derive(Clone)]
pub struct Pinned(Resolved);

#[derive(Clone)]
enum Resolved {
    Local {
        at: tw_api::control::Address,
        config: std::path::PathBuf,
        key: tw_link::ControlKey,
    },
    Remote(crate::connection::connector::RemoteTarget),
}

impl Pinned {
    /// 连上控制面：建连，再握手。
    ///
    /// **连不上时只说 core 现在不在。**socket 的路径和「No such file or
    /// directory (os error 2)」是给写代码的人看的，而几乎每个命令在 core 不在
    /// 的时候回给界面的都是这一句。原话进日志
    async fn connect(&self) -> Result<Box<dyn Stream>> {
        match &self.0 {
            Resolved::Local { at, config, key } => local(at, config, key).await,
            // 远程那一档的建连和握手见 `connection::connector`
            Resolved::Remote(r) => crate::connection::connector::open(r)
                .await
                .map(|(stream, _)| stream)
                .map_err(anyhow::Error::new),
        }
    }

    /// 调一个端点，同 [`ControlClient::call`]
    pub async fn call<E: Endpoint>(&self, params: &[&str], req: &E::Req) -> Result<E::Res> {
        let (path, body) = request::<E>(params, req)?;
        decode::<E>(send(self.connect().await?, E::METHOD, &path, body).await?)
    }
}

/// 在一条已经连上、握过手的流上问一次 `/status`。
///
/// 试连远程时用（`connection::connector::test`）：**握手的那条连接接着问**，不再为这
/// 一问另连一遍、另握一遍手
pub(crate) async fn status_on(stream: Box<dyn Stream>) -> Result<tw_api::Status> {
    let (path, body) = request::<ep::Status>(&[], &())?;
    same_protocol(decode::<ep::Status>(
        send(stream, ep::Status::METHOD, &path, body).await?,
    )?)
}

/// 版本不匹配要明确提示「请升级客户端」，而不是以奇怪的方式失败。
/// 这里 UI 和 core 是一起打包的，理论上不该发生 ——
/// 但开发时会（一边改 core 一边跑旧 UI），而那正是最需要一句
/// 人话的时候。
fn same_protocol(s: tw_api::Status) -> Result<tw_api::Status> {
    if s.api_version != tw_api::CONTROL_API_VERSION {
        anyhow::bail!(tr!(
            format!(
                "控制面协议版本不一致：core 为 {}，界面为 {}。请重新构建。",
                s.api_version,
                tw_api::CONTROL_API_VERSION
            ),
            format!(
                "Control plane protocol versions differ: core uses {}, the interface uses {}. Rebuild the app.",
                s.api_version,
                tw_api::CONTROL_API_VERSION
            )
        ));
    }
    Ok(s)
}

/// 一个端点的请求：填好参数、拼上查询串的路径，和请求体（怎么填见
/// [`ControlClient::call`]）。
fn request<E: Endpoint>(params: &[&str], req: &E::Req) -> Result<(String, Option<String>)> {
    anyhow::ensure!(
        params.len() == E::PARAMS.len(),
        "{} takes {} path parameters, got {}",
        E::NAME,
        E::PARAMS.len(),
        params.len()
    );
    anyhow::ensure!(
        E::FORMAT != Format::Events,
        "{} is an event stream; use subscribe_events or open_live",
        E::NAME
    );
    let filled: Vec<(&str, &str)> = E::PARAMS
        .iter()
        .copied()
        .zip(params.iter().copied())
        .collect();
    let mut path = tw_api::fill(E::PATH, &filled);
    let req = serde_json::to_value(req)?;
    let mut body = None;
    if E::METHOD.query() {
        let q = query_string(&req)?;
        if !q.is_empty() {
            path.push('?');
            path.push_str(&q);
        }
    } else if !req.is_null() {
        body = Some(serde_json::to_string(&req)?);
    }
    Ok((path, body))
}

/// 成功的响应体按端点的格式解出来。
fn decode<E: Endpoint>(bytes: Vec<u8>) -> Result<E::Res> {
    Ok(match E::FORMAT {
        Format::Text => {
            serde_json::from_value(serde_json::Value::String(String::from_utf8(bytes)?))?
        }
        _ => serde_json::from_slice(&bytes)?,
    })
}

/// 在这条流上发出去，把成功的响应体整个读回来。非 2xx 是 [`Refused`]。
async fn send(
    stream: Box<dyn Stream>,
    method: tw_api::Method,
    path: &str,
    body: Option<String>,
) -> Result<Vec<u8>> {
    let io = TokioIo::new(stream);
    let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
    tokio::spawn(async move {
        if let Err(e) = conn.await {
            tracing::debug!("控制面连接结束：{e}");
        }
    });
    let mut req = hyper::Request::builder()
        .method(method.as_str())
        .uri(path)
        // unix socket 上没有真正的 host，但 HTTP/1.1 要求这个头存在
        .header(hyper::header::HOST, "localhost");
    if body.is_some() {
        req = req.header(hyper::header::CONTENT_TYPE, "application/json");
    }
    let resp = sender
        .send_request(req.body(body.unwrap_or_default())?)
        .await?;
    let status = resp.status();
    let bytes = resp.into_body().collect().await?.to_bytes();
    if !status.is_success() {
        return Err(refused(status, &bytes));
    }
    Ok(bytes.to_vec())
}

/// GET 和 DELETE 的请求拼成查询串。
///
/// 这些请求类型都是平的：字段是字符串、数字、布尔或者不带（`None` 不序列化，
/// 或者是 `null`）。别的形状在查询串里说不清，遇到就是 tw-api 那边的端点写错了。
fn query_string(req: &serde_json::Value) -> Result<String> {
    use serde_json::Value;
    let fields = match req {
        Value::Null => return Ok(String::new()),
        Value::Object(m) => m,
        other => anyhow::bail!("a query must be an object, not {other}"),
    };
    let mut out = Vec::new();
    for (k, v) in fields {
        let v = match v {
            Value::Null => continue,
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            Value::Bool(b) => b.to_string(),
            other => anyhow::bail!("query field `{k}` cannot be {other}"),
        };
        out.push(format!("{}={}", encode(k), encode(&v)));
    }
    Ok(out.join("&"))
}

/// 查询串里的一段。项目路径、名字里有空格和中文是常事。
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// 界面发出来的每一种补丁操作，这一层都要认得。
    ///
    /// **这条缝是真的裂过。**`tw-api` 是按 rev 锁在 core 的 main 上的，
    /// 而补丁协议加一种操作时，界面这边只是多写一个字符串 —— TypeScript
    /// 编译得过、Rust 编译也得过（没有哪一行提到那个新分支），只有用户
    /// 点下去的那一刻才失败。把 UI 发的原样 JSON 在这儿解一遍，锁没跟上
    /// 就是编译期的事，不是运行期的。
    #[test]
    fn every_patch_op_the_ui_sends_still_deserialises() {
        let raw = r#"[
            {"op":"replace","path":"/listen/gateway/bind","value":"all"},
            {"op":"replace","path":"/clients/demo/max_concurrent","value":3},
            {"op":"replace","path":"/clients/demo/route","value":null},
            {"op":"append","path":"/clients","item":"name: a\nkey: tw-x"},
            {"op":"remove","path":"/clients/a"},
            {"op":"clear","path":"/clients/demo/allow"}
        ]"#;
        let ops: Vec<tw_api::PatchOp> = serde_json::from_str(raw).expect("UI 发的 op 解不动");
        assert_eq!(ops.len(), 6);
    }

    /// 一份写着钥匙的配置。**钥匙是在的**：下面几条要测的是建连那一步，不是读钥匙。
    ///
    /// 放在一个测试结束（过了、没过）就删掉的临时目录里，拿着返回的第一项到测试结束
    fn key_file(name: &str) -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::Builder::new()
            .prefix(&format!("tw-key-{name}-"))
            .tempdir()
            .unwrap();
        let p = d.path().join("config.yaml");
        std::fs::write(
            &p,
            format!("listen:\n  control:\n    key: \"{}\"\n", "ab".repeat(32)),
        )
        .unwrap();
        (d, p)
    }

    /// 一个一定连不上的客户端：这个平台默认的那种传输，指向一个不存在的地方。
    /// 第二项是钥匙所在的临时目录，拿着它到测试结束
    fn unreachable() -> (ControlClient, tempfile::TempDir) {
        let (dir, key) = key_file("unreachable");
        let c = ControlClient::new(
            tw_api::control::Address::in_dir(Path::new("/tmp/tw-definitely-not-there-xyz")),
            key,
        );
        (c, dir)
    }

    /// 配置还没写出来（或者还没写进钥匙）：**和 socket 不在同一句话** —— core 起来时
    /// 才补上钥匙，那一小段里这是常态
    #[tokio::test]
    async fn no_key_yet_also_says_core_is_not_there() {
        let missing = ControlClient::new(
            tw_api::control::Address::in_dir(Path::new("/tmp/tw-definitely-not-there-xyz")),
            PathBuf::from("/tmp/tw-no-such-config-xyz.yaml"),
        );
        let msg = format!("{:#}", missing.status().await.unwrap_err());
        assert!(msg.contains("core"), "{msg}");
        assert!(!msg.contains("tw-no-such-config"), "{msg}");

        let dir = tempfile::Builder::new()
            .prefix("tw-key-nokey-")
            .tempdir()
            .unwrap();
        let p = dir.path().join("config.yaml");
        std::fs::write(&p, "listen:\n  gateway:\n    port: 1\n").unwrap();
        let no_key = ControlClient::new(
            tw_api::control::Address::in_dir(Path::new("/tmp/tw-definitely-not-there-xyz")),
            p.clone(),
        );
        let msg = format!("{:#}", no_key.status().await.unwrap_err());
        assert!(msg.contains("core"), "{msg}");
    }

    /// 连不上时说 core 不在，**不带地址和系统原话**：几乎每个命令在
    /// core 不在的时候回给界面的都是这一句
    #[tokio::test]
    async fn connecting_to_a_missing_socket_says_core_is_not_there() {
        let (c, _key) = unreachable();
        let msg = format!("{:#}", c.status().await.unwrap_err());
        assert!(msg.contains("core"), "{msg}");
        assert!(!msg.contains("os error"), "{msg}");
        assert!(!msg.contains("definitely-not-a-socket"), "{msg}");
    }

    /// 端口文件不在时，回环那一档说的是同一句话。
    ///
    /// **这条在 macOS 上也跑。**回环是 Windows 专用的传输，而一条只在一个
    /// 平台上被测到的错误处理等于没被测过 —— 何况它比 socket 那档多一步：
    /// 先要把端口读出来，而「文件还没写」正是刚把 core 拉起来那一小段的常态。
    #[tokio::test]
    async fn a_missing_port_file_also_says_core_is_not_there() {
        let (_key, key) = key_file("noport");
        let c = ControlClient::new(
            tw_api::control::Address::Loopback {
                port_file: PathBuf::from("/tmp/tw-no-such-port-file-xyz"),
            },
            key,
        );
        let msg = format!("{:#}", c.status().await.unwrap_err());
        assert!(msg.contains("core"), "{msg}");
        assert!(!msg.contains("os error"), "{msg}");
        assert!(!msg.contains("tw-no-such-port-file"), "{msg}");
    }

    /// 写了一半的端口文件也算「还没好」，不是一个要报给用户的错。
    #[tokio::test]
    async fn a_half_written_port_file_counts_as_not_ready() {
        let (dir, key) = key_file("halfport");
        let d = dir.path().join("control.port");
        std::fs::write(&d, "12").unwrap();
        let c = ControlClient::new(
            tw_api::control::Address::Loopback {
                port_file: d.clone(),
            },
            key,
        );
        // 12 是个能解析的端口号，但没人听 —— 连接失败，同一句话
        let msg = format!("{:#}", c.status().await.unwrap_err());
        assert!(msg.contains("core"), "{msg}");

        std::fs::write(&d, "不是数字").unwrap();
        let msg = format!("{:#}", c.status().await.unwrap_err());
        assert!(msg.contains("core"), "{msg}");
        assert!(
            !msg.contains("invalid digit"),
            "别把 parse 的原话给用户：{msg}"
        );
    }

    /// 同一句话按界面语言说
    #[test]
    fn the_unreachable_message_follows_the_interface_language() {
        use crate::i18n::{Lang, with_lang};
        let (c, _key) = unreachable();
        // 跑在当前线程上：`with_lang` 只改这一个线程看到的语言
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let said = |lang| {
            with_lang(lang, || {
                format!("{:#}", rt.block_on(c.status()).unwrap_err())
            })
        };
        assert_eq!(
            said(Lang::En),
            "core is not running, or has not finished starting"
        );
        assert_eq!(said(Lang::Zh), "core 未在运行，或尚未启动完成");
    }

    /// GET 的请求变成查询串：没带的字段不出现，值做百分号编码，`()` 什么都不拼。
    #[test]
    fn a_query_is_flat_and_leaves_out_what_is_not_there() {
        let q = query_string(
            &serde_json::to_value(tw_api::SecurityEventsQuery {
                guard: Some(tw_api::Guard::InspectTools),
                from_ms: Some(5),
                to_ms: None,
                before: None,
                limit: Some(3),
            })
            .unwrap(),
        )
        .unwrap();
        let mut parts: Vec<&str> = q.split('&').collect();
        parts.sort_unstable();
        assert_eq!(parts, ["from_ms=5", "guard=inspect_tools", "limit=3"]);
        // 协议里的查询字段现在都是数字和枚举，编码拿一个手写的值来验
        assert_eq!(
            query_string(&serde_json::json!({ "q": "a b/中" })).unwrap(),
            "q=a%20b%2F%E4%B8%AD"
        );
        assert_eq!(
            query_string(&serde_json::to_value(()).unwrap()).unwrap(),
            ""
        );
        let dim = query_string(
            &serde_json::to_value(tw_api::GroupQuery {
                from_ms: None,
                to_ms: None,
                dim: tw_api::CostDim::Client,
            })
            .unwrap(),
        )
        .unwrap();
        assert_eq!(dim, "dim=client");
    }

    #[test]
    fn sse_framing_splits_on_blank_lines_not_chunks() {
        // 一个事件可能被拆在两个 TCP 包里。按 chunk 处理会切出半个 JSON，
        // 然后每隔一阵丢一条事件而且看不出原因。事件流和实时内容用的是同一个分帧
        let mut frames = SseFrames::default();
        let mut got = Vec::new();
        for chunk in [
            "data: {\"kind\":\"request_",
            "started\",\"id\":1,\"client\":\"c\",\"route\":\"default\",\"rule\":\"catch-all\",\"rewritten_by\":[],\"provider\":\"p\",\"billing\":\"per-token\",\"model\":\"m\",\"method\":\"POST\",\"path\":\"/x\",\"at_ms\":0}\n\n",
        ] {
            for m in frames.push(chunk.as_bytes()) {
                if let Ok(ev) = serde_json::from_str::<tw_api::Event>(&m.data) {
                    got.push(ev);
                }
            }
        }
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id(), 1);
    }

    /// 实时内容的分帧：名字和数据各归各的，心跳不算一条，`\r\n` 也认，一个汉字拆在两块
    /// 中间也拼得回来
    #[test]
    fn sse_messages_keep_their_event_name_and_skip_heartbeats() {
        let mut frames = SseFrames::default();
        let whole = "event: head\ndata: {\"a\":1}\n\n: keep-alive\n\nevent: body\r\ndata: 第一行\r\ndata:第二行\r\n\r\nevent: end\ndata: {}\n\n";
        let bytes = whole.as_bytes();
        // 切在「第」字的第二个字节上
        let cut = whole.find("第").unwrap() + 1;
        let mut got = frames.push(&bytes[..cut]);
        assert_eq!(got.len(), 1, "{got:?}");
        got.extend(frames.push(&bytes[cut..]));
        assert_eq!(
            got,
            [
                SseMessage {
                    event: "head".into(),
                    data: "{\"a\":1}".into()
                },
                SseMessage {
                    event: "body".into(),
                    data: "第一行\n第二行".into()
                },
                SseMessage {
                    event: "end".into(),
                    data: "{}".into()
                },
            ]
        );
        assert!(frames.push(b"").is_empty());
    }

    /// 一个假的控制面：握手照 core 那样做，然后对第一个请求原样写回 `answer` 的那几段
    /// （每段之间停一下，让它们分在不同的包里）。回环那一档，每个平台上都跑。
    ///
    /// 返回连它的客户端、收到的请求行，和放钥匙的临时目录（拿着它到测试结束）
    async fn fake_core(
        answer: Vec<Vec<u8>>,
    ) -> (
        ControlClient,
        tokio::sync::oneshot::Receiver<String>,
        tempfile::TempDir,
    ) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let (dir, config) = key_file("live");
        let key = tw_link::read_key(&config).unwrap();
        let port_file = dir.path().join("control.port");
        let l = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        std::fs::write(&port_file, l.local_addr().unwrap().port().to_string()).unwrap();
        let (line_tx, line_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            let (tcp, _) = l.accept().await.unwrap();
            let acceptor = tw_link::Acceptor::new(move || Some(key.clone()), "test");
            let mut s = acceptor.accept(tcp).await.unwrap().stream;
            let mut req = Vec::new();
            let mut buf = [0u8; 1024];
            while !req.windows(4).any(|w| w == b"\r\n\r\n") {
                let n = s.read(&mut buf).await.unwrap();
                assert!(n > 0, "请求没写完连接就关了");
                req.extend_from_slice(&buf[..n]);
            }
            let text = String::from_utf8_lossy(&req).into_owned();
            let _ = line_tx.send(text.lines().next().unwrap_or_default().to_string());
            for part in answer {
                s.write_all(&part).await.unwrap();
                s.flush().await.unwrap();
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
            let _ = s.shutdown().await;
        });
        let client = ControlClient::new(tw_api::control::Address::Loopback { port_file }, config);
        (client, line_rx, dir)
    }

    /// SSE 的响应头：不写长度，连接关掉就是结束
    const SSE_HEAD: &str =
        "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n";

    /// 实时内容一条一条读出来：补发的和后来的都在，心跳不算，一条消息拆在两个包里、一个汉字
    /// 拆在两半中间也拼得回来，`end` 之后没有了
    #[tokio::test]
    async fn live_content_is_read_message_by_message_until_end() {
        let body = "event: body\ndata: {\"side\":\"client\",\"dir\":\"response\",\"attempt\":0,\"text\":\"你好\",\"truncated\":false}\n\n";
        let split = body.find("你").unwrap() + 2;
        let (client, line, _dir) = fake_core(vec![
            SSE_HEAD.into(),
            "event: head\ndata: {\"side\":\"client\",\"dir\":\"request\",\"attempt\":0,\"line\":\"POST /v1/messages HTTP/1.1\",\"headers\":[[\"x-api-key\",\"tw-ab…cd\"]]}\n\n: keep-alive\n\n".into(),
            body.as_bytes()[..split].to_vec(),
            body.as_bytes()[split..].to_vec(),
            "event: end\ndata: {\"status\":200,\"outcome\":\"finished\"}\n\n".into(),
        ])
        .await;
        let mut live = client.open_live(42).await.unwrap();
        assert_eq!(line.await.unwrap(), "GET /request/42/live HTTP/1.1");

        let Some(tw_api::LiveContent::Head(h)) = live.next().await.unwrap() else {
            panic!("第一条应当是报文头");
        };
        assert_eq!(h.line, "POST /v1/messages HTTP/1.1");
        assert_eq!(
            h.headers,
            vec![("x-api-key".to_string(), "tw-ab…cd".to_string())]
        );
        let Some(tw_api::LiveContent::Body(b)) = live.next().await.unwrap() else {
            panic!("第二条应当是正文");
        };
        assert_eq!(b.text, "你好");
        assert_eq!(b.dir, tw_api::WireDir::Response);
        let Some(tw_api::LiveContent::End(e)) = live.next().await.unwrap() else {
            panic!("最后一条应当是 end");
        };
        assert_eq!(e.status, Some(200));
        assert_eq!(e.outcome, tw_api::LiveOutcome::Finished);
        assert!(live.next().await.unwrap().is_none());
    }

    /// 请求已经结束：core 的 404 原样是一条带码的拒绝，界面按码去取存下的
    #[tokio::test]
    async fn a_request_that_is_not_running_is_refused_with_its_code() {
        let body = r#"{"code":"control.request_not_running","args":{"id":"7"},"text":"Request #7 is not running."}"#;
        let (client, _line, _dir) = fake_core(vec![format!(
            "HTTP/1.1 404 Not Found\r\ncontent-type: application/json\r\ncontent-length: {}\r\n\r\n{body}",
            body.len()
        ).into_bytes()])
        .await;
        let Err(e) = client.open_live(7).await else {
            panic!("应当被拒绝");
        };
        let Some(Refused(m)) = e.downcast_ref::<Refused>() else {
            panic!("应当是一条带码的拒绝：{e:#}");
        };
        assert_eq!(m.code, "control.request_not_running");
    }

    /// 没等到 `end` 流就断了：是错误，不是正常结束 —— 结局这一侧不知道
    #[tokio::test]
    async fn a_stream_that_closes_before_end_is_an_error() {
        let (client, _line, _dir) = fake_core(vec![
            SSE_HEAD.into(),
            "event: body\ndata: {\"side\":\"client\",\"dir\":\"response\",\"attempt\":0,\"text\":\"半\",\"truncated\":false}\n\n".into(),
        ])
        .await;
        let mut live = client.open_live(9).await.unwrap();
        assert!(matches!(
            live.next().await.unwrap(),
            Some(tw_api::LiveContent::Body(_))
        ));
        assert!(live.next().await.is_err());
    }
}
