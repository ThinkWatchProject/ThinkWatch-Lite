/**
 * 上游页用到的控制面调用。
 *
 * **只是类型化的 invoke。**名字校验、改名跟随引用、被引用时能不能删、一次
 * 保存写几个版本，全在 core —— 界面多判断一次，就多一处和 core 说法不一致
 * 的可能。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ChatgptLogin,
  ChatgptLoginMode,
  ChatgptLoginStatus,
  ChatgptUsage,
  ConfigWritten,
  CostGroup,
  L1Result,
  LatencyView,
  PriceQuery,
  PriceQueryResult,
  PriceSheetInput,
  PriceSheetSave,
  PricingRefreshed,
  PricingStatus,
  ProviderModelsView,
  ProviderPreview,
  ProviderQuota,
  ProviderSave,
  ProviderTest,
  ProviderTestResult,
  ProxySave,
  ProxyTest,
  ResetCredits,
  ResetCreditUsed,
  SpeedQuote,
  SpeedResult,
} from "@/types";

export interface UpstreamStats {
  costs: CostGroup[];
  latency: LatencyView[];
  quotas: ProviderQuota[];
}

/** 删除、开关这类不带正文的写入，要带上基于哪一版 */
type Base = string | null;

export const api = {
  createProvider: (save: ProviderSave) => invoke<ConfigWritten>("create_provider", { save }),
  updateProvider: (name: string, save: ProviderSave) =>
    invoke<ConfigWritten>("update_provider", { name, save }),
  deleteProvider: (name: string, baseVersion: Base) =>
    invoke<ConfigWritten>("delete_provider", { name, baseVersion }),
  testProvider: (test: ProviderTest) => invoke<ProviderTestResult>("test_provider", { test }),
  /** `protocol`：表单里选定的协议，不给就是自动识别 */
  previewProvider: (baseUrl: string, protocol?: string) =>
    invoke<ProviderPreview>("preview_provider", { preview: { base_url: baseUrl, protocol } }),
  providerModels: (name: string) => invoke<ProviderModelsView>("provider_models", { name }),
  refreshProviderModels: (name: string) =>
    invoke<ProviderModelsView>("refresh_provider_models", { name }),
  upstreamStats: (sinceMs: number) => invoke<UpstreamStats>("upstream_stats", { sinceMs }),

  createProxy: (save: ProxySave) => invoke<ConfigWritten>("create_proxy", { save }),
  updateProxy: (name: string, save: ProxySave) =>
    invoke<ConfigWritten>("update_proxy", { name, save }),
  deleteProxy: (name: string, baseVersion: Base) =>
    invoke<ConfigWritten>("delete_proxy", { name, baseVersion }),
  testProxy: (test: ProxyTest) => invoke<L1Result>("test_proxy", { test }),

  /** 开始登录。浏览器登录会顺手打开授权页 —— 授权地址留在 Rust 侧，界面不经手 */
  startChatgptLogin: (name: string, proxy: string, mode: ChatgptLoginMode) =>
    invoke<ChatgptLogin>("start_chatgpt_login", { name, proxy, mode }),
  reopenChatgptLogin: (id: string) => invoke<void>("reopen_chatgpt_login", { id }),
  /** 把登录码放进剪贴板。码也留在 Rust 侧：界面拿不到一个写剪贴板的口子 */
  copyChatgptCode: (id: string) => invoke<void>("copy_chatgpt_code", { id }),
  chatgptLoginStatus: (id: string) => invoke<ChatgptLoginStatus>("chatgpt_login_status", { id }),
  cancelChatgptLogin: (id: string) => invoke<ChatgptLoginStatus>("cancel_chatgpt_login", { id }),
  chatgptUsage: (name: string) => invoke<ChatgptUsage>("chatgpt_usage", { name }),
  chatgptResets: (name: string) => invoke<ResetCredits>("chatgpt_resets", { name }),
  /** 用掉一张卡。**用掉就回不来**，调用前必须让用户确认 */
  useChatgptReset: (name: string, creditId: string | null, idempotencyKey: string) =>
    invoke<ResetCreditUsed>("use_chatgpt_reset", { name, creditId, idempotencyKey }),

  pricingStatus: () => invoke<PricingStatus>("pricing_status"),
  refreshPricing: () => invoke<PricingRefreshed>("refresh_pricing"),
  setPriceAutoUpdate: (on: boolean, baseVersion: Base) =>
    invoke<ConfigWritten>("set_price_auto_update", { on, baseVersion }),
  queryPrices: (query: PriceQuery) => invoke<PriceQueryResult>("query_prices", { query }),
  priceSheet: (name: string) => invoke<PriceSheetInput>("price_sheet", { name }),
  createPriceSheet: (save: PriceSheetSave) =>
    invoke<ConfigWritten>("create_price_sheet", { save }),
  updatePriceSheet: (name: string, save: PriceSheetSave) =>
    invoke<ConfigWritten>("update_price_sheet", { name, save }),
  deletePriceSheet: (name: string, baseVersion: Base) =>
    invoke<ConfigWritten>("delete_price_sheet", { name, baseVersion }),

  /** 链路测速。不给名字就测全部上游 */
  linkTest: (provider: string | null) => invoke<L1Result[]>("speed_test", { provider }),
  /** 推理测速的费用预估。`providers` 空 = 全部上游 */
  speedQuote: (model: string, providers: string[]) =>
    invoke<SpeedQuote>("speed_quote", { model, providers }),
  speedRun: (model: string, providers: string[]) =>
    invoke<SpeedResult[]>("speed_run", { model, providers }),
};
