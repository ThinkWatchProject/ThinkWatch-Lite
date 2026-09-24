/**
 * 上游页用到的控制面调用。
 *
 * **只是类型化的调用。**名字校验、改名跟随引用、被引用时能不能删、一次
 * 保存写几个版本，全在 core —— 界面多判断一次，就多一处和 core 说法不一致
 * 的可能。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type {
  ChatgptLogin,
  ChatgptLoginMode,
  ChatgptLoginStatus,
  CostBucketGroup,
  CostGroup,
  LatencyView,
  PriceQuery,
  PriceSheetSave,
  Protocol,
  ProviderQuota,
  ProviderSave,
  ProviderTest,
  ProxySave,
  ProxyTest,
  ZaiFamily,
  ZaiLogin,
  ZaiLoginStatus,
} from "@/types";

/** `upstream_stats`：一段时间里每个上游的请求与费用、首字节耗时、订阅额度和走势 */
export interface UpstreamStats {
  costs: CostGroup[];
  latency: LatencyView[];
  quotas: ProviderQuota[];
  /** 按 `bucketMs` 分格、按上游分开的请求数。**稀疏的**：没有请求的格子不在里面 */
  buckets: CostBucketGroup[];
}

export const api = {
  createProvider: (save: ProviderSave) => call("CreateProvider", save),
  updateProvider: (name: string, save: ProviderSave) => call("UpdateProvider", save, name),
  deleteProvider: (name: string, baseVersion: string) =>
    call("DeleteProvider", { base_version: baseVersion }, name),
  testProvider: (test: ProviderTest) => call("TestProvider", test),
  /** `protocol`：表单里选定的协议，不给就是自动识别 */
  previewProvider: (baseUrl: string, protocol?: Protocol) =>
    call("PreviewProvider", { base_url: baseUrl, protocol }),
  providerModels: (name: string) => call("ProviderModels", null, name),
  refreshProviderModels: (name: string) => call("RefreshProviderModels", null, name),
  /** 补问缺失、失败、过期的清单。**立刻回**，答案随 `models_changed` 到 */
  refreshStaleModels: () => call("RefreshStaleModels", null),
  /** 起点和格宽都由界面给：格子对齐到本地整点（见 `bucketStart`） */
  upstreamStats: (sinceMs: number, bucketMs: number) =>
    invoke<UpstreamStats>("upstream_stats", { sinceMs, bucketMs }),
  /** 此刻在途的请求（开始事件的快照）。页面半路挂上时用它补齐 */
  inFlight: () => call("InFlight", null),

  createProxy: (save: ProxySave) => call("CreateProxy", save),
  updateProxy: (name: string, save: ProxySave) => call("UpdateProxy", save, name),
  deleteProxy: (name: string, baseVersion: string) =>
    call("DeleteProxy", { base_version: baseVersion }, name),
  testProxy: (test: ProxyTest) => call("TestProxy", test),

  /** 开始登录。浏览器登录会顺手打开授权页 —— 授权地址留在 Rust 侧，界面不经手 */
  startChatgptLogin: (name: string, proxy: string, mode: ChatgptLoginMode) =>
    invoke<ChatgptLogin>("start_chatgpt_login", { name, proxy, mode }),
  reopenChatgptLogin: (id: string) => invoke<void>("reopen_chatgpt_login", { id }),
  /** 把登录码放进剪贴板。码也留在 Rust 侧：界面拿不到一个写剪贴板的口子 */
  copyChatgptCode: (id: string) => invoke<void>("copy_chatgpt_code", { id }),
  chatgptLoginStatus: (id: string) => call("ChatgptLoginStatus", null, id),
  cancelChatgptLogin: (id: string) => invoke<ChatgptLoginStatus>("cancel_chatgpt_login", { id }),
  /** 开始一次 Z.ai / BigModel 登录。顺手打开授权页 —— 地址留在 Rust 侧 */
  startZaiLogin: (family: ZaiFamily, name: string, proxy: string) =>
    invoke<ZaiLogin>("start_zai_login", { family, name, proxy }),
  reopenZaiLogin: (id: string) => invoke<void>("reopen_zai_login", { id }),
  zaiLoginStatus: (id: string) => call("ZaiLoginStatus", null, id),
  cancelZaiLogin: (id: string) => invoke<ZaiLoginStatus>("cancel_zai_login", { id }),

  chatgptUsage: (name: string) => call("ChatgptUsage", null, name),
  chatgptResets: (name: string) => call("ChatgptResets", null, name),
  /** 用掉一张卡。**用掉就回不来**，调用前必须让用户确认 */
  useChatgptReset: (name: string, creditId: string | null, idempotencyKey: string) =>
    call("UseChatgptReset", { credit_id: creditId, idempotency_key: idempotencyKey }, name),

  pricingStatus: () => call("Pricing", null),
  refreshPricing: () => call("RefreshPricing", null),
  setPriceAutoUpdate: (on: boolean, baseVersion: string) =>
    call("SetPricingAutoUpdate", { on, base_version: baseVersion }),
  queryPrices: (query: PriceQuery) => call("QueryPrice", query),
  priceSheet: (name: string) => call("PriceSheet", null, name),
  createPriceSheet: (save: PriceSheetSave) => call("CreatePriceSheet", save),
  updatePriceSheet: (name: string, save: PriceSheetSave) =>
    call("UpdatePriceSheet", save, name),
  deletePriceSheet: (name: string, baseVersion: string) =>
    call("DeletePriceSheet", { base_version: baseVersion }, name),

  /** 链路测速。不给名字就测全部上游 */
  linkTest: (provider: string | null) => call("L1", { provider }),
  /** 推理测速的费用预估。`providers` 空 = 全部上游 */
  speedQuote: (model: string, providers: string[]) => call("SpeedQuote", { model, providers }),
  speedRun: (model: string, providers: string[]) => call("SpeedRun", { model, providers }),
};
