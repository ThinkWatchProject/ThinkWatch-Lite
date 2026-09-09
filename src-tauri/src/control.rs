//! 控制面客户端：通过 unix socket 和 core 说话。
//!
//! 走 socket 而不是 TCP 的理由是权限（DESIGN.md §2.1）：一个 `0700` 的
//! socket 文件天然只有当前用户能连，不需要再发明一套 token。

use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use http_body_util::BodyExt;
use hyper_util::rt::TokioIo;

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
                format!(
                    "连不上控制面 {}。core 可能还没起来，或者已经挂了。",
                    self.socket.display()
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
        if !resp.status().is_success() {
            anyhow::bail!("控制面返回 {}", resp.status());
        }
        Ok(resp.into_body().collect().await?.to_bytes().to_vec())
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
        // 版本不匹配要明确提示「请升级客户端」，而不是以奇怪的方式失败
        // （§9.6）。这里 UI 和 core 是一起打包的，理论上不该发生 ——
        // 但开发时会（一边改 core 一边跑旧 UI），而那正是最需要一句
        // 人话的时候。
        if s.api_version != tw_api::CONTROL_API_VERSION {
            anyhow::bail!(
                "控制面协议版本对不上：core 是 {}，界面认的是 {}。两边版本不一致，请重新构建。",
                s.api_version,
                tw_api::CONTROL_API_VERSION
            );
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
                format!(
                    "连不上控制面 {}。core 可能还没起来，或者已经挂了。",
                    self.socket.display()
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
            // 控制面对可预期的失败回的是人话（比如「已经配过上游了」），
            // 原样带出去 —— 在这里重新包装一遍只会把它埋掉。
            anyhow::bail!("{}", String::from_utf8_lossy(&bytes));
        }
        Ok(serde_json::from_slice(&bytes)?)
    }

    /// 探一个上游能不能用。零成本，用户可以随便点。
    pub async fn probe(&self, base_url: &str, key: &str) -> Result<tw_api::ProbeResponse> {
        self.post_json(
            "/probe",
            &tw_api::ProbeRequest {
                base_url: base_url.to_string(),
                key: key.to_string(),
            },
        )
        .await
    }

    /// L1 测速：只握手，不发业务请求。**零成本**，用户可以随便点。
    ///
    /// 全部不给就测所有上游。core 那边是逐个测的 —— 并发会让每一段的
    /// 耗时互相干扰，而这一层存在的全部意义就是那几个数字准不准。
    pub async fn l1(&self, req: tw_api::L1Request) -> Result<Vec<tw_api::L1Result>> {
        self.post_json("/l1", &req).await
    }

    /// 今天的汇总。
    pub async fn summary(&self) -> Result<tw_api::Summary> {
        Ok(serde_json::from_slice(&self.get("/summary").await?)?)
    }

    pub async fn history(&self, limit: usize) -> Result<Vec<tw_api::HistoryRow>> {
        Ok(serde_json::from_slice(
            &self.get(&format!("/history?limit={limit}")).await?,
        )?)
    }

    pub async fn latency(&self) -> Result<Vec<tw_api::LatencyView>> {
        Ok(serde_json::from_slice(&self.get("/latency").await?)?)
    }

    /// 出站密钥检测攒下的证据（§5.0）。
    pub async fn leaks(&self) -> Result<Vec<tw_api::LeakGroup>> {
        Ok(serde_json::from_slice(&self.get("/leaks").await?)?)
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
    /// 永远不该那样做：用户在编辑器里改了什么，我们无从知道（§3.8）。
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

    pub async fn config_history(&self) -> Result<Vec<tw_api::ConfigVersion>> {
        let body = self.get("/config/history").await?;
        Ok(serde_json::from_slice(&body)?)
    }

    pub async fn rollback(&self, version: String) -> Result<tw_api::ConfigWritten> {
        self.post_json("/config/rollback", &tw_api::RollbackRequest { version })
            .await
    }

    /// 首次运行：写下第一个上游。
    pub async fn setup(
        &self,
        name: &str,
        base_url: &str,
        key: &str,
    ) -> Result<tw_api::SetupResponse> {
        self.post_json(
            "/setup",
            &tw_api::SetupRequest {
                name: name.to_string(),
                base_url: base_url.to_string(),
                key: key.to_string(),
            },
        )
        .await
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

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn connecting_to_a_missing_socket_says_core_might_be_down() {
        // 「Connection refused」对用户毫无意义。这里要说的是「core 可能
        // 还没起来」—— 那才是他能行动的信息。
        let c = ControlClient::new(PathBuf::from("/tmp/definitely-not-a-socket-xyz"));
        let e = c.status().await.unwrap_err();
        let msg = format!("{e:#}");
        assert!(msg.contains("core"), "{msg}");
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
            "started\",\"id\":1,\"client\":\"c\",\"provider\":\"p\",\"method\":\"POST\",\"path\":\"/x\",\"at_ms\":0}\n\n",
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
