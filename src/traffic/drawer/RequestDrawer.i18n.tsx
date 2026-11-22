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
    stayedSealed: "对话带有该上游加密的内容，只能送回该上游",
    /** 选定上游之后才判断、拒绝了此请求的规则 */
    deniedBy: "拒绝规则",
    /** 规则写的拒绝理由，或者选中的上游为何都无法服务 */
    reason: "原因",
    attempts: "尝试链",
    /** 这一跳等空位等了多久（上游满着）。秒数已经按一位小数写好 */
    queued: (s: string) => `排队 ${s} 秒`,
    /** 第二轮起的一跳：第几次重试 */
    retry: (n: number) => `第 ${n} 次重试`,
    /** 这一跳发出之前退避等了多久。秒数的写法同 `queued` */
    backoff: (s: string) => `等待 ${s} 秒`,
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
    model: "请求的模型无法使用，未发往任何上游。",
    unrouted: "未能为此请求选出去向，未发往任何上游。",
    /** 前面几跳里有满着跳过的：它们不是上游的失败 */
    switched: (n: number) => `已自动切换上游：前 ${n} 次尝试未接下此请求。`,
    /** 最后接下它的是前面试过的一家：等它恢复之后发了过去 */
    waited: (n: number) => `前 ${n} 次尝试未接下此请求，上游恢复后已发出。`,
    /** 最后一跳是重试：候选都试过、最后一次是暂时的故障，又发了一轮 */
    retried: (n: number) => `前 ${n} 次尝试未接下此请求，已自动重试。`,
    limited: "网关密钥已达到用量上限，此请求未发往任何上游。",
    busy: "上游均已达到并发上限，等待期间没有空出位置，此请求未发往任何上游。",
    busyAfterTries: (n: number) => `发出的 ${n} 次尝试未成功，其余上游均已达到并发上限，等待期间没有空出位置。`,
    throttled: "上游均因返回 429 而暂停，等待期间没有恢复，此请求未被接下。",
    throttledAfterTries: (n: number) => `发出的 ${n} 次尝试未成功，其余上游均因返回 429 而暂停，等待期间没有恢复。`,
    full: "上游均已达到各自的用量上限，此请求未被接下。",
    fullAfterTries: (n: number) => `发出的 ${n} 次尝试未成功，其余上游均已达到各自的用量上限。`,
    timeout: "等待期间没有上游恢复可用，此请求未被接下。",
    timeoutAfterTries: (n: number) => `发出的 ${n} 次尝试未成功，等待期间其余上游均未恢复可用。`,
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
      <>将{em("记录中的请求")}发送至另一个上游，并排对比结果</>
    ),
    asIsTip: "使用保存时已脱敏的请求体，其中的占位符和遮蔽后的值也会一并发送。",
    asIs: "记录的内容",
    /** 选重放目标的那个下拉框，上游列表没取到 */
    upstreamsFailed: "上游列表读取失败",
    /** 下拉框里原来那个上游名后面的标记 */
    originalUpstream: "（原上游）",
    estimateCost: "预估费用",
    quote: (upstream: ReactNode, bytes: number, tokens: number) => (
      <>将向 {upstream} 发送 {bytes} 字节，约 {tokens} 个输入 token。</>
    ),
    willRedact: "发送前将按密钥与隐私的规则替换凭据。",
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
    stayedSealed: "Sent back to the upstream that encrypted content in this conversation",
    deniedBy: "Denied by",
    reason: "Reason",
    attempts: "Attempts",
    queued: (s: string) => `Queued ${s} s`,
    retry: (n: number) => `Retry ${n}`,
    backoff: (s: string) => `Waited ${s} s`,
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
    model: "The requested model cannot be used; the request was not sent to any upstream.",
    unrouted: "No destination could be chosen for this request; it was not sent to any upstream.",
    switched: (n: number) =>
      n === 1
        ? "Switched upstreams automatically: the first attempt did not take this request."
        : `Switched upstreams automatically: the first ${n} attempts did not take this request.`,
    waited: (n: number) =>
      n === 1
        ? "The first attempt did not take this request; it was sent once the upstream was available again."
        : `The first ${n} attempts did not take this request; it was sent once the upstream was available again.`,
    retried: (n: number) =>
      n === 1
        ? "The first attempt did not take this request; it was retried automatically."
        : `The first ${n} attempts did not take this request; it was retried automatically.`,
    limited: "The gateway key had reached a usage limit; this request was not sent to any upstream.",
    busy: "Every upstream was at its concurrency limit and none freed up in time; this request was not sent to any upstream.",
    busyAfterTries: (n: number) =>
      n === 1
        ? "The attempt sent did not succeed, and the other upstreams were at their concurrency limits with none freeing up in time."
        : `The ${n} attempts sent did not succeed, and the other upstreams were at their concurrency limits with none freeing up in time.`,
    throttled: "Every upstream was paused after answering 429 and none resumed in time; this request was not taken.",
    throttledAfterTries: (n: number) =>
      n === 1
        ? "The attempt sent did not succeed, and the other upstreams were paused after answering 429 with none resuming in time."
        : `The ${n} attempts sent did not succeed, and the other upstreams were paused after answering 429 with none resuming in time.`,
    full: "Every upstream was at one of its usage limits; this request was not taken.",
    fullAfterTries: (n: number) =>
      n === 1
        ? "The attempt sent did not succeed, and the other upstreams were at their usage limits."
        : `The ${n} attempts sent did not succeed, and the other upstreams were at their usage limits.`,
    timeout: "No upstream became available in time; this request was not taken.",
    timeoutAfterTries: (n: number) =>
      n === 1
        ? "The attempt sent did not succeed, and none of the other upstreams became available in time."
        : `The ${n} attempts sent did not succeed, and none of the other upstreams became available in time.`,
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
        Send {em("the recorded request")} to another upstream and compare the results side by side
      </>
    ),
    asIsTip:
      "Uses the body redacted for storage, including any placeholders and masked values.",
    asIs: "About the stored request",
    upstreamsFailed: "Could not load the upstreams",
    originalUpstream: " (original)",
    estimateCost: "Estimate cost",
    quote: (upstream: ReactNode, bytes: number, tokens: number) => (
      <>
        {count(bytes, "byte", "bytes")} will be sent to {upstream}, about{" "}
        {count(tokens, "input token", "input tokens")}.
      </>
    ),
    willRedact: "Credentials are replaced by the secrets & privacy rules before sending.",
    pricingDate: (date: string) => `Price sheet data as of ${date}.`,
    confirmSend: "Confirm and send",
    originalColumn: (upstream: string) => `${upstream} (original)`,
    replayColumn: (upstream: string) => `${upstream} (replay)`,
    duration: "Total time",
    replayPending: "Replay is available when the request ends",
  },
  {
    "zh-Hant": {
      title: "請求詳情",
      requestNo: (id: number) => `第 ${id} 號請求`,
      loadFailed: "請求詳情讀取失敗",
      tabTimeline: "時間線",
      tabPayload: "內容",
      details: "說明",
      ttfb: "首位元組",
      totalTime: "總耗時",
      generationTime: "生成用時",
      answeredLocally: "本地應答",
      client: "金鑰",
      app: "應用",
      guessed: "（按請求頭推測）",
      peer: "來源",
      path: "路徑",
      conversion: "格式轉換",
      dropped: "丟棄欄位",
      plugins: "外掛",
      droppedTip: "目標格式不支援這些欄位，傳送前已移除。",
      sessionLog: "會話日誌",
      sessionLogNote: "DeepSeek Harness 隨請求附帶的整段對話記錄。發往 DeepSeek 以外的上游之前，閘道器已將其去除。",
      status: "狀態",
      inProgress: "進行中",
      failed: "失敗",
      aborted: "手動中止",
      idleTimeout: "無回應超時",
      cancelled: "已取消：用戶端在回應結束前斷開連線",
      upload: "上傳",
      download: "下載",
      viaProxy: (name: string) => `經 ${name}`,
      notSentSuffix: "（未傳送）",
      matchedRule: "命中規則",
      denied: "拒絕",
      viaGroup: "經過策略組",
      alias: "別名",
      aliasNote: "按上游換成對應的模型名",
      pinnedBy: (rule: string) => `由規則「${rule}」指定，模型名原樣發出`,
      rewrittenBy: "引數改寫",
      continuity: "對話延續",
      heldRoute: "沿用本輪開頭的路由決定",
      stayedTurn: "同一輪內留在上次回答的上游",
      stayedCache: "上次回答的快取仍有效，留在該上游",
      stayedSealed: "對話帶有該上游加密的內容，只能送回該上游",
      deniedBy: "拒絕規則",
      attempts: "嘗試鏈",
      queued: (s: string) => `排隊 ${s} 秒`,
      retry: (n: number) => `第 ${n} 次重試`,
      abandonedEstimate: (n: string) => `輸入約 ${n} token`,
      mayBeBilled: "上游可能已計費",
      mayBeBilledTip: "上游是否收取這部分費用無法得知，此請求的費用不含這部分。",
      sentModel: (model: string) => `規則改寫了模型名：這一跳發給上游的是 ${model}，費用按它計算`,
      sentByAlias: (upstream: string, model: string) => `別名：這一跳發給 ${upstream} 的是 ${model}，費用按它計算`,
      sentPinned: (upstream: string, model: string) => `指定模型：這一跳發給 ${upstream} 的是 ${model}，費用按它計算`,
      sentByPlugin: (model: string) => `外掛改寫了模型名：這一跳發給上游的是 ${model}，費用按它計算`,
      sentOther: (model: string) => `這一跳發給上游的是 ${model}，費用按它計算`,
      failover: (failed: number) => `已發生故障轉移：前 ${failed} 個上游失敗，已自動切換至下一個上游。`,
      failoverDenied: (failed: number, rule: string) => `已發生故障轉移：前 ${failed} 個上游失敗，切換至下一個上游後，規則「${rule}」拒絕了此請求，未向該上游傳送。`,
      deniedAfterPick: (rule: string) => `選定上游後，規則「${rule}」拒絕了此請求，未發往任何上游。`,
      deniedBeforePick: (rule: string) => `選定上游之前，規則「${rule}」已拒絕此請求，未發往任何上游。`,
      unavailable: "規則選中的上游均無法服務此請求，未發往任何上游。",
      model: "請求的模型無法使用，未發往任何上游。",
      unrouted: "未能為此請求選出去向，未發往任何上游。",
      switched: (n: number) => `已自動切換上游：前 ${n} 次嘗試未接下此請求。`,
      waited: (n: number) => `前 ${n} 次嘗試未接下此請求，上游恢復後已發出。`,
      retried: (n: number) => `前 ${n} 次嘗試未接下此請求，已自動重試。`,
      limited: "閘道器金鑰已達到用量上限，此請求未發往任何上游。",
      busy: "上游均已達到併發上限，等待期間沒有空出位置，此請求未發往任何上游。",
      busyAfterTries: (n: number) => `發出的 ${n} 次嘗試未成功，其餘上游均已達到併發上限，等待期間沒有空出位置。`,
      throttled: "上游均因返回 429 而暫停，等待期間沒有恢復，此請求未被接下。",
      throttledAfterTries: (n: number) => `發出的 ${n} 次嘗試未成功，其餘上游均因返回 429 而暫停，等待期間沒有恢復。`,
      full: "上游均已達到各自的用量上限，此請求未被接下。",
      fullAfterTries: (n: number) => `發出的 ${n} 次嘗試未成功，其餘上游均已達到各自的用量上限。`,
      timeout: "等待期間沒有上游恢復可用，此請求未被接下。",
      timeoutAfterTries: (n: number) => `發出的 ${n} 次嘗試未成功，等待期間其餘上游均未恢復可用。`,
      noRouting: "此請求由閘道器本地應答，未經過路由。",
      noAttempts: "此請求沒有上游嘗試記錄。",
      payloadViews: { compare: "對比", after: "外掛改寫後" },
      afterPluginsSentBy: (n: number, upstream: string) => `外掛改寫後的請求：第 ${n} 跳發往 ${upstream} 的那一份`,
      notSaved: "未儲存",
      afterEnd: "請求結束後可檢視",
      pastRetentionTip: "此記錄已超過保留期限。",
      requestNotKeptTip: "請求正文未保留。",
      responseNotKeptTip: "回應正文未保留。",
      truncated: "僅儲存開頭部分",
      collapse: "摺疊",
      showAll: "展開全部",
      usagePending: "請求結束後可檢視用量和費用",
      cancelledBeforeUsage: "用戶端在上游報告用量前斷開連線",
      failedBeforeUsage: "請求在上游報告用量前失敗",
      noUsage: "上游未報告用量",
      noUsageTip: "部分上游的回應不含用量欄位。缺少用量時，無法得知此次呼叫的消耗，也無法計算費用。",
      input: "新輸入",
      output: "輸出",
      cacheReads: "快取讀取",
      cacheWrites: "快取寫入",
      inputMix: (read: string, input: string, write: string) => `快取讀取 ${read}，新輸入 ${input}，快取寫入 ${write}`,
      cost: "費用",
      free: "不計費",
      unpriced: "無法計價：該模型未定價",
      estimatedCancelled: "估算值，輸出用量計至用戶端斷開",
      estimatedInterrupted: "估算值，輸出用量計至回應中斷",
      priceSource: "價格來源",
      replayIntro: (em: (x: ReactNode) => ReactNode) => (<>將{em("記錄中的請求")}傳送至另一個上游，並排對比結果</>),
      asIsTip: "使用儲存時已脫敏的請求本文，其中的佔位符和遮蔽後的值也會一併傳送。",
      asIs: "記錄的內容",
      upstreamsFailed: "上游列表讀取失敗",
      estimateCost: "預估費用",
      quote: (upstream: ReactNode, bytes: number, tokens: number) => (<>將向 {upstream} 傳送 {bytes} 位元組，約 {tokens} 個輸入 token。</>),
      willRedact: "傳送前將按金鑰與隱私的規則替換憑據。",
      pricingDate: (date: string) => `價目表日期 ${date}。`,
      confirmSend: "確認傳送",
      originalColumn: (upstream: string) => `${upstream}（原請求）`,
      duration: "耗時",
      replayPending: "請求結束後可重放",
    },
    ko: {
      tabRouting: "라우팅",
      tabUsage: "사용량",
      details: "세부 정보",
      upstream: "업스트림",
      client: "키",
      peer: "출처",
      security: "보안",
      plugins: "플러그인",
      attemptGroup: (n: number, upstream: string | null) => (upstream ? `Attempt ${n} · ${upstream}` : `${n}번째 시도`),
      status: "상태",
      inProgress: "진행 중",
      failed: "실패",
      tokens: "토큰",
      reason: "원인",
      output: "출력",
      cost: "비용",
    },
    es: {
      title: "Detalles de la solicitud",
      requestNo: (id: number) => `Solicitud #${id}`,
      loadFailed: "No se pudo cargar la solicitud",
      tabTimeline: "Calendario",
      tabRouting: "Enrutamiento",
      tabPayload: "Contenido",
      tabUsage: "Uso",
      tabReplay: "Repetir",
      details: "Detalles",
      ttft: "Primer token",
      speed: "Velocidad",
      totalTime: "Tiempo total",
      generationTime: "Generación",
      upstream: "Proveedor",
      answeredLocally: "Respuestas locales",
      client: "Clave",
      guessed: " (afirmado en las cabeceras de la solicitud)",
      peer: "Origen",
      path: "Ruta",
      conversion: "Conversión",
      dropped: "Caída",
      security: "Seguridad",
      plugins: "Complementos",
      attemptGroup: (n: number, upstream: string | null) => (upstream ? `Intento ${n} · ${upstream}` : `Intento ${n}`),
      droppedTip: "El formato de destino no admite estos campos; fueron eliminados antes de enviarlos.",
      sessionLog: "Registro de la sesión",
      sessionLogNote: "Toda la conversación, unida por DeepSeek Harness. La puerta de entrada lo elimina antes de que una solicitud vaya a un río arriba distinto de Deepseek.",
      status: "Estado",
      inProgress: "En curso",
      failed: "Error",
      cancelledShort: "Cancelado",
      aborted: "Abortado",
      idleTimeout: "Sin respuesta",
      cancelled: "Cancelado: el cliente se desconectó antes de que la respuesta terminara",
      egress: "Egreso",
      upload: "Subir",
      download: "Descargar",
      waiting: "Esperando el primer token",
      generating: "Generando",
      timingLabel: (ttft: string, gen: string) => `Esperando el primer token ${ttft}, generando ${gen}`,
      notSentSuffix: " (no enviado)",
      route: "Ruta",
      matchedRule: "Regla armonizada",
      denied: "Denegado",
      viaGroup: "A través del grupo",
      aliasNote: "Resuelto al nombre del modelo de cada uno de ellos",
      pinnedModel: "Modelo de fijación",
      pinnedBy: (rule: string) => `Establecer por regla “${rule}”; el nombre del modelo se envía como es`,
      rewrittenBy: "Reescrito por",
      continuity: "Conversación",
      heldRoute: "Mantuvo la ruta decidida al inicio de este turno",
      stayedTurn: "Se quedó con la corriente que respondió antes en este turno",
      stayedCache: "Permaneció con el cursor que respondió por última vez, mientras que su caché es caliente",
      stayedSealed: "Enviado de vuelta al contenido cifrado en esta conversación",
      deniedBy: "Denegado por",
      reason: "Motivo",
      attempts: "Intentos",
      queued: (s: string) => `Encolado ${s} s`,
      retry: (n: number) => `Reintentar ${n}`,
      backoff: (s: string) => `Esperado ${s} s`,
      abandonedEstimate: (n: string) => `Acerca de ${n} tokens de entrada`,
      mayBeBilled: "puede haber sido facturado por el",
      mayBeBilledTip: "Se desconoce si la carga ascendente de estos tokens no está incluida en el coste de esta solicitud.",
      sentModel: (model: string) => `Una regla reescribió el modelo: este intento enviado ${model}, y el costo es el precio por él`,
      sentByAlias: (upstream: string, model: string) => `Alias: este intento enviado ${model} a ${upstream}, y el costo es calculado por él`,
      sentPinned: (upstream: string, model: string) => `Modelo clavado: este intento enviado ${model} a ${upstream}, y el costo es valorado por él`,
      sentByPlugin: (model: string) => `Un plugin reescribió el modelo: este intento enviado ${model}, y el costo es el precio por él`,
      sentOther: (model: string) => `Este intento enviado ${model}, y el costo es calculado por él`,
      failover: (failed: number) => failed === 1
        ? "Ocurrió un fallo: la primera versión anterior falló, y la solicitud se cambió a la siguiente versión anterior automáticamente."
        : `Ocurrió un fallo: las primeras ${failed} del proveedor fallaron, y la solicitud fue cambiada automáticamente a la siguiente del proveedor.`,
      failoverDenied: (failed: number, rule: string) => failed === 1
        ? `Ocurrió un fallo: el primer paso anterior falló, y después del cambio al siguiente paso, la regla “${rule}” denegó la solicitud antes de que se enviara allí.`
        : `Ocurrió un fallo: los primeros ${failed} del proveedor fallaron, y después del cambio a la siguiente del proveedor, la regla “${rule}” denegó la solicitud antes de que fuera enviada allí.`,
      deniedAfterPick: (rule: string) => `La regla “${rule}” denegó esta solicitud una vez que se eligió el curso anterior; no se envió a ningún curso anterior.`,
      deniedBeforePick: (rule: string) => `La regla “${rule}” denegó esta solicitud antes de que se eligiera un curso anterior; no se envió a ningún curso anterior.`,
      unavailable: "Ninguna regla seleccionada puede servir a esta solicitud; no fue enviada a ninguna instrucción.",
      model: "No se puede utilizar el modelo solicitado; la solicitud no se envió a ninguna fuente.",
      unrouted: "No se pudo elegir ningún destino para esta solicitud; no se envió a ninguna fuente.",
      switched: (n: number) => n === 1
        ? "Conmutado de forma automática: el primer intento no aceptó esta petición."
        : `Conmutado hacia arriba automáticamente: los primeros intentos ${n} no aceptaron esta petición.`,
      waited: (n: number) => n === 1
        ? "En el primer intento no se aceptó esta solicitud; se envió una vez que el curso previo estaba disponible de nuevo."
        : `Los primeros ${n} intentos no aceptaron esta petición; se envió una vez que el curso previo estaba disponible de nuevo.`,
      retried: (n: number) => n === 1
        ? "El primer intento no tomó esta petición; fue juzgado automáticamente."
        : `Los primeros ${n} intentos no tomaron esta petición; fue juzgado automáticamente.`,
      limited: "La clave de entrada había alcanzado un límite de uso; esta solicitud no se envió a ninguna fuente.",
      busy: "Todas las del proveedor estaban en su límite de concurrencia y ninguna fue liberada a tiempo; esta solicitud no fue enviada a ninguna del proveedor.",
      busyAfterTries: (n: number) => n === 1
        ? "El intento enviado no tuvo éxito, y las otras del proveedor estaban en sus límites de concurrencia sin que nadie se liberara a tiempo."
        : `Los ${n} intentos enviados no tuvieron éxito, y las otras del proveedor estaban en sus límites de concurrencia, sin que ninguno se liberara a tiempo.`,
      throttled: "Cada del proveedor se detuvo después de responder 429 y ninguna se reanudó a tiempo; esta petición no fue tomada.",
      throttledAfterTries: (n: number) => n === 1
        ? "El intento enviado no tuvo éxito, y las otras del proveedor se detuvieron después de responder 429 sin que se reanudara a tiempo."
        : `Los ${n} intentos enviados no tuvieron éxito, y las otras del proveedor fueron pausadas después de responder a 429 sin que ninguna se reanudara a tiempo.`,
      full: "Todas las del proveedor estaban en uno de sus límites de uso; esta petición no fue tomada.",
      fullAfterTries: (n: number) => n === 1
        ? "El intento enviado no tuvo éxito, y las otras del proveedor estaban en sus límites de uso."
        : `Los ${n} intentos enviados no tuvieron éxito, y las otras del proveedor estaban en sus límites de uso.`,
      timeout: "No se pudo acceder a tiempo a ninguna fase anterior; esta solicitud no se hizo efectiva.",
      timeoutAfterTries: (n: number) => n === 1
        ? "El intento enviado no tuvo éxito, y ninguna de las otras del proveedor estuvo disponible a tiempo."
        : `Los ${n} intentos enviados no tuvieron éxito, y ninguna de las otras del proveedor llegó a estar disponible a tiempo.`,
      noRouting: "La puerta de entrada respondió a esta petición localmente; no pasó por rutas.",
      routingPending: "El enrutamiento no ha terminado todavía",
      noAttempts: "No se registraron intentos previos para esta solicitud.",
      payloadViews: { compare: "Comparar", after: "Después de los complementos" },
      afterPluginsSentBy: (n: number, upstream: string) => `Después de plugins: qué intento ${n} enviado a ${upstream}`,
      notSaved: "No guardado",
      afterEnd: "Disponible cuando finalice la solicitud",
      pastRetentionTip: "Este registro ha pasado su período de retención.",
      requestNotKeptTip: "El cuerpo de solicitud no se mantuvo.",
      responseNotKeptTip: "El cuerpo de respuesta no se mantuvo.",
      truncated: "sólo el principio se salvó",
      collapse: "Colapso",
      showAll: "Mostrar todo",
      usagePending: "Uso y costo están disponibles cuando la solicitud termina",
      cancelledBeforeUsage: "El cliente se desconectó antes del uso informado",
      failedBeforeUsage: "La solicitud falló antes del uso informado",
      noUsage: "En la fase anterior no se informó del uso",
      noUsageTip: "Algunas respuestas anteriores no incluyen campos de uso. Sin uso, se desconoce el consumo de esta llamada y no se puede calcular su costo.",
      input: "Entrada sin encallar",
      output: "Salida",
      cacheReads: "Caché lee",
      cacheWrites: "Cache escribe",
      inputMix: (read: string, input: string, write: string) => `Caché lee ${read}, entrada sin caché ${input}, caché escribe ${write}`,
      cost: "Coste",
      free: "Libre",
      unpriced: "Sin precio: este modelo no tiene precio",
      estimatedCancelled: "estimado; uso de salida contado hasta la desconexión del cliente",
      estimatedInterrupted: "estimado; el uso de la salida se contabilizó hasta la interrupción",
      estimated: "Estimación",
      priceSource: "Fuente del precio",
      replayIntro: (em: (x: ReactNode) => ReactNode) => (<>
        Enviar {em("la solicitud registrada")} y comparar los resultados uno al lado del otro
       </>),
      asIsTip: "Utiliza el cuerpo redactado para su almacenamiento, incluidos los marcadores de posición y los valores enmascarados.",
      asIs: "Acerca de la solicitud almacenada",
      upstreamsFailed: "No se pudo cargar las del proveedor",
      estimateCost: "Costo estimado",
      quote: (upstream: ReactNode, bytes: number, tokens: number) => (<>
        {count(bytes, "byte", "bytes")} se enviará a {upstream}, sobre{" "}
        {count(tokens, "token de entrada", "tokens de entrada")}.
       </>),
      willRedact: "Las credenciales se sustituyen por los secretos y las reglas de privacidad antes de enviar.",
      pricingDate: (date: string) => `Datos de la hoja de precios a partir de ${date}.`,
      confirmSend: "Confirmar y enviar",
      replayColumn: (upstream: string) => `${upstream} (reproducir)`,
      duration: "Tiempo total",
      replayPending: "La repetición está disponible cuando finaliza la solicitud",
    },
  },
);
