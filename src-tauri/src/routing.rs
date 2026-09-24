//! 路由页的命令：路由、策略组的增删改，更换默认路由，以及模型建议。
//!
//! **这一层只转发。**规则怎么校验、改名时密钥和规则怎么跟着改、删除时密钥
//! 改用哪条路由，全在 core。

use crate::AppState;

use crate::error::{Out, text};

#[tauri::command]
pub async fn create_route(
    state: tauri::State<'_, AppState>,
    save: tw_api::RouteSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.create_route(&save).await.map_err(text)
}

#[tauri::command]
pub async fn update_route(
    state: tauri::State<'_, AppState>,
    name: String,
    save: tw_api::RouteSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.update_route(&name, &save).await.map_err(text)
}

#[tauri::command]
pub async fn delete_route(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
    reassign_to: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .delete_route(&name, base_version.as_deref(), reassign_to.as_deref())
        .await
        .map_err(text)
}

#[tauri::command]
pub async fn set_default_route(
    state: tauri::State<'_, AppState>,
    save: tw_api::DefaultRouteSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.set_default_route(&save).await.map_err(text)
}

#[tauri::command]
pub async fn create_group(
    state: tauri::State<'_, AppState>,
    save: tw_api::GroupSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.create_group(&save).await.map_err(text)
}

#[tauri::command]
pub async fn update_group(
    state: tauri::State<'_, AppState>,
    name: String,
    save: tw_api::GroupSave,
) -> Out<tw_api::ConfigWritten> {
    state.control.update_group(&name, &save).await.map_err(text)
}

#[tauri::command]
pub async fn delete_group(
    state: tauri::State<'_, AppState>,
    name: String,
    base_version: Option<String>,
) -> Out<tw_api::ConfigWritten> {
    state
        .control
        .delete_group(&name, base_version.as_deref())
        .await
        .map_err(text)
}

/// 规则条件和试算里的模型建议
#[tauri::command]
pub async fn known_models(state: tauri::State<'_, AppState>) -> Out<Vec<tw_api::KnownModel>> {
    state.control.known_models().await.map_err(text)
}
