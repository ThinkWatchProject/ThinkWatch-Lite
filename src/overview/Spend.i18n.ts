import { messages } from "@/i18n";

/** 概览「去向」那张卡片的文案 */
export const spendText = messages(
  {
    label: "去向",
    dims: { model: "模型", provider: "上游", client: "密钥" },
    /** 右上角的口径：按什么排 · 哪一段时间 */
    metrics: {
      tokens: "按 Token",
      cost: "按费用",
      requests: "按请求",
      cache: "按缓存命中",
      ttft: "按首 token",
      traffic: "按流量",
    },
    caption: (by: string, range: string) => `${by} · ${range}`,
    total: (v: string) => `合计 ${v}`,
    overallHit: (v: string) => `整体命中 ${v}`,
    overallP50: (v: string) => `整体 P50 ${v}`,
    /** 超出显示行数的那些：写出有几项，不静默丢掉 */
    more: { model: (n: number) => `另有 ${n} 个模型`, provider: (n: number) => `另有 ${n} 个上游`, client: (n: number) => `另有 ${n} 把密钥` },
    unnamed: { model: "未知模型", provider: "未到上游", client: "未知密钥" },
    viewInTraffic: "在流量中查看",
    unavailable: "去向暂时取不到",
    empty: "所选区间内无请求记录",
  },
  {
    label: "Distribution",
    dims: { model: "Models", provider: "Upstreams", client: "Keys" },
    metrics: {
      tokens: "By tokens",
      cost: "By cost",
      requests: "By requests",
      cache: "By cache hit rate",
      ttft: "By first token",
      traffic: "By traffic",
    },
    caption: (by: string, range: string) => `${by} · ${range}`,
    total: (v: string) => `Total ${v}`,
    overallHit: (v: string) => `Overall hit rate ${v}`,
    overallP50: (v: string) => `Overall P50 ${v}`,
    more: { model: (n: number) => `${n} more`, provider: (n: number) => `${n} more`, client: (n: number) => `${n} more` },
    unnamed: { model: "Unknown model", provider: "No upstream", client: "Unknown key" },
    viewInTraffic: "View in Traffic",
    unavailable: "Unavailable right now",
    empty: "No requests recorded in the selected range",
  },
);
