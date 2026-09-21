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
    client: "客户端",
    path: "路径",
    conversion: "格式转换",
    dropped: "丢弃字段",
    droppedTip: "目标格式不支持这些字段，发送前已移除。",
    status: "状态",
    cancelled: "已取消：客户端在响应结束前断开连接",
    bytes: "字节",

    // 路由
    matchedRule: "命中规则",
    viaGroup: "经过策略组",
    attempts: "尝试链",
    failover: (failed: number) =>
      `已发生故障转移：前 ${failed} 个上游失败，已自动切换至下一个上游。`,
    noRouting: "此请求没有路由信息",
    noRoutingTip: "此请求由网关本地应答，未发送到上游；或记录于路由信息功能上线之前。",
    possibleCauses: "可能原因",

    // 内容
    request: "请求",
    response: "响应",
    notSaved: "未保存",
    notSavedTip: "此记录已超过保留期限。",
    size: (n: number) => `${n.toLocaleString()} 字节`,
    truncated: "仅保存开头部分",
    collapse: "折叠",
    showAll: "展开全部",
    redactedNote: "请求与响应内容已脱敏，疑似密钥的内容已遮盖。",

    // 用量。**没有用量、没有价格、估算，各说各的**
    cancelledBeforeUsage: "客户端在上游报告用量前断开连接",
    failedBeforeUsage: "请求在上游报告用量前失败",
    noUsage: "上游未报告用量",
    noUsageTip:
      "部分上游的响应不含用量字段。缺少用量时，无法得知此次调用的消耗，也无法计算费用。",
    input: "输入",
    output: "输出",
    cacheReads: "缓存读取",
    cacheWrites: "缓存写入",
    cost: "费用",
    subscription: "订阅制，计入订阅额度",
    free: "不计费",
    billingUnknown: "计费方式未知",
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
    /** 下拉框里原来那个上游名后面的标记 */
    originalUpstream: "（原上游）",
    estimateCost: "预估费用",
    quote: (upstream: ReactNode, bytes: number, tokens: number) => (
      <>将向 {upstream} 发送 {bytes} 字节，约 {tokens} 个输入 token。</>
    ),
    willRedact: "发送前将按此上游的规则脱敏，回显内容将自动还原。",
    pricingDate: (date: string) => `价目表日期 ${date}。`,
    confirmSend: "确认发送",
    originalColumn: (upstream: string) => `${upstream}（原请求）`,
    replayColumn: (upstream: string) => `${upstream}（重放）`,
    duration: "耗时",
  },
  {
    title: "Request details",
    requestNo: (id: number) => `Request #${id}`,

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
    client: "Client",
    path: "Path",
    conversion: "Conversion",
    dropped: "Dropped",
    droppedTip: "The target format does not support these fields; they were removed before sending.",
    status: "Status",
    cancelled: "Canceled: the client disconnected before the response finished",
    bytes: "Bytes",

    matchedRule: "Matched rule",
    viaGroup: "Via group",
    attempts: "Attempts",
    failover: (failed: number) =>
      failed === 1
        ? "Failover occurred: the first upstream failed, and the request was switched to the next upstream automatically."
        : `Failover occurred: the first ${failed} upstreams failed, and the request was switched to the next upstream automatically.`,
    noRouting: "No routing information for this request",
    noRoutingTip:
      "This request was answered locally by the gateway and not sent to an upstream, or it was recorded before routing information was introduced.",
    possibleCauses: "Possible causes",

    request: "Request",
    response: "Response",
    notSaved: "Not saved",
    notSavedTip: "This record is past its retention period.",
    size: (n: number) => (n === 1 ? "1 byte" : `${n.toLocaleString()} bytes`),
    truncated: "only the beginning was saved",
    collapse: "Collapse",
    showAll: "Show all",
    redactedNote: "Request and response content is redacted; anything resembling a key is masked.",

    cancelledBeforeUsage: "The client disconnected before the upstream reported usage",
    failedBeforeUsage: "The request failed before the upstream reported usage",
    noUsage: "The upstream did not report usage",
    noUsageTip:
      "Some upstreams' responses do not include usage fields. Without usage, the consumption of this call is unknown and its cost cannot be calculated.",
    input: "Input",
    output: "Output",
    cacheReads: "Cache reads",
    cacheWrites: "Cache writes",
    cost: "Cost",
    subscription: "Subscription; counts toward the subscription quota",
    free: "Free",
    billingUnknown: "Billing unknown",
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
    originalUpstream: " (original)",
    estimateCost: "Estimate cost",
    quote: (upstream: ReactNode, bytes: number, tokens: number) => (
      <>
        {count(bytes, "byte", "bytes")} will be sent to {upstream}, about{" "}
        {count(tokens, "input token", "input tokens")}.
      </>
    ),
    willRedact:
      "Content is redacted by this upstream's rules before sending; echoed content is restored automatically.",
    pricingDate: (date: string) => `Price sheet data as of ${date}.`,
    confirmSend: "Confirm and send",
    originalColumn: (upstream: string) => `${upstream} (original)`,
    replayColumn: (upstream: string) => `${upstream} (replay)`,
    duration: "Total time",
  },
);
