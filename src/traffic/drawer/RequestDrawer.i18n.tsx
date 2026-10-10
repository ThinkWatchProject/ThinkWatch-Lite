import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 英文的单复数：`count(3, "byte", "bytes")` 是 `3 bytes` */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 请求详情的文案。
 *
 * `.tsx`：重放那一页有两句话带着加粗的片段，而片段在中英文句子里的位置
 * 不同，只能由句子自己决定放在哪儿。加粗的样式由调用方传进来。
 */
export const requestDrawerText = messages(
  {
    /** 读屏软件念的标题 */
    title: "请求详情",
    /** 没有模型名时的标题 */
    requestNo: (id: number) => `第 ${id} 号请求`,
    loadFailed: "请求详情读取失败",

    tabTimeline: "时间线",
    tabRouting: "路由",
    tabPayload: "内容",
    tabUsage: "用量",
    tabReplay: "重放",

    /** 虚线下划线的提示入口 */
    details: "说明",
    listSep: "、",

    // 时间线。左边那一列标签只有 80px 宽
    ttfb: "首字节",
    ttft: "首 token",
    speed: "生成速度",
    speedValue: (n: string) => `${n} token/秒`,
    totalTime: "总耗时",
    generationTime: "生成用时",
    upstream: "上游",
    answeredLocally: "本地应答",
    /** 请求带的是哪把网关密钥 —— 身份 */
    client: "密钥",
    /** 按请求头推测的应用 —— 旁证 */
    app: "应用",
    guessed: "（按请求头推测）",
    /** 非本机来的请求从哪台机器来 */
    peer: "来源",
    path: "路径",
    conversion: "格式转换",
    dropped: "丢弃字段",
    /** 两项防护在这次请求上的全部命中 */
    security: "安全",
    /** 这次请求上运行过的插件 */
    plugins: "插件",
    /** 插件运行按跳分组：组头 */
    attemptGroup: (n: number, upstream: string | null) => (upstream ? `第 ${n} 跳 · ${upstream}` : `第 ${n} 跳`),
    droppedTip: "目标格式不支持这些字段，发送前已移除。",
    /** DeepSeek Harness 随请求附带的会话日志：标签，和大小下面那一句 */
    sessionLog: "会话日志",
    sessionLogNote: "DeepSeek Harness 随请求附带的整段对话记录。发往 DeepSeek 以外的上游之前，网关已将其去除。",
    status: "状态",
    inProgress: "进行中",
    /** 头上那一项：失败了。原因写在「时间线」的状态那一行 */
    failed: "失败",
    cancelledShort: "已取消",
    /** 在界面上手动中止的 */
    aborted: "手动中止",
    /** 上游等到无响应超时还没有内容（一个字都没给，或者答到一半停住） */
    idleTimeout: "无响应超时",
    cancelled: "已取消：客户端在响应结束前断开连接",
    /** 服务这个请求的那一跳走的代理，或者「直连」 */
    egress: "出口",
    /** 网关和上游之间：发给上游的请求体、从上游收到的响应体 */
    upload: "上传",
    download: "下载",
    /** 尝试链上一跳走的代理 */
    viaProxy: (name: string) => `经 ${name}`,
    /** 顶上那一排数字 */
    tokens: "token",
    /** 首 token 和生成的比例条：两段的名字，和读屏念的那一句 */
    waiting: "等待首 token",
    generating: "生成",
    timingLabel: (ttft: string, gen: string) => `等待首 token ${ttft}，生成 ${gen}`,

    /** 选定上游之后被规则拒绝的请求，「上游」那一行名字后面的标记 */
    notSentSuffix: "（未发送）",

    // 路由
    route: "路由",
    matchedRule: "命中规则",
    /** 命中规则后面的标记：决定去向的这一条就是拒绝 */
    denied: "拒绝",
    viaGroup: "经过策略组",
    /** 客户端写的是别名：别名的名称，后面一句说它怎么对到各家 */
    alias: "别名",
    aliasNote: "按上游换成对应的模型名",
    /** 决定去向的规则用了「指定模型」 */
    pinnedModel: "指定模型",
    pinnedBy: (rule: string) => `由规则「${rule}」指定，模型名原样发出`,
    /** 改写了参数的规则，按求值的顺序 */
    rewrittenBy: "参数改写",
    /** 这段对话之前的去向起的作用 */
    continuity: "对话延续",
    heldRoute: "沿用本轮开头的路由决定",
    stayedTurn: "同一轮内留在上次回答的上游",
    stayedCache: "上次回答的缓存仍有效，留在该上游",
    /** 选定上游之后才判断、拒绝了此请求的规则 */
    deniedBy: "拒绝规则",
    /** 规则写的拒绝理由，或者选中的上游为何都无法服务 */
    reason: "原因",
    attempts: "尝试链",
    /** 这一跳等空位等了多久（上游满着）。秒数已经按一位小数写好 */
    queued: (s: string) => `排队 ${s} 秒`,
    /** 放弃了的一跳（无响应超时）下面那一行：上游没报用量时，网关估的输入 */
    abandonedEstimate: (n: string) => `输入约 ${n} token`,
    mayBeBilled: "上游可能已计费",
    mayBeBilledTip: "上游是否收取这部分费用无法得知，此请求的费用不含这部分。",
    // 尝试链里一跳发出的模型名和客户端写的不同：悬停按原因说
    sentModel: (model: string) => `规则改写了模型名：这一跳发给上游的是 ${model}，费用按它计算`,
    sentByAlias: (upstream: string, model: string) => `别名：这一跳发给 ${upstream} 的是 ${model}，费用按它计算`,
    sentPinned: (upstream: string, model: string) => `指定模型：这一跳发给 ${upstream} 的是 ${model}，费用按它计算`,
    sentByPlugin: (model: string) => `插件改写了模型名：这一跳发给上游的是 ${model}，费用按它计算`,
    /** 原因对不上现在的配置（规则、别名在这次请求之后改过）：只说事实 */
    sentOther: (model: string) => `这一跳发给上游的是 ${model}，费用按它计算`,
    failover: (failed: number) =>
      `已发生故障转移：前 ${failed} 个上游失败，已自动切换至下一个上游。`,
    failoverDenied: (failed: number, rule: string) =>
      `已发生故障转移：前 ${failed} 个上游失败，切换至下一个上游后，规则「${rule}」拒绝了此请求，未向该上游发送。`,
    deniedAfterPick: (rule: string) => `选定上游后，规则「${rule}」拒绝了此请求，未发往任何上游。`,
    deniedBeforePick: (rule: string) => `选定上游之前，规则「${rule}」已拒绝此请求，未发往任何上游。`,
    unavailable: "规则选中的上游均无法服务此请求，未发往任何上游。",
    /** 前面几跳里有满着跳过的：它们不是上游的失败 */
    switched: (n: number) => `已自动切换上游：前 ${n} 次尝试未接下此请求。`,
    limited: "网关密钥已达到用量上限，此请求未发往任何上游。",
    busy: "上游均已达到并发上限，等待期间没有空出位置，此请求未发往任何上游。",
    busyAfterTries: (n: number) => `发出的 ${n} 次尝试未成功，其余上游均已达到并发上限，等待期间没有空出位置。`,
    noRouting: "此请求由网关本地应答，未经过路由。",
    routingPending: "路由尚未完成",
    noAttempts: "此请求没有上游尝试记录。",

    // 内容
    /** 插件改写过的请求（上游一侧）：对比原样和改写后的，或者只看改写后的 */
    payloadViews: { compare: "对比", after: "插件改写后" },
    /** 试过不止一跳时，改写后的那一份是哪一跳发出的 */
    afterPluginsSentBy: (n: number, upstream: string) => `插件改写后的请求：第 ${n} 跳发往 ${upstream} 的那一份`,
    notSaved: "未保存",
    afterEnd: "请求结束后可查看",
    /** 「未保存」的说明：早于报文的保留期限的 */
    pastRetentionTip: "此记录已超过保留期限。",
    /** 「未保存」的说明：期限之内也没有的（WebSocket、本地应答从来不存），不说原因 */
    requestNotKeptTip: "请求正文未保留。",
    responseNotKeptTip: "响应正文未保留。",
    truncated: "仅保存开头部分",
    collapse: "折叠",
    showAll: "展开全部",

    // 用量。**没有用量、没有价格、估算，各说各的**
    usagePending: "请求结束后可查看用量和费用",
    cancelledBeforeUsage: "客户端在上游报告用量前断开连接",
    failedBeforeUsage: "请求在上游报告用量前失败",
    noUsage: "上游未报告用量",
    noUsageTip:
      "部分上游的响应不含用量字段。缺少用量时，无法得知此次调用的消耗，也无法计算费用。",
    input: "新输入",
    output: "输出",
    cacheReads: "缓存读取",
    cacheWrites: "缓存写入",
    /** 输入构成条，读屏念的那一句 */
    inputMix: (read: string, input: string, write: string) =>
      `缓存读取 ${read}，新输入 ${input}，缓存写入 ${write}`,
    cost: "费用",
    free: "不计费",
    unpriced: "无法计价：该模型未定价",
    estimatedCancelled: "估算值，输出用量计至客户端断开",
    estimatedInterrupted: "估算值，输出用量计至响应中断",
    estimated: "估算值",
    priceSource: "价格来源",

    // 重放
    replayIntro: (em: (x: ReactNode) => ReactNode) => (
      <>将此请求{em("原样")}发送至另一个上游，并排对比结果</>
    ),
    asIsTip: "使用记录中保存的原始请求体，内容与原请求完全一致。",
    asIs: "「原样」的含义",
    /** 选重放目标的那个下拉框，上游列表没取到 */
    upstreamsFailed: "上游列表读取失败",
    /** 下拉框里原来那个上游名后面的标记 */
    originalUpstream: "（原上游）",
    estimateCost: "预估费用",
    quote: (upstream: ReactNode, bytes: number, tokens: number) => (
      <>将向 {upstream} 发送 {bytes} 字节，约 {tokens} 个输入 token。</>
    ),
    willRedact: "发送前将按出站脱敏的规则替换凭据。",
    pricingDate: (date: string) => `价目表日期 ${date}。`,
    confirmSend: "确认发送",
    originalColumn: (upstream: string) => `${upstream}（原请求）`,
    replayColumn: (upstream: string) => `${upstream}（重放）`,
    duration: "耗时",
    replayPending: "请求结束后可重放",
  },
  {
    title: "Request details",
    requestNo: (id: number) => `Request #${id}`,
    loadFailed: "Could not load the request",

    tabTimeline: "Timeline",
    tabRouting: "Routing",
    tabPayload: "Content",
    tabUsage: "Usage",
    tabReplay: "Replay",

    details: "Details",
    listSep: ", ",

    // 标签列放不下术语表里的全称时用短的那半：Generation、Conversion、Dropped
    ttfb: "TTFB",
    ttft: "First token",
    speed: "Speed",
    speedValue: (n: string) => `${n} tokens/s`,
    totalTime: "Total time",
    generationTime: "Generation",
    upstream: "Upstream",
    answeredLocally: "Answered locally",
    client: "Key",
    app: "App",
    guessed: " (guessed from the request headers)",
    peer: "Source",
    path: "Path",
    conversion: "Conversion",
    dropped: "Dropped",
    security: "Security",
    plugins: "Plugins",
    attemptGroup: (n: number, upstream: string | null) => (upstream ? `Attempt ${n} · ${upstream}` : `Attempt ${n}`),
    droppedTip: "The target format does not support these fields; they were removed before sending.",
    sessionLog: "Session log",
    sessionLogNote:
      "The whole conversation, attached by DeepSeek Harness. The gateway removes it before a request goes to an upstream other than DeepSeek.",
    status: "Status",
    inProgress: "In progress",
    failed: "Failed",
    cancelledShort: "Canceled",
    aborted: "Aborted",
    idleTimeout: "No response",
    cancelled: "Canceled: the client disconnected before the response finished",
    egress: "Egress",
    upload: "Upload",
    download: "Download",
    viaProxy: (name: string) => `via ${name}`,
    tokens: "Tokens",
    waiting: "Waiting for first token",
    generating: "Generating",
    timingLabel: (ttft: string, gen: string) => `Waiting for first token ${ttft}, generating ${gen}`,

    notSentSuffix: " (not sent)",

    route: "Route",
    matchedRule: "Matched rule",
    denied: "Denied",
    viaGroup: "Via group",
    alias: "Alias",
    aliasNote: "Resolved to each upstream's own model name",
    pinnedModel: "Pinned model",
    pinnedBy: (rule: string) => `Set by rule “${rule}”; the model name is sent as is`,
    rewrittenBy: "Rewritten by",
    continuity: "Conversation",
    heldRoute: "Kept the route decided at the start of this turn",
    stayedTurn: "Stayed with the upstream that answered earlier in this turn",
    stayedCache: "Stayed with the upstream that answered last, while its cache is warm",
    deniedBy: "Denied by",
    reason: "Reason",
    attempts: "Attempts",
    queued: (s: string) => `Queued ${s} s`,
    abandonedEstimate: (n: string) => `About ${n} input tokens`,
    mayBeBilled: "may have been billed by the upstream",
    mayBeBilledTip: "Whether the upstream charged for these tokens is unknown; they are not included in this request's cost.",
    sentModel: (model: string) => `A rule rewrote the model: this attempt sent ${model}, and the cost is priced by it`,
    sentByAlias: (upstream: string, model: string) =>
      `Alias: this attempt sent ${model} to ${upstream}, and the cost is priced by it`,
    sentPinned: (upstream: string, model: string) =>
      `Pinned model: this attempt sent ${model} to ${upstream}, and the cost is priced by it`,
    sentByPlugin: (model: string) => `A plugin rewrote the model: this attempt sent ${model}, and the cost is priced by it`,
    sentOther: (model: string) => `This attempt sent ${model}, and the cost is priced by it`,
    failover: (failed: number) =>
      failed === 1
        ? "Failover occurred: the first upstream failed, and the request was switched to the next upstream automatically."
        : `Failover occurred: the first ${failed} upstreams failed, and the request was switched to the next upstream automatically.`,
    failoverDenied: (failed: number, rule: string) =>
      failed === 1
        ? `Failover occurred: the first upstream failed, and after the switch to the next upstream, rule “${rule}” denied the request before it was sent there.`
        : `Failover occurred: the first ${failed} upstreams failed, and after the switch to the next upstream, rule “${rule}” denied the request before it was sent there.`,
    deniedAfterPick: (rule: string) =>
      `Rule “${rule}” denied this request after the upstream was chosen; it was not sent to any upstream.`,
    deniedBeforePick: (rule: string) =>
      `Rule “${rule}” denied this request before an upstream was chosen; it was not sent to any upstream.`,
    unavailable: "No upstream the rule selected can serve this request; it was not sent to any upstream.",
    switched: (n: number) =>
      n === 1
        ? "Switched upstreams automatically: the first attempt did not take this request."
        : `Switched upstreams automatically: the first ${n} attempts did not take this request.`,
    limited: "The gateway key had reached a usage limit; this request was not sent to any upstream.",
    busy: "Every upstream was at its concurrency limit and none freed up in time; this request was not sent to any upstream.",
    busyAfterTries: (n: number) =>
      n === 1
        ? "The attempt sent did not succeed, and the other upstreams were at their concurrency limits with none freeing up in time."
        : `The ${n} attempts sent did not succeed, and the other upstreams were at their concurrency limits with none freeing up in time.`,
    noRouting: "The gateway answered this request locally; it did not go through routing.",
    routingPending: "Routing has not finished yet",
    noAttempts: "No upstream attempts were recorded for this request.",

    payloadViews: { compare: "Compare", after: "After plugins" },
    afterPluginsSentBy: (n: number, upstream: string) => `After plugins: what attempt ${n} sent to ${upstream}`,
    notSaved: "Not saved",
    afterEnd: "Available when the request ends",
    pastRetentionTip: "This record is past its retention period.",
    requestNotKeptTip: "The request body was not kept.",
    responseNotKeptTip: "The response body was not kept.",
    truncated: "only the beginning was saved",
    collapse: "Collapse",
    showAll: "Show all",

    usagePending: "Usage and cost are available when the request ends",
    cancelledBeforeUsage: "The client disconnected before the upstream reported usage",
    failedBeforeUsage: "The request failed before the upstream reported usage",
    noUsage: "The upstream did not report usage",
    noUsageTip:
      "Some upstreams' responses do not include usage fields. Without usage, the consumption of this call is unknown and its cost cannot be calculated.",
    input: "Uncached input",
    output: "Output",
    cacheReads: "Cache reads",
    cacheWrites: "Cache writes",
    inputMix: (read: string, input: string, write: string) =>
      `Cache reads ${read}, uncached input ${input}, cache writes ${write}`,
    cost: "Cost",
    free: "Free",
    unpriced: "Unpriced: this model has no price",
    estimatedCancelled: "estimated; output usage counted up to the client disconnect",
    estimatedInterrupted: "estimated; output usage counted up to the interruption",
    estimated: "estimated",
    priceSource: "Price source",

    replayIntro: (em: (x: ReactNode) => ReactNode) => (
      <>
        Send this request {em("as is")} to another upstream and compare the results side by side
      </>
    ),
    asIsTip:
      "Uses the original request body saved in the record; the content is identical to the original request.",
    asIs: "What “as is” means",
    upstreamsFailed: "Could not load the upstreams",
    originalUpstream: " (original)",
    estimateCost: "Estimate cost",
    quote: (upstream: ReactNode, bytes: number, tokens: number) => (
      <>
        {count(bytes, "byte", "bytes")} will be sent to {upstream}, about{" "}
        {count(tokens, "input token", "input tokens")}.
      </>
    ),
    willRedact: "Credentials are replaced by the outbound redaction rules before sending.",
    pricingDate: (date: string) => `Price sheet data as of ${date}.`,
    confirmSend: "Confirm and send",
    originalColumn: (upstream: string) => `${upstream} (original)`,
    replayColumn: (upstream: string) => `${upstream} (replay)`,
    duration: "Total time",
    replayPending: "Replay is available when the request ends",
  },
);
