//! 界面调控制面的那一个命令：`call`。
//!
//! **只是转发的端点不再各有一个命令。**以前一个端点在这一层要写一个命令，
//! 参数名、路径、请求类型各写一遍，前端再按命令名和参数名调一遍 —— 参数名
//! 拼错是运行时才知道的事。现在界面按端点名调（类型来自生成的 `tw-api.ts`），
//! 这里按名字找到 `tw_api::ep` 里那一个端点。搜索能力可随 Core 扩展，三个搜索
//! 端点直接转发 JSON 交给 Core 校验；其余端点先按钉住的协议类型校验。
//!
//! **界面够得着的端点只有 [`ALLOWED`] 里这些。**不在里面的有意不给：密钥明文
//! （`KeyValue`，复制走 Rust 这边直接写剪贴板）、让 core 退出、诊断包的正文、
//! 事件流，以及只在概览、上游页的汇总里用到的统计端点（那几样由 Rust 这边的
//! 命令拼好再给）。路径参数由 `tw_api::fill` 做百分号编码，所以界面给的名字
//! 只能是一段，拼不出别的路径。
//!
//! **插件要点头的三步有意不给**：`CreatePluginConfirmed`、`SavePluginConfirmed`、
//! `ApprovePluginFileConfirmed`（约定附录 4 §3：装上、打开改得了回答里工具调用的插件，改它的
//! 代码，批准它磁盘上改过的文件）。界面里的脚本自己就能点网页上的「确定」，所以这几步只能
//! 经过 `plugins` 里的命令，在系统原生对话框里确认。不必点头的装、存、批准（`CreatePlugin`、
//! `SavePlugin`、`ApprovePluginFile`）在这里：要点头时 core 答 403。
//!
//! 做的事不止转发的命令（打开浏览器、写剪贴板、拼概览）仍然各是一个命令。
//! 其中有三个端点**只能经过那些命令**，因为这台机器上的客户端要一起照顾到：删密钥
//! （接管着的客户端的那把删不得）、换密钥（新值要同步进它的配置）、为客户端发密钥
//! （先认得这个客户端）。客户端接管、MCP、扫描本来就不经过 core，见 `clients`。

use serde_json::Value;
use tw_api::{Endpoint, ep};

use crate::AppState;
use crate::control::ControlClient;
use crate::error::{CmdError, Out};

macro_rules! webview_endpoints {
    ($($name:ident),* $(,)?) => {
        /// 界面能直接调的端点，按名字。和 `src/control.ts` 的
        /// `WEBVIEW_ENDPOINTS` 是同一份（测试核对）。
        pub const ALLOWED: &[&str] = &[$(stringify!($name)),*];

        /// 调一个控制面端点。`params` 按顺序填路径参数，`req` 是请求（没有就是
        /// `null`）。
        #[tauri::command]
        pub async fn call(
            state: tauri::State<'_, AppState>,
            endpoint: String,
            params: Vec<String>,
            req: Value,
        ) -> Out<Value> {
            let params: Vec<&str> = params.iter().map(String::as_str).collect();
            match endpoint.as_str() {
                $(stringify!($name) => relay::<ep::$name>(&state.control, &params, req).await,)*
                _ => Err(CmdError::plain(format!(
                    "The interface cannot call the control-plane endpoint `{endpoint}`."
                ))),
            }
        }
    };
}

webview_endpoints![
    // 进程与概览
    Interfaces,
    Overview,
    L1,
    InFlight,
    // 在跑的请求此刻生成得多快：流量页在跑的那几行每秒问一次
    Live,
    // 配置原文。光标在哪一段（`ConfigAt`）；修改记录由备份取代（下面）
    GetConfig,
    PatchConfig,
    PutConfig,
    ConfigAt,
    // 一键修复：修的是磁盘上那一份，界面只交版本号
    ConfigRepairPlan,
    RepairConfig,
    SaveListen,
    WebTools,
    SaveWebTools,
    TestWebTool,
    // 记录。搜索翻的是整个库，界面自己发起、自己翻页
    History,
    HistorySearch,
    RequestDetail,
    AbortRequest,
    Sessions,
    SessionDetail,
    SessionTranscript,
    // 一轮的上下文由什么组成（估算），点开那一轮才取
    SessionTurnContext,
    AbortSession,
    // 测速、回放、试路由
    SpeedQuote,
    SpeedRun,
    ReplayQuote,
    ReplayRun,
    DryRun,
    // 密钥（删和换走 Rust 这边的命令，见下面的测试）
    Keys,
    CreateKey,
    UpdateKey,
    SetDefaultKey,
    // 上游与代理
    CreateProvider,
    TestProvider,
    PreviewProvider,
    UpdateProvider,
    DeleteProvider,
    ProviderModels,
    // 手写一个模型的上下文窗口、输出上限
    SetModelSpec,
    // 手动添加的模型：上游能服务、却没列进清单的
    SetManualModels,
    RefreshProviderModels,
    // 余额：上游自己的接口报的钱包、额度、窗口限额，立刻重读一次
    RefreshBalance,
    RefreshStaleModels,
    CreateProxy,
    TestProxy,
    UpdateProxy,
    DeleteProxy,
    // 路由
    CreateRoute,
    UpdateRoute,
    DeleteRoute,
    SetDefaultRoute,
    CreateGroup,
    UpdateGroup,
    DeleteGroup,
    KnownModels,
    // 模型别名：同一个模型在各个上游的不同名称
    Aliases,
    CreateAlias,
    UpdateAlias,
    DeleteAlias,
    PreviewAlias,
    AliasUsage,
    // 各条路由、各条规则命中了多少：路由图按它给线加权、标出从没命中过的规则
    RouteStats,
    // 用量历史：概览上「最近一年」的热力图，一天一格
    UsageHistory,
    // 上游体检：各家上游的事实和样本数，界面按它写成自己的话
    UpstreamHealth,
    // 价目表
    Pricing,
    RefreshPricing,
    SetPricingAutoUpdate,
    QueryPrice,
    CreatePriceSheet,
    PriceSheet,
    UpdatePriceSheet,
    DeletePriceSheet,
    // 安全
    Security,
    SecurityEvents,
    SecurityRuleCounts,
    SetSecurityMode,
    ToggleBuiltinRule,
    SetBuiltinRuleAction,
    SetRulesEnabled,
    CreateCustomRule,
    UpdateCustomRule,
    DeleteCustomRule,
    TestSecurity,
    RedactExceptions,
    AddRedactException,
    ExceptSecurityEvent,
    RemoveRedactException,
    // 账号登录（发起和取消是命令：要开浏览器、要记住这一次）
    ChatgptLoginStatus,
    ChatgptUsage,
    ChatgptResets,
    UseChatgptReset,
    ZaiLoginStatus,
    // 插件。要点头的三步（`…Confirmed`）走 Rust 这边的命令，见下面的测试
    Plugins,
    PluginInspect,
    PluginRewrite,
    CreatePlugin,
    SavePlugin,
    ApprovePluginFile,
    PluginSourceDiff,
    DeletePlugin,
    ReorderPlugins,
    TrialPlugin,
    PluginLogs,
    // 导入导出与备份：配置里有哪些项目、导出、导入的预览与写入；备份版本的列表、另存、
    // 恢复的预览与写入。备份的几个在安全模式下照样能用
    ConfigItems,
    ExportConfig,
    ImportPreview,
    ImportConfig,
    Backups,
    BackupFile,
    RestorePreview,
    Restore,
    // 同步。固定密钥、通用偏好只经过 Rust（`sync`、`client_prefs`）
    SyncStatus,
    SyncTest,
    SyncJoinPreview,
    SyncEnable,
    SyncSave,
    SyncNow,
    SyncConflicts,
    SyncResolve,
    SyncEncryption,
    SyncUnlock,
    SyncDisable,
    // 同步位置空了、keyring 不见了之后，由人选的「重新上传本机配置」
    SyncRepublish,
];

/// 搜索端点保留 Core 的可扩展能力字段，其余请求先按端点类型校验。
async fn relay<E: Endpoint>(c: &ControlClient, params: &[&str], req: Value) -> Out<Value> {
    // Search capabilities evolve on Core independently of the bundled API.
    // Only these already-allowlisted routes accept extensible JSON. Core still
    // validates every request, with the same authenticated transport and paths.
    if matches!(E::NAME, "WebTools" | "SaveWebTools" | "TestWebTool") {
        return Ok(c.call::<SearchEndpoint<E>>(params, &req).await?);
    }
    let req: E::Req = serde_json::from_value(req).map_err(|e| {
        CmdError::plain(format!(
            "The request for `{}` has the wrong shape: {e}",
            E::NAME
        ))
    })?;
    let res = c.call::<E>(params, &req).await?;
    serde_json::to_value(res).map_err(|e| CmdError::plain(e.to_string()))
}

struct SearchEndpoint<E>(std::marker::PhantomData<E>);

impl<E: Endpoint> Endpoint for SearchEndpoint<E> {
    const METHOD: tw_api::Method = E::METHOD;
    const PATH: &'static str = E::PATH;
    const PARAMS: &'static [&'static str] = E::PARAMS;
    const FORMAT: tw_api::Format = E::FORMAT;
    const NAME: &'static str = E::NAME;
    type Req = Value;
    type Res = Value;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Use the real authenticated transport to catch enum decoding in either
    /// direction, including adapters added after this Lite version was built.
    async fn search_roundtrip<E: Endpoint>(req: Value, reply: Value) {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let dir = tempfile::tempdir().unwrap();
        let config = dir.path().join("config.yaml");
        std::fs::write(
            &config,
            format!("listen:\n  control:\n    key: \"{}\"\n", "ab".repeat(32)),
        )
        .unwrap();
        let key = tw_link::read_key(&config).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port_file = dir.path().join("control.port");
        std::fs::write(
            &port_file,
            listener.local_addr().unwrap().port().to_string(),
        )
        .unwrap();
        let expected_req = req.clone();
        let expected_reply = reply.clone();
        let server = tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            let acceptor = tw_link::Acceptor::new(move || Some(key.clone()), "test");
            let mut stream = acceptor.accept(tcp).await.unwrap().stream;
            let mut head = Vec::new();
            while !head.ends_with(b"\r\n\r\n") {
                head.push(stream.read_u8().await.unwrap());
            }
            let head = String::from_utf8(head).unwrap();
            assert!(head.starts_with(&format!("{} {} HTTP/1.1", E::METHOD.as_str(), E::PATH)));
            let len = head
                .lines()
                .find_map(|line| {
                    let (key, value) = line.split_once(':')?;
                    key.eq_ignore_ascii_case("content-length")
                        .then(|| value.trim().parse::<usize>().unwrap())
                })
                .unwrap_or(0);
            if len > 0 {
                let mut body = vec![0; len];
                stream.read_exact(&mut body).await.unwrap();
                assert_eq!(
                    serde_json::from_slice::<Value>(&body).unwrap(),
                    expected_req
                );
            } else {
                assert!(expected_req.is_null());
            }
            let body = reply.to_string();
            stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
            stream.flush().await.unwrap();
        });
        let client = ControlClient::new(tw_api::control::Address::Loopback { port_file }, config);
        assert_eq!(relay::<E>(&client, &[], req).await.unwrap(), expected_reply);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn search_capabilities_cross_the_pinned_native_bridge() {
        use serde_json::json;
        search_roundtrip::<ep::WebTools>(Value::Null, json!({
            "config": {"engines": ["google_docs", "future_engine"]},
            "available_engines": [{"id": "future_engine", "name": "Future", "min_interval_ms": 6000}]
        })).await;
        search_roundtrip::<ep::SaveWebTools>(
            json!({
                "base_version": "test", "config": {"engines": ["google_docs", "future_engine"]}
            }),
            json!({"version": "saved"}),
        )
        .await;
        search_roundtrip::<ep::TestWebTool>(
            json!({"action": "search", "query": "Rust"}),
            json!({
                "sources": [{"engine": "future_engine", "url": "https://www.rust-lang.org/"}]
            }),
        )
        .await;
    }

    #[tokio::test]
    #[ignore = "requires a Google Docs-capable resources/twcore and live Google access"]
    async fn live_search_through_native_relay_and_isolated_core() {
        use serde_json::json;
        use std::time::Duration;
        struct Process(std::process::Child);
        impl Drop for Process {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let home = tempfile::Builder::new()
            .prefix("tw-search-")
            .tempdir()
            .unwrap();
        let config_path = home.path().join("config.yaml");
        let _process = Process(
            std::process::Command::new(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("resources")
                    .join(crate::gateway::CORE_EXE),
            )
            .args(["serve", "--config"])
            .arg(&config_path)
            .args(["--port", "0"])
            .env("THINKWATCH_HOME", home.path())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap(),
        );
        let client = ControlClient::new(tw_api::control::Address::in_dir(home.path()), config_path);
        tokio::time::timeout(Duration::from_secs(30), async {
            while client.ping(Duration::from_millis(500)).await.is_err() {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .unwrap();
        let view = relay::<ep::WebTools>(&client, &[], Value::Null)
            .await
            .unwrap();
        assert!(
            view["available_engines"]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e["id"] == "google_docs")
        );
        let mut config = view["config"].clone();
        config["engines"] = json!(["google_docs"]);
        config["read_pages"] = json!(0);
        relay::<ep::SaveWebTools>(
            &client,
            &[],
            json!({"base_version": view["config_version"], "config": config}),
        )
        .await
        .unwrap();
        let saved = relay::<ep::WebTools>(&client, &[], Value::Null)
            .await
            .unwrap();
        assert_eq!(saved["config"]["engines"], json!(["google_docs"]));
        let request = json!({"action": "search", "query": "Python asyncio TaskGroup documentation", "allowed_domains": ["python.org"], "blocked_domains": []});
        let result = relay::<ep::TestWebTool>(&client, &[], request.clone())
            .await
            .unwrap();
        assert!(
            result["sources"]
                .as_array()
                .unwrap()
                .iter()
                .any(|s| s["engine"] == "google_docs"
                    && s["url"]
                        .as_str()
                        .unwrap()
                        .contains("docs.python.org/3/library/asyncio-task.html")),
            "{result}"
        );
        let cached = relay::<ep::TestWebTool>(&client, &[], request)
            .await
            .unwrap();
        assert_eq!(cached["cached"], true);
        let invalid = relay::<ep::SaveWebTools>(&client, &[], json!({"base_version": saved["config_version"], "config": {"engines": ["unsupported_engine"]}})).await;
        assert!(invalid.is_err(), "Core must still reject unknown engines");
    }

    /// 这些是有意不给界面的，见模块说明。
    #[test]
    fn what_the_webview_cannot_reach() {
        for name in [
            "KeyValue",
            "Shutdown",
            "Events",
            "Diagnostics",
            "Fixture",
            "Status",
            // 请 core 等接替者：只在更新、重启网关时由 Rust 这边发（`handover`）
            "HandoverArm",
            "StartChatgptLogin",
            "CancelChatgptLogin",
            "StartZaiLogin",
            "CancelZaiLogin",
            // 要这台机器上的客户端一起照顾到的，见模块说明
            "DeleteKey",
            "RotateKey",
            "ClientKey",
            // 插件要点头的三步只能在原生对话框里确认，见模块说明
            "CreatePluginConfirmed",
            "SavePluginConfirmed",
            "ApprovePluginFileConfirmed",
            // 哪几把密钥被接管着的客户端用着，由 Rust 这边算（它看得见这台机器上的客户端）；
            // 通用偏好由 Rust 这边读写（`client_prefs`）
            "PinKeys",
            "GetClientPrefs",
            "PutClientPrefs",
        ] {
            assert!(!ALLOWED.contains(&name), "{name}");
        }
    }

    /// 要点头的插件写入只有一条路：`plugins` 里的命令先弹系统的确认框。界面的清单里连这几个
    /// 名字都不该有 —— 有了，网页里的脚本就能替用户装上、打开、改写一个改工具调用的插件
    #[test]
    fn the_confirmed_plugin_writes_only_go_through_the_native_dialog() {
        let ts = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/control.ts"))
            .unwrap();
        for (name, path) in [
            ("CreatePluginConfirmed", "/plugin-confirmed"),
            ("SavePluginConfirmed", "/plugins/{id}/confirmed"),
            (
                "ApprovePluginFileConfirmed",
                "/plugins/{id}/approve/confirmed",
            ),
        ] {
            assert!(!ALLOWED.contains(&name), "{name}");
            assert!(!ts.contains(&format!("\"{name}\"")), "{name}");
            // 它确实是 core 的一个端点（不是拼错了名字才「不在清单里」）
            assert!(
                ep::ALL.iter().any(|e| e.name == name && e.path == path),
                "{name}"
            );
        }
        // 不必点头的那几步在清单里：要点头时 core 答 403，界面再请 Rust
        for name in [
            "CreatePlugin",
            "SavePlugin",
            "ApprovePluginFile",
            "PluginRewrite",
        ] {
            assert!(ALLOWED.contains(&name), "{name}");
        }
    }

    /// 修改记录由备份取代（同步与备份约定 2.1）：旧的两个端点不再给界面
    #[test]
    fn the_config_history_is_replaced_by_backups() {
        for name in ["ConfigHistory", "ConfigRollback"] {
            assert!(!ALLOWED.contains(&name), "{name}");
        }
        for name in ["Backups", "BackupFile", "RestorePreview", "Restore"] {
            assert!(ALLOWED.contains(&name), "{name}");
        }
    }

    /// 前端那份清单和这里一样。多一个，界面调了会被拒；少一个，界面上的类型
    /// 就会允许一个这里不接的调用。
    #[test]
    fn the_frontend_lists_the_same_endpoints() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../src/control.ts");
        let src = std::fs::read_to_string(path).unwrap().replace("\r\n", "\n");
        let start = src
            .find("export const WEBVIEW_ENDPOINTS = [")
            .expect("src/control.ts 里找不到 WEBVIEW_ENDPOINTS");
        let body = &src[start..];
        let body = &body[body.find('[').unwrap() + 1..body.find("] as const").unwrap()];
        let mut ts: Vec<&str> = body
            .split(',')
            .map(|s| s.trim().trim_matches('"'))
            .filter(|s| !s.is_empty())
            .collect();
        let mut rs = ALLOWED.to_vec();
        ts.sort_unstable();
        rs.sort_unstable();
        assert_eq!(ts, rs);
    }
}
