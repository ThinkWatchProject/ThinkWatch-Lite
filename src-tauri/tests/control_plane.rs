//! 起一个真的 core，真连上去。
//!
//! # 为什么这条不能只靠单元测试
//!
//! 单元测试能证明「连不上时说的是哪句话」，证明不了**连得上**。而这一侧新加的
//! 那几样 —— 凭据从哪儿来、怎么交给 core、每个请求带不带得对、控制面的地址由
//! 谁说了算 —— 只有在两个真进程之间才成立或者不成立。
//!
//! 它接的是包里那一份 `resources/twcore`，也就是**发出去的包里装的那一个**。
//! 换句话说这条测试同时在问：桌面端钉的这一版 core，和桌面端自己编进去的那份
//! 协议镜像，是不是同一版。答不上来的样子是应用起来之后停在连接页上。

use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::time::{Duration, Instant};

use thinkwatch_lite_lib::control::ControlClient;
use tw_api::control::Address;

/// 包里那份 core。
///
/// **不在就失败，不跳过。**一条悄悄跳过的测试和一条不存在的测试没有区别，
/// 而 CI 在跑测试之前就会把它取回来（见 `scripts/fetch-core.sh`）。
fn core_binary() -> PathBuf {
    let p = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(thinkwatch_lite_lib::gateway::CORE_EXE);
    assert!(
        p.exists(),
        "{} 不在。先跑 bash src-tauri/scripts/fetch-core.sh",
        p.display()
    );
    p
}

/// 起一个只有自己看得见的 core。
///
/// `THINKWATCH_HOME` 指到一个临时目录，端口由系统分一个空闲的 —— **不碰
/// `~/.thinkwatch`，也不碰这台机器上正开着的那个实例。**
struct Core {
    child: Child,
    home: PathBuf,
    token: String,
}

/// 同一个测试二进制里的第几个 core。
///
/// **每个都要自己的目录。**同一个进程里的测试是并行跑的，而两个 core 共用一个
/// `THINKWATCH_HOME` 时，先到的那个拿走单实例锁、后到的根本起不来 —— 表现为
/// 「core 三十秒都没答应」，一个看上去完全不像是测试自己造成的失败。
static NTH: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);

/// 系统此刻分给我们的一个空闲端口。
///
/// **不写死一段端口。**写死的话，另一个检出里同时跑着的同一条测试就会撞上同一个
/// 端口，那个 core 起不来 —— 表现也是「三十秒都没答应」。放掉之后到 core 绑上之间
/// 有一小段空档，系统不会马上把刚分出去的端口再分给别人。
fn free_port() -> u16 {
    std::net::TcpListener::bind(("127.0.0.1", 0))
        .and_then(|l| l.local_addr())
        .expect("系统分不出空闲端口")
        .port()
}

impl Core {
    fn start() -> Self {
        let nth = NTH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // 短路径：unix socket 的 `sun_path` 只有一百来字节，而 macOS 的
        // `TMPDIR` 本身就很长。
        let home = std::env::temp_dir().join(format!("tw-ctl-{}-{nth}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let token = "test-token-not-a-real-one".to_string();
        let child = Command::new(core_binary())
            .args(["serve", "--config"])
            .arg(home.join("config.yaml"))
            // 这条测试不打数据面，端口只是不能撞上：同一个测试二进制里的另一个
            // core、另一个检出里同时在跑的这条测试、这台机器上别的什么
            .args(["--port", &free_port().to_string()])
            .env("THINKWATCH_HOME", &home)
            .env(tw_api::control::TOKEN_ENV, &token)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("起不来 twcore");
        Self { child, home, token }
    }

    fn address(&self) -> Address {
        Address::in_dir(&self.home)
    }

    fn client(&self, token: &str) -> ControlClient {
        ControlClient::new(self.address(), token.to_string())
    }

    /// 等到它答得上话。**等的是 `/status` 有应答，不是 socket 文件出现** ——
    /// 后者在它还没把路由挂上去的时候就已经在了。
    async fn wait_ready(&self) {
        let c = self.client(&self.token);
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if c.ping(Duration::from_millis(500)).await.is_ok() {
                return;
            }
            assert!(Instant::now() < deadline, "core 三十秒都没答应");
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// 带着对的凭据连得上，带着错的连不上。
///
/// 后半条是这里真正要钉住的：**漏带凭据的样子是一切照常** —— 在 macOS 上
/// socket 的权限本来就挡住了别人，于是「忘了加那个头」要到 Windows 上才发作，
/// 而那时表现为界面连不上一个正在跑的网关。
#[tokio::test]
async fn the_desktop_side_gets_in_with_its_token_and_not_without() {
    let core = Core::start();
    core.wait_ready().await;

    let ok = core.client(&core.token).status().await;
    assert!(ok.is_ok(), "带着对的凭据反而连不上：{:?}", ok.err());
    let status = ok.unwrap();
    assert_eq!(
        status.api_version,
        tw_api::CONTROL_API_VERSION,
        "桌面端编进去的协议版本和它钉的那版 core 对不上"
    );

    let wrong = core.client("not-the-token").status().await;
    assert!(wrong.is_err(), "凭据不对居然进去了");
}

/// 写请求也要带凭据。
///
/// **读和写是两条代码路径**（`get` 和 `send_json`），2026.9.10 就是只有读的
/// 那条带了：界面照常显示数据，而保存、新建、接管全部被拒。这里用
/// `/shutdown` 当那个写请求 —— 它走的正是 `send_json`，又不会改任何配置。
#[tokio::test]
async fn writes_carry_the_token_too() {
    let core = Core::start();
    core.wait_ready().await;

    let wrong = core.client("not-the-token").shutdown().await;
    assert!(wrong.is_err(), "凭据不对的写请求居然进去了");

    let ok = core.client(&core.token).shutdown().await;
    assert!(ok.is_ok(), "带着对的凭据写请求被拒：{:?}", ok.err());
}

/// 事件流也要带凭据。
///
/// **它和别的请求不是同一条代码路径**（长连接那条自己拼请求），所以漏掉那个头
/// 的话，界面上的表现是「什么都能点，但一切都不自己更新」—— 一种很难往凭据上
/// 联想的坏法。
#[tokio::test]
async fn the_event_stream_carries_the_token_too() {
    let core = Core::start();
    core.wait_ready().await;

    let opened = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let o = opened.clone();
    let c = core.client(&core.token);
    // 流是长连接，不会自己结束 —— 给它一点时间把头发出去、把响应收回来
    let _ = tokio::time::timeout(
        Duration::from_secs(10),
        c.subscribe_events(
            move || o.store(true, std::sync::atomic::Ordering::SeqCst),
            |_| {},
        ),
    )
    .await;
    assert!(
        opened.load(std::sync::atomic::Ordering::SeqCst),
        "事件流没开起来 —— 多半是那个请求没带凭据"
    );
}

/// 控制面拒绝时，**带着 core 的码回来**，不是一段要界面再解析一遍的文本。
///
/// 401 用的是 core 最外层替框架回的那条（没带凭据），所以这里顺带钉住了
/// 「框架回的失败也是 `ErrorBody`」。
#[tokio::test]
async fn a_refusal_comes_back_with_its_code() {
    use thinkwatch_lite_lib::control::Refused;

    let core = Core::start();
    core.wait_ready().await;

    let e = core.client("not-the-token").status().await.unwrap_err();
    let Some(Refused(m)) = e.downcast_ref::<Refused>() else {
        panic!("401 没按 ErrorBody 读出来：{e:#}");
    };
    assert!(!m.code.is_empty(), "{m:?}");

    let e = core
        .client(&core.token)
        .call::<tw_api::ep::RequestDetail>(&["987654321"], &())
        .await
        .unwrap_err();
    let Some(Refused(m)) = e.downcast_ref::<Refused>() else {
        panic!("不存在的请求没按 ErrorBody 读出来：{e:#}");
    };
    assert!(!m.code.is_empty(), "{m:?}");
}

/// 接管要问 core 的只有两件事，都问得到：客户端该连的网关地址（按配置里的端口），
/// 和为这个客户端发的专用密钥 —— 第二次问拿到的是同一把，记着是为谁发的
#[tokio::test]
async fn adoption_gets_its_gateway_and_its_key_from_core() {
    use tw_api::ep;

    let core = Core::start();
    core.wait_ready().await;
    let c = core.client(&core.token);

    let base = thinkwatch_lite_lib::clients::gateway_base(&c, "127.0.0.1")
        .await
        .unwrap();
    assert!(base.starts_with("http://127.0.0.1:"), "{base}");

    let first = c
        .call::<ep::ClientKey>(&["claude-code"], &())
        .await
        .unwrap();
    assert!(first.created);
    let again = c
        .call::<ep::ClientKey>(&["claude-code"], &())
        .await
        .unwrap();
    assert!(!again.created);
    assert_eq!(
        (again.name.as_str(), again.key.as_str()),
        (first.name.as_str(), first.key.as_str())
    );
    let keys = c.call::<ep::Keys>(&[], &()).await.unwrap();
    let mine = keys.iter().find(|k| k.name == first.name).unwrap();
    assert_eq!(mine.client.as_deref(), Some("claude-code"));
}

/// 一个端点一种写法：GET 带查询串、DELETE 带查询串、PUT 带请求体、带路径参数的
/// 名字有空格，全都对着真的 core 走一遍。拼错的表现是 core 回 400 或 404
#[tokio::test]
async fn the_generic_call_speaks_every_shape() {
    use tw_api::ep;

    let core = Core::start();
    core.wait_ready().await;
    let c = core.client(&core.token);

    // GET + 查询串
    let rows = c
        .call::<ep::History>(
            &[],
            &tw_api::ListQuery {
                limit: Some(5),
                ..Default::default()
            },
        )
        .await;
    assert!(rows.is_ok(), "{:?}", rows.err());
    // 文本响应
    let md = c.call::<ep::Diagnostics>(&[], &()).await.unwrap();
    assert!(!md.is_empty());
    // 路径参数里有空格：编码之后仍是一段，core 说的是「没有这个密钥」而不是 404
    let e = c
        .call::<ep::DeleteKey>(&["no such key"], &tw_api::BaseVersion::default())
        .await
        .unwrap_err();
    let m = &e
        .downcast_ref::<thinkwatch_lite_lib::control::Refused>()
        .expect("DELETE 被拒时要带码")
        .0;
    assert_eq!(m.code, "config.edit.not_found", "{m:?}");
    assert_eq!(m.arg("name"), "no such key");
    // 带请求体的写请求
    let cfg = c.call::<ep::GetConfig>(&[], &()).await.unwrap();
    let w = c
        .call::<ep::PatchConfig>(
            &[],
            &tw_api::ConfigPatch {
                base_version: Some(cfg.version),
                ops: vec![],
            },
        )
        .await;
    assert!(w.is_ok(), "{:?}", w.err());
}
