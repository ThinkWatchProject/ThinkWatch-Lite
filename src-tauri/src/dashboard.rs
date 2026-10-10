//! 概览页：一次取齐的汇总、趋势、分组、延迟和生成速度。

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
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let since = since_ms.min(now);
    let bucket = bucket_ms.max(60_000);
    // **十四样同时问，不排队。**每一问都是一条新连接、一次握手：排着队问，连着远程时
    // 十四问的来回一个接一个叠起来，而这一页是默认打开的那一页、每个请求结束都要重取。
    // 钥匙只读一次（`pin`）
    let c = state.control.pin().map_err(text)?;
    // 延迟、生成速度和汇总**同一个时间窗**。不给窗口的话 core 按「今天零点至今」算，
    // 而界面上它们和上面的数字摆在一起，读的人会当成同一段时间
    let win = window(Some(since), None);
    let buckets = tw_api::BucketQuery {
        from_ms: Some(since),
        to_ms: None,
        bucket_ms: Some(bucket),
    };
    // 同样的格子按三个维度分：模型（趋势图的 token 合计、明细表的「模型」）、上游和
    // 密钥（明细表的另两页）。**格宽和模型那份一样**，三份的格子对得上
    let by = |dim| tw_api::BucketGroupQuery {
        from_ms: Some(since),
        to_ms: None,
        bucket_ms: Some(bucket),
        dim,
    };
    let (by_model, by_provider, by_client) = (
        by(tw_api::CostDim::Model),
        by(tw_api::CostDim::Provider),
        by(tw_api::CostDim::Client),
    );
    // **上一个等长区间。**一个没有参照系的金额只能读，不能判断
    // ——「$4.05」是多还是少，只有和上一个七天比过才知道
    let before = window(Some(since - (now - since)), Some(since));
    // **整段时间的首 token 分位**：问一个宽过整个时间窗的格子，整段落在第 0 格。分位数不能
    // 从每一格（或每个模型）的分位合出来 —— 中位数不能这么合 —— 只能让 core 拿整段的样本
    // 求。终点和汇总一样不给（到 core 的「现在」），两边数的是同一批请求
    let whole = |from_ms, to_ms| tw_api::BucketQuery {
        from_ms: Some(from_ms),
        to_ms,
        bucket_ms: Some(WHOLE_MS),
    };
    let (whole_now, whole_before) = (
        whole(since, None),
        whole(since - (now - since), Some(since)),
    );
    let (
        summary,
        latency,
        latency_by_provider,
        latency_by_client,
        token_rate,
        token_rate_by_provider,
        storage,
        buckets,
        buckets_by_model,
        buckets_by_provider,
        buckets_by_client,
        prev,
        ttft,
        prev_ttft,
    ) = tokio::join!(
        c.call::<ep::Summary>(&[], &win),
        c.call::<ep::Latency>(&[], &win),
        c.call::<ep::LatencyByProvider>(&[], &win),
        c.call::<ep::LatencyByClient>(&[], &win),
        c.call::<ep::TokenRate>(&[], &win),
        c.call::<ep::TokenRateByProvider>(&[], &win),
        c.call::<ep::Storage>(&[], &()),
        c.call::<ep::CostBuckets>(&[], &buckets),
        c.call::<ep::CostBucketsBy>(&[], &by_model),
        c.call::<ep::CostBucketsBy>(&[], &by_provider),
        c.call::<ep::CostBucketsBy>(&[], &by_client),
        c.call::<ep::Summary>(&[], &before),
        c.call::<ep::CostBuckets>(&[], &whole_now),
        c.call::<ep::CostBuckets>(&[], &whole_before),
    );
    Ok(Dashboard {
        summary: summary.map_err(text)?,
        latency: latency.ok(),
        latency_by_provider: latency_by_provider.ok(),
        latency_by_client: latency_by_client.ok(),
        token_rate: token_rate.ok(),
        token_rate_by_provider: token_rate_by_provider.ok(),
        storage: storage.ok(),
        // 趋势和分组。**拿不到不该让整页失败** —— 这一页别的部分照样有用（同一条：
        // 观测层的缺失不该扩散）。但拿不到是 `None`，**不是空的**：空的在界面上就是
        // 一张全零的图，读作「这段时间没有请求」，那是一个编出来的零
        buckets: buckets.ok(),
        buckets_by_model: buckets_by_model.ok(),
        buckets_by_provider: buckets_by_provider.ok(),
        buckets_by_client: buckets_by_client.ok(),
        // 拿不到就不显示那句对比，不影响这一页别的部分
        prev: prev.ok(),
        ttft: ttft.ok().map(|b| Percentiles::of(&b)),
        prev_ttft: prev_ttft.ok().map(|b| Percentiles::of(&b)),
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
    /// 按密钥分（`model` 是密钥名）。明细表的「密钥」一页
    latency_by_client: Option<Vec<tw_api::LatencyView>>,
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
    /// 同样的格子按上游分。概览明细表的「上游」一页，失败最多的那个上游也从这里看
    buckets_by_provider: Option<Vec<tw_api::CostBucketGroup>>,
    /// 同样的格子按密钥分（core 的 `client` 就是密钥名）。明细表的「密钥」一页
    buckets_by_client: Option<Vec<tw_api::CostBucketGroup>>,
    /// 上一个等长区间的汇总。拿不到就是没有对比，不是零
    prev: Option<tw_api::Summary>,
    /// 整段时间的首 token 分位（不分模型）。拿不到是 `None`；没有样本是 `samples` 为 0
    ttft: Option<Percentiles>,
    /// 上一个等长区间的，首 token 那张卡片的环比用
    prev_ttft: Option<Percentiles>,
    /// 实际用上的时间窗起点。**原样回传** —— 界面补空桶要从它数起，而界面送来的
    /// 起点在未来时（时钟被往回拨过）这里截到了现在
    since_ms: i64,
}

/// 宽过任何时间窗的一格（一百年）：按它分格，整段时间都落在第 0 格
pub(crate) const WHOLE_MS: i64 = 100 * 365 * 86_400_000;

/// 一段时间里第一个 token 到的时刻的分位，毫秒。
///
/// **没有样本和取不到是两回事**：没有样本是 `samples` 为 0、两个分位为 `None`（这段时间
/// 没有流式请求）；取不到是外面那一层 `Option` 为 `None`。
#[derive(serde::Serialize)]
pub struct Percentiles {
    p50_ms: Option<i64>,
    p95_ms: Option<i64>,
    samples: i64,
}

impl Percentiles {
    /// 从「整段一格」的那份里取。没有请求时那一格不在（core 不产出空桶）
    fn of(b: &[tw_api::CostBucket]) -> Self {
        let first = b.first();
        Self {
            p50_ms: first.and_then(|x| x.ttft_p50_ms),
            p95_ms: first.and_then(|x| x.ttft_p95_ms),
            samples: first.map_or(0, |x| x.ttft_samples),
        }
    }
}

/// 一段时间窗。两端各自可缺：只给起点就是「从那时起到现在」。
pub(crate) fn window(from_ms: Option<i64>, to_ms: Option<i64>) -> tw_api::Window {
    tw_api::Window { from_ms, to_ms }
}
