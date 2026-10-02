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
  "SaveListen",
  "History",
  "HistorySearch",
  "RequestDetail",
  "Sessions",
  "SessionDetail",
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
  "SetSecurityLimit",
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
  "UpdatePlugin",
  "PluginSourceDiff",
  "DeletePlugin",
  "ReorderPlugins",
  "TrialPlugin",
  "PluginLogs",
] as const;

/**
 * PROVISIONAL：插件的端点在白名单里，类型还不在生成的 `tw-api.ts` 里（core 发版之前）。
 * 它们走 `src/plugins/api.provisional.ts` 的 `pluginCall`。core 发版、重新生成之后删掉
 * 这一行和下面的 `Exclude`，插件页改用 `call`。
 *
 * 安装、更换代码、确认文件变更（`CreatePlugin`、`ReplacePluginSource`、`ApprovePluginFile`）
 * **有意不在白名单里**：只能经过 Rust 的原生确认（`plugin_install` 等命令）。
 */
type Provisional =
  | "Plugins"
  | "PluginInspect"
  | "UpdatePlugin"
  | "PluginSourceDiff"
  | "DeletePlugin"
  | "ReorderPlugins"
  | "TrialPlugin"
  | "PluginLogs";

export type WebviewEndpoint = Exclude<(typeof WEBVIEW_ENDPOINTS)[number], Provisional>;

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
