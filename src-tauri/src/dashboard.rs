//! 概览页：一次取齐的汇总、趋势、延迟和生成速度。

use tw_api::ep;

use crate::{
    AppState,
    error::{Out, text},
};

/// 一段时间的汇总、趋势、延迟、生成速度、存储状态，和上一个等长区间的汇总。
///
/// **一起取。**界面上它们是同一块，分几次 invoke 会让那一块在几十毫秒里分几次
/// 跳变。
#[tauri::command]
pub async fn dashboard(
    state: tauri::State<'_, AppState>,
    // 时间窗的起点，以及趋势图一格多宽。
    //
    // **两个都由界面给，这一层不再自己算。**原来这里收的是「往前看多少
    // 毫秒」，起点是 `now - window` —— 每刷新一次就往前挪一点，于是所有
    // 格子的边界跟着挪：没有任何新请求，柱子的高低也会变，而那是「你
    // 什么时候看」造成的，不是数据。格子边界该对齐到**本地**日历（本地
    // 零点、整点），而本地时区只有界面知道。
    //
    // 另一个理由是这两个数原来在两边各算了一遍：一边算窗口，一边算格宽，
    // 而补空桶要求两边算出来的格子完全重合。对不上的表现是整张图全是零。
    //
    // **没有兜底。**这一层替界面挑一个时间窗（原来是「最近 24 小时」），就又有一处
    // 不按本地时钟定的窗口；缺参数是界面的错，该在那边报出来。
    since_ms: i64,
    bucket_ms: i64,
) -> Out<Dashboard> {
    let c = &state.control;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let since = since_ms.min(now);
    let bucket = bucket_ms.max(60_000);
    Ok(Dashboard {
        summary: c
            .call::<ep::Summary>(&[], &window(Some(since), None))
            .await
            .map_err(text)?,
        // 延迟和汇总**同一个时间窗**。不给窗口的话 core 按「今天零点至今」算，而
        // 界面上它和上面的数字摆在一起，读的人会当成同一段时间
        latency: c
            .call::<ep::Latency>(&[], &window(Some(since), None))
            .await
            .ok(),
        latency_by_provider: c
            .call::<ep::LatencyByProvider>(&[], &window(Some(since), None))
            .await
            .ok(),
        token_rate: c
            .call::<ep::TokenRate>(&[], &window(Some(since), None))
            .await
            .ok(),
        token_rate_by_provider: c
            .call::<ep::TokenRateByProvider>(&[], &window(Some(since), None))
            .await
            .ok(),
        storage: c.call::<ep::Storage>(&[], &()).await.ok(),
        // 趋势和分组。**拿不到不该让整页失败** —— 这一页别的部分照样有用（同一条：
        // 观测层的缺失不该扩散）。但拿不到是 `None`，**不是空的**：空的在界面上就是
        // 一张全零的图，读作「这段时间没有请求」，那是一个编出来的零
        buckets: c
            .call::<ep::CostBuckets>(
                &[],
                &tw_api::BucketQuery {
                    from_ms: Some(since),
                    to_ms: None,
                    bucket_ms: Some(bucket),
                },
            )
            .await
            .ok(),
        buckets_by_model: c
            .call::<ep::CostBucketsBy>(
                &[],
                &tw_api::BucketGroupQuery {
                    from_ms: Some(since),
                    to_ms: None,
                    bucket_ms: Some(bucket),
                    dim: tw_api::CostDim::Model,
                },
            )
            .await
            .ok(),
        // **上一个等长区间。**一个没有参照系的金额只能读，不能判断
        // ——「$4.05」是多还是少，只有和上一个七天比过才知道。
        // 拿不到就不显示那句对比，不影响这一页别的部分。
        prev: c
            .call::<ep::Summary>(&[], &window(Some(since - (now - since)), Some(since)))
            .await
            .ok(),
        since_ms: since,
    })
}

#[derive(serde::Serialize)]
pub struct Dashboard {
    summary: tw_api::Summary,
    /// 第一个 token 到的时刻的分位，按模型分。和 `summary` 同一个时间窗。
    ///
    /// 下面这几样**拿不到是 `None`，不是空的**：空的是「没有样本、没有请求」，
    /// 取数失败时那样说就是编了一个零。界面见到 `None` 写「暂时取不到」
    latency: Option<Vec<tw_api::LatencyView>>,
    /// 按上游分。**和按模型分是两个问题**
    latency_by_provider: Option<Vec<tw_api::LatencyView>>,
    /// 生成速度的中位数，按模型分。同一个时间窗
    token_rate: Option<Vec<tw_api::TokenRateView>>,
    /// 按上游分
    token_rate_by_provider: Option<Vec<tw_api::TokenRateView>>,
    /// 拿不到就是没有 —— 存储层不在的时候网关照常跑
    storage: Option<tw_api::StorageStatus>,
    /// 按界面给的格宽分格。**稀疏的** —— 空桶由界面补
    buckets: Option<Vec<tw_api::CostBucket>>,
    /// 同样的格子，再按模型分层。趋势图靠它把「什么时候花的」和
    /// 「花在哪个模型上」画成同一张图
    buckets_by_model: Option<Vec<tw_api::CostBucketGroup>>,
    /// 上一个等长区间的汇总。拿不到就是没有对比，不是零
    prev: Option<tw_api::Summary>,
    /// 实际用上的时间窗起点。**原样回传** —— 界面补空桶要从它数起，而界面送来的
    /// 起点在未来时（时钟被往回拨过）这里截到了现在
    since_ms: i64,
}

/// 一段时间窗。两端各自可缺：只给起点就是「从那时起到现在」。
pub(crate) fn window(from_ms: Option<i64>, to_ms: Option<i64>) -> tw_api::Window {
    tw_api::Window { from_ms, to_ms }
}
