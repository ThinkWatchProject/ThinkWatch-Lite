import type { ReactNode } from "react";
import { messages } from "@/i18n";
import { isMac, modKey } from "@/platform";

/** 英文的单复数：`count(3, "request", "requests")` 是 `3 requests` */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 流量页的文案：页头、过滤条、请求表、空状态、行菜单。会话那一侧（组头、会话详情）
 * 在 `Sessions.i18n.ts`。
 *
 * `.tsx`：有几句话中间嵌着地址（`<code>`）或会动的数字，而它们在中英文句子里的
 * 位置不同 —— 片段由组件画好传进来，放在哪儿由句子自己决定。
 */
export const trafficText = messages(
  {
    // 页头的摘要
    idle: "当前空闲",
    inFlight: "个进行中",
    /** 列表装满了（最近两千条），前面加一个「最近」：总数不是全部 */
    latest: "最近",
    requestsUnit: (_n: number) => "条请求",
    failedUnit: (_n: number) => "条失败",
    recent: (n: ReactNode) => <>近 30 分钟 {n} 条</>,
    /** 近 30 分钟那条小图，读屏念的那一句 */
    sparkLabel: (n: number, failed: number) =>
      `近 30 分钟 ${n} 条请求${failed > 0 ? `，其中 ${failed} 条失败` : ""}`,
    /** 小图里一分钟那一格的悬停说明。`at` 是那一分钟 */
    sparkBar: (at: string, n: number, failed: number) =>
      n === 0 ? `${at} · 无请求` : `${at} · ${n} 条${failed > 0 ? `，${failed} 条失败` : ""}`,

    // 页头右边的视图：逐条看请求，还是按会话看
    viewLabel: "视图",
    viewRequests: "请求",
    viewSessions: "会话",

    // 过滤条
    // Windows 上键名是「Ctrl+F」，比「⌘F」长；那边字号又大 1px，中文带着「…」
    // 会超出输入框 7px（量过：241 对 234）。去掉省略号就放得下
    search: isMac ? "搜索路径、密钥、上游、错误…  ⌘F" : `搜索路径、密钥、上游、错误  ${modKey}+F`,
    failedOnly: "仅显示失败",
    unpricedOnly: "仅显示无法计价",
    allClients: "全部密钥",
    allUpstreams: "全部上游",
    allModels: "全部模型",
    shownOf: (shown: number, total: number) => `${shown} / ${total} 条`,
    clear: "清空",

    // 还没有上游
    noUpstreams: "尚未配置上游",
    listening: (addr: ReactNode) => <>网关正在 {addr} 监听。配置上游后，请求才能转发。</>,
    goToUpstreams: "前往上游",

    // 空状态
    noMatchTitle: "没有符合条件的请求",
    noMatch: (n: number) => `共 ${n} 条记录，当前筛选条件下没有匹配项。`,
    clearFilters: "清除筛选条件",
    emptyTitle: "暂无请求记录",
    pointClients: (endpoint: ReactNode) => <>将客户端的端点设为 {endpoint}，并使用以 tw- 开头的客户端密钥。</>,
    appearHere: "收到请求后，请求记录将显示在此处。",
    /** 空状态上的按钮：复制网关地址、去客户端页接管 */
    copyAddress: "复制地址",
    goToClients: "前往客户端",
    addressCopied: "网关地址已复制",
    probesAnswered: (n: number) => `已本地应答 ${n} 次客户端探测。客户端已连接网关，这些探测未产生费用。`,
    probesElsewhere: (n: number) => `另有 ${n} 次客户端探测由网关本地应答，未发送到上游。`,

    // 读历史失败
    historyFailed: "请求记录读取失败",
    /** 读历史失败了，但之后事件流上来了几条：表照常画，上面挂这一句 */
    historyPartial: "请求记录读取失败，以下仅为此后收到的请求。",

    // 表头
    status: "状态",
    time: "时间",
    /** 请求带的是哪把网关密钥。**不是哪个应用** —— 应用是按请求头推测的，在悬停里 */
    client: "密钥",
    model: "模型",
    upstream: "上游",
    latency: "延迟",
    tokens: "token",
    cost: "费用",

    // 密钥那一格的悬停说明：密钥、推测的应用、来源，一项一行
    keyTip: (key: string) => `密钥 ${key}`,
    appTip: (app: string) => `应用 ${app}（按请求头推测）`,
    fromPeer: (ip: string) => `来自 ${ip}`,

    // token 那一格的悬停说明。「输入」和请求详情里一样，指新输入（不含缓存）
    promptTip: (n: string) => `输入合计 ${n}`,
    promptParts: (input: string, read: string, write: string) =>
      `新输入 ${input} · 缓存读取 ${read} · 缓存写入 ${write}`,
    outputTip: (n: string) => `输出 ${n}`,

    // 行菜单（右键和行尾的「…」是同一份）
    rowActions: (id: number) => `第 ${id} 号请求的操作`,
    openDetails: "打开详情",
    onlyUpstream: (name: string) => `仅显示上游 ${name}`,
    onlyClient: (name: string) => `仅显示密钥 ${name}`,
    copyId: "复制请求 ID",
    copyRow: "复制此行",

    // 状态一列
    failed: "失败",
    cancelled: "已取消",

    // 上游一列的徽标和它们的悬浮说明
    redactedTip: (items: string[]) => `发送前已替换：${items.join("、")}\n模型回显的内容将自动还原。`,
    redacted: (n: number) => `已脱敏 ${n}`,
    secretsTip: (items: string[]) => `请求中含有凭据，已原样发出：${items.join("、")}`,
    withSecrets: (n: number) => `含凭据 ${n}`,
    sentConverted: (formats: string) => `请求已转换格式后发送：${formats}。`,
    droppedFields: (fields: string[]) => `\n\n目标格式不支持、已丢弃的字段：${fields.join("、")}`,
    noneDropped: "\n未丢弃任何字段。",
    converted: "已转换",
    /** 转换时丢了字段：只说丢了几个，转换本身不用再说一遍（只有转换才会丢），细节在悬停 */
    convertedDropped: (n: number) => `丢弃 ${n} 个字段`,
    flaggedTip: (tool: string, rule: string, excerpt: string) => `${tool} · ${rule}\n${excerpt}`,
    blocked: "已拦截",
    suspicious: "可疑调用",

    // 估算的费用为什么是估算
    estimatedCancelled: "客户端在响应结束前断开，输出用量计至断开时，实际费用可能更高。",
    estimatedFailed: "响应在结束前中断，输出用量计至中断时，实际费用可能更高。",
    estimatedBorrowed: "价目表中没有此上游的单价，该金额按同一模型在其他平台的单价估算。",
  },
  {
    idle: "Idle",
    inFlight: "in progress",
    latest: "Latest",
    requestsUnit: (n: number) => (n === 1 ? "request" : "requests"),
    failedUnit: (_n: number) => "failed",
    recent: (n: ReactNode) => <>{n} in the last 30 min</>,
    sparkLabel: (n: number, failed: number) =>
      `${count(n, "request", "requests")} in the last 30 minutes${failed > 0 ? `, ${failed} failed` : ""}`,
    sparkBar: (at: string, n: number, failed: number) =>
      n === 0 ? `${at} · No requests` : `${at} · ${count(n, "request", "requests")}${failed > 0 ? `, ${failed} failed` : ""}`,

    viewLabel: "View",
    viewRequests: "Requests",
    viewSessions: "Sessions",

    // 输入框 256px 宽，放得下的文字约 234px；带上「Search」就放不下 ⌘F 了
    search: `Path, key, upstream, error…  ${modKey}${isMac ? "" : "+"}F`,
    failedOnly: "Failed only",
    unpricedOnly: "Unpriced only",
    allClients: "All keys",
    allUpstreams: "All upstreams",
    allModels: "All models",
    shownOf: (shown: number, total: number) => `${shown} / ${count(total, "request", "requests")}`,
    clear: "Clear",

    noUpstreams: "No upstreams configured yet",
    listening: (addr: ReactNode) => (
      <>The gateway is listening on {addr}. Requests can be forwarded once an upstream is configured.</>
    ),
    goToUpstreams: "Go to Upstreams",

    noMatchTitle: "No matching requests",
    noMatch: (n: number) =>
      n === 1
        ? "1 request recorded; it does not match the current filters."
        : `${n} requests recorded; none match the current filters.`,
    clearFilters: "Clear filters",
    emptyTitle: "No requests yet",
    pointClients: (endpoint: ReactNode) => (
      <>Set the client's endpoint to {endpoint} and use a client key that starts with tw-.</>
    ),
    appearHere: "Requests appear here once they are received.",
    copyAddress: "Copy address",
    goToClients: "Go to Clients",
    addressCopied: "Gateway address copied",
    probesAnswered: (n: number) =>
      n === 1
        ? "1 client probe was answered locally. A client is already connected to the gateway; the probe incurred no cost."
        : `${n} client probes were answered locally. A client is already connected to the gateway; these probes incurred no cost.`,
    probesElsewhere: (n: number) =>
      n === 1
        ? "In addition, 1 client probe was answered locally by the gateway and not sent to an upstream."
        : `In addition, ${n} client probes were answered locally by the gateway and not sent to an upstream.`,

    historyFailed: "Could not load the request log",
    historyPartial: "The request log could not be loaded. Only requests received since then are shown below.",

    status: "Status",
    time: "Time",
    client: "Key",
    model: "Model",
    upstream: "Upstream",
    latency: "Latency",
    tokens: "Tokens",
    cost: "Cost",

    keyTip: (key: string) => `Key ${key}`,
    appTip: (app: string) => `App ${app} (guessed from the request headers)`,
    fromPeer: (ip: string) => `from ${ip}`,

    promptTip: (n: string) => `Input total ${n}`,
    promptParts: (input: string, read: string, write: string) =>
      `Uncached input ${input} · Cache reads ${read} · Cache writes ${write}`,
    outputTip: (n: string) => `Output ${n}`,

    rowActions: (id: number) => `Actions for request #${id}`,
    openDetails: "Open details",
    onlyUpstream: (name: string) => `Show only upstream ${name}`,
    onlyClient: (name: string) => `Show only key ${name}`,
    copyId: "Copy request ID",
    copyRow: "Copy row",

    failed: "Failed",
    cancelled: "Canceled",

    redactedTip: (items: string[]) =>
      `Replaced before sending: ${items.join(", ")}\nContent echoed by the model is restored automatically.`,
    redacted: (n: number) => `Redacted ${n}`,
    secretsTip: (items: string[]) => `Sent as is, with credentials in it: ${items.join(", ")}`,
    withSecrets: (n: number) => `Credentials ${n}`,
    sentConverted: (formats: string) => `Sent after format conversion: ${formats}.`,
    droppedFields: (fields: string[]) =>
      `\n\nFields dropped because the target format does not support them: ${fields.join(", ")}`,
    noneDropped: "\nNo fields were dropped.",
    converted: "Converted",
    convertedDropped: (n: number) => (n === 1 ? "1 field dropped" : `${n} fields dropped`),
    flaggedTip: (tool: string, rule: string, excerpt: string) => `${tool} · ${rule}\n${excerpt}`,
    blocked: "Blocked",
    suspicious: "Suspicious call",

    estimatedCancelled:
      "The client disconnected before the response finished. Output usage is counted up to the disconnect, so the actual cost may be higher.",
    estimatedFailed:
      "The response was interrupted before it finished. Output usage is counted up to the interruption, so the actual cost may be higher.",
    estimatedBorrowed:
      "The price sheet has no price for this upstream; the amount is estimated from the same model's price on another platform.",
  },
);
