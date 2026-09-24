//! 上游页的汇总：一行上的费用、延迟、额度一起取。
//!
//! 上游、代理、价目表的增删改与检测都是直接转发的端点，走 `crate::call`。

use tw_api::ep;

use crate::AppState;
use crate::error::Out;

/// 上游列表那几列统计：24 小时的请求与费用、首字节耗时、订阅额度。
///
/// **一起取。**列表上它们是同一行的几格，分几次 invoke 会让一行数字分几次
/// 跳变。拿不到的就是空的 —— 存储层不在的时候网关照常转发，列表也该照常打开。
#[derive(serde::Serialize)]
pub struct UpstreamStats {
    costs: Vec<tw_api::CostGroup>,
    latency: Vec<tw_api::LatencyView>,
    quotas: Vec<tw_api::ProviderQuota>,
}

#[tauri::command]
pub async fn upstream_stats(
    state: tauri::State<'_, AppState>,
    since_ms: i64,
) -> Out<UpstreamStats> {
    let c = &state.control;
    Ok(UpstreamStats {
        costs: c
            .call::<ep::CostBy>(
                &[],
                &tw_api::GroupQuery {
                    from_ms: Some(since_ms),
                    to_ms: None,
                    dim: tw_api::CostDim::Provider,
                },
            )
            .await
            .unwrap_or_default(),
        latency: c
            .call::<ep::LatencyByProvider>(&[], &since(since_ms))
            .await
            .unwrap_or_default(),
        quotas: c.call::<ep::Quota>(&[], &()).await.unwrap_or_default(),
    })
}

/// 从某一刻到现在
fn since(from_ms: i64) -> tw_api::Window {
    tw_api::Window {
        from_ms: Some(from_ms),
        to_ms: None,
    }
}
