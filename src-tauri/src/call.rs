//! 界面调控制面的那一个命令：`call`。
//!
//! **只是转发的端点不再各有一个命令。**以前一个端点在这一层要写一个命令，
//! 参数名、路径、请求类型各写一遍，前端再按命令名和参数名调一遍 —— 参数名
//! 拼错是运行时才知道的事。现在界面按端点名调（类型来自生成的 `tw-api.ts`），
//! 这里按名字找到 `tw_api::ep` 里那一个端点，把请求按它的类型读一遍再发出去。
//!
//! **界面够得着的端点只有 [`ALLOWED`] 里这些**，和改成这样之前各个转发命令
//! 覆盖的那一组一模一样。不在里面的有意不给：密钥明文（`KeyValue`，复制走
//! Rust 这边直接写剪贴板）、让 core 退出、诊断包的正文、事件流，以及只在
//! 概览、上游页的汇总里用到的统计端点。路径参数由 `tw_api::fill` 做百分号
//! 编码，所以界面给的名字只能是一段，拼不出别的路径。
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
    // 配置原文与历史
    GetConfig,
    PatchConfig,
    PutConfig,
    ConfigHistory,
    ConfigAt,
    ConfigRollback,
    SaveListen,
    // 记录
    History,
    RequestDetail,
    Sessions,
    SessionDetail,
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
    RefreshProviderModels,
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
    SetSecurityMode,
    ToggleBuiltinRule,
    SetBuiltinRuleAction,
    SetSecurityLimit,
    CreateCustomRule,
    UpdateCustomRule,
    DeleteCustomRule,
    TestSecurity,
    // 账号登录（发起和取消是命令：要开浏览器、要记住这一次）
    ChatgptLoginStatus,
    ChatgptUsage,
    ChatgptResets,
    UseChatgptReset,
    ZaiLoginStatus,
];

/// 请求按这个端点的类型读一遍再发：**界面发来的形状不对，在这里就停下**，
/// 不把一个 core 读不了的请求送过去。
async fn relay<E: Endpoint>(c: &ControlClient, params: &[&str], req: Value) -> Out<Value> {
    let req: E::Req = serde_json::from_value(req).map_err(|e| {
        CmdError::plain(format!(
            "The request for `{}` has the wrong shape: {e}",
            E::NAME
        ))
    })?;
    let res = c.call::<E>(params, &req).await?;
    serde_json::to_value(res).map_err(|e| CmdError::plain(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

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
            "StartChatgptLogin",
            "CancelChatgptLogin",
            "StartZaiLogin",
            "CancelZaiLogin",
            // 要这台机器上的客户端一起照顾到的，见模块说明
            "DeleteKey",
            "RotateKey",
            "ClientKey",
        ] {
            assert!(!ALLOWED.contains(&name), "{name}");
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
