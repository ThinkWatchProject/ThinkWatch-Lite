import { messages } from "@/i18n";
import type { LimitMeasure, LimitPer } from "@/types";

/**
 * 用量上限的几样说法：对话框里的一行、密钥表里「已达上限」的悬停说明共用。
 */
export const limitsText = messages(
  {
    per: { minute: "分钟", hour: "小时", day: "天", week: "周", month: "月" } satisfies Record<LimitPer, string>,
    measure: { requests: "次请求", tokens: "token", cost: "费用 (USD)" } satisfies Record<LimitMeasure, string>,
    /** 用量那一行开头：天、周、月是这一期，分钟、小时是最近这一段 */
    period: {
      minute: "最近一分钟",
      hour: "最近一小时",
      day: "今天",
      week: "本周",
      month: "本月",
    } satisfies Record<LimitPer, string>,
    resets: (at: string) => `${at} 重置`,
    /** 重置的时刻：一天之内只写钟点，再远带上日期（日期按 `locale` 写） */
    at: (hm: string) => hm,
    on: (date: string, hm: string) => `${date} ${hm}`,
    locale: "zh-CN",
    reached: "已达上限",
    /** 一条上限说成一句：「每天 $5.00 费用」「每分钟 30 次请求」 */
    phrase: (per: string, amount: string, measure: LimitMeasure, cacheReads: boolean) =>
      measure === "requests"
        ? `每${per} ${amount} 次请求`
        : measure === "tokens"
          ? `每${per} ${amount} token${cacheReads ? "（含缓存读取）" : ""}`
          : `每${per} ${amount} 费用`,
  },
  {
    per: { minute: "minute", hour: "hour", day: "day", week: "week", month: "month" },
    measure: { requests: "requests", tokens: "tokens", cost: "USD" },
    period: {
      minute: "Last minute",
      hour: "Last hour",
      day: "Today",
      week: "This week",
      month: "This month",
    },
    resets: (at: string) => `resets ${at}`,
    at: (hm: string) => `at ${hm}`,
    on: (date: string, hm: string) => `${date} at ${hm}`,
    locale: "en-US",
    reached: "Limit reached",
    phrase: (per: string, amount: string, measure: LimitMeasure, cacheReads: boolean) =>
      measure === "requests"
        ? `${amount} requests per ${per}`
        : measure === "tokens"
          ? `${amount} tokens per ${per}${cacheReads ? " (cache reads included)" : ""}`
          : `${amount} per ${per}`,
  },
);
