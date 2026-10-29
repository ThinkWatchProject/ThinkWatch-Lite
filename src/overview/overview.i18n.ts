import { messages } from "@/i18n";

/** 数字开头的和前面的汉字之间空一格，和别处「另有 3 项」的写法一致 */
const sp = (s: string) => (/^[0-9]/.test(s) ? " " : "");

/** 概览页的文案。 */
export const overviewText = messages(
  {
    /** 读取失败时 ErrorState 的标题 */
    loadFailed: "概览数据读取失败",

    // 页头摘要：此刻的状态。数字和状态，不写说明
    inFlight: (_n: number) => "个进行中",
    idle: "当前空闲",
    upstreams: (_n: number) => "个上游",
    unavailable: (_n: number) => "个不可用",
    noUpstreams: "尚未添加上游",
    showUpstreams: "在上游页中查看",

    viewInTraffic: "在流量中查看",

    // 用量：六个指标的名目
    usageLabel: "用量",
    metricsLabel: "指标",
    kpiTokens: "Token",
    kpiCost: "费用",
    kpiCache: "缓存命中",
    kpiRequests: "请求",
    kpiLatency: "首 token",
    kpiTraffic: "流量",
    /** 读屏念的那张大图：「Token 走势」 */
    chartOf: (name: string) => `${name}走势`,

    /**
     * 环比的悬停：和什么比、从多少到多少。`period` 是时间范围给的「24 小时」「7 天」
     * 「等长区间」
     */
    deltaTip: (period: string, before: string, now: string) => `较上一个${sp(period)}${period}：${before} → ${now}`,
    /** 上一个区间没有数据时，幅度那一格（「—」）的悬停说明 */

    // 大图
    /** 悬停抬头里还没过完的那一格止于「现在」 */
    now: "现在",
    /** 横轴上今天零点那一格 */
    today: "今天",
    /** 那一样读取失败：**不是没有** */
    chartUnavailable: "暂时取不到",
    unrecorded: "未记录",
    /** 图例右边：一格多宽 */
    perSlot: (width: string) => `每格 ${width}`,
    hours: (n: number) => `${n} 小时`,
    days: (n: number) => `${n} 天`,
    seconds: (n: number) => `${n} 秒`,
    /** 实时档 token、费用的线是速率，图例右边写单位 */
    tokenUnit: "token/秒",
    costUnit: "$/小时",
    /** 提示里排在前几之外的模型合成一行 */
    otherModels: (n: number) => `其他 ${n} 个模型`,

    // Token
    inOut: (input: string, output: string) => `输入 ${input} · 输出 ${output}`,
    input: "输入",
    output: "输出",
    /** 实时档的提示读的是速率 */
    tokenRate: (shown: string) => `${shown} token/秒`,
    /** token 数。`shown` 是写出来的样子（缩写或精确值），`n` 决定英文的单复数 */
    tokens: (shown: string, _n: number) => `${shown} token`,

    // 费用。**估算、无法计价、无用量各说各的**
    avgCost: (amount: string) => `平均每次请求 ${amount}`,
    costRate: (amount: string) => `${amount}/小时`,
    noRequestsShort: "无请求",
    estimated: (amount: string) => `含估算 ${amount}`,
    /** 费用那一格：有用量，却一条都没算出费用 */
    unpricedCell: "无法计价",
    /** 同上：连用量都没有 */
    noUsageCell: "无用量",
    /** 费用悬停里的句子：金额之外的请求 */
    rankUnpriced: (n: number) => `${n} 条请求无法计价：模型未定价，费用未计入`,
    rankNoUsage: (n: number) => `${n} 条请求没有用量数据，费用未计入`,
    /** 实时档：请求刚落地，价钱还没算出来 */
    rankPending: (n: number) => `${n} 条请求的费用尚在计算，暂未计入`,
    /** 细项那一行：金额之外的请求，短句。整句在悬停里 */
    shortUnpriced: (n: number) => `${n} 条请求无法计价`,
    shortNoUsage: (n: number) => `${n} 条请求无用量`,
    shortPending: (n: number) => `${n} 条请求尚在计算`,
    /** 费用指标上一直看得见的那个限定词（只放得下一个） */
    tagEstimated: "含估算",
    tagUnpriced: "部分无法计价",
    tagNoUsage: "部分无用量",
    tagPending: "尚在计算",

    // 缓存
    saved: (amount: string) => `省下 ${amount}`,
    netCost: (amount: string) => `净增费用 ${amount}`,
    noTokens: "无 token 记录",
    cacheReads: "缓存读取",
    uncachedInput: "新输入",
    cacheWrites: "缓存写入",
    /** 提示的大数：这一格的命中率 */
    hitRate: (pct: string) => `${pct} 命中`,

    // 请求
    failedSub: (n: number) => `失败 ${n} 次`,
    rateSuffix: (pct: string) => ` · ${pct}%`,
    noFailures: "无失败",
    showFailed: "在流量中查看失败的请求",
    showUnpriced: "在流量中查看无法计价的请求",
    /** 提示的大数：这一格几次请求 */
    reqCount: (n: string, _n: number) => `${n} 次`,
    succeeded: "成功",
    failed: "失败",

    // 首 token
    latDetail: (p50: string, p95: string) => `P50 ${p50} · P95 ${p95}`,
    noSamples: "无样本",

    // 流量
    upload: (shown: string) => `上传 ${shown}`,
    download: (shown: string) => `下载 ${shown}`,
    sent: "上传",
    received: "下载",

    // 明细表
    tableLabel: "明细",
    tabModels: "模型",
    tabUpstreams: "上游",
    tabKeys: "密钥",
    colRequests: "请求",
    colTokens: "Token",
    colCost: "费用",
    colCache: "缓存命中",
    colLatency: "首 token",
    colSpeed: "生成速度",
    unknownModel: "未知模型",
    /** 没到上游的请求：被规则拒绝、没有可用的上游 */
    noUpstream: "未到上游",
    unknownKey: "未知密钥",
    more: (n: number) => `另有 ${n} 项`,
    less: "收起",
    tableEmpty: "所选区间内无请求记录",
    tableUnavailable: "明细暂时取不到",
    latencyCellTip: (p50: string, p95: string, samples: number) => `P50 ${p50} · P95 ${p95} · ${samples} 个样本`,
    speedCell: (n: string) => `${n}/秒`,
    speedTip: (n: string, samples: number) => `生成速度中位数 ${n} token/秒 · ${samples} 个样本`,
    /** 可以点的「无法计价」，读屏读出来的后半句 */
    viewUnpriced: "在流量中查看无法计价的请求",

    // 请求记录没起来。正常时不显示
    recordingUnavailable: "请求记录未能启动",
    forwardingUnaffected: "转发不受影响。",
  },
  {
    loadFailed: "Could not load the overview",

    inFlight: (_n: number) => "in progress",
    idle: "Idle",
    upstreams: (n: number) => (n === 1 ? "upstream" : "upstreams"),
    unavailable: (_n: number) => "unavailable",
    noUpstreams: "No upstreams yet",
    showUpstreams: "View in Upstreams",

    viewInTraffic: "View in Traffic",

    usageLabel: "Usage",
    metricsLabel: "Metrics",
    kpiTokens: "Tokens",
    kpiCost: "Cost",
    kpiCache: "Cache hits",
    kpiRequests: "Requests",
    kpiLatency: "First token",
    kpiTraffic: "Traffic",
    chartOf: (name: string) => `${name} over time`,

    deltaTip: (period: string, before: string, now: string) => `vs. prior ${period}: ${before} → ${now}`,

    now: "Now",
    today: "Today",
    chartUnavailable: "Unavailable right now",
    unrecorded: "Not recorded",
    perSlot: (width: string) => `${width} per bar`,
    hours: (n: number) => (n === 1 ? "1 hour" : `${n} hours`),
    days: (n: number) => (n === 1 ? "1 day" : `${n} days`),
    seconds: (n: number) => (n === 1 ? "1 second" : `${n} seconds`),
    tokenUnit: "tokens/s",
    costUnit: "$/hour",
    otherModels: (n: number) => (n === 1 ? "1 other model" : `${n} other models`),

    inOut: (input: string, output: string) => `Input ${input} · Output ${output}`,
    input: "Input",
    output: "Output",
    tokenRate: (shown: string) => `${shown} tokens/s`,
    tokens: (shown: string, n: number) => `${shown} ${n === 1 ? "token" : "tokens"}`,

    avgCost: (amount: string) => `${amount} per request on average`,
    costRate: (amount: string) => `${amount}/hour`,
    noRequestsShort: "No requests",
    estimated: (amount: string) => `Incl. ${amount} estimated`,
    unpricedCell: "Unpriced",
    noUsageCell: "No usage",
    rankUnpriced: (n: number) =>
      n === 1
        ? "1 request unpriced: the model has no price, so its cost is not included"
        : `${n} requests unpriced: the model has no price, so their cost is not included`,
    rankNoUsage: (n: number) =>
      n === 1
        ? "1 request has no usage data, so its cost is not included"
        : `${n} requests have no usage data, so their cost is not included`,
    rankPending: (n: number) =>
      n === 1
        ? "1 request is still being priced, so its cost is not included yet"
        : `${n} requests are still being priced, so their cost is not included yet`,
    shortUnpriced: (n: number) => (n === 1 ? "1 request unpriced" : `${n} requests unpriced`),
    shortNoUsage: (n: number) => (n === 1 ? "1 request without usage" : `${n} requests without usage`),
    shortPending: (n: number) => (n === 1 ? "1 request being priced" : `${n} requests being priced`),
    tagEstimated: "Incl. estimates",
    tagUnpriced: "Partly unpriced",
    tagNoUsage: "Partly no usage",
    tagPending: "Being priced",

    saved: (amount: string) => `${amount} saved`,
    netCost: (amount: string) => `${amount} net cost increase`,
    noTokens: "No tokens recorded",
    cacheReads: "Cache reads",
    uncachedInput: "Uncached input",
    cacheWrites: "Cache writes",
    hitRate: (pct: string) => `${pct} hit`,

    failedSub: (n: number) => `${n} failed`,
    rateSuffix: (pct: string) => ` · ${pct}%`,
    noFailures: "No failures",
    showFailed: "View failed requests in Traffic",
    showUnpriced: "View unpriced requests in Traffic",
    reqCount: (shown: string, n: number) => `${shown} ${n === 1 ? "request" : "requests"}`,
    succeeded: "Succeeded",
    failed: "Failed",

    latDetail: (p50: string, p95: string) => `P50 ${p50} · P95 ${p95}`,
    noSamples: "No samples",

    upload: (shown: string) => `Up ${shown}`,
    download: (shown: string) => `Down ${shown}`,
    sent: "Up",
    received: "Down",

    tableLabel: "Breakdown",
    tabModels: "Models",
    tabUpstreams: "Upstreams",
    tabKeys: "Keys",
    colRequests: "Requests",
    colTokens: "Tokens",
    colCost: "Cost",
    colCache: "Cache hits",
    colLatency: "First token",
    colSpeed: "Speed",
    unknownModel: "Unknown model",
    noUpstream: "No upstream",
    unknownKey: "Unknown key",
    more: (n: number) => `${n} more`,
    less: "Show less",
    tableEmpty: "No requests recorded in the selected range",
    tableUnavailable: "The breakdown is unavailable right now",
    latencyCellTip: (p50: string, p95: string, samples: number) =>
      `P50 ${p50} · P95 ${p95} · ${samples === 1 ? "1 sample" : `${samples} samples`}`,
    speedCell: (n: string) => `${n}/s`,
    speedTip: (n: string, samples: number) =>
      `Median speed ${n} tokens/s · ${samples === 1 ? "1 sample" : `${samples} samples`}`,
    viewUnpriced: "View unpriced requests in Traffic",

    recordingUnavailable: "Request recording could not start",
    forwardingUnaffected: "Forwarding is not affected.",
  },
);
