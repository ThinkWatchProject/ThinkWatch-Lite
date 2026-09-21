import { messages } from "@/i18n";

/**
 * 会话页的文案。
 *
 * 费用那一格的限定语和概览页说的是同一批事（估算、无法计价、无用量、
 * 订阅），措辞跟着 `Dashboard.i18n.ts` 走 —— 同一件事在两页上不该有两种
 * 说法。区别只在量词：概览按请求数，这里按轮次。
 */
export const sessionsText = messages(
  {
    loading: "读取中…",
    emptyTitle: "暂无会话记录",
    emptyBody: "同一对话中的请求将聚合为会话，并显示在此处。",

    // 表头
    started: "开始",
    client: "客户端",
    turns: "轮次",
    duration: "时长",
    peakContext: "上下文峰值",
    cacheSavings: "缓存节省",
    cost: "费用",

    /** 轮次一列里跟在总轮数后面的失败数 */
    failedTurns: (n: number) => `${n} 失败`,

    // 时长。会话短的按秒算，长的按小时算
    seconds: (n: number) => `${n} 秒`,
    minutes: (n: number) => `${n} 分`,
    hours: (n: string) => `${n} 小时`,

    // 费用那一格。**估算、无法计价、无用量、订阅各说各的**
    estimatedTip: (amount: string) =>
      `其中 ${amount} 为估算值：请求在响应结束前断开或中断，输出用量计至断开时；或模型的单价取自其他平台。`,
    unpriced: "无法计价",
    noPricedTurnsTip: "此会话中没有可计价的轮次",
    unpricedTurns: (n: number) => `+${n} 轮无法计价`,
    unpricedTurnsTip: "这些轮次所用的模型未定价，费用未计入合计",
    noUsageTurns: (n: number) => `+${n} 轮无用量`,
    noUsageTurnsTip:
      "这些轮次没有用量数据：上游未报告，或连接在报告之前已结束。费用无法计算，未计入合计",
    subscriptionTurns: (n: number) => `订阅额度 ${n} 轮`,
    subscriptionTip: "这些轮次由订阅制上游服务，计入订阅额度，不按用量产生费用",

    // 详情
    /** `at` 是开始时刻写出来的样子 */
    detailTitle: (at: string, turns: number, duration: string) =>
      `${at} 的会话 · ${turns} 轮 · ${duration}`,
    /** 模型名之间的分隔符 */
    modelSep: "、",
    detailUsage: (models: string, input: string, output: string, cacheRead: string) =>
      `${models} · 输入 ${input} / 输出 ${output} · 缓存读取 ${cacheRead}`,

    growthTitle: "上下文增长（每轮的输入 token）",
    /** 柱子的悬浮文字。`cached` 是缓存命中的那一段，没有时为 null */
    growthBar: (shown: string, _n: number, cached: string | null) =>
      `${shown} token${cached ? `，其中 ${cached} 为缓存命中` : ""}`,
    growthLegend: (peak: string) => `绿色为缓存命中部分。峰值 ${peak} token。`,

    waterfallTitle: "每轮费用",
    /** 瀑布里单独一轮的标注 */
    turnSubscription: "订阅额度",
    turnFailed: "失败",
    turnCancelled: "已取消",
  },
  {
    loading: "Loading…",
    emptyTitle: "No sessions yet",
    emptyBody: "Requests from the same conversation are grouped into a session and appear here.",

    started: "Started",
    client: "Client",
    turns: "Turns",
    duration: "Duration",
    peakContext: "Peak context",
    cacheSavings: "Cache savings",
    cost: "Cost",

    failedTurns: (n: number) => `${n} failed`,

    // 和 format.i18n.ts 的单位写法一致：s、min、h
    seconds: (n: number) => `${n} s`,
    minutes: (n: number) => `${n} min`,
    hours: (n: string) => `${n} h`,

    estimatedTip: (amount: string) =>
      `${amount} of this is estimated: requests disconnected or were interrupted before the response finished, and output usage is counted up to the disconnect; or the model's price was taken from another platform.`,
    unpriced: "Unpriced",
    noPricedTurnsTip: "No turn in this session could be priced.",
    unpricedTurns: (n: number) => `+${n} unpriced`,
    unpricedTurnsTip:
      "The models used by these turns have no price, so their cost is not included in the total.",
    // 费用那一格在默认窗口宽度下只有 ~340px，几个限定语要挤在一行里：
    // 单位交给「轮次」那一列，这里只写数目
    noUsageTurns: (n: number) => `+${n} no usage`,
    noUsageTurnsTip:
      "These turns have no usage data: the upstream did not report it, or the connection ended before it was reported. Their cost cannot be calculated and is not included in the total.",
    subscriptionTurns: (n: number) => `${n} on subscription`,
    subscriptionTip:
      "These turns were served by a subscription upstream. They count against the subscription quota and do not incur cost by usage.",

    detailTitle: (at: string, turns: number, duration: string) =>
      `Session at ${at} · ${turns === 1 ? "1 turn" : `${turns} turns`} · ${duration}`,
    modelSep: ", ",
    detailUsage: (models: string, input: string, output: string, cacheRead: string) =>
      `${models} · Input ${input} / Output ${output} · Cache reads ${cacheRead}`,

    growthTitle: "Context growth (input tokens per turn)",
    growthBar: (shown: string, n: number, cached: string | null) =>
      `${shown} ${n === 1 ? "token" : "tokens"}${cached ? `, ${cached} from cache` : ""}`,
    growthLegend: (peak: string) => `Green marks the part served from cache. Peak ${peak} tokens.`,

    waterfallTitle: "Cost per turn",
    turnSubscription: "Subscription",
    turnFailed: "Failed",
    turnCancelled: "Canceled",
  },
);
