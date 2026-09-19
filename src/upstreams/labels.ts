/**
 * 上游页用到的名称与格式。
 *
 * **同一个概念只有一个叫法**，所以集中在这里：列表、对话框、测速结果里
 * 说的「按量计费」「默认价目表」「自动识别」必须是同一个词。
 */
import type { L1Result, L1Skip, L1Stage, PriceFields, PriceSourceView, ProviderView } from "@/types";

export const PROTOCOLS: { id: string; label: string }[] = [
  { id: "anthropic", label: "Anthropic Messages" },
  { id: "openai-chat", label: "OpenAI Chat Completions" },
  { id: "openai-responses", label: "OpenAI Responses" },
  { id: "gemini", label: "Google Gemini" },
];

/** 登录得来的上游，协议不在上面那张表里：它不能在新建表单里选 */
export const CHATGPT_PROTOCOL = { id: "chatgpt", label: "ChatGPT 账号" };

/** 地址认不出协议、配置里也没写时，请求按客户端发来的格式原样转发 */
export function protocolLabel(id: string | null | undefined): string {
  if (id === CHATGPT_PROTOCOL.id) return CHATGPT_PROTOCOL.label;
  return PROTOCOLS.find((p) => p.id === id)?.label ?? "协议未识别";
}

export const BILLINGS: { id: string; label: string; desc: string }[] = [
  { id: "per-token", label: "按量计费", desc: "按价目表的单价与用量计算费用。" },
  { id: "subscription", label: "订阅制", desc: "请求计入订阅额度，不计算费用。" },
  { id: "free", label: "不计费", desc: "费用记为 $0，例如本地模型。" },
  { id: "unknown", label: "计费方式未知", desc: "不计算费用，也不计入合计。" },
];

export function billingLabel(id: string | null | undefined): string {
  return BILLINGS.find((b) => b.id === id)?.label ?? "按量计费";
}

export const PROXY_KINDS: { id: string; label: string; desc: string }[] = [
  {
    id: "socks5h",
    label: "SOCKS5h",
    desc: "域名由代理解析，本机不发出 DNS 查询。",
  },
  { id: "socks5", label: "SOCKS5", desc: "域名在本机解析后，经代理连接目标地址。" },
  { id: "http", label: "HTTP", desc: "通过 HTTP CONNECT 建立隧道。" },
  { id: "https", label: "HTTPS", desc: "与代理之间使用 TLS，再通过 CONNECT 建立隧道。" },
];

export function proxyKindLabel(id: string): string {
  return PROXY_KINDS.find((k) => k.id === id)?.label ?? id;
}

/** 出站怎么走。`direct` / `system` 是内置的两个选项，其余是代理名称 */
export function egressLabel(proxy: string): string {
  if (proxy === "direct") return "直连";
  if (proxy === "system") return "系统代理";
  return proxy;
}

export const REDACT_KINDS: { id: string; label: string }[] = [
  { id: "api-keys", label: "API 密钥" },
  { id: "private-keys", label: "私钥" },
  { id: "jwt", label: "JWT" },
  { id: "conn-strings", label: "连接串口令" },
  { id: "internal", label: "内网标识" },
];

export function redactLabel(id: string): string {
  return REDACT_KINDS.find((k) => k.id === id)?.label ?? id;
}

export const AUTH_MODES: { id: "key" | "oauth"; label: string }[] = [
  { id: "key", label: "API 密钥" },
  { id: "oauth", label: "OAuth" },
];

/** 密钥所在的请求头，按 HTTP 报文里的写法 */
export function authHeaderLabel(header: string): string {
  return header === "authorization" ? "Authorization: Bearer" : header;
}

export function modelSourceLabel(source: string): string {
  switch (source) {
    case "discovered":
      return "自动发现";
    case "manual":
      return "手动清单";
    default:
      return "未获取";
  }
}

/** 订阅额度窗口：`5h` / `7d` / `weekly` */
/** 模型清单是怎么来的。自动获取、范围也没限制时不用说 */
export function modelSourceNote(p: ProviderView): string | null {
  if (p.model_source === "manual") return "手动清单";
  if (p.model_source === "none") return "未获取";
  return p.models_only ? "指定范围" : null;
}

/**
 * 订阅类型。**认不出来的原样显示** —— OpenAI 随时会多出一个
 * 新名字，把它显示成「未知」比直接写出那个词更差。
 */
export function planLabel(plan: string | null | undefined): string | null {
  if (!plan) return null;
  const known: Record<string, string> = {
    free: "Free",
    plus: "Plus",
    pro: "Pro",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Edu",
  };
  return known[plan.toLowerCase()] ?? plan;
}

export function quotaWindowLabel(window: string): string {
  switch (window) {
    case "5h":
      return "5 小时";
    case "7d":
      return "7 天";
    case "weekly":
      return "每周";
    default:
      return window;
  }
}

const L1_STEPS: Record<L1Stage["step"], string> = {
  config: "配置",
  dns: "DNS 解析",
  tcp: "TCP 握手",
  tls: "TLS 握手",
  handshake: "代理握手",
};

/** 建连的一步。对着代理的那几步带上「代理」，代理握手本身不用 */
export function l1StageLabel(s: L1Stage): string {
  const step = L1_STEPS[s.step] ?? s.step;
  return s.peer === "proxy" && s.step !== "handshake" ? `${step} · 代理` : step;
}

/** 某一步不在分段里的原因 */
export function l1SkipText(s: L1Skip): string {
  switch (s.reason) {
    case "plain_http":
      return "http:// 地址不进行 TLS 握手";
    case "ip_address":
      return "地址已是 IP，无需 DNS 解析";
    case "proxy_resolves":
      return "域名由代理解析，本机不进行 DNS 解析";
    default:
      return s.reason;
  }
}

/** 测速失败时的那一句：失败在哪一步，加上原因 */
export function l1ErrorText(r: L1Result): string {
  const error = r.error ?? "无法连接";
  return r.failed ? `${l1StageLabel(r.failed)}：${error}` : error;
}

/** 候选上游被跳过的原因 */
export function skipLabel(reason: string): string {
  switch (reason) {
    case "disabled":
      return "已停用";
    case "out_of_scope":
      return "不在启用范围内";
    case "not_offered":
      return "未提供此模型";
    default:
      return reason;
  }
}

/** 列表里地址那一行：去掉协议头和末尾斜杠 */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

/** 这一家的计费一栏：订阅制、不计费、未知直接说；按量计费说价目表 */
export function billingSummary(p: ProviderView): string {
  const b = p.billing ?? p.billing_effective;
  if (b !== "per-token") return billingLabel(b);
  return p.pricing ?? "默认价目表";
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
  if (!s) return "无法计价";
  switch (s.kind) {
    case "default":
      return "默认价目表";
    case "scaled":
      return `默认价目表 × ${formatMultiplier(s.multiplier)}`;
    case "override":
      return "价目表覆盖";
  }
}

/** 一笔费用按哪个价格算出，带价目表名与数据日期 */
export function priceSourceDetail(s: PriceSourceView): string {
  switch (s.kind) {
    case "default":
      return `默认价目表 · 数据日期 ${s.date}`;
    case "scaled":
      return `价目表「${s.sheet}」· 默认价目表 × ${formatMultiplier(s.multiplier)} · 数据日期 ${s.date}`;
    case "override":
      return `价目表「${s.sheet}」· 覆盖价格`;
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

export const PRICE_COLUMNS: { key: keyof PriceFields; label: string }[] = [
  { key: "input", label: "输入" },
  { key: "output", label: "输出" },
  { key: "cache_read", label: "缓存读取" },
  { key: "cache_write_5m", label: "缓存写入 5 分钟" },
  { key: "cache_write_1h", label: "缓存写入 1 小时" },
];

/** Tauri 的 invoke 用字符串 reject，不是 Error */
export function errorText(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}
