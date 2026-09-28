//! 上游页的汇总：一行上的费用、延迟、额度、走势一起取。
//!
//! 上游、代理、价目表的增删改与检测都是直接转发的端点，走 `crate::call`。

use tw_api::ep;

use crate::AppState;
use crate::error::Out;

/// 上游列表那几列统计：一段时间里的请求与费用、第一个 token 到的时刻、生成速度、订阅
/// 额度，以及同一段时间按上游分格的请求数（每一行的走势）。
///
/// **一起取。**列表上它们是同一行的几格，分几次 invoke 会让一行数字分几次
/// 跳变。拿不到的那一样是 `None`，不让整张列表打不开 —— 存储层不在的时候网关照常
/// 转发，列表也该照常打开。**但不是空的**：空的在界面上读作「24 小时里 0 次请求、
/// $0」，那是一个编出来的零（同一条见 `keys::key_usage`）。
///
/// **几样同时问，不排队。**额度那一问可能要等几秒：GLM Coding Plan 的额度不在响应头
/// 里，core 答 `/quota` 时现去问账号的额度接口（最多等 5 秒）。排着队问的话，费用和
/// 走势要白白跟着等。
#[derive(serde::Serialize)]
pub struct UpstreamStats {
    costs: Option<Vec<tw_api::CostGroup>>,
    latency: Option<Vec<tw_api::LatencyView>>,
    token_rate: Option<Vec<tw_api::TokenRateView>>,
    quotas: Option<Vec<tw_api::ProviderQuota>>,
    /// 按界面给的格宽、按上游分格。**稀疏的** —— 没有请求的格子不在里面，由界面补
    buckets: Option<Vec<tw_api::CostBucketGroup>>,
}

/// 格宽的下限。和概览同一条：再细就是把噪声当细节，而这一条查询还要乘上上游个数
const MIN_BUCKET_MS: i64 = 60_000;

#[tauri::command]
pub async fn upstream_stats(
    state: tauri::State<'_, AppState>,
    // 时间窗的起点和一格多宽，**都由界面给**：格子要对齐到本地的整点，而本地时区
    // 只有界面知道（见 `dashboard` 的同名参数）
    since_ms: i64,
    bucket_ms: i64,
) -> Out<UpstreamStats> {
    let c = &state.control;
    let costs = tw_api::GroupQuery {
        from_ms: Some(since_ms),
        to_ms: None,
        dim: tw_api::CostDim::Provider,
    };
    let window = since(since_ms);
    let buckets = tw_api::BucketGroupQuery {
        from_ms: Some(since_ms),
        to_ms: None,
        bucket_ms: Some(bucket_ms.max(MIN_BUCKET_MS)),
        dim: tw_api::CostDim::Provider,
    };
    let (costs, latency, token_rate, quotas, buckets) = tokio::join!(
        c.call::<ep::CostBy>(&[], &costs),
        c.call::<ep::LatencyByProvider>(&[], &window),
        c.call::<ep::TokenRateByProvider>(&[], &window),
        c.call::<ep::Quota>(&[], &()),
        c.call::<ep::CostBucketsBy>(&[], &buckets),
    );
    Ok(UpstreamStats {
        costs: costs.ok(),
        latency: latency.ok(),
        token_rate: token_rate.ok(),
        quotas: quotas.ok(),
        buckets: buckets.ok(),
    })
}

/// 从某一刻到现在
fn since(from_ms: i64) -> tw_api::Window {
    tw_api::Window {
        from_ms: Some(from_ms),
        to_ms: None,
    }
}
