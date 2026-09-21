import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句子中间要加重的那几个字。怎么画由组件决定，这里只管是哪几个字、在句子的哪儿 */
type Em = (text: string) => ReactNode;

/** 英文的单复数：`count(3, "request", "requests")` 是 `3 requests` */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 主窗口外壳的文案：源列表、工具栏、状态带、流量表、退出确认。
 *
 * `.tsx`：有几句话中间嵌着地址（`<code>`）、上游名或加粗的片段，而它们在
 * 中英文句子里的位置不同 —— 片段由组件画好传进来，放在哪儿由句子自己决定。
 */
export const appText = messages(
  {
    /** 源列表的各项，也是工具栏上「当前在哪一页」 */
    surfaces: {
      dashboard: "概览",
      requests: "流量",
      sessions: "会话",
      security: "发现",
      guard: "防护",
      upstreams: "上游",
      routing: "路由",
      access: "接入",
      clients: "客户端",
      settings: "设置",
    },
    newFindings: (label: string, n: number) => `${label} · ${n} 项新发现`,

    // core 的状态。`…Short` 给收起的源列表用，那里只有 80px
    running: "运行中",
    starting: "启动中",
    restarting: (attempt: string) => `重启中（第 ${attempt} 次）`,
    restartingShort: "重启中",
    safeMode: "安全模式 · 网关未运行",
    safeModeShort: "安全模式",
    stopped: "已停止",

    // 工具栏
    collapseRail: "收起源列表",
    expandRail: "展开源列表",
    configFile: "配置文件",
    versionHistory: "版本历史",

    // 配置没通过校验。`rejectedAt` 后面直接接 core 给的那句错误
    rejectedTitle: "配置校验未通过，仍在使用上一版本",
    rejectedAt: (stage: string, line: number | null) =>
      `${stage}错误${line != null ? `（第 ${line} 行）` : ""}：`,

    // token 端点换发了新凭据
    rotatedSaved: (provider: ReactNode) => <>{provider} 的 token 端点已换发新凭据，并已写回 config.yaml。</>,
    reloadTip: "如果编辑器中打开了 config.yaml，编辑器可能提示「文件已在磁盘上更改」，需重新加载。",
    reload: "编辑器需重新加载",
    rotatedUnsaved: (provider: string) => `${provider} 已换发新凭据，但未能写回 config.yaml。当前转发正常。`,
    oldRevoked: (em: Em) => <>原凭据已在服务端失效。{em("重启前如未处理，该上游的请求将持续返回 401")}。</>,

    // 断线重连
    staleData: (what: string) => `${what} · 以下数据截至连接断开时`,
    restart: "重新启动",
    loadingConfig: "读取配置中…",

    // 过滤条
    search: "搜索路径、客户端、上游、错误…  ⌘F",
    failedOnly: "仅显示失败",
    allClients: "全部客户端",
    allUpstreams: "全部上游",
    shownOf: (shown: number, total: number) => `${shown} / ${total} 条`,
    total: (n: number) => `${n} 条`,
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
    probesAnswered: (n: number) => `已本地应答 ${n} 次客户端探测。客户端已连接网关，这些探测未产生费用。`,
    probesElsewhere: (n: number) => `另有 ${n} 次客户端探测由网关本地应答，未发送到上游。`,

    // 表头
    status: "状态",
    time: "时间",
    client: "客户端",
    model: "模型",
    upstream: "上游",
    latency: "延迟",
    tokens: "token",
    cost: "费用",

    // 行的右键菜单
    openDetails: "打开详情",
    onlyUpstream: (name: string) => `仅显示上游 ${name}`,
    onlyClient: (name: string) => `仅显示客户端 ${name}`,
    copyId: "复制请求 ID",
    copyRow: "复制此行",

    // 状态一列
    failed: "失败",
    cancelled: "已取消",

    // 上游一列的徽标和它们的悬浮说明
    redactedTip: (items: string[]) => `发送前已替换：${items.join("、")}\n模型回显的内容将自动还原。`,
    redacted: (n: number) => `已脱敏 ${n}`,
    sentConverted: (formats: string) => `请求已转换格式后发送：${formats}。`,
    droppedFields: (fields: string[]) => `\n\n目标格式不支持、已丢弃的字段：${fields.join("、")}`,
    noneDropped: "\n未丢弃任何字段。",
    converted: "已转换",
    convertedDropped: (n: number) => `已转换 · 丢弃 ${n} 项`,
    flaggedTip: (tool: string, why: string, excerpt: string) => `${tool}：${why}\n${excerpt}`,
    blocked: "已拦截",
    suspicious: "可疑调用",

    // 估算的费用为什么是估算
    estimatedCancelled: "客户端在响应结束前断开，输出用量计至断开时，实际费用可能更高。",
    estimatedFailed: "响应在结束前中断，输出用量计至中断时，实际费用可能更高。",
    estimatedBorrowed: "价目表中没有此上游的单价，该金额按同一模型在其他平台的单价估算。",

    // 退出确认
    quitTitle: "退出 ThinkWatch Lite",
    quitDescription: "退出后网关将停止监听，所有已接管的客户端将立即无法连接。",
    quitHint: "仅关闭窗口请按 ⌘W，进程将保留在菜单栏。",
    quit: "退出",
  },
  {
    surfaces: {
      dashboard: "Overview",
      requests: "Traffic",
      sessions: "Sessions",
      security: "Findings",
      guard: "Protection",
      upstreams: "Upstreams",
      routing: "Routing",
      access: "Access",
      clients: "Clients",
      settings: "Settings",
    },
    newFindings: (label: string, n: number) => `${label} · ${count(n, "new finding", "new findings")}`,

    // 展开的源列表里这一行约 167px，收起时约 51px：「Gateway stopped」比
    // 「Gateway not running」短一截才放得下；「Safe mode」中间是不换行空格，
    // 收起时不会折成两行
    running: "Running",
    starting: "Starting",
    restarting: (attempt: string) => `Restarting (attempt ${attempt})`,
    restartingShort: "Restarting",
    safeMode: "Safe mode · Gateway stopped",
    safeModeShort: "Safe\u00a0mode",
    stopped: "Stopped",

    collapseRail: "Collapse sidebar",
    expandRail: "Expand sidebar",
    configFile: "Config file",
    versionHistory: "Version history",

    rejectedTitle: "Config validation failed; the previous version is still in use",
    rejectedAt: (stage: string, line: number | null) => `${stage} error${line != null ? ` (line ${line})` : ""}: `,

    rotatedSaved: (provider: ReactNode) => (
      <>The token endpoint for {provider} issued new credentials; they have been written back to config.yaml.</>
    ),
    reloadTip:
      "If config.yaml is open in an editor, the editor may report “The file has been changed on disk” and needs to reload it.",
    reload: "Editor needs to reload",
    rotatedUnsaved: (provider: string) =>
      `${provider} issued new credentials, but they could not be written back to config.yaml. Forwarding currently works normally.`,
    oldRevoked: (em: Em) => (
      <>
        The previous credentials are no longer valid on the server.{" "}
        {em("Unless this is resolved before the next restart, requests to this upstream will keep returning 401")}.
      </>
    ),

    staleData: (what: string) => `${what} · Data below is as of the disconnect`,
    restart: "Restart",
    loadingConfig: "Loading config…",

    // 输入框 256px 宽，放得下的文字约 234px；带上「Search」就放不下 ⌘F 了
    search: "Path, client, upstream, error…  ⌘F",
    failedOnly: "Failed only",
    allClients: "All clients",
    allUpstreams: "All upstreams",
    shownOf: (shown: number, total: number) => `${shown} / ${count(total, "request", "requests")}`,
    total: (n: number) => count(n, "request", "requests"),
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
    probesAnswered: (n: number) =>
      n === 1
        ? "1 client probe was answered locally. A client is already connected to the gateway; the probe incurred no cost."
        : `${n} client probes were answered locally. A client is already connected to the gateway; these probes incurred no cost.`,
    probesElsewhere: (n: number) =>
      n === 1
        ? "In addition, 1 client probe was answered locally by the gateway and not sent to an upstream."
        : `In addition, ${n} client probes were answered locally by the gateway and not sent to an upstream.`,

    status: "Status",
    time: "Time",
    client: "Client",
    model: "Model",
    upstream: "Upstream",
    latency: "Latency",
    tokens: "Tokens",
    cost: "Cost",

    openDetails: "Open details",
    onlyUpstream: (name: string) => `Show only upstream ${name}`,
    onlyClient: (name: string) => `Show only client ${name}`,
    copyId: "Copy request ID",
    copyRow: "Copy row",

    failed: "Failed",
    cancelled: "Canceled",

    redactedTip: (items: string[]) =>
      `Replaced before sending: ${items.join(", ")}\nContent echoed by the model is restored automatically.`,
    redacted: (n: number) => `Redacted ${n}`,
    sentConverted: (formats: string) => `Sent after format conversion: ${formats}.`,
    droppedFields: (fields: string[]) =>
      `\n\nFields dropped because the target format does not support them: ${fields.join(", ")}`,
    noneDropped: "\nNo fields were dropped.",
    converted: "Converted",
    convertedDropped: (n: number) => `Converted · ${n} dropped`,
    flaggedTip: (tool: string, why: string, excerpt: string) => `${tool}: ${why}\n${excerpt}`,
    blocked: "Blocked",
    suspicious: "Suspicious call",

    estimatedCancelled:
      "The client disconnected before the response finished. Output usage is counted up to the disconnect, so the actual cost may be higher.",
    estimatedFailed:
      "The response was interrupted before it finished. Output usage is counted up to the interruption, so the actual cost may be higher.",
    estimatedBorrowed:
      "The price sheet has no price for this upstream; the amount is estimated from the same model's price on another platform.",

    quitTitle: "Quit ThinkWatch Lite",
    quitDescription:
      "After quitting, the gateway stops listening, and every connected client immediately loses its connection.",
    quitHint: "To close only the window, press ⌘W; the app keeps running in the menu bar.",
    quit: "Quit",
  },
);
