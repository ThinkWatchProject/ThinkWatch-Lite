//! 控制面客户端：和 core 说话。
//!
//! **传输按平台分。**macOS 上是一个 `0700` 的 unix socket，那里权限是文件
//! 系统给的；Windows 上没有对等物，控制面落在回环端口上，而本机任意进程都
//! 连得上一个回环端口。
//!
//! **凭据两边都带。**回环那一侧它是唯一的门，而只在一个平台上生效的防线没
//! 人日常测 —— 两条路走同一份代码，才不会有一半从来没被跑过。凭据怎么来的
//! 见 `crate::token`。
//!
//! **端点只有一个入口：[`ControlClient::call`]。**方法、路径、请求和响应的类型
//! 都来自 `tw_api::ep` 里那一行声明，这里不再为每个端点各写一个方法 —— 以前
//! 那样写，路径是字符串、查询串是手拼的，拼错的表现是运行时的 400。

use std::path::Path;

use anyhow::Result;
use http_body_util::BodyExt;
use hyper_util::rt::TokioIo;
use tw_api::{Endpoint, Format, ep};

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
    /// 本机的 core：数据目录里的 socket（Windows 上是回环端口），凭据是这一次启动生成的
    Local {
        at: tw_api::control::Address,
        /// 这一次启动的凭据，见 `crate::token`。
        token: String,
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
    pub fn new(at: tw_api::control::Address, token: String) -> Self {
        Self::to(Target::Local { at, token })
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

    /// 连的是不是别的机器
    pub fn is_remote(&self) -> bool {
        matches!(*self.target.read().expect("锁未中毒"), Target::Remote(_))
    }

    /// 换地方的通知
    pub fn moved(&self) -> tokio::sync::watch::Receiver<u64> {
        self.moved.subscribe()
    }

    fn target(&self) -> Target {
        self.target.read().expect("锁未中毒").clone()
    }

    /// 连上控制面。
    ///
    /// **连不上时只说 core 现在不在。**socket 的路径和「No such file or
    /// directory (os error 2)」是给写代码的人看的，而几乎每个命令在 core 不在
    /// 的时候回给界面的都是这一句。原话进日志
    async fn connect(&self) -> Result<Box<dyn Stream>> {
        use tw_api::control::Address;
        let not_running = |e: &dyn std::fmt::Display| {
            tracing::debug!("控制面连不上：{e}");
            anyhow::anyhow!(tr!(
                "core 未在运行，或尚未启动完成",
                "core is not running, or has not finished starting"
            ))
        };
        let at = match self.target() {
            Target::Local { at, .. } => at,
            // **远程那一档的门由握手把守**，见 `connection::connector`
            Target::Remote(r) => {
                return crate::connection::connector::open(&r)
                    .await
                    .map(|(stream, _)| stream)
                    .map_err(anyhow::Error::new);
            }
        };
        match &at {
            #[cfg(unix)]
            Address::Socket(path) => Ok(Box::new(
                tokio::net::UnixStream::connect(path)
                    .await
                    .map_err(|e| not_running(&e))?,
            )),
            #[cfg(not(unix))]
            Address::Socket(_) => Err(not_running(&"这个平台上没有 unix socket")),
            Address::Loopback { port_file } => {
                let port = read_port(port_file).map_err(|e| not_running(&e))?;
                Ok(Box::new(
                    tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
                        .await
                        .map_err(|e| not_running(&e))?,
                ))
            }
        }
    }

    /// 每个请求都带上的那个头。**远程连接不带**：那边进门靠的是握手，不是这个头
    fn auth(&self) -> String {
        match self.target() {
            Target::Local { token, .. } => format!("Bearer {token}"),
            Target::Remote(_) => String::new(),
        }
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
    pub async fn call<E: Endpoint>(&self, params: &[&str], req: &E::Req) -> Result<E::Res> {
        anyhow::ensure!(
            params.len() == E::PARAMS.len(),
            "{} takes {} path parameters, got {}",
            E::NAME,
            E::PARAMS.len(),
            params.len()
        );
        anyhow::ensure!(
            E::FORMAT != Format::Events,
            "{} is an event stream; use subscribe_events",
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
        let bytes = self.send(E::METHOD, &path, body).await?;
        Ok(match E::FORMAT {
            Format::Text => {
                serde_json::from_value(serde_json::Value::String(String::from_utf8(bytes)?))?
            }
            _ => serde_json::from_slice(&bytes)?,
        })
    }

    /// 发出去，把成功的响应体整个读回来。非 2xx 是 [`Refused`]。
    async fn send(
        &self,
        method: tw_api::Method,
        path: &str,
        body: Option<String>,
    ) -> Result<Vec<u8>> {
        let stream = self.connect().await?;
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
            .header(hyper::header::HOST, "localhost")
            // **读写都带凭据。**写请求的那一处曾经漏了：读的请求都带着，于是
            // 界面一切正常地显示，而每一次保存、新建、接管都被控制面拒掉 ——
            // 两个平台都是。见 tests/control_plane.rs 里走写请求的那一条
            .header(hyper::header::AUTHORIZATION, self.auth());
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
        let s = self.call::<ep::Status>(&[], &()).await?;
        // 版本不匹配要明确提示「请升级客户端」，而不是以奇怪的方式失败。
        // 这里 UI 和 core 是一起打包的，理论上不该发生 ——
        // 但开发时会（一边改 core 一边跑旧 UI），而那正是最需要一句
        // 人话的时候。
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
            .header(hyper::header::AUTHORIZATION, self.auth())
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

        let mut buf = String::new();
        while let Some(frame) = resp.frame().await {
            let frame = frame?;
            let Some(chunk) = frame.data_ref() else {
                continue;
            };
            buf.push_str(&String::from_utf8_lossy(chunk));
            // SSE 的事件以空行分隔。**必须按空行切而不是按 chunk 切** ——
            // 一个事件可能被拆在两个 TCP 包里，按 chunk 处理会切出半个
            // JSON，然后每隔一阵就丢一条事件而且看不出原因。
            while let Some(idx) = buf.find("\n\n") {
                let raw = buf[..idx].to_string();
                buf.drain(..idx + 2);
                for line in raw.lines() {
                    if let Some(data) = line.strip_prefix("data:")
                        && let Ok(ev) = serde_json::from_str::<tw_api::Event>(data.trim())
                    {
                        on_event(ev);
                    }
                }
            }
        }
        Ok(())
    }
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

    /// 一个一定连不上的客户端：这个平台默认的那种传输，指向一个不存在的地方。
    fn unreachable() -> ControlClient {
        ControlClient::new(
            tw_api::control::Address::in_dir(Path::new("/tmp/tw-definitely-not-there-xyz")),
            "t".into(),
        )
    }

    /// 连不上时说 core 不在，**不带地址和系统原话**：几乎每个命令在
    /// core 不在的时候回给界面的都是这一句
    #[tokio::test]
    async fn connecting_to_a_missing_socket_says_core_is_not_there() {
        let c = unreachable();
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
        let c = ControlClient::new(
            tw_api::control::Address::Loopback {
                port_file: PathBuf::from("/tmp/tw-no-such-port-file-xyz"),
            },
            "t".into(),
        );
        let msg = format!("{:#}", c.status().await.unwrap_err());
        assert!(msg.contains("core"), "{msg}");
        assert!(!msg.contains("os error"), "{msg}");
        assert!(!msg.contains("tw-no-such-port-file"), "{msg}");
    }

    /// 写了一半的端口文件也算「还没好」，不是一个要报给用户的错。
    #[tokio::test]
    async fn a_half_written_port_file_counts_as_not_ready() {
        let d = std::env::temp_dir().join(format!("tw-port-{}", std::process::id()));
        std::fs::write(&d, "12").unwrap();
        let c = ControlClient::new(
            tw_api::control::Address::Loopback {
                port_file: d.clone(),
            },
            "t".into(),
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
        let _ = std::fs::remove_file(&d);
    }

    /// 同一句话按界面语言说
    #[test]
    fn the_unreachable_message_follows_the_interface_language() {
        use crate::i18n::{Lang, with_lang};
        let c = unreachable();
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
        // 然后每隔一阵丢一条事件而且看不出原因。这里把那个分帧逻辑单独
        // 验一遍。
        let mut buf = String::new();
        let mut got = Vec::new();
        for chunk in [
            "data: {\"kind\":\"request_",
            "started\",\"id\":1,\"client\":\"c\",\"provider\":\"p\",\"billing\":\"per-token\",\"model\":\"m\",\"method\":\"POST\",\"path\":\"/x\",\"at_ms\":0}\n\n",
        ] {
            buf.push_str(chunk);
            while let Some(idx) = buf.find("\n\n") {
                let raw = buf[..idx].to_string();
                buf.drain(..idx + 2);
                for line in raw.lines() {
                    if let Some(d) = line.strip_prefix("data:")
                        && let Ok(ev) = serde_json::from_str::<tw_api::Event>(d.trim())
                    {
                        got.push(ev);
                    }
                }
            }
        }
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id(), 1);
    }
}
