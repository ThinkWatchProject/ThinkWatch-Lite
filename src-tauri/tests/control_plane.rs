//! 起一个真的 core，真连上去。
//!
//! # 为什么这条不能只靠单元测试
//!
//! 单元测试能证明「连不上时说的是哪句话」，证明不了**连得上**。而这一侧新加的
//! 那几样 —— 钥匙从哪儿读、每条连接的握手、控制面的地址由谁说了算、换钥匙之后
//! 接不接得上 —— 只有在两个真进程之间才成立或者不成立。
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
    child: std::sync::Mutex<Child>,
    home: PathBuf,
}

/// 同一个测试二进制里的第几个 core。
///
/// **每个都要自己的目录。**同一个进程里的测试是并行跑的，而两个 core 共用一个
/// `THINKWATCH_HOME` 时，先到的那个拿走单实例锁、后到的根本起不来 —— 表现为
/// 「core 三十秒都没答应」，一个看上去完全不像是测试自己造成的失败。
static NTH: std::sync::atomic::AtomicU16 = std::sync::atomic::AtomicU16::new(0);

impl Core {
    fn start() -> Self {
        let nth = NTH.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        // 短路径：unix socket 的 `sun_path` 只有一百来字节，而 macOS 的
        // `TMPDIR` 本身就很长。
        let home = std::env::temp_dir().join(format!("tw-ctl-{}-{nth}", std::process::id()));
        let _ = std::fs::remove_dir_all(&home);
        std::fs::create_dir_all(&home).unwrap();
        let child = Command::new(core_binary())
            .args(["serve", "--config"])
            .arg(home.join("config.yaml"))
            // 这条测试不打数据面，端口只是不能撞上：同一个测试二进制里的另一个
            // core、另一个检出里同时在跑的这条测试、这台机器上别的什么。
            //
            // **交给 core 自己向系统要（`--port 0`），不是这边先要一个再递过去。**
            // 先要、放掉、再让 core 去绑，中间那段空档里端口会被别人拿走 —— 并发
            // 跑几份测试时真撞上过，core 报「already in use」退出，而这边只看得到
            // 「三十秒都没答应」
            .args(["--port", "0"])
            .env("THINKWATCH_HOME", &home)
            // 输出留在它自己的目录里：起不来时 `wait_ready` 把它和退出状态一起报出来
            .stdout(std::fs::File::create(home.join("core.out")).unwrap())
            .stderr(std::fs::File::create(home.join("core.err")).unwrap())
            .spawn()
            .expect("起不来 twcore");
        Self {
            child: std::sync::Mutex::new(child),
            home,
        }
    }

    /// core 的配置。**钥匙由 core 写进去**，桌面端从这里读
    fn config(&self) -> PathBuf {
        self.home.join("config.yaml")
    }

    /// 一份写着另一把钥匙的配置：拿它去连，就是「钥匙不对」
    fn wrong_key(&self) -> PathBuf {
        let p = self.home.join("wrong.yaml");
        std::fs::write(
            &p,
            format!("listen:\n  control:\n    key: \"{}\"\n", "0f".repeat(32)),
        )
        .unwrap();
        p
    }

    fn address(&self) -> Address {
        Address::in_dir(&self.home)
    }

    fn client(&self, key_file: PathBuf) -> ControlClient {
        ControlClient::new(self.address(), key_file)
    }

    fn ok(&self) -> ControlClient {
        self.client(self.config())
    }

    /// 等到它答得上话。**等的是 `/status` 有应答，不是 socket 文件出现** ——
    /// 后者在它还没把路由挂上去的时候就已经在了。
    async fn wait_ready(&self) {
        let c = self.ok();
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            let last = match c.ping(Duration::from_millis(500)).await {
                Ok(()) => return,
                Err(e) => format!("{e:#}"),
            };
            // **答不上来时把能看的都报出来**：它是不是已经退出了、它自己说了什么。
            // 只报一句「没答应」的话，端口被占、配置被拒、二进制不对都长一个样
            if Instant::now() >= deadline {
                let exited = self.child.lock().unwrap().try_wait();
                let log = |f: &str| std::fs::read_to_string(self.home.join(f)).unwrap_or_default();
                panic!(
                    "core 三十秒都没答应\n最后一次：{last}\n退出状态：{exited:?}\n--- stdout\n{}\n--- stderr\n{}",
                    log("core.out"),
                    log("core.err")
                );
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        let mut c = self.child.lock().unwrap();
        let _ = c.kill();
        let _ = c.wait();
        let _ = std::fs::remove_dir_all(&self.home);
    }
}

/// 拿着配置里的钥匙连得上，拿着别的钥匙连不上。
///
/// 后半条是这里真正要钉住的：**握手漏掉的样子是一切照常** —— 在 macOS 上 socket
/// 的权限本来就挡住了别人，于是门没关上要到 Windows 上才发作。
#[tokio::test]
async fn the_desktop_side_gets_in_with_the_key_and_not_without() {
    let core = Core::start();
    core.wait_ready().await;

    let ok = core.ok().status().await;
    assert!(ok.is_ok(), "拿着对的钥匙反而连不上：{:?}", ok.err());
    let status = ok.unwrap();
    assert_eq!(
        status.api_version,
        tw_api::CONTROL_API_VERSION,
        "桌面端编进去的协议版本和它钉的那版 core 对不上"
    );

    let wrong = core.client(core.wrong_key()).status().await;
    let e = format!("{:#}", wrong.expect_err("钥匙不对居然进去了"));
    assert!(e.contains("密钥") || e.contains("key"), "{e}");
}

/// 写请求也走同一条握手。
///
/// **读和写是两条代码路径**，2026.9.10 就是只有读的那条带了凭据：界面照常显示
/// 数据，而保存、新建、接管全部被拒。这里用 `/shutdown` 当那个写请求，它不会改
/// 任何配置。
#[tokio::test]
async fn writes_go_through_the_handshake_too() {
    let core = Core::start();
    core.wait_ready().await;

    let wrong = core.client(core.wrong_key()).shutdown().await;
    assert!(wrong.is_err(), "钥匙不对的写请求居然进去了");

    let ok = core.ok().shutdown().await;
    assert!(ok.is_ok(), "拿着对的钥匙写请求被拒：{:?}", ok.err());
}

/// 事件流也走握手。**它和别的请求不是同一条代码路径**（长连接那条自己拼请求），
/// 坏了的样子是「什么都能点，但一切都不自己更新」
#[tokio::test]
async fn the_event_stream_goes_through_the_handshake_too() {
    let core = Core::start();
    core.wait_ready().await;

    let opened = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let o = opened.clone();
    let c = core.ok();
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
        "事件流没开起来"
    );
}

/// 换钥匙（`twcore control-key --rotate`）之后，**下一条连接就用新的**：桌面端每次
/// 连接都现读配置，不用重启。用旧钥匙开着的事件流被 core 关掉，重连时读到的是新的
#[tokio::test]
async fn after_the_key_is_rotated_the_next_connection_gets_in() {
    let core = Core::start();
    core.wait_ready().await;
    let before = tw_link::read_key(&core.config()).unwrap();

    let rotated = Command::new(core_binary())
        .args(["control-key", "--rotate", "--config"])
        .arg(core.config())
        .env("THINKWATCH_HOME", &core.home)
        .output()
        .expect("twcore control-key 跑不起来");
    assert!(rotated.status.success(), "{rotated:?}");
    let after = tw_link::read_key(&core.config()).unwrap();
    assert!(after != before, "钥匙没换");

    // core 一秒之内换上新钥匙
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        match core.ok().status().await {
            Ok(_) => break,
            Err(e) => assert!(Instant::now() < deadline, "换钥匙之后一直连不上：{e:#}"),
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    // 旧钥匙进不去了
    let old = core.home.join("old.yaml");
    std::fs::write(
        &old,
        format!("listen:\n  control:\n    key: \"{}\"\n", before.to_hex()),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while core.client(old.clone()).status().await.is_ok() {
        assert!(Instant::now() < deadline, "旧钥匙还进得去");
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
}

/// 控制面拒绝时，**带着 core 的码回来**，不是一段要界面再解析一遍的文本。
#[tokio::test]
async fn a_refusal_comes_back_with_its_code() {
    use thinkwatch_lite_lib::control::Refused;

    let core = Core::start();
    core.wait_ready().await;

    let e = core
        .ok()
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
    let c = core.ok();

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
    let c = core.ok();

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
