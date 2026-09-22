import { messages } from "@/i18n";

export const retentionText = messages(
  {
    title: "日志保留",
    intro: "报文和请求记录分别设置保留期限。报文占用空间最多，记录很小，可以保留更久。",
    bodyDays: "报文",
    bodyDaysWhat: "超过期限的报文被删除，请求详情中的「内容」随之为空。",
    rowDays: "记录",
    rowDaysWhat: "请求的时刻、模型、用量和费用，用于统计较长时间段的费用。",
    bodyMax: "报文上限",
    bodyMaxWhat: (used: string) => `超出后从最早的一天开始删除。当前占用 ${used}。`,
    days: "天",
    bad: "须为正整数。",
    badGb: "须为正数，最多一位小数。",
    saved: "日志保留设置已保存",
    saveFailed: "未能保存",
  },
  {
    title: "Log retention",
    intro:
      "Payloads and request records expire separately. Payloads take most of the space; records are small and can be kept longer.",
    bodyDays: "Payloads",
    bodyDaysWhat: "Payloads past this age are deleted, and a request's Content tab is then empty.",
    rowDays: "Records",
    rowDaysWhat: "Each request's time, model, usage and cost, for totals over longer periods.",
    bodyMax: "Payload cap",
    bodyMaxWhat: (used: string) => `Over it, the oldest days go first. Currently in use: ${used}.`,
    days: "days",
    bad: "A positive whole number.",
    badGb: "A positive number with at most one decimal place.",
    saved: "Log retention settings saved",
    saveFailed: "Not saved",
  },
);
