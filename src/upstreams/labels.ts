/**
 * 上游页用到的名称与格式。
 *
 * **同一个概念只有一个叫法**，所以集中在这里：列表、对话框、测速结果里
 * 说的「按量计费」「默认价目表」「自动识别」必须是同一个词。
 */
import { textOf } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import type {
  Billing,
  ChatgptPlan,
  KnownChatgptPlan,
  L1Result,
  L1Skip,
  L1Stage,
  ModelListStatus,
  ModelSource,
  PriceFields,
  PriceSourceView,
  Protocol,
  ProviderView,
  ProxyFault,
  ProxyKind,
  QuotaWindow,
  ServeSkip,
} from "@/types";
import { labelsText } from "./labels.i18n";

/*
 * 下面几张表的显示文字写成 getter：每次读取都按当时的语言取（`textOf`）。
 * 表本身留在模块级，引用它的地方照旧读 `.label`、`.desc` —— 读取都发生在
 * 渲染里，换了语言，下一次渲染就是新的文字。
 */

export const PROTOCOLS: { id: Protocol; label: string }[] = [
  { id: "anthropic", label: "Anthropic Messages" },
  { id: "openai-chat", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "gemini", label: "Google Gemini" },
];

/** 登录得来的上游，协议不在上面那张表里：它不能在新建表单里选 */
export const CHATGPT_PROTOCOL: { id: Protocol; readonly label: string } = {
  id: "chatgpt",
  get label() {
    return textOf(labelsText).chatgptAccount;
  },
};

/** 地址认不出协议、配置里也没写时，请求按客户端发来的格式原样转发 */
export function protocolLabel(id: Protocol | null | undefined): string {
  if (id === CHATGPT_PROTOCOL.id) return CHATGPT_PROTOCOL.label;
  return PROTOCOLS.find((p) => p.id === id)?.label ?? textOf(labelsText).protocolUnknown;
}

/** 计费方式只有两档：按价目表算，或者记 $0。订阅账号也按价目表算 */
export const BILLINGS: { id: Billing; label: string; desc: string }[] = (
  ["per-token", "free"] as const
).map((id) => ({
  id,
  get label() {
    return textOf(labelsText).billings[id].label;
  },
  get desc() {
    return textOf(labelsText).billings[id].desc;
  },
}));

export function billingLabel(id: Billing | null | undefined): string {
  return BILLINGS.find((b) => b.id === id)?.label ?? textOf(labelsText).billings["per-token"].label;
}

export const PROXY_KINDS: { id: ProxyKind; label: string; desc: string }[] = (
  [
    ["socks5h", "SOCKS5h"],
    ["socks5", "SOCKS5"],
    ["http", "HTTP"],
    ["https", "HTTPS"],
  ] as const
).map(([id, label]) => ({
  id,
  label,
  get desc() {
    return textOf(labelsText).proxyKinds[id];
  },
}));

export function proxyKindLabel(id: ProxyKind): string {
  return PROXY_KINDS.find((k) => k.id === id)?.label ?? id;
}

/** 出站怎么走。`direct` / `system` 是内置的两个选项，其余是代理名称 */
export function egressLabel(proxy: string): string {
  const t = textOf(labelsText);
  if (proxy === "direct") return t.direct;
  if (proxy === "system") return t.systemProxy;
  return proxy;
}

export const AUTH_MODES: { id: "key" | "oauth"; label: string }[] = [
  {
    id: "key",
    get label() {
      return textOf(labelsText).apiKey;
    },
  },
  { id: "oauth", label: "OAuth" },
];

/**
 * 密钥所在的请求头，按 HTTP 报文里的写法：名字，和值前面拼的东西。
 * core 给的是小写的 `authorization`，报文里习惯写 `Authorization`。
 */
export function authHeaderParts(header: string): { name: string; prefix: string } {
  return header === "authorization"
    ? { name: "Authorization", prefix: "Bearer" }
    : { name: header, prefix: "" };
}

/**
 * 模型清单从哪儿来。**没拿到清单时说为什么**：还在获取、上游不提供、
 * 没问到 —— 三种情况要做的事不一样，不能都叫「未获取」。
 */
export function modelSourceLabel(source: ModelSource, status?: ModelListStatus): string {
  const t = textOf(labelsText).models;
  switch (source) {
    case "discovered":
      return t.discovered;
    case "manual":
      return t.manual;
    case "none":
      return status === "failed" ? t.failed : status === "no_list" ? t.noList : t.notFetched;
  }
}

/**
 * 上游表「模型」一格的样子：主数字，和下面那一行小字。
 *
 * **每种状态都说得出是什么**：以前「还没问」「密钥被拒」「上游不给清单」
 * 都显示成「未获取」，而用户该做的事完全不同 —— 等一下、改密钥、填手动清单。
 */
export function modelFace(p: ProviderView): {
  count: number | null;
  note: string | null;
  warn: boolean;
} {
  const t = textOf(labelsText).models;
  const manual = p.model_source === "manual";
  const known = p.model_source !== "none";
  // 还没问过：打开这一页时已经去问了，马上就有
  if (p.model_status === "pending" && !known) return { count: null, note: t.fetching, warn: false };
  if (p.model_fetching && !known) return { count: null, note: t.fetching, warn: false };
  if (!known) {
    return p.model_status === "no_list"
      ? { count: null, note: t.noList, warn: false }
      : { count: null, note: t.failed, warn: true };
  }
  return {
    count: p.model_count,
    note: manual ? t.manual : p.models_only ? t.scoped : null,
    warn: false,
  };
}

/**
 * ChatGPT 套餐的叫法，和 Codex 客户端显示的一样。**词和叫法不是一回事**：套餐改过名，
 * `team` 现在叫 Business，`business` 叫 Enterprise，`prolite` 才是 Pro。产品名，中英
 * 界面一样。
 */
const PLANS: Record<KnownChatgptPlan, string> = {
  free: "Free",
  go: "Go",
  plus: "Plus",
  pro: "Pro (More)",
  prolite: "Pro",
  promax: "Pro (Max)",
  team: "Business",
  business: "Enterprise",
  self_serve_business_prolite: "Business Premium",
  self_serve_business_usage_based: "Business",
  enterprise: "Enterprise",
  ent26: "Enterprise",
  enterprise_cbp_automation: "Enterprise (Automation)",
  enterprise_cbp_usage_based: "Enterprise",
  edu: "Edu",
  edu_plus: "Edu Plus",
  edu_pro: "Edu Pro",
};

/**
 * 订阅类型。**认不出来的原样显示** —— OpenAI 随时会多出一个
 * 新名字，把它显示成「未知」比直接写出那个词更差。
 */
export function planLabel(plan: ChatgptPlan | null | undefined): string | null {
  if (!plan) return null;
  return Object.hasOwn(PLANS, plan) ? PLANS[plan as KnownChatgptPlan] : plan;
}

/** 订阅额度窗口：`5h` / `7d` / `weekly` / `monthly`。认不出来的原样显示 */
export function quotaWindowLabel(window: string): string {
  const t = textOf(labelsText).quotaWindows;
  switch (window) {
    case "5h":
      return t["5h"];
    case "7d":
      return t["7d"];
    case "weekly":
      return t.weekly;
    case "monthly":
      return t.monthly;
    default:
      return window;
  }
}

/**
 * 按数量计的额度窗口还剩多少：「剩余 1,976 / 2,000 积分」。按百分比报的窗口没有，是 null。
 *
 * **剩余照上游说的写**，不拿总额减已用去算 —— 上游给的三个数不一定对得上。每月那个窗口
 * （GLM 老套餐）数的是 MCP 调用次数，不是积分。
 */
export function quotaLeft(w: QuotaWindow): string | null {
  if (!w.credits) return null;
  const t = textOf(labelsText).quotaLeft;
  // 小数差的不到一个，不值得占位置
  const n = (x: number) => Math.round(Math.max(0, x)).toLocaleString();
  const say = w.window === "monthly" ? t.calls : t.credits;
  return say(n(w.credits.remaining), n(w.credits.total));
}

/** 建连的一步。对着代理的那几步带上「代理」，代理握手本身不用 */
/** 网关检出一个代理不通时的原因，写法和 `l1ErrorText` 一样：卡在哪一步，为什么 */
export function proxyFaultText(f: ProxyFault): string {
  const t = textOf(labelsText);
  const error = coreText(f.detail);
  return f.failed ? t.stageError(l1StageLabel(f.failed), error) : error;
}
export function l1StageLabel(s: L1Stage): string {
  const t = textOf(labelsText);
  const step = t.l1Steps[s.step];
  return s.peer === "proxy" && s.step !== "handshake" ? t.l1ToProxy(step) : step;
}

/** 某一步不在分段里的原因 */
export function l1SkipText(s: L1Skip): string {
  const t = textOf(labelsText).l1Skips;
  switch (s.reason) {
    case "plain_http":
      return t.plain_http;
    case "ip_address":
      return t.ip_address;
    case "proxy_resolves":
      return t.proxy_resolves;
  }
}

/** 测速失败时的那一句：失败在哪一步，加上原因 */
export function l1ErrorText(r: L1Result): string {
  const t = textOf(labelsText);
  const error = r.error ? coreText(r.error) : t.cannotConnect;
  return r.failed ? t.stageError(l1StageLabel(r.failed), error) : error;
}

/** 候选上游被跳过的原因 */
export function skipLabel(reason: ServeSkip): string {
  const t = textOf(labelsText).skips;
  switch (reason) {
    case "disabled":
      return t.disabled;
    case "out_of_scope":
      return t.out_of_scope;
    case "not_offered":
      return t.not_offered;
  }
}

/** 列表里地址那一行：去掉协议头和末尾斜杠 */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** 这一家的计费一栏：不计费直接说；按量计费说价目表 */
export function billingSummary(p: ProviderView): string {
  if (p.billing !== "per-token") return billingLabel(p.billing);
  return p.pricing ?? textOf(labelsText).defaultSheet;
}

/** 单价，美元 / 百万 tokens。**不截成两位** —— 0.075 和 0.08 是两个价 */
export function perMillion(v: number | null | undefined): string {
  if (v == null) return "—";
  const two = v.toFixed(2);
  // 两位小数写得下就写两位（3.00、0.30）；写不下的保留到它真实的精度（0.075）
  if (Math.abs(Number(two) - v) < 1e-9) return two;
  return String(Number(v.toFixed(6)));
}

export function priceSourceLabel(s: PriceSourceView | null | undefined): string {
  const t = textOf(labelsText);
  if (!s) return t.unpriced;
  switch (s.kind) {
    case "default":
      return t.defaultSheet;
    case "scaled":
      return t.scaled(formatMultiplier(s.multiplier));
    case "override":
      return t.override;
  }
}

/** 一笔费用按哪个价格算出，带价目表名与数据日期 */
export function priceSourceDetail(s: PriceSourceView): string {
  const t = textOf(labelsText);
  switch (s.kind) {
    case "default":
      return t.detailDefault(s.date);
    case "scaled":
      return t.detailScaled(s.sheet, formatMultiplier(s.multiplier), s.date);
    case "override":
      return t.detailOverride(s.sheet);
  }
}

export function formatMultiplier(m: number): string {
  return m.toFixed(2);
}

/** 上下文窗口：200000 → 200K */
export function contextWindow(n: number | null | undefined): string {
  if (!n) return "—";
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  return `${Math.round(n / 1000)}K`;
}

export const PRICE_COLUMNS: { key: keyof PriceFields; label: string }[] = (
  ["input", "output", "cache_read", "cache_write_5m", "cache_write_1h"] as const
).map((key) => ({
  key,
  get label() {
    return textOf(labelsText).priceColumns[key];
  },
}));

export { coreText, errorText, plain } from "@/i18n/core.i18n";
