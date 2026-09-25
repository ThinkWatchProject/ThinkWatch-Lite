import { messages } from "@/i18n";

/** 概览页的文案。 */
export const overviewText = messages(
  {
    title: "概览",
    /** 读取失败时 ErrorState 的标题 */
    loadFailed: "概览数据读取失败",

    // 页头摘要：此刻的状态。数字和状态，不写说明
    inFlight: (_n: number) => "个进行中",
    idle: "当前空闲",
    upstreams: (_n: number) => "个上游",
    unavailable: (_n: number) => "个不可用",
    noUpstreams: "尚未添加上游",
    showUpstreams: "在上游页中查看",

    /** 实时档的标记 */
    live: "实时",
    /** 实时档下，不跟着图走的那几块按这个区间统计 */
    liveWindow: "10 分钟",

    // 三个大数
    kpiTokens: "Token",
    kpiCost: "费用",
    kpiRequests: "请求",
    /**
     * 环比。`period` 是时间范围给的「24 小时」「7 天」「等长区间」；带箭头的幅度另画。
     * 数字开头的和前面的汉字之间空一格，和别处「另有 3 项」的写法一致
     */
    deltaVs: (period: string) => `较上一个${/^[0-9]/.test(period) ? " " : ""}${period}`,
    /** 上一个区间没有数据时，幅度那一格（「—」）的悬停说明 */
    noPrior: (period: string) => `上一个${/^[0-9]/.test(period) ? " " : ""}${period}无记录`,
    /** token 数。`shown` 是写出来的样子（缩写或精确值），`n` 决定英文的单复数 */
    tokens: (shown: string, _n: number) => `${shown} token`,
    /** token 那一栏的限定语：「输入 10.5M · 输出 356k」，两个数各自走 */
    input: "输入",
    output: "输出",

    // 费用那一栏的限定语。**估算、无法计价、无用量各说各的**
    estimated: (amount: string) => `含估算 ${amount}`,
    estimatedTip:
      "此部分金额为估算值：请求在响应结束前断开或中断，输出用量计至断开时；或该模型的单价取自其他平台。",
    unpriced: (n: number) => `${n} 条无法计价`,
    unpricedTip:
      "这些请求所用的模型未定价，费用未计入上方金额。在「上游 › 价目表」中设置价格后，之后的请求将按该价格计入。",
    noUsage: (n: number) => `${n} 条无用量`,
    noUsageTip:
      "这些请求没有用量数据：上游未报告，或连接在报告之前已结束。费用无法计算，未计入上方金额。",
    allMeasured: "全部按价目表实测",

    // 请求数那一栏
    failed: (n: number) => `${n} 次失败`,
    failureRate: (pct: string) => `失败率 ${pct}%`,
    showFailed: "在流量中查看失败的请求",

    // 图
    trend: "趋势",
    /** 图的口径。读屏读出来的这一组的名字 */
    metric: "图表口径",
    byTokens: "token",
    byCost: "费用",
    unknownModel: "未知模型",
    /** 前五项以外合并成的那一层。**它同时是图里那一层的名字** */
    other: "其他",
    otherCount: (n: number) => `其他 ${n} 项`,
    /** 悬停提示的抬头。**实时档读的是速率，不是那一格的量** */
    tokenRate: (shown: string) => `${shown} token/秒`,
    costRate: (amount: string) => `${amount}/小时`,
    /** 悬停提示抬头下面那一句：这一格有几次请求 */
    tipRequests: (requests: number, failed: number) => `${requests} 次请求${failed ? `，${failed} 次失败` : ""}`,
    tipNone: "无请求",
    waiting: "等待请求",
    noRequests: "所选区间内无请求记录",
    liveTicks: ["10 分钟前", "8 分钟", "6 分钟", "4 分钟", "2 分钟"],
    now: "现在",
    failureMarks: "存在失败的时段",
    /** 基线上一段红色的悬停说明 */
    failedAt: (at: string, n: number) => `${at}　${n} 次失败`,

    // 模型排行
    models: "模型",
    times: (n: number) => `${n} 次`,
    /** 用了 token 却没有费用的那一格（「—」）的悬停说明 */
    noCost: "无费用记录：模型未定价或不计费",
    moreNotListed: (n: number) => `另有 ${n} 项未列出`,
    /** 可以点的一行，读屏读出来的后半句 */
    viewInTraffic: "在流量中查看",

    // 缓存
    cache: "缓存",
    noTokens: "所选区间内无 token 记录",
    hitRate: "命中",
    netCost: "净增费用",
    netSavings: "净节省",
    readWrite: "读写比",
    cacheReads: "缓存读取",
    uncachedInput: "新输入",
    cacheWrites: "缓存写入",
    hitByModel: "各模型命中率",

    // 延迟
    latency: "延迟",
    latencyWhat: "首字节时间",
    notEnoughSamples: "所选区间内样本不足，暂无分位数据",
    byModel: "按模型",
    byUpstream: "按上游",
    /** 延迟表头的最后一列：每一行的分位数由几个请求算出 */
    samples: "样本",
    /** 样本太少的那一格的悬停说明 */
    fewSamples: "样本较少，分位数仅供参考",

    // 安全：各项防护的档位和这段时间各自看见了什么。数的是安全日志里的条数
    security: "安全",
    modeOff: "关闭",
    modeObserve: "观察",
    modeEnforce: "拦截",
    redact: "出站脱敏",
    inspect: "工具调用审查",
    notChecked: "不检查，不记录",
    secrets: (n: number, replaced: number) =>
      `发现 ${n} 处凭据，` + (replaced === 0 ? "均未替换" : replaced === n ? "均已替换" : `已替换 ${replaced} 处`),
    noSecrets: "未发现凭据",
    toolCalls: (n: number, cut: number) =>
      `发现 ${n} 个可疑工具调用，` + (cut === 0 ? "均未切断" : cut === n ? "均已切断" : `已切断 ${cut} 个`),
    noToolCalls: "未发现可疑工具调用",
    hiddenText: "隐藏字符",
    hiddenFound: (n: number, blocked: number) =>
      `发现 ${n} 处隐藏字符，` + (blocked === 0 ? "均未拒绝" : blocked === n ? "均已拒绝" : `已拒绝 ${blocked} 处`),
    noHidden: "未发现隐藏字符",
    content: "内容过滤",
    contentMatched: (n: number, blocked: number) =>
      `命中内容规则 ${n} 次，` + (blocked === 0 ? "均未拒绝" : blocked === n ? "均已拒绝" : `已拒绝 ${blocked} 次`),
    noContent: "未命中内容规则",
    outputLimit: "输出长度",
    overLimit: (n: number, cut: number) =>
      `${n} 次回答超过上限，` + (cut === 0 ? "均未切断" : cut === n ? "均已切断" : `已切断 ${cut} 次`),
    noOverLimit: "无回答超过上限",
    showLog: "在安全日志中查看",

    // 请求记录没起来。正常时不显示
    recordingUnavailable: "请求记录未能启动",
    forwardingUnaffected: "转发不受影响。",

    // 还没有任何请求时
    emptyTitle: "尚无请求记录",
    emptyHint: "将客户端指向本机网关后，用量与费用将在此处显示。",
    emptyHintNoUpstream: "添加上游并将客户端指向本机网关后，用量与费用将在此处显示。",
    probesAnswered: (n: number) => `已本地应答 ${n} 次客户端探测，客户端已连接网关。`,
    setUpClients: "设置客户端",
    addUpstream: "添加上游",
  },
  {
    title: "Overview",
    loadFailed: "Could not load the overview",

    inFlight: (_n: number) => "in progress",
    idle: "Idle",
    upstreams: (n: number) => (n === 1 ? "upstream" : "upstreams"),
    unavailable: (_n: number) => "unavailable",
    noUpstreams: "No upstreams yet",
    showUpstreams: "View in Upstreams",

    live: "Live",
    liveWindow: "10 minutes",

    kpiTokens: "Tokens",
    kpiCost: "Cost",
    kpiRequests: "Requests",
    deltaVs: (period: string) => `vs. prior ${period}`,
    noPrior: (period: string) => `No data for the prior ${period}`,
    tokens: (shown: string, n: number) => `${shown} ${n === 1 ? "token" : "tokens"}`,
    input: "Input",
    output: "Output",

    estimated: (amount: string) => `Incl. ${amount} estimated`,
    estimatedTip:
      "This part of the cost is estimated: requests disconnected or were interrupted before the response finished, and output usage is counted up to the disconnect; or the model's price was taken from another platform.",
    unpriced: (n: number) => `${n} unpriced`,
    unpricedTip:
      "The models used by these requests have no price, so their cost is not included in the amount above. Once a price is set in Upstreams › Price sheets, later requests are counted at that price.",
    noUsage: (n: number) => `${n} with no usage`,
    noUsageTip:
      "These requests have no usage data: the upstream did not report it, or the connection ended before it was reported. Their cost cannot be calculated and is not included in the amount above.",
    allMeasured: "All measured at price-sheet rates",

    failed: (n: number) => `${n} failed`,
    failureRate: (pct: string) => `Failure rate ${pct}%`,
    showFailed: "View failed requests in Traffic",

    trend: "Trend",
    metric: "Chart measure",
    byTokens: "Tokens",
    byCost: "Cost",
    unknownModel: "Unknown model",
    other: "Other",
    otherCount: (n: number) => (n === 1 ? "1 other" : `${n} others`),
    tokenRate: (shown: string) => `${shown} tokens/s`,
    costRate: (amount: string) => `${amount}/hour`,
    tipRequests: (requests: number, failed: number) =>
      `${requests === 1 ? "1 request" : `${requests} requests`}${failed ? `, ${failed} failed` : ""}`,
    tipNone: "No requests",
    waiting: "Waiting for requests",
    noRequests: "No requests recorded in the selected range",
    liveTicks: ["10 min ago", "8 min", "6 min", "4 min", "2 min"],
    now: "Now",
    failureMarks: "Periods with failures",
    failedAt: (at: string, n: number) => `${at} · ${n} failed`,

    models: "Models",
    times: (n: number) => `${n}×`,
    noCost: "No cost recorded: the model is unpriced or not billed",
    moreNotListed: (n: number) => `${n} more not listed`,
    viewInTraffic: "View in Traffic",

    cache: "Cache",
    noTokens: "No tokens recorded in the selected range",
    hitRate: "hit rate",
    netCost: "Net cost increase",
    netSavings: "Net savings",
    readWrite: "Read/write ratio",
    cacheReads: "Cache reads",
    uncachedInput: "Uncached input",
    cacheWrites: "Cache writes",
    hitByModel: "Hit rate by model",

    latency: "Latency",
    latencyWhat: "Time to first byte",
    notEnoughSamples: "Not enough samples in the selected range; no percentiles yet",
    byModel: "By model",
    byUpstream: "By upstream",
    samples: "Samples",
    fewSamples: "Few samples; the percentiles are only indicative",

    security: "Security",
    modeOff: "Off",
    modeObserve: "Observe",
    modeEnforce: "Enforce",
    redact: "Outbound redaction",
    inspect: "Tool-call inspection",
    notChecked: "Not checked or recorded",
    secrets: (n: number, replaced: number) =>
      (n === 1 ? "1 credential found, " : `${n} credentials found, `) +
      (replaced === 0 ? "none replaced" : replaced === n ? (n === 1 ? "replaced" : "all replaced") : `${replaced} replaced`),
    noSecrets: "No credentials found",
    toolCalls: (n: number, cut: number) =>
      (n === 1 ? "1 suspicious tool call found, " : `${n} suspicious tool calls found, `) +
      (cut === 0 ? "none cut off" : cut === n ? (n === 1 ? "cut off" : "all cut off") : `${cut} cut off`),
    noToolCalls: "No suspicious tool calls found",
    hiddenText: "Hidden characters",
    hiddenFound: (n: number, blocked: number) =>
      (n === 1 ? "Hidden characters found once, " : `Hidden characters found ${n} times, `) +
      (blocked === 0 ? "none refused" : blocked === n ? (n === 1 ? "refused" : "all refused") : `${blocked} refused`),
    noHidden: "No hidden characters found",
    content: "Content filter",
    contentMatched: (n: number, blocked: number) =>
      (n === 1 ? "1 content rule match, " : `${n} content rule matches, `) +
      (blocked === 0 ? "none refused" : blocked === n ? (n === 1 ? "refused" : "all refused") : `${blocked} refused`),
    noContent: "No content rule matches",
    outputLimit: "Output limit",
    overLimit: (n: number, cut: number) =>
      (n === 1 ? "1 answer over the limit, " : `${n} answers over the limit, `) +
      (cut === 0 ? "none cut off" : cut === n ? (n === 1 ? "cut off" : "all cut off") : `${cut} cut off`),
    noOverLimit: "No answers over the limit",
    showLog: "View in the security log",

    recordingUnavailable: "Request recording could not start",
    forwardingUnaffected: "Forwarding is not affected.",

    emptyTitle: "No requests yet",
    emptyHint: "Usage and cost appear here once clients point to the local gateway.",
    emptyHintNoUpstream:
      "Usage and cost appear here once an upstream is added and clients point to the local gateway.",
    probesAnswered: (n: number) =>
      n === 1
        ? "1 client probe was answered locally; a client is already connected to the gateway."
        : `${n} client probes were answered locally; a client is already connected to the gateway.`,
    setUpClients: "Set up clients",
    addUpstream: "Add upstream",
  },
);
