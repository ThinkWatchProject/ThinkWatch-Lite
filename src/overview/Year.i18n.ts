import { messages } from "@/i18n";

const ZH_WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const EN_WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const zhMd = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`;
const enMd = (d: Date) => `${EN_MONTHS[d.getMonth()]} ${d.getDate()}`;
const enDays = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

export const yearText = messages(
  {
    title: "最近一年",
    metricLabel: "指标",
    metric: { tokens: "Token", cost: "费用", requests: "请求" },
    /** 标题行右边：一整年都在记录里 */
    spanYear: (d: Date) => `${d.getFullYear()}年${zhMd(d)} 至今`,
    /** 标题行右边：记录不满一年 */
    spanSince: (d: Date) => `${zhMd(d)}开始记录`,
    totalYear: "最近一年",
    totalSince: "开始记录以来",
    usedDays: (n: number) => `${n} 天有用量`,
    average: "日均",
    averageNote: "不含没有用量的日子",
    peak: "最多的一天",
    streak: "连续使用",
    days: (n: number) => `${n} 天`,
    longest: (n: number) => `最长 ${n} 天`,
    /** 统计和提示里的数：token 不带单位、请求带「次」 */
    times: (n: string) => `${n} 次`,
    tokensMain: (v: string) => `${v} token`,
    requestsMain: (n: string) => `${n} 次请求`,
    /** 费用的限定词，统计下面那一行里的短写法（全文在悬停里） */
    estimatedShort: (amount: string) => `含估算 ${amount}`,
    unpricedShort: (n: number) => `${n} 条无法计价`,
    noUsageShort: (n: number) => `${n} 条无用量`,
    input: "输入",
    output: "输出",
    cacheRead: "缓存读取",
    tokensRow: "Token",
    costRow: "费用",
    requestsRow: "请求",
    noRequests: "没有请求",
    unrecorded: "未记录",
    /** 用量合计还在、逐条的请求记录已过保留期的日子：悬停里说明为什么点不开 */
    aged: "请求记录已过保留期，没有当天的明细",
    unavailable: "暂时取不到",
    legendRange: "所选时间范围",
    less: "少",
    more: "多",
    gridLabel: "最近一年每天的用量",
    cell: (date: string, what: string) => `${date}：${what}`,
    /** 提示和读屏用的整个日期：2026年10月28日 周三 */
    dateFull: (d: Date) => `${d.getFullYear()}年${zhMd(d)} ${ZH_WEEKDAYS[d.getDay()]}`,
    /** 「最多的一天」下面：10月28日 周三 */
    dateShort: (d: Date) => `${zhMd(d)} ${ZH_WEEKDAYS[d.getDay()]}`,
    /** 网格左边那一列：周一、周三、周五（getDay 的数） */
    weekday: (day: number) => ZH_WEEKDAYS[day]!,
    /** 网格上方的月份（0 起） */
    month: (m: number) => `${m + 1}月`,
  },
  {
    title: "Past year",
    metricLabel: "Metric",
    metric: { tokens: "Tokens", cost: "Cost", requests: "Requests" },
    spanYear: (d: Date) => `Since ${enMd(d)}, ${d.getFullYear()}`,
    spanSince: (d: Date) => `Recording since ${enMd(d)}`,
    totalYear: "Past year",
    totalSince: "Since recording began",
    usedDays: (n: number) => `${enDays(n)} with usage`,
    average: "Daily average",
    averageNote: "Days without usage excluded",
    peak: "Busiest day",
    streak: "Current streak",
    days: (n: number) => enDays(n),
    longest: (n: number) => `Longest ${enDays(n)}`,
    times: (n: string) => n,
    tokensMain: (v: string) => `${v} tokens`,
    requestsMain: (n: string) => `${n} requests`,
    estimatedShort: (amount: string) => `Incl. ${amount} estimated`,
    unpricedShort: (n: number) => `${n} unpriced`,
    noUsageShort: (n: number) => `${n} without usage`,
    input: "Input",
    output: "Output",
    cacheRead: "Cache read",
    tokensRow: "Tokens",
    costRow: "Cost",
    requestsRow: "Requests",
    noRequests: "No requests",
    unrecorded: "Not recorded",
    aged: "Request records past the retention period; no details for this day",
    unavailable: "Unavailable right now",
    legendRange: "Selected range",
    less: "Less",
    more: "More",
    gridLabel: "Daily usage over the past year",
    cell: (date: string, what: string) => `${date}: ${what}`,
    dateFull: (d: Date) => `${EN_WEEKDAYS[d.getDay()]}, ${enMd(d)}, ${d.getFullYear()}`,
    dateShort: (d: Date) => `${EN_WEEKDAYS[d.getDay()]}, ${enMd(d)}`,
    weekday: (day: number) => EN_WEEKDAYS[day]!,
    month: (m: number) => EN_MONTHS[m]!,
  },
);
