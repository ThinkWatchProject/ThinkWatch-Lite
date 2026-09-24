//! 上游页的命令：上游、代理、价目表的增删改与检测。
//!
//! **这一层只转发。**名字怎么校验、改名时引用怎么跟着改、被引用时能不能删、
//! 一次保存写几个版本，全在 core；这里多做一件事，就多一处和 core 说法不一
//! 致的可能。

use crate::AppState;

use crate::error::{Out, text};

// ─────────────────────────────────────────────── 上游

#[tauri::command]
pub async fn create_provider(
    state: tauri::State<'_, AppState>,
    save: tw_api::ProviderSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.create_provider(&save).await.map_err(text)
}

#[tauri::command]
pub async fn update_provider(
    state: tauri::State<'_, AppState>,
    name: String,
    save: tw_api::ProviderSave,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .update_provider(&name, &save)
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn delete_provider(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .delete_provider(&name, base_version.as_deref())
        .await
        .map_err(text)
}

/// 检测连接。**不保存、不调用模型** —— 验证地址与凭据，并获取模型列表。
#[tauri::command]
pub async fn test_provider(
    state: tauri::State<'_, AppState>,
    test: tw_api::ProviderTest,
) -> Out<tw_api::ProviderTestResult> {
    state.control.test_provider(&test).await.map_err(text)
}

#[tauri::command]
pub async fn preview_provider(
    state: tauri::State<'_, AppState>,
    preview: tw_api::ProviderPreviewRequest,
) -> Out<tw_api::ProviderPreview> {
    state.control.preview_provider(&preview).await.map_err(text)
}

#[tauri::command]
pub async fn provider_models(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Out<tw_api::ProviderModelsView> {
    state.control.provider_models(&name).await.map_err(text)
}

#[tauri::command]
pub async fn refresh_provider_models(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Out<tw_api::ProviderModelsView> {
    state
        .control
        .refresh_provider_models(&name)
        .await
        .map_err(text)
}

/// 打开上游页时补问模型清单：还没有的、没问到的、过期的。不等上游回话。
#[tauri::command]
pub async fn refresh_stale_models(
    state: tauri::State<'_, AppState>,
) -> Out<tw_api::ModelsRefreshing> {
    state.control.refresh_stale_models().await.map_err(text)
}

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
        costs: c.cost_by("provider", since_ms).await.unwrap_or_default(),
        latency: c
            .latency_by_provider(Some(since_ms))
            .await
            .unwrap_or_default(),
        quotas: c.quota().await.unwrap_or_default(),
    })
}

// ─────────────────────────────────────────────── 代理

#[tauri::command]
pub async fn create_proxy(
    state: tauri::State<'_, AppState>,
    save: tw_api::ProxySave,
) -> Out<tw_api::ConfigWritten> {
    state.control.create_proxy(&save).await.map_err(text)
}

#[tauri::command]
pub async fn update_proxy(
    state: tauri::State<'_, AppState>,
    name: String,
    save: tw_api::ProxySave,
) -> Out<tw_api::ConfigWritten> {
    state.control.update_proxy(&name, &save).await.map_err(text)
}

#[tauri::command]
pub async fn delete_proxy(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .delete_proxy(&name, base_version.as_deref())
        .await
        .map_err(text)
}

/// 检测代理：完成握手与认证。不保存。
#[tauri::command]
pub async fn test_proxy(
    state: tauri::State<'_, AppState>,
    test: tw_api::ProxyTest,
) -> Out<tw_api::L1Result> {
    state.control.test_proxy(&test).await.map_err(text)
}

// ─────────────────────────────────────────────── 价目表

#[tauri::command]
pub async fn pricing_status(state: tauri::State<'_, AppState>) -> Out<tw_api::PricingStatus> {
    state.control.pricing_status().await.map_err(text)
}

#[tauri::command]
pub async fn refresh_pricing(state: tauri::State<'_, AppState>) -> Out<tw_api::PricingRefreshed> {
    state.control.refresh_pricing().await.map_err(text)
}

#[tauri::command]
pub async fn set_price_auto_update(
    state: tauri::State<'_, AppState>,
    on: bool,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .set_price_auto_update(&tw_api::AutoUpdateSave { on, base_version })
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn query_prices(
    state: tauri::State<'_, AppState>,
    query: tw_api::PriceQuery,
) -> Out<tw_api::PriceQueryResult> {
    state.control.query_prices(&query).await.map_err(text)
}

#[tauri::command]
pub async fn price_sheet(
    state: tauri::State<'_, AppState>,
    name: String,
) -> Out<tw_api::PriceSheetInput> {
    state.control.price_sheet(&name).await.map_err(text)
}

#[tauri::command]
pub async fn create_price_sheet(
    state: tauri::State<'_, AppState>,
    save: tw_api::PriceSheetSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.create_price_sheet(&save).await.map_err(text)
}

#[tauri::command]
pub async fn update_price_sheet(
    state: tauri::State<'_, AppState>,
    name: String,
    save: tw_api::PriceSheetSave,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .update_price_sheet(&name, &save)
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn delete_price_sheet(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .delete_price_sheet(&name, base_version.as_deref())
        .await
        .map_err(text)
}
