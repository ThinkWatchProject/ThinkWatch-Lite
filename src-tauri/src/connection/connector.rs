//! 连上一个 core：本机的，或者另一台机器上的。
//!
//! **切换之前先试连**，试连和真正连上走的是同一个函数（[`test`]），所以「试的时候
//! 通了、切过去却连不上」只可能是这中间对面变了，不会是两段代码各说各的。
//!
//! 失败分五种说（[`ConnectError`]），每一种界面上都给出下一步：地址不通、被对面
//! 关掉、密钥不对、版本不一致、超时。
//!
//! 远程这一档：TCP 连上服务器的远程控制端口，再做和本机同一套握手（`tw-link`，
//! Noise NNpsk0，钥匙是服务器上 `twcore control-key` 给的那一把）。版本在握手里就
//! 对过了，所以对不上时在任何 HTTP 请求之前就能说出两个确切的版本号。

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

/// 应用自己的版本，握手时报给 core（只进它的日志）
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

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

/// 握手：把 `io` 包成加密的流，顺带问到对面是哪一版 core。
///
/// 失败按 [`ConnectError`] 的几种说：解不开、收到拒绝字节 → 钥匙不对；版本对不上
/// → 两个版本号（`ours` 是这一版应用配的 core，`theirs` 是服务器的 core 自己报的
/// 版本）；一个字节不回就关 → 被关闭。钥匙本身写得不对（钥匙串里那一串不是 64 位
/// 十六进制）也按钥匙不对说：结果一样，去服务器上重新抄一遍
async fn handshake<S>(
    io: S,
    key: &str,
    addr: &str,
) -> Result<(Box<dyn Stream>, Handshake), ConnectError>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let key = tw_link::ControlKey::parse(key).map_err(|_| ConnectError::WrongKey)?;
    let (secure, hello) = tw_link::connect(io, &key, APP_VERSION)
        .await
        .map_err(|e| link_error(e, addr))?;
    Ok((
        Box::new(secure),
        Handshake {
            core_version: hello.core,
        },
    ))
}

/// `tw-link` 的失败对到界面的几种说法
fn link_error(e: tw_link::LinkError, addr: &str) -> ConnectError {
    use tw_link::LinkError;
    tracing::debug!("{addr}：握手没过：{e}");
    let addr = addr.to_string();
    match e {
        LinkError::Unreachable(_) => ConnectError::Unreachable { addr },
        LinkError::WrongKey => ConnectError::WrongKey,
        LinkError::VersionMismatch { peer_version, .. } => ConnectError::VersionMismatch {
            ours: REQUIRED_CORE.to_string(),
            theirs: peer_version,
        },
        LinkError::Timeout => ConnectError::Timeout { addr },
        // 握手中途断了、或者对面说的不是这套协议：都是「被关掉了」
        LinkError::Closed | LinkError::Io(_) => ConnectError::Closed { addr },
    }
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

    fn key() -> String {
        "ab".repeat(32)
    }

    /// 一个只会握手的「core」：用 `server_key` 那一把，自称 9.9.9，握手之后什么都不做
    async fn fake_core(server_key: String) -> u16 {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            let key = tw_link::ControlKey::parse(&server_key).unwrap();
            let acceptor = tw_link::Acceptor::new(move || Some(key.clone()), "9.9.9");
            while let Ok((s, _)) = l.accept().await {
                let _ = acceptor.accept(s).await;
            }
        });
        port
    }

    fn at(port: u16, key: String) -> Target {
        Target::Remote(RemoteTarget {
            host: "127.0.0.1".into(),
            port,
            key,
        })
    }

    /// 对面一个字节不回就关：被关闭（不在允许列表里时就是这样）
    #[tokio::test]
    async fn a_server_that_hangs_up_is_closed() {
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = l.local_addr().unwrap().port();
        tokio::spawn(async move {
            while let Ok((s, _)) = l.accept().await {
                drop(s);
            }
        });
        let e = test(&at(port, key())).await.unwrap_err();
        assert!(matches!(e, ConnectError::Closed { .. }), "{e:?}");
    }

    #[tokio::test]
    async fn another_key_is_the_wrong_key() {
        let port = fake_core("cd".repeat(32)).await;
        assert_eq!(
            test(&at(port, key())).await.unwrap_err(),
            ConnectError::WrongKey
        );
        // 钥匙串里那一串压根不是一把钥匙，说的也是这一句
        assert_eq!(
            test(&at(port, "short".into())).await.unwrap_err(),
            ConnectError::WrongKey
        );
    }

    /// 同一把钥匙：握手通过，问到服务器 core 自己报的版本
    #[tokio::test]
    async fn the_same_key_gets_through_and_learns_the_core_version() {
        let port = fake_core(key()).await;
        let r = RemoteTarget {
            host: "127.0.0.1".into(),
            port,
            key: key(),
        };
        let (_, hello) = open(&r).await.unwrap();
        assert_eq!(hello.core_version, "9.9.9");
    }

    /// 版本不一致：说出服务器 core 自己报的版本和这一版应用要的版本
    #[test]
    fn a_version_mismatch_names_both_versions() {
        let e = link_error(
            tw_link::LinkError::VersionMismatch {
                ours: 18,
                theirs: 17,
                peer_version: "0.47.2".into(),
            },
            "h:1",
        );
        assert_eq!(
            e,
            ConnectError::VersionMismatch {
                ours: REQUIRED_CORE.to_string(),
                theirs: "0.47.2".into(),
            }
        );
        assert_eq!(
            link_error(tw_link::LinkError::Timeout, "h:1"),
            ConnectError::Timeout { addr: "h:1".into() }
        );
    }
}
