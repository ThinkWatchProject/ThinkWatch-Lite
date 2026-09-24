//! 连上一个 core：本机的，或者另一台机器上的。
//!
//! **切换之前先试连**，试连和真正连上走的是同一个函数（[`test`]），所以「试的时候
//! 通了、切过去却连不上」只可能是这中间对面变了，不会是两段代码各说各的。
//!
//! 失败分五种说（[`ConnectError`]），每一种界面上都给出下一步：地址不通、被对面
//! 关掉、密钥不对、版本不一致、超时。
//!
//! # 远程那一档还没接上（P2）
//!
//! 远程控制面的握手（Noise，密钥来自服务器的 `listen.control.key`）由 core 的
//! `tw-link` 提供，还没发版。这里先把 TCP 连上 —— 地址不通和超时现在就能如实说 ——
//! 握手那一步集中在 [`handshake`] 一个函数里，眼下一律回 [`ConnectError::NotYetAvailable`]。
//! 接上 P2 时只改它（和删掉那一种错误）。

use std::time::Duration;

use tokio::io::{AsyncRead, AsyncWrite};

use crate::control::{ControlClient, Stream, Target};

/// 远程的 core 在哪、拿什么进门。**密钥只在内存里**：存盘在 `secrets` 那个只有自己
/// 能读的文件里，不进连接列表，也不交给界面
#[derive(Clone)]
pub struct RemoteTarget {
    pub host: String,
    pub port: u16,
    /// 服务器上 `twcore control-key` 给的那 64 位十六进制
    pub key: String,
}

impl RemoteTarget {
    /// `host:port`。IPv6 字面量加方括号
    pub fn addr(&self) -> String {
        display_addr(&self.host, self.port)
    }
}

impl std::fmt::Debug for RemoteTarget {
    /// **不打印密钥**：日志里出现的只有地址
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "RemoteTarget({})", self.addr())
    }
}

pub fn display_addr(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

/// 连上之后知道的：对面是哪一版 core，客户端该连它的哪个网关地址
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ServerInfo {
    pub core_version: String,
    /// 服务器的网关地址（安全模式下没有）。远程时侧栏上显示的就是它 —— 客户端要连的那个
    pub gateway_addr: Option<String>,
}

/// 连不上的原因。**界面按种类说话**（文案在前端的 `connection.i18n.tsx`），这里只
/// 带事实：地址、两个版本号
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConnectError {
    /// 地址不通：解析不出来、对面拒绝连接、网络不可达
    Unreachable { addr: String },
    /// TCP 连上了，对面一个字节不回就关掉。**多半是不在允许列表里**：core 对
    /// `allow_from` 之外的地址 accept 之后直接关，不向扫描者暴露自己是什么
    Closed { addr: String },
    /// 握手解不开：密钥和服务器的不一样
    WrongKey,
    /// 握手通过了，两边的控制面版本不一样。`ours` 是这一版应用配的 core
    VersionMismatch { ours: String, theirs: String },
    /// 在限定时间内没连上，或者握手没走完
    Timeout { addr: String },
    /// 这一版应用还不会远程握手。**P2 接上握手时删掉这一种**
    NotYetAvailable,
}

/// 一句话。**界面不用它**（界面按种类说，带下一步）；它给的是经控制面客户端冒出来、
/// 落进日志和个别错误提示里的那一句
impl std::fmt::Display for ConnectError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ConnectError::Unreachable { addr } => {
                tr!(
                    format!("无法连接到 {addr}"),
                    format!("Cannot connect to {addr}")
                )
            }
            ConnectError::Closed { addr } => tr!(
                format!("{addr} 关闭了连接"),
                format!("{addr} closed the connection")
            ),
            ConnectError::WrongKey => tr!("密钥不正确", "The key is not correct").into(),
            ConnectError::VersionMismatch { ours, theirs } => tr!(
                format!("版本不一致：服务器 core {theirs}，本应用需要 {ours}"),
                format!("Version mismatch: the server runs core {theirs}; this app needs {ours}")
            ),
            ConnectError::Timeout { addr } => tr!(
                format!("连接 {addr} 超时"),
                format!("Connecting to {addr} timed out")
            ),
            ConnectError::NotYetAvailable => tr!(
                "此版本尚不支持连接远程 core",
                "This version cannot connect to a remote core yet"
            )
            .into(),
        };
        f.write_str(&s)
    }
}

impl std::error::Error for ConnectError {}

/// 这一版应用配的是哪一版 core。**来自 `Cargo.lock` 里 tw-api 锁的 tag**，见 build.rs
pub const REQUIRED_CORE: &str = env!("TW_CORE_TAG");

/// 连一次 TCP、握手，最多等这么久
const CONNECT_WITHIN: Duration = Duration::from_secs(5);
/// 本机那一档问一次 `/status` 最多等多久
const LOCAL_WITHIN: Duration = Duration::from_secs(3);

/// 握手的结果：对面说自己是哪一版
#[derive(Debug, Clone)]
pub struct Handshake {
    pub core_version: String,
}

/// 试连：连上、握手、问一次 `/status`。**切换之前、启动时、断线重连都走它。**
pub async fn test(target: &Target) -> Result<ServerInfo, ConnectError> {
    match target {
        Target::Local { .. } => {
            let c = ControlClient::to(target.clone());
            let s = tokio::time::timeout(LOCAL_WITHIN, c.status())
                .await
                .map_err(|_| ConnectError::Timeout {
                    addr: tr!("本机", "This Mac").into(),
                })?
                .map_err(|_| ConnectError::Unreachable {
                    addr: tr!("本机", "This Mac").into(),
                })?;
            Ok(ServerInfo {
                core_version: s.version,
                gateway_addr: s.gateway_addr,
            })
        }
        Target::Remote(r) => {
            let (_, hello) = open(r).await?;
            // 握手过了，剩下的是一次普通的控制面请求。**失败按「连接被关闭」说**：
            // 握手刚通过就断，是对面在这一瞬间没了
            let s = ControlClient::to(target.clone())
                .status()
                .await
                .map_err(|_| ConnectError::Closed { addr: r.addr() })?;
            Ok(ServerInfo {
                core_version: if s.version.is_empty() {
                    hello.core_version
                } else {
                    s.version
                },
                gateway_addr: s.gateway_addr,
            })
        }
    }
}

/// 打开一条到远程控制面的流：TCP 连上，再握手。控制面客户端每个请求都走它
pub(crate) async fn open(r: &RemoteTarget) -> Result<(Box<dyn Stream>, Handshake), ConnectError> {
    let addr = r.addr();
    let tcp = tokio::time::timeout(
        CONNECT_WITHIN,
        tokio::net::TcpStream::connect((r.host.trim_matches(['[', ']']), r.port)),
    )
    .await
    .map_err(|_| ConnectError::Timeout { addr: addr.clone() })?
    .map_err(|e| {
        tracing::debug!("连不上 {addr}：{e}");
        match e.kind() {
            std::io::ErrorKind::TimedOut => ConnectError::Timeout { addr: addr.clone() },
            _ => ConnectError::Unreachable { addr: addr.clone() },
        }
    })?;
    let _ = tcp.set_nodelay(true);
    tokio::time::timeout(CONNECT_WITHIN, handshake(tcp, &r.key, &addr))
        .await
        .map_err(|_| ConnectError::Timeout { addr })?
}

/// **P2 在这里接上握手。**
///
/// 要做的：用 `tw-link` 的 Noise 握手（`Noise_NNpsk0_25519_ChaChaPoly_BLAKE2s`，PSK 是
/// `key` 的 32 字节）把 `io` 包成加密的流，第一条消息带上应用的控制面版本和应用版本；
/// 按对面第二条消息的结果返回：
///
/// - 解不开、收到明文拒绝字节 → [`ConnectError::WrongKey`]
/// - `accept=false`（版本不一致）→ [`ConnectError::VersionMismatch`]，`ours` 用
///   [`REQUIRED_CORE`]，`theirs` 用对面报的 core 版本
/// - 对面一个字节不回就关掉 → [`ConnectError::Closed`]
///
/// 返回的流交给 hyper 跑 HTTP/1.1，事件流（SSE）也走它。
async fn handshake<S>(
    io: S,
    key: &str,
    addr: &str,
) -> Result<(Box<dyn Stream>, Handshake), ConnectError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let _ = (io, key);
    tracing::debug!("{addr}：TCP 已连上，这一版还不会远程握手");
    Err(ConnectError::NotYetAvailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipv6_addresses_get_brackets() {
        assert_eq!(display_addr("192.168.1.20", 8789), "192.168.1.20:8789");
        assert_eq!(display_addr("::1", 8789), "[::1]:8789");
        assert_eq!(display_addr("[::1]", 8789), "[::1]:8789");
        assert_eq!(display_addr("nas.local", 1), "nas.local:1");
    }

    /// 日志里不能出现密钥
    #[test]
    fn debug_output_leaves_the_key_out() {
        let r = RemoteTarget {
            host: "h".into(),
            port: 1,
            key: "secret-secret".into(),
        };
        assert!(!format!("{r:?}").contains("secret"));
    }

    #[test]
    fn the_required_core_is_the_locked_tag() {
        assert!(!REQUIRED_CORE.is_empty());
        assert!(!REQUIRED_CORE.starts_with('v'), "{REQUIRED_CORE}");
    }

    /// 错误按种类交给界面，字段是事实不是句子
    #[test]
    fn errors_go_out_tagged_by_kind() {
        let v = serde_json::to_value(ConnectError::VersionMismatch {
            ours: "0.48.0".into(),
            theirs: "0.47.2".into(),
        })
        .unwrap();
        assert_eq!(v["kind"], "version_mismatch");
        assert_eq!(v["theirs"], "0.47.2");
        assert_eq!(
            serde_json::to_value(ConnectError::WrongKey).unwrap()["kind"],
            "wrong_key"
        );
    }

    /// 没人听的端口：说地址不通（或者超时），**不会卡住**
    #[tokio::test]
    async fn a_port_nobody_listens_on_is_unreachable() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let r = RemoteTarget {
            host: "127.0.0.1".into(),
            port,
            key: "k".into(),
        };
        let e = test(&Target::Remote(r)).await.unwrap_err();
        assert!(
            matches!(
                e,
                ConnectError::Unreachable { .. } | ConnectError::Timeout { .. }
            ),
            "{e:?}"
        );
    }

    /// 有人听、握手还没接上：说「这一版还不支持」，不是别的
    #[tokio::test]
    async fn a_listening_port_reaches_the_handshake_seam() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let _ = l.accept().await;
        });
        let r = RemoteTarget {
            host: "127.0.0.1".into(),
            port,
            key: "k".into(),
        };
        assert_eq!(
            test(&Target::Remote(r)).await.unwrap_err(),
            ConnectError::NotYetAvailable
        );
    }
}
