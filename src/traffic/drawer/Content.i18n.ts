import { messages } from "@/i18n";

/** 英文的单复数 */
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

/**
 * 请求详情「内容」那一页的文案：解析、原始报文两种看法，客户端、上游两边，在跑时实时追加。
 * 角色、系统提示、思考这些和会话的「对话」同一套说法（`Conversation.i18n`）。
 */
export const contentText = messages(
  {
    /** 看法：按对话读出来，或者报文原样 */
    views: { parsed: "解析", raw: "原始报文" },
    viewsLabel: "内容的显示方式",
    /** 原始报文看哪一边：客户端收发的，或者网关和上游之间的 */
    sides: { client: "客户端一侧", upstream: "上游一侧" },
    sidesLabel: "报文的一侧",
    /** 上游一侧试过不止一跳时，看哪一跳 */
    attemptsLabel: "尝试",
    follow: "跟随最新",
    /** 请求还在跑，内容在实时追加 */
    live: "实时",

    request: "请求",
    response: "回答",
    /** 回答正在一段一段到 */
    receiving: "接收中",
    /** 还没有上游的回答 */
    waiting: "等待上游响应",
    messages: (n: number) => `${n.toLocaleString()} 条消息`,
    tools: (n: number) => `${n.toLocaleString()} 个工具`,
    /** 解析里声明的工具那一行，左边那一列 */
    toolsLabel: "工具",
    outputTokens: (n: number) => `${n.toLocaleString()} token`,
    events: (n: number) => `${n.toLocaleString()} 个事件`,
    /** 原始报文里收起的前面那些事件，点开显示 */
    earlierEvents: (n: number) => `前 ${n.toLocaleString()} 个事件`,
    showEarlierEvents: "显示全部事件",

    // 解析不出来的时候
    unknownFormat: "无法识别此请求的格式，原文见「原始报文」",
    requestCut: "请求过大，仅保存了开头部分，无法解析，原文见「原始报文」",
    requestUnreadable: "请求正文无法解析，原文见「原始报文」",
    responseUnreadable: "回答的格式无法识别，原文见「原始报文」",
    /** 认得出格式，但里面没有文字、思考或工具调用 */
    noAnswer: "回答中没有可显示的内容",

    // 上游一侧的正文没有另存的几种
    sameAsClient: "正文与客户端一侧相同",
    afterPluginsLater: "正文为插件改写后的版本，请求结束后可查看",
    attemptNotKept: "失败的尝试不保留正文",
    /** 这一段还没有报文头 */
    noHead: "尚未发出",
    /** 在跑的请求订阅不上实时内容（不是因为它已经结束）：后面跟着原因 */
    liveFailed: (why: string) => `无法显示实时内容：${why}`,
  },
  {
    views: { parsed: "Parsed", raw: "Raw" },
    viewsLabel: "How the content is shown",
    sides: { client: "Client side", upstream: "Upstream side" },
    sidesLabel: "Side of the exchange",
    attemptsLabel: "Attempt",
    follow: "Follow latest",
    live: "Live",

    request: "Request",
    response: "Response",
    receiving: "Receiving",
    waiting: "Waiting for the upstream",
    messages: (n: number) => count(n, "message", "messages"),
    tools: (n: number) => count(n, "tool", "tools"),
    toolsLabel: "Tools",
    outputTokens: (n: number) => count(n, "token", "tokens"),
    events: (n: number) => count(n, "event", "events"),
    earlierEvents: (n: number) => (n === 1 ? "1 earlier event" : `${n.toLocaleString()} earlier events`),
    showEarlierEvents: "Show all events",

    unknownFormat: "The format of this request is not recognized; see Raw for the original",
    requestCut: "The request was too large to save in full and cannot be parsed; see Raw for the beginning",
    requestUnreadable: "The request body cannot be parsed; see Raw for the original",
    responseUnreadable: "The response format is not recognized; see Raw for the original",
    noAnswer: "The response has nothing to show",

    sameAsClient: "The body is the same as on the client side",
    afterPluginsLater: "The body is the version rewritten by plugins; it can be viewed when the request ends",
    attemptNotKept: "Bodies of failed attempts are not kept",
    noHead: "Not sent yet",
    liveFailed: (why: string) => `Live content is unavailable: ${why}`,
  },
);
