//! 安全页的命令：两项防护的档位、规则、测试和日志。
//!
//! **这一层只转发。**规则怎么编译、哪些写进文件、测试怎么和网关对齐，全在
//! core。

use crate::AppState;

type Out<T> = Result<T, String>;

fn text(e: anyhow::Error) -> String {
    format!("{e:#}")
}

#[tauri::command]
pub async fn security_detail(state: tauri::State<'_, AppState>) -> Out<tw_api::SecurityDetail> {
    state.control.security().await.map_err(text)
}

/// 安全日志的一页。`guard` 不给就是两项都要；`before` 翻页
#[tauri::command]
pub async fn security_events(
    state: tauri::State<'_, AppState>,
    guard: Option<String>,
    from_ms: Option<i64>,
    to_ms: Option<i64>,
    before: Option<i64>,
    limit: Option<usize>,
) -> Out<tw_api::SecurityEventsPage> {
    let within = match (from_ms, to_ms) {
        (None, None) => None,
        (from, to) => Some((from.unwrap_or(0), to.unwrap_or(i64::MAX))),
    };
    state
        .control
        .security_events(guard.as_deref(), within, before, limit.unwrap_or(100))
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn set_security_mode(
    state: tauri::State<'_, AppState>,
    guard: String,
    save: tw_api::ModeSave,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .set_security_mode(&guard, &save)
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn toggle_security_rule(
    state: tauri::State<'_, AppState>,
    guard: String,
    id: String,
    save: tw_api::RuleToggle,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .toggle_security_rule(&guard, &id, &save)
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn set_security_rule_action(
    state: tauri::State<'_, AppState>,
    guard: String,
    id: String,
    save: tw_api::ActionSave,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .set_security_rule_action(&guard, &id, &save)
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn create_security_rule(
    state: tauri::State<'_, AppState>,
    guard: String,
    save: tw_api::CustomRuleSave,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .create_security_rule(&guard, &save)
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn update_security_rule(
    state: tauri::State<'_, AppState>,
    guard: String,
    name: String,
    save: tw_api::CustomRuleSave,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .update_security_rule(&guard, &name, &save)
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn delete_security_rule(
    state: tauri::State<'_, AppState>,
    guard: String,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .delete_security_rule(&guard, &name, base_version.as_deref())
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn test_security(
    state: tauri::State<'_, AppState>,
    guard: String,
    req: tw_api::SecurityTestRequest,
) -> Out<tw_api::SecurityTestResult> {
    state
        .control
        .test_security(&guard, &req)
        .await
        .map_err(text)
}
