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

    // 需要处理的事。一件一句，陈述式
    attentionLabel: "需要处理的事",
    /** 失败过半集中在一个上游时点出它；全在一个上游时说「均」 */
    attnFailed: (n: number, top: { name: string; n: number } | null) =>
      `${n} 次请求失败` + (top ? (top.n === n ? `，均发生在 ${top.name}` : `，其中 ${top.name} ${top.n} 次`) : ""),
    attnToolCut: (n: number) => `工具调用审查切断了 ${n} 个可疑工具调用`,
    attnUpstream: (name: string, why: string) => `${name} ${why}`,
    attnUpstreams: (n: number, names: string[]) =>
      `${n} 个上游不可用：${names.slice(0, 3).join("、")}${names.length > 3 ? " 等" : ""}`,
    whyOpen: "熔断中",
    whyAuth: "凭据被拒",
    whyLogin: "需要重新登录",
    attnUnpriced: (n: number) => `${n} 条请求无法计价：所用模型未定价，费用未计入`,
    /** 实时档：这几句的数按 24 小时算 */
    scoped: (period: string, text: string) => `${period}内${sp(text)}${text}`,
    viewInTraffic: "在流量中查看",
    showLog: "在安全日志中查看",

    // 指标卡的名目
    kpiTokens: "Token",
    kpiCost: "费用",
    kpiCache: "缓存命中",
    kpiRequests: "请求",
    kpiLatency: "首 token",
    kpiTraffic: "流量",
    /** 读屏念的那张小图：「Token 走势」 */
    chartOf: (name: string) => `${name}走势`,

    /**
     * 环比的悬停：和什么比、从多少到多少。`period` 是时间范围给的「24 小时」「7 天」
     * 「等长区间」
     */
    deltaTip: (period: string, before: string, now: string) => `较上一个${sp(period)}${period}：${before} → ${now}`,
    /** 上一个区间没有数据时，幅度那一格（「—」）的悬停说明 */
    noPrior: (period: string) => `上一个${sp(period)}${period}无记录`,

    // 小图下面首尾两头
    ago: (period: string) => `${period}前`,
    liveAgo: "10 分钟前",
    now: "现在",
    /** 那一样读取失败：**不是没有** */
    chartUnavailable: "暂时取不到",

    // Token
    inOut: (input: string, output: string) => `输入 ${input} · 输出 ${output}`,
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

    // 缓存
    saved: (amount: string) => `省下 ${amount}`,
    netCost: (amount: string) => `净增费用 ${amount}`,
    noTokens: "无 token 记录",
    cacheReads: "缓存读取",
    uncachedInput: "新输入",
    cacheWrites: "缓存写入",

    // 请求
    failedSub: (n: number) => `失败 ${n} 次`,
    rateSuffix: (pct: string) => ` · ${pct}%`,
    noFailures: "无失败",
    showFailed: "在流量中查看失败的请求",
    reqTip: (n: number, failed: number) => `${n} 次${failed ? ` · 失败 ${failed}` : ""}`,

    // 首 token
    /** core 给出整体分位之前：写明是哪个模型的 */
    latencyOf: (model: string, p95: string) => `${model} · P95 ${p95}`,
    p95: (shown: string) => `P95 ${shown}`,
    latTip: (p50: string, p95: string) => `P50 ${p50} · P95 ${p95}`,
    noSamples: "无样本",

    // 流量
    upload: (shown: string) => `上传 ${shown}`,
    download: (shown: string) => `下载 ${shown}`,
    trafficTip: (up: string, down: string) => `↑ ${up} · ↓ ${down}`,
    trafficNone: "暂无流量记录",

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

    attentionLabel: "Needs attention",
    attnFailed: (n: number, top: { name: string; n: number } | null) =>
      (n === 1 ? "1 request failed" : `${n} requests failed`) +
      (top ? (top.n === n ? (n === 1 ? ` on ${top.name}` : `, all on ${top.name}`) : `, ${top.n} of them on ${top.name}`) : ""),
    attnToolCut: (n: number) =>
      n === 1 ? "Tool-call inspection cut off 1 suspicious tool call" : `Tool-call inspection cut off ${n} suspicious tool calls`,
    attnUpstream: (name: string, why: string) => `${name}: ${why}`,
    attnUpstreams: (n: number, names: string[]) =>
      `${n} upstreams unavailable: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`,
    whyOpen: "circuit open",
    whyAuth: "credentials rejected",
    whyLogin: "sign-in required",
    attnUnpriced: (n: number) =>
      n === 1
        ? "1 request unpriced: its model has no price, so its cost is not included"
        : `${n} requests unpriced: their models have no price, so their cost is not included`,
    scoped: (period: string, text: string) => `Last ${period}: ${text}`,
    viewInTraffic: "View in Traffic",
    showLog: "View in the security log",

    kpiTokens: "Tokens",
    kpiCost: "Cost",
    kpiCache: "Cache hits",
    kpiRequests: "Requests",
    kpiLatency: "First token",
    kpiTraffic: "Traffic",
    chartOf: (name: string) => `${name} over time`,

    deltaTip: (period: string, before: string, now: string) => `vs. prior ${period}: ${before} → ${now}`,
    noPrior: (period: string) => `No data for the prior ${period}`,

    ago: (period: string) => `${period} ago`,
    liveAgo: "10 min ago",
    now: "Now",
    chartUnavailable: "Unavailable right now",

    inOut: (input: string, output: string) => `Input ${input} · Output ${output}`,
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

    saved: (amount: string) => `${amount} saved`,
    netCost: (amount: string) => `${amount} net cost increase`,
    noTokens: "No tokens recorded",
    cacheReads: "Cache reads",
    uncachedInput: "Uncached input",
    cacheWrites: "Cache writes",

    failedSub: (n: number) => `${n} failed`,
    rateSuffix: (pct: string) => ` · ${pct}%`,
    noFailures: "No failures",
    showFailed: "View failed requests in Traffic",
    reqTip: (n: number, failed: number) => `${n === 1 ? "1 request" : `${n} requests`}${failed ? ` · ${failed} failed` : ""}`,

    latencyOf: (model: string, p95: string) => `${model} · P95 ${p95}`,
    p95: (shown: string) => `P95 ${shown}`,
    latTip: (p50: string, p95: string) => `P50 ${p50} · P95 ${p95}`,
    noSamples: "No samples",

    upload: (shown: string) => `Up ${shown}`,
    download: (shown: string) => `Down ${shown}`,
    trafficTip: (up: string, down: string) => `↑ ${up} · ↓ ${down}`,
    trafficNone: "No traffic recorded yet",

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
