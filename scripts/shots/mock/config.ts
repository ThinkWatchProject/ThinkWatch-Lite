// 网关的配置这一半：上游、密钥、路由、安全规则、价格。
//
// **骨架是 core 答出来的**（../core/<语言>/*.json，由 `core/oracle.sh` 把示例配置交给
// 那一版 core 生成）：打码的写法、自动识别的协议、规则上的标记、价格，都是 core 的原样。
// 这里只补 core 在没有网络、没有请求记录时给不出来的那几样：上游列出的模型、最后一次
// 使用的时刻、价目表今天刷新过。
import type {
  ClientView,
  DryRunRequest,
  DryRunResult,
  ModelRow,
  Overview,
  PriceFields,
  PricingStatus,
  ProviderModelsView,
  ProviderView,
  ResolvedPrice,
  SecurityDetail,
  Status,
} from "@/types";
import OV_EN from "../core/en/overview.json";
import KEYS_EN from "../core/en/keys.json";
import SEC_EN from "../core/en/security.json";
import PRICING_EN from "../core/en/pricing.json";
import STATUS_EN from "../core/en/status.json";
import DRY_EN from "../core/en/dryrun.json";
import PRICES_EN from "../core/en/prices.json";
import OV_ZH from "../core/zh/overview.json";
import KEYS_ZH from "../core/zh/keys.json";
import SEC_ZH from "../core/zh/security.json";
import PRICING_ZH from "../core/zh/pricing.json";
import STATUS_ZH from "../core/zh/status.json";
import DRY_ZH from "../core/zh/dryrun.json";
import PRICES_ZH from "../core/zh/prices.json";
import REQUESTS from "../core/requests.json";
import { P } from "./params";
import { HOUR, MIN, NOW, clone, msg } from "./util";

const en = P.lang === "en";
/** JSON 推出来的类型是宽的（字符串而不是那几个取值），按 core 的类型读 */
const as = <T>(x: unknown) => x as T;
const FX = {
  overview: as<Overview>(en ? OV_EN : OV_ZH),
  keys: as<ClientView[]>(en ? KEYS_EN : KEYS_ZH),
  security: as<SecurityDetail>(en ? SEC_EN : SEC_ZH),
  pricing: as<PricingStatus>(en ? PRICING_EN : PRICING_ZH),
  status: as<Status>(en ? STATUS_EN : STATUS_ZH),
  dryrun: as<DryRunResult[]>(en ? DRY_EN : DRY_ZH),
  prices: as<{ items: ResolvedPrice[] }>(en ? PRICES_EN : PRICES_ZH).items,
};

/** 用户起的名字（路由、规则、策略组）：和 config.*.yaml 里的一致 */
export const N = {
  opus: en ? "opus-direct" : "Opus 直连",
  deepseek: en ? "deepseek" : "DeepSeek 模型",
  gemini: en ? "gemini" : "Gemini 模型",
  local: en ? "local-models" : "本地模型",
  catchAll: en ? "catch-all" : "兜底",
  qwen: en ? "qwen" : "Qwen 模型",
  main: en ? "main" : "主力",
  customer: en ? "customer-id" : "客户编号",
};

// ───────────────────────────────────────── 价格

/**
 * 价目表的日期。**今天刷新过**：自动更新开着，core 每天从网上取一次，取回来的那份
 * 以取的那天为日期（`tw-pricing` 的 `Table::fetched`）
 */
export const AS_OF = "2026-09-25";

/** 默认价目表里的价格（core 查出来的），按模型 */
const BASE = new Map(FX.prices.filter((x) => x.price).map((x) => [x.model, x.price!]));

/** 中转用的价目表 `relay-discount`：默认价格乘 0.8（config.*.yaml） */
const SHEETS: Record<string, number> = { "relay-discount": 0.8 };

function scaled(p: PriceFields, m: number): PriceFields {
  if (m === 1) return p;
  const k = (v: number | null | undefined) => (v == null ? v : v * m);
  return {
    input: p.input * m,
    output: p.output * m,
    cache_read: p.cache_read * m,
    cache_write_5m: p.cache_write_5m * m,
    cache_write_1h: p.cache_write_1h * m,
    input_above_200k: k(p.input_above_200k),
    output_above_200k: k(p.output_above_200k),
  };
}

/** 这个上游跑这个模型的单价。不计费的上游、价目表里没有的模型是 null */
export function priceFor(provider: string, model: string): PriceFields | null {
  const pv = FX.overview.providers.find((x) => x.name === provider);
  if (!pv || pv.billing === "free") return null;
  const base = BASE.get(model);
  if (!base) return null;
  return scaled(base, pv.pricing ? (SHEETS[pv.pricing] ?? 1) : 1);
}

export function priceSource(provider: string) {
  const pv = FX.overview.providers.find((x) => x.name === provider);
  if (pv?.billing === "free") return null;
  return pv?.pricing
    ? { kind: "scaled" as const, sheet: pv.pricing, multiplier: SHEETS[pv.pricing] ?? 1, date: AS_OF }
    : { kind: "default" as const, date: AS_OF };
}

// ───────────────────────────────────────── 上游列出的模型

/**
 * 每个上游 `/v1/models` 答的清单（示例）。**core 没有网络时拿不到**，所以只有这一块
 * 是这里写的。模型名都在默认价目表里查得到，除了 OpenRouter 上的 Qwen、Kimi ——
 * 那两家在价目表里只有带 `openrouter/` 前缀的键，按名字查不到，真的就是「价格未知」
 */
const LISTED: Record<string, string[]> = {
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  relay: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  chatgpt: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
  // 其余的不在 `models_only` 里，列出来但不启用
  openrouter: [
    "anthropic/claude-sonnet-5",
    "google/gemini-2.5-pro",
    "moonshotai/kimi-k2.6",
    "openai/gpt-5.5",
    "qwen/qwen3-coder",
    "qwen/qwen3-coder-plus",
  ],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-3.1-pro-preview"],
};

function glob(pattern: string, s: string) {
  return pattern.endsWith("*") ? s.startsWith(pattern.slice(0, -1)) : pattern === s;
}

function inScope(p: ProviderView, model: string) {
  return !p.models_only || p.models_only.some((g) => glob(g, model));
}

/** 这个上游能服务的模型：手动清单，或者列出来的里面在启用范围内的 */
export function catalogOf(p: ProviderView): string[] {
  if (p.model_source === "manual" || p.models.length > 0) return p.models;
  return (LISTED[p.name] ?? []).filter((m) => inScope(p, m));
}

/** 上一次去问模型清单是什么时候 */
const CHECKED = NOW - 2 * HOUR - 17 * MIN;

export function providers(): ProviderView[] {
  return FX.overview.providers.map((p) => {
    const manual = p.models.length > 0;
    return {
      ...clone(p),
      model_source: manual ? "manual" : "discovered",
      model_status: "listed",
      model_fetching: false,
      model_checked_at_ms: manual ? null : CHECKED,
      model_count: catalogOf(p).length,
    };
  });
}

export function providerModels(name: string): ProviderModelsView | null {
  const p = providers().find((x) => x.name === name);
  if (!p) return null;
  const ids = p.model_source === "manual" ? p.models : (LISTED[name] ?? []);
  const rows: ModelRow[] = ids.map((id) => {
    const price = priceFor(name, id);
    return {
      id,
      enabled: p.model_source === "manual" || inScope(p, id),
      context_window: FX.prices.find((x) => x.model === id)?.max_input_tokens ?? null,
      price,
      price_source: price ? priceSource(name) : null,
      estimated: false,
    };
  });
  return {
    provider: name,
    source: p.model_source,
    status: "listed",
    fetching: false,
    checked_at_ms: p.model_checked_at_ms ?? null,
    error: null,
    models: rows,
  };
}

export function knownModels() {
  const by = new Map<string, string[]>();
  for (const p of providers()) for (const m of catalogOf(p)) by.set(m, [...(by.get(m) ?? []), p.name]);
  return [...by.entries()].map(([id, ps]) => ({ id, providers: ps })).sort((a, b) => a.id.localeCompare(b.id));
}

// ───────────────────────────────────────── 概览、密钥、安全、价格

/** 报文当前占用：示例值 */
const BODY_BYTES = 412 * 1024 ** 2;

export function overview(lastSeen: Map<string, number>): Overview {
  const o = clone(FX.overview);
  return {
    ...o,
    providers: providers(),
    clients: o.clients.map((c) => ({ ...c, last_seen_ms: lastSeen.get(c.name) ?? null })),
    retention: { ...o.retention, body_bytes_now: BODY_BYTES },
  };
}

export function keys(lastSeen: Map<string, number>): ClientView[] {
  return clone(FX.keys).map((k) => ({ ...k, last_seen_ms: lastSeen.get(k.name) ?? null }));
}

export const security = (): SecurityDetail => clone(FX.security);

export function pricing(unpriced: { provider: string; model: string; requests: number }[]): PricingStatus {
  return {
    ...clone(FX.pricing),
    date: AS_OF,
    source: "fetched",
    checked_at_ms: NOW - 3 * HOUR - 12 * MIN,
    error: null,
    unpriced_recent: unpriced.reduce((a, x) => a + x.requests, 0),
    unpriced_models: unpriced,
  };
}

/**
 * 试算。**只答 requests.json 里那几个请求**，答的是 core 对它们的原样结果；别的请求
 * （对话框里一边填一边算的中间状态）答不上来就报错，拍出来的图不会是一个张冠李戴的结果
 */
export function dryRun(req: DryRunRequest): DryRunResult {
  const i = (REQUESTS.dryrun as DryRunRequest[]).findIndex(
    (r) => r.client === req.client && r.model === req.model && r.dialect === req.dialect && r.input_tokens === req.input_tokens,
  );
  if (i < 0) throw msg("", "This dry run is not in the screenshot data.");
  return clone(FX.dryrun[i]!);
}

/** 本机网关的地址：默认端口，只听本机 */
export const LOCAL_GATEWAY = `127.0.0.1:${FX.overview.listen.port}`;

export function status(gatewayAddr: string, inFlight: number): Status {
  return {
    ...clone(FX.status),
    pid: 48213,
    gateway_addr: gatewayAddr,
    config_path: "~/.thinkwatch/config.yaml",
    uptime_secs: 3 * 86_400 + 5 * 3_600 + 22 * 60,
    in_flight: inFlight,
  };
}

/** 配置的版本号（core 算的内容哈希） */
export const configVersion = () => FX.overview.config_version;

/** 配置文件原文。截图里不打开它，给一份读得通的 */
export const CONFIG_TEXT = "# ~/.thinkwatch/config.yaml\nversion: 1\n";
