import { messages } from "@/i18n";
import type { LimitMeasure, LimitPer } from "@/types";

const PER_ZH: Record<LimitPer, string> = { minute: "分钟", hour: "小时", day: "天", week: "周", month: "月" };
const PER_EN: Record<LimitPer, string> = { minute: "minute", hour: "hour", day: "day", week: "week", month: "month" };

/**
 * 用量上限的几样说法：对话框里的一行、密钥表里「已达上限」的悬停说明共用。
 */
export const limitsText = messages(
  {
    per: PER_ZH,
    /** 周期的字，跟着「每 N」的 N 走（英文要分单复数） */
    unit: (per: LimitPer, _n: number): string => PER_ZH[per],
    /** 「每」后面的那一段：「天」「分钟」「 5 分钟」（N 前后留空格，「每 5 分钟」） */
    span: (per: LimitPer, n: number): string => (n > 1 ? ` ${n} ${PER_ZH[per]}` : PER_ZH[per]),
    /** 用量那一行开头，N 大于 1 的分钟、小时：「最近 5 分钟」 */
    lastN: (span: string) => `最近${span}`,
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
    /** 一条上限说成一句：「每天 $5.00 费用」「每分钟 30 次请求」。`per` 是 `span` 给的那一段 */
    phrase: (per: string, amount: string, measure: LimitMeasure, cacheReads: boolean) =>
      measure === "requests"
        ? `每${per} ${amount} 次请求`
        : measure === "tokens"
          ? `每${per} ${amount} token${cacheReads ? "（含缓存读取）" : ""}`
          : `每${per} ${amount} 费用`,
  },
  {
    per: PER_EN,
    unit: (per: LimitPer, n: number): string => (n > 1 ? `${PER_EN[per]}s` : PER_EN[per]),
    span: (per: LimitPer, n: number): string => (n > 1 ? `${n} ${PER_EN[per]}s` : PER_EN[per]),
    lastN: (span: string) => `Last ${span}`,
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
