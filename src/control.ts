/**
 * 调控制面：一个端点一次调用，类型来自生成的 `tw-api.ts`。
 *
 * ```ts
 * const ov = await call("Overview", null);
 * await call("UpdateProvider", save, name);           // 路径参数跟在请求后面
 * await call("DeleteProvider", { base_version }, name); // DELETE 的请求走查询串
 * ```
 *
 * **请求和响应的类型不在这里写**，端点名一给，TypeScript 就从 `Endpoints`
 * 里查出来。路径参数的个数也是：`ENDPOINTS` 里那个端点有几个，这里就要几个。
 *
 * 失败时抛出的是一条 `Msg` 形状的对象，交给 `errorText`。
 */
import { invoke } from "@tauri-apps/api/core";
import type { ENDPOINTS, Endpoints } from "./generated/tw-api";

/**
 * 界面能直接调的端点。**和 `src-tauri/src/call.rs` 的 `ALLOWED` 是同一份**
 * （那边的测试核对）：不在这里的端点，界面够不着。
 *
 * 插件要在系统的确认框里点头的三步（`CreatePluginConfirmed`、`SavePluginConfirmed`、
 * `ApprovePluginFileConfirmed`）**有意不在这里**：只能请 Rust 弹系统的确认框
 * （`src/plugins/write.ts`）。不必点头的装、存、批准（`CreatePlugin`、`SavePlugin`、
 * `ApprovePluginFile`）在这里，core 说要点头时答 403。
 */
export const WEBVIEW_ENDPOINTS = [
  "Interfaces",
  "Overview",
  "L1",
  "InFlight",
  "GetConfig",
  "PatchConfig",
  "PutConfig",
  "ConfigHistory",
  "ConfigAt",
  "ConfigRollback",
  "ConfigRepairPlan",
  "RepairConfig",
  "SaveListen",
  "History",
  "HistorySearch",
  "RequestDetail",
  "AbortRequest",
  "Sessions",
  "SessionDetail",
  "SessionTranscript",
  "SessionTurnContext",
  "AbortSession",
  "SpeedQuote",
  "SpeedRun",
  "ReplayQuote",
  "ReplayRun",
  "DryRun",
  "Keys",
  "CreateKey",
  "UpdateKey",
  "SetDefaultKey",
  "CreateProvider",
  "TestProvider",
  "PreviewProvider",
  "UpdateProvider",
  "DeleteProvider",
  "ProviderModels",
  "SetModelSpec",
  "SetManualModels",
  "RefreshProviderModels",
  "RefreshStaleModels",
  "CreateProxy",
  "TestProxy",
  "UpdateProxy",
  "DeleteProxy",
  "CreateRoute",
  "UpdateRoute",
  "DeleteRoute",
  "SetDefaultRoute",
  "CreateGroup",
  "UpdateGroup",
  "DeleteGroup",
  "KnownModels",
  "Aliases",
  "CreateAlias",
  "UpdateAlias",
  "DeleteAlias",
  "PreviewAlias",
  "AliasUsage",
  "RouteStats",
  "UpstreamHealth",
  "Pricing",
  "RefreshPricing",
  "SetPricingAutoUpdate",
  "QueryPrice",
  "CreatePriceSheet",
  "PriceSheet",
  "UpdatePriceSheet",
  "DeletePriceSheet",
  "Security",
  "SecurityEvents",
  "SetSecurityMode",
  "ToggleBuiltinRule",
  "SetBuiltinRuleAction",
  "CreateCustomRule",
  "UpdateCustomRule",
  "DeleteCustomRule",
  "TestSecurity",
  "ChatgptLoginStatus",
  "ChatgptUsage",
  "ChatgptResets",
  "UseChatgptReset",
  "ZaiLoginStatus",
  "Plugins",
  "PluginInspect",
  "PluginRewrite",
  "CreatePlugin",
  "SavePlugin",
  "ApprovePluginFile",
  "PluginSourceDiff",
  "DeletePlugin",
  "ReorderPlugins",
  "TrialPlugin",
  "PluginLogs",
] as const;

export type WebviewEndpoint = (typeof WEBVIEW_ENDPOINTS)[number];

/** 模板里每个参数名换成一个值 */
type Values<T> = T extends readonly [unknown, ...infer Rest] ? [string | number, ...Values<Rest>] : [];

/** 这个端点的路径参数，按模板里的顺序 */
type Params<N extends WebviewEndpoint> = Values<(typeof ENDPOINTS)[N]["params"]>;

export function call<N extends WebviewEndpoint>(
  endpoint: N,
  req: Endpoints[N]["req"],
  ...params: Params<N>
): Promise<Endpoints[N]["res"]> {
  return invoke<Endpoints[N]["res"]>("call", {
    endpoint,
    params: params.map(String),
    req,
  });
}
