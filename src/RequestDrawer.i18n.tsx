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
    droppedTip: "目标格式不支持这些字段，发送前已移除。",
    status: "状态",
    inProgress: "进行中",
    /** 头上那一项：失败了。原因写在「时间线」的状态那一行 */
    failed: "失败",
    cancelledShort: "已取消",
    cancelled: "已取消：客户端在响应结束前断开连接",
    bytes: "字节",
    /** 顶上那一排数字 */
    tokens: "token",
    /** 首字节和生成的比例条：两段的名字，和读屏念的那一句 */
    waiting: "等待首字节",
    generating: "生成",
    timingLabel: (ttfb: string, gen: string) => `等待首字节 ${ttfb}，生成 ${gen}`,

    /** 选定上游之后被规则拒绝的请求，「上游」那一行名字后面的标记 */
    notSentSuffix: "（未发送）",

    // 路由
    route: "路由",
    matchedRule: "命中规则",
    /** 命中规则后面的标记：决定去向的这一条就是拒绝 */
    denied: "拒绝",
    viaGroup: "经过策略组",
    /** 改写了参数的规则，按求值的顺序 */
    rewrittenBy: "参数改写",
    /** 选定上游之后才判断、拒绝了此请求的规则 */
    deniedBy: "拒绝规则",
    /** 规则写的拒绝理由，或者选中的上游为何都无法服务 */
    reason: "原因",
    attempts: "尝试链",
    failover: (failed: number) =>
      `已发生故障转移：前 ${failed} 个上游失败，已自动切换至下一个上游。`,
    failoverDenied: (failed: number, rule: string) =>
      `已发生故障转移：前 ${failed} 个上游失败，切换至下一个上游后，规则「${rule}」拒绝了此请求，未向该上游发送。`,
    deniedAfterPick: (rule: string) => `选定上游后，规则「${rule}」拒绝了此请求，未发往任何上游。`,
    deniedBeforePick: (rule: string) => `选定上游之前，规则「${rule}」已拒绝此请求，未发往任何上游。`,
    unavailable: "规则选中的上游均无法服务此请求，未发往任何上游。",
    noRouting: "此请求由网关本地应答，未经过路由。",
    routingPending: "路由尚未完成",
    noAttempts: "此请求没有上游尝试记录。",

    // 内容
    request: "请求",
    response: "响应",
    notSaved: "未保存",
    afterEnd: "请求结束后可查看",
    notSavedTip: "此记录已超过保留期限。",
    size: (n: number) => `${n.toLocaleString()} 字节`,
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
    willRedact: "发送前将按出站脱敏的规则替换凭据，回显内容将自动还原。",
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
    droppedTip: "The target format does not support these fields; they were removed before sending.",
    status: "Status",
    inProgress: "In progress",
    failed: "Failed",
    cancelledShort: "Canceled",
    cancelled: "Canceled: the client disconnected before the response finished",
    bytes: "Bytes",
    tokens: "Tokens",
    waiting: "Waiting for first byte",
    generating: "Generating",
    timingLabel: (ttfb: string, gen: string) => `Waiting for first byte ${ttfb}, generating ${gen}`,

    notSentSuffix: " (not sent)",

    route: "Route",
    matchedRule: "Matched rule",
    denied: "Denied",
    viaGroup: "Via group",
    rewrittenBy: "Rewritten by",
    deniedBy: "Denied by",
    reason: "Reason",
    attempts: "Attempts",
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
    noRouting: "The gateway answered this request locally; it did not go through routing.",
    routingPending: "Routing has not finished yet",
    noAttempts: "No upstream attempts were recorded for this request.",

    request: "Request",
    response: "Response",
    notSaved: "Not saved",
    afterEnd: "Available when the request ends",
    notSavedTip: "This record is past its retention period.",
    size: (n: number) => (n === 1 ? "1 byte" : `${n.toLocaleString()} bytes`),
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
    willRedact:
      "Credentials are replaced by the outbound redaction rules before sending; echoed content is restored automatically.",
    pricingDate: (date: string) => `Price sheet data as of ${date}.`,
    confirmSend: "Confirm and send",
    originalColumn: (upstream: string) => `${upstream} (original)`,
    replayColumn: (upstream: string) => `${upstream} (replay)`,
    duration: "Total time",
    replayPending: "Replay is available when the request ends",
  },
);
