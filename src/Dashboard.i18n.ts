import { messages } from "@/i18n";

/** 概览页的文案。 */
export const dashboardText = messages(
  {
    // 图的口径。`metric` 是读屏读出来的这一组的名字
    metric: "图表口径",
    byTokens: "token",
    byCost: "费用",

    // 延迟的样本数、模型排行里的请求数。那一栏很窄
    times: (n: number) => `${n} 次`,
    moreNotListed: (n: number) => `另有 ${n} 项未列出`,

    /** 环比。`period` 是时间范围给的「24 小时」「7 天」 */
    delta: (period: string, arrow: string, pct: string) => `较上一个${period} ${arrow} ${pct}%`,

    /** token 数。`shown` 是写出来的样子（缩写或精确值），`n` 决定英文的单复数 */
    tokens: (shown: string, _n: number) => `${shown} token`,
    tokenUnit: (_n: number) => "token",
    inputOutput: (input: string, output: string) => `输入 ${input} · 输出 ${output}`,

    // 费用那一栏的限定语。**估算、无法计价、无用量、订阅各说各的**
    estimated: (amount: string) => `含估算 ${amount}`,
    estimatedTip:
      "此部分金额为估算值：请求在响应结束前断开或中断，输出用量计至断开时；或该模型的单价取自其他平台。",
    unpriced: (n: number) => `${n} 条无法计价`,
    unpricedTip:
      "这些请求所用的模型未定价，费用未计入上方金额。在「上游 › 价目表」中设置价格后，之后的请求将按该价格计入。",
    noUsage: (n: number) => `${n} 条无用量`,
    noUsageTip:
      "这些请求没有用量数据：上游未报告，或连接在报告之前已结束。费用无法计算，未计入上方金额。",
    subscription: (n: number) => `订阅额度 ${n} 次`,
    subscriptionTip:
      "订阅制上游不按用量产生费用，按 API 价目表折算的金额不代表实际费用，因此不计入。",
    allMeasured: "全部按价目表实测",

    // 请求数那一栏
    requestUnit: (_n: number) => "次请求",
    failed: (n: number) => `${n} 次失败`,
    failureRate: (pct: string) => `失败率 ${pct}%`,
    inFlight: (n: number) => `${n} 个进行中`,
    idle: "当前空闲",

    // 图
    unknownModel: "未知模型",
    /** 前五项以外合并成的那一层。**它同时是图里那一层的名字** */
    other: "其他",
    otherCount: (n: number) => `其他 ${n} 项`,
    /** 图里每一格的 `label`。**实时档读的是速率，不是那一格的量** */
    liveBucket: (at: string, rate: string) => `${at}　${rate}`,
    tokenRate: (shown: string) => `${shown} token/秒`,
    costRate: (amount: string) => `${amount}/小时`,
    bucket: (at: string, amount: string, requests: number, failed: number) =>
      `${at}　${amount}　${requests} 次${failed ? `（${failed} 次失败）` : ""}`,
    waiting: "等待请求。",
    noRequests: "所选区间内无请求记录。",
    liveTicks: ["10 分钟前", "8 分钟", "6 分钟", "4 分钟", "2 分钟"],
    now: "现在",
    failureMarks: "基线上的红色标出存在失败的时段",
    liveScope: "顶部数字与缓存、延迟、安全按最近 24 小时统计；模型排行跟随上图",

    // 还没有请求时
    gatewayHint: "本机网关地址",
    pointClients: (gateway: string) => `将客户端指向${gateway}后，用量与费用将在此处显示。`,
    probesAnswered: (n: number) =>
      `已本地应答 ${n} 次客户端探测。客户端已连接网关，这些探测未产生费用。`,

    // 左边那一列
    models: "模型",
    cache: "缓存",
    latency: "延迟",
    security: "安全",

    // 缓存
    noTokens: "所选区间内无 token 记录。",
    hitRate: "命中",
    netCost: "净增费用",
    netSavings: "净节省",
    readWrite: "读写比",
    cacheReads: "缓存读取",
    uncachedInput: "新输入",
    cacheWrites: "缓存写入",

    // 延迟
    notEnoughSamples: "所选区间内样本不足，暂无分位数据。",
    byModel: "按模型 · 首字节 P50 至 P95",
    byUpstream: "按上游 · 同上",

    // 安全：两项防护的档位和这段时间各自看见了什么。数的是安全日志里的条数
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
    showLog: "在安全日志中查看",

    /** 后面可能接「。转发不受影响。」，所以不带句号 */
    recordingUnavailable: "请求记录未能启动",
    forwardingUnaffected: "。转发不受影响。",
  },
  {
    metric: "Chart measure",
    byTokens: "Tokens",
    byCost: "Cost",

    times: (n: number) => `${n}×`,
    moreNotListed: (n: number) => `${n} more not listed`,

    // 大数下面那两行是定高的：英文要和中文一样在两行里放得下，所以用短的说法
    delta: (period: string, arrow: string, pct: string) => `${arrow} ${pct}% vs. prior ${period}`,

    tokens: (shown: string, n: number) => `${shown} ${n === 1 ? "token" : "tokens"}`,
    tokenUnit: (n: number) => (n === 1 ? "token" : "tokens"),
    inputOutput: (input: string, output: string) => `Input ${input} · Output ${output}`,

    estimated: (amount: string) => `Incl. ${amount} estimated`,
    estimatedTip:
      "This part of the cost is estimated: requests disconnected or were interrupted before the response finished, and output usage is counted up to the disconnect; or the model's price was taken from another platform.",
    unpriced: (n: number) => `${n} unpriced`,
    unpricedTip:
      "The models used by these requests have no price, so their cost is not included in the amount above. Once a price is set in Upstreams › Price sheets, later requests are counted at that price.",
    noUsage: (n: number) => `${n} with no usage`,
    noUsageTip:
      "These requests have no usage data: the upstream did not report it, or the connection ended before it was reported. Their cost cannot be calculated and is not included in the amount above.",
    subscription: (n: number) => `${n} on subscription`,
    subscriptionTip:
      "Subscription upstreams do not incur cost by usage. An amount converted at API price-sheet rates does not represent actual cost, so it is not included.",
    allMeasured: "All measured at price-sheet rates",

    requestUnit: (n: number) => (n === 1 ? "request" : "requests"),
    failed: (n: number) => `${n} failed`,
    failureRate: (pct: string) => `Failure rate ${pct}%`,
    inFlight: (n: number) => `${n} in progress`,
    idle: "Idle",

    unknownModel: "Unknown model",
    other: "Other",
    otherCount: (n: number) => (n === 1 ? "1 other" : `${n} others`),
    liveBucket: (at: string, rate: string) => `${at} · ${rate}`,
    tokenRate: (shown: string) => `${shown} tokens/s`,
    costRate: (amount: string) => `${amount}/hour`,
    bucket: (at: string, amount: string, requests: number, failed: number) =>
      `${at} · ${amount} · ${requests === 1 ? "1 request" : `${requests} requests`}${
        failed ? ` (${failed} failed)` : ""
      }`,
    waiting: "Waiting for requests.",
    noRequests: "No requests recorded in the selected range.",
    liveTicks: ["10 min ago", "8 min", "6 min", "4 min", "2 min"],
    now: "Now",
    failureMarks: "Red on the baseline marks periods with failures",
    liveScope:
      "Top figures, cache, latency and security cover the last 24 hours; the model ranking follows the chart above",

    gatewayHint: "the local gateway address",
    pointClients: (gateway: string) => `Usage and cost appear here once clients point to ${gateway}.`,
    // 接在上一句后面：英文两句之间要一个空格，中文不要
    probesAnswered: (n: number) =>
      n === 1
        ? " 1 client probe was answered locally. A client is already connected to the gateway; the probe incurred no cost."
        : ` ${n} client probes were answered locally. A client is already connected to the gateway; these probes incurred no cost.`,

    models: "Models",
    cache: "Cache",
    latency: "Latency",
    security: "Security",

    noTokens: "No tokens recorded in the selected range.",
    hitRate: "hit rate",
    netCost: "Net cost increase",
    netSavings: "Net savings",
    readWrite: "Read/write ratio",
    cacheReads: "Cache reads",
    uncachedInput: "Uncached input",
    cacheWrites: "Cache writes",

    notEnoughSamples: "Not enough samples in the selected range; no percentiles yet.",
    byModel: "By model · TTFB P50 to P95",
    byUpstream: "By upstream · same as above",

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
    showLog: "View in the security log",

    recordingUnavailable: "Request recording could not start",
    forwardingUnaffected: ". Forwarding is not affected.",
  },
);
