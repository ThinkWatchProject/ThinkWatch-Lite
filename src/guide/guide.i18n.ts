import { messages } from "@/i18n";

/**
 * 引导的文案：概览上的「开始使用」三步，和各页的下一步提示。
 *
 * **只说下一步做什么，不讲道理**：用户要的是往前走一步的那个按钮，不是网关怎么工作。
 */
export const guideText = messages(
  {
    /** 关掉一条提示，以后也不再出现 */
    hide: "不再显示",

    // 概览：开始使用
    setupTitle: "开始使用",
    /** 三步做完了几步 */
    setupProgress: (done: number, total: number) => `${done}/${total}`,
    stepUpstream: "添加上游",
    stepUpstreamTodo: "API 密钥、中转服务、本机模型，或 ChatGPT、Z.ai 账号。",
    stepUpstreamDone: (n: number) => `已添加 ${n} 个上游`,
    newUpstream: "新建上游…",
    stepClient: "接管客户端",
    /** 检测到了、还没接的那几个，用顿号连起来 */
    stepClientFound: (names: string) => `检测到 ${names}。接管前会先列出要改动的配置。`,
    stepClientNone: "未检测到可自动接管的客户端，可按说明手动配置。",
    stepClientDone: (names: string) => `已接管 ${names}`,
    /** 只配了手动的（Cursor 之类），没有接管的 */
    stepClientManual: "已按说明手动配置",
    goClients: "前往客户端",
    stepRequest: "发出第一条请求",
    stepRequestTodo: "在已接管的客户端中发一条消息。",
    waiting: "等待请求",
    /** 客户端的探测由网关直接答了：说明它连上了 */
    probes: (n: number) => `已直接应答 ${n} 次客户端探测，客户端已连接网关。`,
    /** 名字之间的分隔 */
    listSep: "、",

    // 上游页
    nextClientsTitle: "下一步：接管客户端",
    nextClientsBody: "接管后，客户端的请求经网关发往上游。",

    // 客户端页
    nextUpstreamTitle: "尚未添加上游",
    nextUpstreamBody: "接管的客户端发出的请求，需要有上游才能送达。",
    nextRequestTitle: "下一步：发出第一条请求",
    nextRequestBody: (names: string) => `在 ${names} 中发一条消息，流量页即会显示这条请求。`,
    goTraffic: "前往流量",

    // 概览：第一条请求
    firstRequestTitle: "第一条请求已经过网关",
    firstRequestBody: "它的路由、尝试过的上游、用量与费用已记录在流量页。",
    viewRequest: "查看这条请求",

    // 流量页
    openRowTitle: "点开一条请求查看详情",
    openRowBody: "命中的路由规则、尝试过的上游、用量与费用，以及被替换的敏感值，都在详情中。",

    // 安全页
    /** 此刻停在「观察」的有几项 */
    observeTitle: (n: number) => `${n} 项防护处于「观察」`,
    observeBody: "命中时只记录，不拦截。在日志中确认没有误报后，可将其改为「拦截」。",

    // 设置
    hintsLabel: "引导提示",
    hintsHint: "设为「不再显示」的提示将重新出现。",
    hintsReset: "重新显示",
    hintsResetDone: "引导提示将重新显示",
  },
  {
    hide: "Don’t show again",

    setupTitle: "Get started",
    setupProgress: (done: number, total: number) => `${done}/${total}`,
    stepUpstream: "Add an upstream",
    stepUpstreamTodo: "An API key, a relay service, a local model, or a ChatGPT or Z.ai account.",
    stepUpstreamDone: (n: number) => (n === 1 ? "1 upstream added" : `${n} upstreams added`),
    newUpstream: "New upstream…",
    stepClient: "Connect a client",
    stepClientFound: (names: string) => `Found ${names}. The configuration changes are listed before anything is written.`,
    stepClientNone: "No client that can be connected automatically was found; manual setup instructions are available.",
    stepClientDone: (names: string) => `Connected: ${names}`,
    stepClientManual: "Set up manually",
    goClients: "Go to Clients",
    stepRequest: "Send a first request",
    stepRequestTodo: "Send a message from a connected client.",
    waiting: "Waiting for a request",
    probes: (n: number) =>
      n === 1
        ? "1 client probe was answered directly; a client is connected to the gateway."
        : `${n} client probes were answered directly; a client is connected to the gateway.`,
    listSep: ", ",

    nextClientsTitle: "Next: connect a client",
    nextClientsBody: "Once connected, a client's requests go through the gateway to the upstreams.",

    nextUpstreamTitle: "No upstream yet",
    nextUpstreamBody: "Requests from connected clients need an upstream to reach a model.",
    nextRequestTitle: "Next: send a first request",
    nextRequestBody: (names: string) => `Send a message from ${names}; the request then appears on the Traffic page.`,
    goTraffic: "Go to Traffic",

    firstRequestTitle: "The first request went through the gateway",
    firstRequestBody: "Its route, the upstreams it tried, its usage and cost are recorded on the Traffic page.",
    viewRequest: "View request",

    openRowTitle: "Open a request for its details",
    openRowBody: "The routing rule it matched, the upstreams it tried, its usage and cost, and any redacted values.",

    observeTitle: (n: number) => (n === 1 ? "1 protection is set to Observe" : `${n} protections are set to Observe`),
    observeBody: "Matches are recorded, not blocked. Once the log shows no false positives, a protection can be set to Enforce.",

    hintsLabel: "Guidance",
    hintsHint: "Hints set to “Don’t show again” reappear.",
    hintsReset: "Show again",
    hintsResetDone: "Hints will show again",
  },
);
