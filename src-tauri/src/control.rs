//! 控制面客户端：通过 unix socket 和 core 说话。
//!
//! 走 socket 而不是 TCP 的理由是权限：一个 `0700` 的
//! socket 文件天然只有当前用户能连，不需要再发明一套 token。

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use http_body_util::BodyExt;
use hyper_util::rt::TokioIo;

/// 查询串里的一段。项目路径里有空格和中文是常事。
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.as_bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => {
                out.push(*b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 路径里的一段（上游、代理、价目表的名字）。**斜杠也要转** —— 名字里的
/// `/` 原样拼进去就成了两段路径，打到另一个端点上。
fn segment(s: &str) -> String {
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

/// 删除时带上的版本，拼成查询串。
fn with_base(path: String, base_version: Option<&str>) -> String {
    match base_version {
        Some(v) => format!("{path}?base_version={}", urlencode(v)),
        None => path,
    }
}

pub struct ControlClient {
    socket: PathBuf,
}

impl ControlClient {
    pub fn new(socket: PathBuf) -> Self {
        Self { socket }
    }

    pub fn socket_path(&self) -> &Path {
        &self.socket
    }

    /// 发一个 GET，把 body 整个读回来。
    ///
    /// 每次新建连接。控制面的调用频率是「用户点一下」的量级，连接复用
    /// 带来的复杂度（连接死了怎么办、什么时候重建）换不来任何东西。
    /// **事件流是例外**，它走 `stream` 那条路，本来就是长连接。
    async fn get(&self, path: &str) -> Result<Vec<u8>> {
        let stream = tokio::net::UnixStream::connect(&self.socket)
            .await
            .with_context(|| {
                tr!(
                    format!(
                        "无法连接控制面 {}，core 可能尚未启动或已退出",
                        self.socket.display()
                    ),
                    format!(
                        "The control plane at {} could not be reached; core may not have started yet or may have exited",
                        self.socket.display()
                    )
                )
            })?;
        let io = TokioIo::new(stream);
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        tokio::spawn(async move {
            if let Err(e) = conn.await {
                tracing::debug!("控制面连接结束：{e}");
            }
        });
        let req = hyper::Request::builder()
            .uri(path)
            // unix socket 上没有真正的 host，但 HTTP/1.1 要求这个头存在
            .header(hyper::header::HOST, "localhost")
            .body(String::new())?;
        let resp = sender.send_request(req).await?;
        let status = resp.status();
        let bytes = resp.into_body().collect().await?.to_bytes();
        if !status.is_success() {
            // 控制面的响应体是一条 JSON 的 `Msg`：**原样带出去，界面那边
            // 按码翻**（见 `errorText`）。只剩状态码的话，界面上只能显示
            // 一个 404
            let text = String::from_utf8_lossy(&bytes);
            if text.trim().is_empty() {
                anyhow::bail!(tr!(
                    format!("控制面返回 {status}"),
                    format!("The control plane returned {status}")
                ));
            }
            anyhow::bail!("{text}");
        }
        Ok(bytes.to_vec())
    }

    /// 带超时的心跳探测。
    ///
    /// **必须有超时**：一个卡死的 core 会让连接一直挂着，而没有超时的
    /// 探测本身就变成了卡死的一部分 —— 守护会永远停在这一行，再也发现
    /// 不了任何东西。
    pub async fn ping(&self, timeout: std::time::Duration) -> Result<()> {
        tokio::time::timeout(timeout, self.get("/status"))
            .await
            .map_err(|_| anyhow::anyhow!("控制面 {timeout:?} 内没回话"))??;
        Ok(())
    }

    pub async fn status(&self) -> Result<tw_api::Status> {
        let body = self.get("/status").await?;
        let s: tw_api::Status = serde_json::from_slice(&body)?;
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

    /// 发一个 POST，body 是 JSON。
    async fn post_json<Req: serde::Serialize, Res: serde::de::DeserializeOwned>(
        &self,
        path: &str,
        body: &Req,
    ) -> Result<Res> {
        self.send_json(hyper::Method::POST, path, body).await
    }

    /// 带 JSON body 的请求。**PATCH 和 POST 只差一个动词** —— 分两份
    /// 写就是两份会漂移，而漂移的那份大概率是漏了错误处理的那份。
    async fn send_json<Req: serde::Serialize, Res: serde::de::DeserializeOwned>(
        &self,
        method: hyper::Method,
        path: &str,
        body: &Req,
    ) -> Result<Res> {
        let stream = tokio::net::UnixStream::connect(&self.socket)
            .await
            .with_context(|| {
                tr!(
                    format!(
                        "无法连接控制面 {}，core 可能尚未启动或已退出",
                        self.socket.display()
                    ),
                    format!(
                        "The control plane at {} could not be reached; core may not have started yet or may have exited",
                        self.socket.display()
                    )
                )
            })?;
        let io = TokioIo::new(stream);
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        let payload = serde_json::to_string(body)?;
        let req = hyper::Request::builder()
            .method(method)
            .uri(path)
            .header(hyper::header::HOST, "localhost")
            .header(hyper::header::CONTENT_TYPE, "application/json")
            .body(payload)?;
        let resp = sender.send_request(req).await?;
        let status = resp.status();
        let bytes = resp.into_body().collect().await?.to_bytes();
        if !status.is_success() {
            // 控制面对可预期的失败回的是一条 JSON 的 `Msg`（码 + 参数 +
            // 英文原句）。**原样带出去**：翻译在界面那一侧，因为词表在
            // 那儿；在这里重新包装一遍只会把码埋掉。
            anyhow::bail!("{}", String::from_utf8_lossy(&bytes));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// L1 测速：只握手，不发业务请求。**零成本**，用户可以随便点。
    ///
    /// 全部不给就测所有上游。core 那边是逐个测的 —— 并发会让每一段的
    /// 耗时互相干扰，而这一层存在的全部意义就是那几个数字准不准。
    pub async fn l1(&self, req: tw_api::L1Request) -> Result<Vec<tw_api::L1Result>> {
        self.post_json("/l1", &req).await
    }

    /// 一个时间窗内的汇总。不给窗口就是 core 的默认口径（今天）。
    pub async fn summary(&self, from_ms: Option<i64>) -> Result<tw_api::Summary> {
        let path = match from_ms {
            Some(f) => format!("/summary?from_ms={f}"),
            None => "/summary".to_string(),
        };
        Ok(serde_json::from_slice(&self.get(&path).await?)?)
    }

    /// 一段闭区间的汇总。**概览拿它算「较上一个区间」** —— 一个没有
    /// 参照系的金额只能读，不能判断。
    pub async fn summary_range(&self, from_ms: i64, to_ms: i64) -> Result<tw_api::Summary> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/summary?from_ms={from_ms}&to_ms={to_ms}"))
                .await?,
        )?)
    }

    /// 按时间分桶的花费（概览的趋势图）。
    ///
    /// **空桶由界面补。**core 那边只产出有数据的桶 —— 要画多少格只有
    /// 知道图有多宽的那一层清楚。
    pub async fn cost_buckets(
        &self,
        from_ms: i64,
        bucket_ms: i64,
    ) -> Result<Vec<tw_api::CostBucket>> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!(
                    "/summary/buckets?from_ms={from_ms}&bucket_ms={bucket_ms}"
                ))
                .await?,
        )?)
    }

    /// 按模型或上游分组的花费。`dim` 只有 `model` / `provider` 两个值 ——
    /// core 那边是个枚举，写错的值在那里被拒掉。
    /// 按时间分桶、再按模型分层的花费（概览那张堆叠面积图）。
    ///
    /// 桶边界和 `cost_buckets` 是同一套算法，**必须如此**：界面按同一个
    /// 起点补空桶，差一格就会把有数据的那一格画在空位置上。
    pub async fn cost_buckets_by(
        &self,
        dim: &str,
        from_ms: i64,
        bucket_ms: i64,
    ) -> Result<Vec<tw_api::CostBucketGroup>> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!(
                    "/summary/buckets/by?dim={dim}&from_ms={from_ms}&bucket_ms={bucket_ms}"
                ))
                .await?,
        )?)
    }

    pub async fn cost_by(&self, dim: &str, from_ms: i64) -> Result<Vec<tw_api::CostGroup>> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/summary/by?dim={dim}&from_ms={from_ms}"))
                .await?,
        )?)
    }

    /// 最近的请求。`within` 给了就只看那一段。
    ///
    /// **不给不等于「今天」** —— 列表的默认答案是「最近 N 条」，缺省成
    /// 今天的话过了零点这张表会空掉（core 那边同一条理由）。
    pub async fn history(
        &self,
        limit: usize,
        within: Option<(i64, i64)>,
    ) -> Result<Vec<tw_api::HistoryRow>> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/history?limit={limit}{}", window_q(within)))
                .await?,
        )?)
    }

    /// 此刻还在跑的请求：它们的开始事件，原样。**半路才开始听事件流的一方
    /// 先问这个**，把订阅之前就开始了的补上（core 的 `/in-flight`）。
    pub async fn in_flight(&self) -> Result<Vec<tw_api::Event>> {
        Ok(serde_json::from_slice(&self.get("/in-flight").await?)?)
    }

    pub async fn latency(&self) -> Result<Vec<tw_api::LatencyView>> {
        Ok(serde_json::from_slice(&self.get("/latency").await?)?)
    }

    /// L3 测速要花多少。**必须先问这个。**`providers` 空 = 全部上游
    pub async fn speed_quote(
        &self,
        model: String,
        providers: Vec<String>,
    ) -> Result<tw_api::SpeedQuote> {
        self.post_json(
            "/speed/quote",
            &tw_api::SpeedRunRequest { providers, model },
        )
        .await
    }

    /// 真的跑。**这一步花钱。**
    pub async fn speed_run(
        &self,
        model: String,
        providers: Vec<String>,
    ) -> Result<Vec<tw_api::SpeedResult>> {
        self.post_json("/speed/run", &tw_api::SpeedRunRequest { providers, model })
            .await
    }

    /// 一条请求的全部细节，含 body。
    pub async fn request_detail(&self, id: i64) -> Result<tw_api::RequestDetail> {
        Ok(serde_json::from_slice(
            &self.get(&format!("/request/{id}")).await?,
        )?)
    }

    /// 订阅额度。按量付费的账号没有，那时是空列表。
    pub async fn quota(&self) -> Result<Vec<tw_api::ProviderQuota>> {
        Ok(serde_json::from_slice(&self.get("/quota").await?)?)
    }

    /// 按上游分的延迟。**「哪家 TTFT 最差」问的是这个。**
    pub async fn latency_by_provider(
        &self,
        from_ms: Option<i64>,
    ) -> Result<Vec<tw_api::LatencyView>> {
        let path = match from_ms {
            Some(f) => format!("/latency/provider?from_ms={f}"),
            None => "/latency/provider".to_string(),
        };
        Ok(serde_json::from_slice(&self.get(&path).await?)?)
    }

    /// 矩阵上能写的是哪几个客户端。
    pub async fn mcp_targets(&self) -> Result<Vec<tw_api::McpTargetView>> {
        Ok(serde_json::from_slice(&self.get("/mcp/targets").await?)?)
    }

    /// 算一份 MCP 改动。**不落盘。**
    pub async fn mcp_plan(&self, req: tw_api::McpOpRequest) -> Result<tw_api::PlanView> {
        self.send_json(hyper::Method::POST, "/mcp/plan", &req).await
    }

    pub async fn mcp_apply(&self, req: tw_api::McpOpRequest) -> Result<tw_api::AdoptResponse> {
        self.send_json(hyper::Method::POST, "/mcp/apply", &req)
            .await
    }

    /// 诊断包的正文（Markdown，已脱敏）。
    pub async fn diagnostics(&self) -> Result<String> {
        Ok(String::from_utf8(self.get("/diagnostics").await?)?)
    }

    /// 重放报价。**不发任何请求。**
    pub async fn replay_quote(&self, id: i64, provider: String) -> Result<tw_api::ReplayQuote> {
        self.send_json(
            hyper::Method::POST,
            "/replay/quote",
            &tw_api::ReplayRequest { id, provider },
        )
        .await
    }

    /// 真的发。**这一步花钱。**
    pub async fn replay_run(&self, id: i64, provider: String) -> Result<tw_api::ReplayResult> {
        self.send_json(
            hyper::Method::POST,
            "/replay/run",
            &tw_api::ReplayRequest { id, provider },
        )
        .await
    }

    // ---------------------------------------------------------------- 安全

    /// 两项防护的档位和全部规则。
    pub async fn security(&self) -> Result<tw_api::SecurityDetail> {
        Ok(serde_json::from_slice(&self.get("/security").await?)?)
    }

    /// 安全日志的一页，按时间倒序。
    pub async fn security_events(
        &self,
        guard: Option<&str>,
        within: Option<(i64, i64)>,
        before: Option<i64>,
        limit: usize,
    ) -> Result<tw_api::SecurityEventsPage> {
        let mut path = format!("/security/events?limit={limit}{}", window_q(within));
        if let Some(g) = guard {
            path.push_str(&format!("&guard={}", urlencode(g)));
        }
        if let Some(b) = before {
            path.push_str(&format!("&before={b}"));
        }
        Ok(serde_json::from_slice(&self.get(&path).await?)?)
    }

    pub async fn set_security_mode(
        &self,
        guard: &str,
        req: &tw_api::ModeSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/security/{}/mode", segment(guard)),
            req,
        )
        .await
    }

    /// 启用或停用一条内置规则。
    pub async fn toggle_security_rule(
        &self,
        guard: &str,
        id: &str,
        req: &tw_api::RuleToggle,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/security/{}/builtin/{}", segment(guard), segment(id)),
            req,
        )
        .await
    }

    /// 一条内置规则在拦截档下做什么。只有工具调用审查的规则有这一项
    pub async fn set_security_rule_action(
        &self,
        guard: &str,
        id: &str,
        req: &tw_api::ActionSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!(
                "/security/{}/builtin/{}/action",
                segment(guard),
                segment(id)
            ),
            req,
        )
        .await
    }

    pub async fn create_security_rule(
        &self,
        guard: &str,
        req: &tw_api::CustomRuleSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.post_json(&format!("/security/{}/custom", segment(guard)), req)
            .await
    }

    pub async fn update_security_rule(
        &self,
        guard: &str,
        name: &str,
        req: &tw_api::CustomRuleSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/security/{}/custom/{}", segment(guard), segment(name)),
            req,
        )
        .await
    }

    pub async fn delete_security_rule(
        &self,
        guard: &str,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        let path = with_base(
            format!("/security/{}/custom/{}", segment(guard), segment(name)),
            base_version,
        );
        self.send_json(hyper::Method::DELETE, &path, &()).await
    }

    /// 拿一段文本试一试规则。**不发出任何请求**
    pub async fn test_security(
        &self,
        guard: &str,
        req: &tw_api::SecurityTestRequest,
    ) -> Result<tw_api::SecurityTestResult> {
        self.post_json(&format!("/security/{}/test", segment(guard)), req)
            .await
    }

    /// 会话列表。
    pub async fn sessions(&self, within: Option<(i64, i64)>) -> Result<Vec<tw_api::SessionView>> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/sessions?limit=200{}", window_q(within)))
                .await?,
        )?)
    }

    /// 一次会话里的每一轮。
    pub async fn session_detail(&self, id: &str) -> Result<tw_api::SessionDetail> {
        Ok(serde_json::from_slice(
            &self.get(&format!("/sessions/{}", urlencode(id))).await?,
        )?)
    }

    /// 扫一遍客户端配置面。**每次现扫，什么都不存**。
    pub async fn scan(&self, projects: &[String]) -> Result<tw_api::ScanResponse> {
        let q = projects
            .iter()
            .map(|p| format!("project={}", urlencode(p)))
            .collect::<Vec<_>>()
            .join("&");
        let path = if q.is_empty() {
            "/scan".to_string()
        } else {
            format!("/scan?{q}")
        };
        Ok(serde_json::from_slice(&self.get(&path).await?)?)
    }

    /// 路由试算。**只算，不发任何请求。**
    pub async fn dry_run(&self, req: tw_api::DryRunRequest) -> Result<tw_api::DryRunResult> {
        self.send_json(hyper::Method::POST, "/dryrun", &req).await
    }

    // ---------------------------------------------------- 客户端接管

    /// 本机装了哪些 AI 客户端、各自指向哪儿。**只读。**
    pub async fn clients(&self) -> Result<tw_api::ClientsResponse> {
        Ok(serde_json::from_slice(&self.get("/clients").await?)?)
    }

    /// 算一份接管改动。**不落盘** —— 界面拿它画 diff 给用户确认。
    pub async fn plan_adopt(
        &self,
        client: String,
        key_name: Option<String>,
    ) -> Result<tw_api::PlanView> {
        self.send_json(
            hyper::Method::POST,
            "/clients/plan",
            &tw_api::AdoptRequest { client, key_name },
        )
        .await
    }

    /// 落盘。**用户在 diff 上点过确认之后才该调它。**
    pub async fn adopt(
        &self,
        client: String,
        key_name: Option<String>,
    ) -> Result<tw_api::AdoptResponse> {
        self.send_json(
            hyper::Method::POST,
            "/clients/adopt",
            &tw_api::AdoptRequest { client, key_name },
        )
        .await
    }

    pub async fn plan_restore(&self, client: &str) -> Result<tw_api::PlanView> {
        Ok(serde_json::from_slice(
            &self.get(&format!("/clients/{client}/restore/plan")).await?,
        )?)
    }

    pub async fn restore(&self, client: &str) -> Result<tw_api::AdoptResponse> {
        self.send_json(
            hyper::Method::POST,
            &format!("/clients/{client}/restore"),
            &serde_json::json!({}),
        )
        .await
    }

    /// 「我明明配了，为什么没生效」。
    /// 为这个客户端准备它的专用密钥（为它留着的，或者新建一把绑给它）
    pub async fn client_key(&self, client: &str) -> Result<tw_api::ClientKey> {
        self.send_json(
            hyper::Method::POST,
            &format!("/clients/{client}/key"),
            &serde_json::json!({}),
        )
        .await
    }

    pub async fn why(&self, client: &str) -> Result<Vec<tw_api::FindingView>> {
        Ok(serde_json::from_slice(
            &self.get(&format!("/clients/{client}/why")).await?,
        )?)
    }

    pub async fn storage(&self) -> Result<tw_api::StorageStatus> {
        Ok(serde_json::from_slice(&self.get("/storage").await?)?)
    }

    /// 当前配置的原文和版本号。
    pub async fn config(&self) -> Result<tw_api::ConfigText> {
        let body = self.get("/config").await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// 按字段改配置。
    ///
    /// **带上 `base_version`** —— 不带就是「我知道我在覆盖」，而界面
    /// 永远不该那样做：用户在编辑器里改了什么，我们无从知道。
    pub async fn patch_config(
        &self,
        ops: Vec<tw_api::PatchOp>,
        base_version: String,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PATCH,
            "/config",
            &tw_api::ConfigPatch {
                base_version: Some(base_version),
                ops,
            },
        )
        .await
    }

    /// 整份写回去（文本模式）。
    pub async fn put_config(
        &self,
        text: String,
        base_version: String,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            "/config",
            &tw_api::ConfigWrite { base_version, text },
        )
        .await
    }

    /// 托盘里切 `select` 组（这个策略就是「UI 上点选或托盘里切」）。
    ///
    /// **走和界面同一条路** —— `patch_config` 加乐观并发，于是它同样会
    /// 校验、存历史、防回环。
    pub async fn select_group(&self, group: &str, provider: &str) -> Result<()> {
        let cur = self.config().await?;
        self.patch_config(
            vec![tw_api::PatchOp::Replace {
                path: format!("/groups/{group}/selected"),
                value: tw_api::PatchValue::Str(provider.to_string()),
            }],
            cur.version,
        )
        .await?;
        Ok(())
    }

    // ───────────────────────────────────────── 上游

    pub async fn create_provider(
        &self,
        req: &tw_api::ProviderSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.post_json("/providers", req).await
    }

    pub async fn update_provider(
        &self,
        name: &str,
        req: &tw_api::ProviderSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/providers/{}", segment(name)),
            req,
        )
        .await
    }

    pub async fn delete_provider(
        &self,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        let path = with_base(format!("/providers/{}", segment(name)), base_version);
        self.send_json(hyper::Method::DELETE, &path, &()).await
    }

    /// 检测一个上游，**不保存**。零成本，不调用模型
    pub async fn test_provider(
        &self,
        req: &tw_api::ProviderTest,
    ) -> Result<tw_api::ProviderTestResult> {
        self.post_json("/providers/test", req).await
    }

    /// 按接口地址自动识别会得到什么。不联网
    pub async fn preview_provider(
        &self,
        req: &tw_api::ProviderPreviewRequest,
    ) -> Result<tw_api::ProviderPreview> {
        self.post_json("/providers/preview", req).await
    }

    pub async fn provider_models(&self, name: &str) -> Result<tw_api::ProviderModelsView> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/providers/{}/models", segment(name)))
                .await?,
        )?)
    }

    pub async fn refresh_provider_models(&self, name: &str) -> Result<tw_api::ProviderModelsView> {
        self.post_json(&format!("/providers/{}/models/refresh", segment(name)), &())
            .await
    }

    /// 补问缺失、失败、过期的模型清单。**立刻回**：答案随 `models_changed` 到
    pub async fn refresh_stale_models(&self) -> Result<tw_api::ModelsRefreshing> {
        self.post_json("/models/refresh", &()).await
    }

    // ───────────────────────────────────────── ChatGPT 账号

    /// 开始一次登录。回来的地址要在浏览器里打开，core 在本机等回调
    pub async fn start_chatgpt_login(
        &self,
        req: &tw_api::ChatgptLoginStart,
    ) -> Result<tw_api::ChatgptLogin> {
        self.post_json("/chatgpt/login", req).await
    }

    pub async fn chatgpt_login_status(&self, id: &str) -> Result<tw_api::ChatgptLoginStatus> {
        Ok(serde_json::from_slice(
            &self.get(&format!("/chatgpt/login/{}", segment(id))).await?,
        )?)
    }

    pub async fn cancel_chatgpt_login(&self, id: &str) -> Result<tw_api::ChatgptLoginStatus> {
        self.send_json(
            hyper::Method::DELETE,
            &format!("/chatgpt/login/{}", segment(id)),
            &(),
        )
        .await
    }

    pub async fn chatgpt_usage(&self, name: &str) -> Result<tw_api::ChatgptUsage> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/providers/{}/chatgpt/usage", segment(name)))
                .await?,
        )?)
    }

    pub async fn chatgpt_resets(&self, name: &str) -> Result<tw_api::ResetCredits> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/providers/{}/chatgpt/resets", segment(name)))
                .await?,
        )?)
    }

    /// 用掉一张额度重置卡。**只在用户明确点下去时调**：卡用掉就回不来
    pub async fn use_chatgpt_reset(
        &self,
        name: &str,
        req: &tw_api::ResetCreditUse,
    ) -> Result<tw_api::ResetCreditUsed> {
        self.post_json(&format!("/providers/{}/chatgpt/resets", segment(name)), req)
            .await
    }

    // ───────────────────────────────────────── 代理

    pub async fn create_proxy(&self, req: &tw_api::ProxySave) -> Result<tw_api::ConfigWritten> {
        self.post_json("/proxies", req).await
    }

    pub async fn update_proxy(
        &self,
        name: &str,
        req: &tw_api::ProxySave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/proxies/{}", segment(name)),
            req,
        )
        .await
    }

    pub async fn delete_proxy(
        &self,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        let path = with_base(format!("/proxies/{}", segment(name)), base_version);
        self.send_json(hyper::Method::DELETE, &path, &()).await
    }

    /// 检测一个代理：完成握手和认证。**不保存**
    pub async fn test_proxy(&self, req: &tw_api::ProxyTest) -> Result<tw_api::L1Result> {
        self.post_json("/proxies/test", req).await
    }

    // ───────────────────────────────────────── 价目表

    pub async fn pricing_status(&self) -> Result<tw_api::PricingStatus> {
        Ok(serde_json::from_slice(&self.get("/pricing").await?)?)
    }

    /// 立即刷新默认价目表
    pub async fn refresh_pricing(&self) -> Result<tw_api::PricingRefreshed> {
        self.post_json("/pricing/refresh", &()).await
    }

    pub async fn set_price_auto_update(
        &self,
        req: &tw_api::AutoUpdateSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(hyper::Method::PUT, "/pricing/auto_update", req)
            .await
    }

    pub async fn query_prices(&self, req: &tw_api::PriceQuery) -> Result<tw_api::PriceQueryResult> {
        self.post_json("/pricing/query", req).await
    }

    pub async fn price_sheet(&self, name: &str) -> Result<tw_api::PriceSheetInput> {
        Ok(serde_json::from_slice(
            &self
                .get(&format!("/pricing/sheets/{}", segment(name)))
                .await?,
        )?)
    }

    pub async fn create_price_sheet(
        &self,
        req: &tw_api::PriceSheetSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.post_json("/pricing/sheets", req).await
    }

    pub async fn update_price_sheet(
        &self,
        name: &str,
        req: &tw_api::PriceSheetSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/pricing/sheets/{}", segment(name)),
            req,
        )
        .await
    }

    pub async fn delete_price_sheet(
        &self,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        let path = with_base(format!("/pricing/sheets/{}", segment(name)), base_version);
        self.send_json(hyper::Method::DELETE, &path, &()).await
    }

    // ───────────────────────────────────────── 路由与策略组

    pub async fn create_route(&self, req: &tw_api::RouteSave) -> Result<tw_api::ConfigWritten> {
        self.post_json("/routes", req).await
    }

    pub async fn update_route(
        &self,
        name: &str,
        req: &tw_api::RouteSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/routes/{}", segment(name)),
            req,
        )
        .await
    }

    /// 删除一条路由。使用它的密钥改用 `reassign_to`；不给就改用默认路由
    pub async fn delete_route(
        &self,
        name: &str,
        base_version: Option<&str>,
        reassign_to: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        let mut path = with_base(format!("/routes/{}", segment(name)), base_version);
        if let Some(t) = reassign_to {
            path.push(if path.contains('?') { '&' } else { '?' });
            path.push_str(&format!("reassign_to={}", urlencode(t)));
        }
        self.send_json(hyper::Method::DELETE, &path, &()).await
    }

    pub async fn set_default_route(
        &self,
        req: &tw_api::DefaultRouteSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(hyper::Method::PUT, "/default_route", req)
            .await
    }

    pub async fn create_group(&self, req: &tw_api::GroupSave) -> Result<tw_api::ConfigWritten> {
        self.post_json("/groups", req).await
    }

    pub async fn update_group(
        &self,
        name: &str,
        req: &tw_api::GroupSave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            &format!("/groups/{}", segment(name)),
            req,
        )
        .await
    }

    pub async fn delete_group(
        &self,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        let path = with_base(format!("/groups/{}", segment(name)), base_version);
        self.send_json(hyper::Method::DELETE, &path, &()).await
    }

    /// 网关知道的全部模型，以及能提供它们的上游
    pub async fn known_models(&self) -> Result<Vec<tw_api::KnownModel>> {
        Ok(serde_json::from_slice(&self.get("/models").await?)?)
    }

    pub async fn config_at(&self, offset: usize) -> Result<tw_api::ConfigAt> {
        let body = self.get(&format!("/config/at?offset={offset}")).await?;
        Ok(serde_json::from_slice(&body)?)
    }

    pub async fn config_history(&self) -> Result<Vec<tw_api::ConfigVersion>> {
        let body = self.get("/config/history").await?;
        Ok(serde_json::from_slice(&body)?)
    }

    pub async fn rollback(&self, version: String) -> Result<tw_api::ConfigWritten> {
        self.post_json("/config/rollback", &tw_api::RollbackRequest { version })
            .await
    }

    // ── 网关密钥。**规则全在 core**：默认密钥删不得、接管中的删不得、
    // 改名带着规则一起改、更换同步给被接管的客户端

    pub async fn keys(&self) -> Result<Vec<tw_api::ClientView>> {
        Ok(serde_json::from_slice(&self.get("/keys").await?)?)
    }

    /// 一把密钥的明文。**只在用户点「复制」那一刻问**
    pub async fn key_value(&self, name: &str) -> Result<tw_api::KeyValue> {
        Ok(serde_json::from_slice(
            &self.get(&format!("/keys/{}/value", segment(name))).await?,
        )?)
    }

    pub async fn create_key(&self, req: &tw_api::KeySave) -> Result<tw_api::ConfigWritten> {
        self.post_json("/keys", req).await
    }

    pub async fn update_key(
        &self,
        name: &str,
        req: &tw_api::KeySave,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(hyper::Method::PUT, &format!("/keys/{}", segment(name)), req)
            .await
    }

    pub async fn delete_key(
        &self,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        let path = with_base(format!("/keys/{}", segment(name)), base_version);
        self.send_json(hyper::Method::DELETE, &path, &()).await
    }

    /// 换一把新的，并同步给正在用它的客户端。**一次调用做完两件事**
    pub async fn rotate_key(
        &self,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::KeyRotated> {
        self.post_json(
            &format!("/keys/{}/rotate", segment(name)),
            &tw_api::KeyRotate {
                base_version: base_version.map(str::to_string),
            },
        )
        .await
    }

    /// 保存监听设置。**core 先试着绑一下新地址**，绑不上就不写配置、说清为什么。
    pub async fn save_listen(&self, save: &tw_api::ListenSave) -> Result<tw_api::ConfigWritten> {
        self.send_json(hyper::Method::PUT, "/listen", save).await
    }

    pub async fn set_default_key(
        &self,
        name: &str,
        base_version: Option<&str>,
    ) -> Result<tw_api::ConfigWritten> {
        self.send_json(
            hyper::Method::PUT,
            "/default_key",
            &tw_api::DefaultKeySave {
                name: name.to_string(),
                base_version: base_version.map(str::to_string),
            },
        )
        .await
    }

    /// 这台机器上有哪些网卡。
    ///
    /// **每次现问，不缓存。**插拔网线、连上另一个 Wi-Fi、起一条 VPN，
    /// 清单就变了 —— 缓存下来只会让选单里出现一个已经不存在的地址，
    /// 而选中它的后果是网关起不来。
    pub async fn interfaces(&self) -> Result<Vec<tw_api::NicView>> {
        let body = self.get("/interfaces").await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// 界面要显示的配置概览。
    pub async fn overview(&self) -> Result<tw_api::Overview> {
        let body = self.get("/overview").await?;
        Ok(serde_json::from_slice(&body)?)
    }

    /// 订阅事件流，逐条交给回调。
    ///
    /// 断开就返回 —— **重连由调用方决定**。守护那边已经有退避逻辑了，
    /// 这里再来一套会变成两套互相不知道对方存在的重试。
    pub async fn subscribe_events<F>(&self, mut on_event: F) -> Result<()>
    where
        F: FnMut(tw_api::Event) + Send,
    {
        let stream = tokio::net::UnixStream::connect(&self.socket).await?;
        let io = TokioIo::new(stream);
        let (mut sender, conn) = hyper::client::conn::http1::handshake(io).await?;
        tokio::spawn(async move {
            let _ = conn.await;
        });
        let req = hyper::Request::builder()
            .uri("/events")
            .header(hyper::header::HOST, "localhost")
            .header(hyper::header::ACCEPT, "text/event-stream")
            .body(String::new())?;
        let mut resp = sender.send_request(req).await?;

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

/// 时间窗拼成 query。**两端都可缺** —— 只给起点就是「从那时起到现在」。
fn window_q(within: Option<(i64, i64)>) -> String {
    match within {
        None => String::new(),
        Some((from, to)) => format!("&from_ms={from}&to_ms={to}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[tokio::test]
    async fn connecting_to_a_missing_socket_says_core_might_be_down() {
        // 「Connection refused」对用户毫无意义。这里要说的是「core 可能
        // 还没起来」—— 那才是他能行动的信息。
        let c = ControlClient::new(PathBuf::from("/tmp/definitely-not-a-socket-xyz"));
        let e = c.status().await.unwrap_err();
        let msg = format!("{e:#}");
        assert!(msg.contains("core"), "{msg}");
    }

    /// 同一句话按界面语言说。core 没起来的时候，几乎每个命令回给界面的都是它
    #[test]
    fn the_unreachable_message_follows_the_interface_language() {
        use crate::i18n::{Lang, with_lang};
        let c = ControlClient::new(PathBuf::from("/tmp/definitely-not-a-socket-xyz"));
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
        let en = said(Lang::En);
        assert!(
            en.starts_with(
                "The control plane at /tmp/definitely-not-a-socket-xyz could not be reached; \
                 core may not have started yet or may have exited: "
            ),
            "{en}"
        );
        let zh = said(Lang::Zh);
        assert!(
            zh.starts_with(
                "无法连接控制面 /tmp/definitely-not-a-socket-xyz，core 可能尚未启动或已退出"
            ),
            "{zh}"
        );
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
