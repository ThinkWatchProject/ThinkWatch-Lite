//! 截图页的「标准答案」：把示例配置交给真的 core，记下控制面怎么答。
//!
//! **不在这个仓库里编译。**`oracle.sh` 把它放进 core 那一版源码的
//! `crates/tw-control/tests/` 下跑一次，跑完就扔。用的是 core 自己的测试
//! 写法（进程内起路由、`oneshot` 发请求），所以答出来的每一个字段都是那一版
//! core 真的会给的 —— 打码的写法、自动识别的协议、规则的标记、试算的轨迹。
//!
//! 输入输出都走环境变量：`SHOTS_CONFIG`（示例配置）、`SHOTS_REQUESTS`（要试算的
//! 请求和要查价的模型，`requests.json`）、`SHOTS_OUT`（写到哪个目录）。

use std::sync::Arc;

use axum::body::Body;
use axum::http::Request;
use tower::ServiceExt;
use tw_control::{ConfigManager, ControlState};

async fn call(app: &axum::Router, method: &str, uri: &str, body: Option<String>) -> serde_json::Value {
    let mut req = Request::builder().method(method).uri(uri);
    if body.is_some() {
        req = req.header("content-type", "application/json");
    }
    let res = app
        .clone()
        .oneshot(req.body(Body::from(body.unwrap_or_default())).unwrap())
        .await
        .unwrap();
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 26).await.unwrap();
    assert!(status.is_success(), "{method} {uri}: {status} {}", String::from_utf8_lossy(&bytes));
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn dump() {
    let env = |k: &str| std::env::var(k).unwrap_or_else(|_| panic!("{k} 没设"));
    let out = std::path::PathBuf::from(env("SHOTS_OUT"));
    std::fs::create_dir_all(&out).unwrap();
    let text = std::fs::read_to_string(env("SHOTS_CONFIG")).unwrap();
    let requests: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(env("SHOTS_REQUESTS")).unwrap()).unwrap();

    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("config.yaml");
    std::fs::write(&path, &text).unwrap();
    let cfg: tw_config::Config = serde_yaml_ng::from_str(&text).unwrap();
    let gw = tw_gateway::AppState::new(cfg).unwrap();
    let bus = gw.bus.clone();
    let app = tw_control::router(ControlState {
        shutdown: Default::default(),
        remote: Default::default(),
        cfg: Arc::new(ConfigManager::new(path, gw.clone(), bus)),
        gateway: gw,
        store: None,
        started: std::time::Instant::now(),
        price_updater: Default::default(),
        chatgpt: Default::default(),
        zai: Default::default(),
    });

    let write = |name: &str, v: &serde_json::Value| {
        let mut s = serde_json::to_string_pretty(v).unwrap();
        s.push('\n');
        std::fs::write(out.join(format!("{name}.json")), s).unwrap();
    };
    for (name, uri) in [
        ("overview", "/overview"),
        ("keys", "/keys"),
        ("security", "/security"),
        ("pricing", "/pricing"),
        ("status", "/status"),
    ] {
        let mut v = call(&app, "GET", uri, None).await;
        // 每跑一次都不一样的那几项（进程号、临时目录）：截图页自己填，这里不留
        if name == "status" {
            v["pid"] = 0.into();
            v["config_path"] = "".into();
        }
        write(name, &v);
    }
    // 试算：每一个请求一份答案，按 requests.json 里的顺序
    let mut dryrun = Vec::new();
    for req in requests["dryrun"].as_array().unwrap() {
        dryrun.push(call(&app, "POST", "/dryrun", Some(req.to_string())).await);
    }
    write("dryrun", &serde_json::Value::Array(dryrun));
    // 示例流量里出现的模型，按默认价目表查价：算费用、画模型清单都用它
    let query = serde_json::json!({ "sheet": { "kind": "default" }, "models": requests["prices"], "limit": 100 });
    write("prices", &call(&app, "POST", "/pricing/query", Some(query.to_string())).await);
}
