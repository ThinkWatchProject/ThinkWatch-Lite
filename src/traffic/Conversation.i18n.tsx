import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 英文的单复数 */
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

/**
 * 会话「对话」那一页的文案。
 *
 * `.tsx`：「Read 的结果」里工具名是加粗的片段，它在中英文句子里的位置不同，由句子
 * 自己决定放在哪儿。
 *
 * 正文不在的那几句分两种（`missingWhy`）：早于保留期限的说「已超过保留期限」，期限之内的说
 * 「未保留」，不说原因。请求详情「未保存」的悬停说明照同一个判断说同样的话。客户端先断开的那一句
 * 和「时间线」状态那一行是同一句。失败的那一轮写 core 给的原因（`failureLine`）。
 */
export const conversationText = messages(
  {
    loadFailed: "对话读取失败",
    /** 会话的轮次一轮都还没落库 */
    emptyTitle: "尚无已记录的轮次",
    emptyHint: "每轮结束后显示在此处",
    /** 每一轮的正文都不在：都已超过保留期限 */
    allExpiredTitle: "对话内容已超过保留期限",
    /** 每一轮的正文都不在，至少有一轮在保留期限之内 */
    allUnkeptTitle: "对话正文未保留",
    allLostHint: "费用与用量仍可在概况中查看",
    showSummary: "查看概况",

    // 左边那一列：这一块是谁说的
    user: "用户",
    assistant: "助手",
    tool: "工具",
    system: "系统",

    turnNo: (n: number) => `第 ${n} 轮`,
    /** 轮次头上的按钮：在这一层之上打开那一条请求 */
    openRequest: "请求详情",
    /** 还在跑的那一轮，下面那一句 */
    afterEnd: "请求结束后可查看",

    systemPrompt: "系统提示",
    systemChanged: "系统提示已更改",
    thinking: "思考",
    /** 响应里只有思考的签名，没有正文 */
    thinkingHidden: "上游未返回思考内容",
    /** 找不到是哪个工具调用的结果 */
    result: "工具结果",
    resultOf: (name: ReactNode) => <>{name} 的结果</>,
    error: "错误",
    noOutput: "无输出",
    image: "图片",
    chars: (n: number) => `${n.toLocaleString()} 字符`,
    showAll: "展开全部",
    collapse: "折叠",
    /** 收起的那一行后面的点：里面有安全命中（读屏用） */
    hasHit: "含安全命中",

    /** 历史重新开始的那一轮上面的分隔线 */
    restart: "对话历史从此处重新开始",
    /** 那一轮带着的、此前已显示过的历史，收起 */
    earlier: (n: number) => `此前的对话 · ${n} 条消息`,

    // 显示不出来的部分。正文不在的，早于保留期限的是 `expired*`，期限之内的是 `unkept*`
    expired: "此轮内容已超过保留期限",
    unkept: "此轮正文未保留",
    expiredRun: (from: number, to: number) => `第 ${from}–${to} 轮的内容已超过保留期限`,
    unkeptRun: (from: number, to: number) => `第 ${from}–${to} 轮的正文未保留`,
    requestExpired: "请求内容已超过保留期限",
    requestUnkept: "请求正文未保留",
    requestTruncated: "请求过大，未完整保存",
    responseExpired: "响应内容已超过保留期限",
    responseUnkept: "响应正文未保留",
    /**
     * 失败的那一轮，原因里没说到的上游状态码写在前面（`failureLine`）。`reason` 是 core 说的
     * 失败原因，一整句；说到了的（上游回了错误、原样交给客户端的）只写原因
     */
    failedWithStatus: (status: number, reason: string) => `上游返回 ${status}：${reason}`,
    responseCancelled: "已取消：客户端在响应结束前断开连接",
    responseTruncated: "响应过大，未完整保存",
    responseUnreadable: "响应格式无法识别，原文见请求详情",
    /** 不生成回答的调用（数 token、压缩上下文）：轮次头上那一句 */
    noContent: "无对话内容",

    // 上下文那一行：这一轮送进模型的 token 占模型上下文窗口的几成，点开是由什么组成
    context: "上下文",
    /** 条后面的说明：送进去的里面缓存读取占几成 */
    cached: (pct: number) => `缓存 ${pct}%`,
    /** 读屏念的那根条 */
    contextBar: (used: string, window: string, cachedPct: number) =>
      `上下文 ${used} / ${window}，缓存读取占 ${cachedPct}%`,
    contextLoadFailed: "上下文读取失败",
    partSystem: "系统提示",
    partTools: "工具定义",
    partHistory: "此前的对话",
    partLastUser: "最后一条用户消息",
    partTotal: "合计",
    /** 各部分的数是估算的，数前带「~」；这一句是「~」的说明 */
    estimated: "估算值",
    estimatedTip: "各部分按保存的请求正文估算，与上游计量的输入不同。",
  },
  {
    loadFailed: "Could not load the conversation",
    emptyTitle: "No turns recorded yet",
    emptyHint: "Each turn appears here when it ends",
    allExpiredTitle: "The conversation is past the retention period",
    allUnkeptTitle: "The conversation's content was not kept",
    allLostHint: "Cost and usage are still in the summary",
    showSummary: "Show summary",

    user: "User",
    assistant: "Assistant",
    tool: "Tool",
    system: "System",

    turnNo: (n: number) => `Turn ${n}`,
    openRequest: "Request details",
    afterEnd: "Available when the request ends",

    systemPrompt: "System prompt",
    systemChanged: "System prompt changed",
    thinking: "Thinking",
    thinkingHidden: "The upstream returned no thinking content",
    result: "Tool result",
    resultOf: (name: ReactNode) => <>{name} result</>,
    error: "Error",
    noOutput: "No output",
    image: "Image",
    chars: (n: number) => count(n, "character", "characters"),
    showAll: "Show all",
    collapse: "Collapse",
    hasHit: "Contains a security hit",

    restart: "The conversation history starts over here",
    earlier: (n: number) => `Earlier conversation · ${count(n, "message", "messages")}`,

    expired: "This turn is past the retention period",
    unkept: "This turn's content was not kept",
    expiredRun: (from: number, to: number) => `Turns ${from}–${to} are past the retention period`,
    unkeptRun: (from: number, to: number) => `The content of turns ${from}–${to} was not kept`,
    requestExpired: "The request is past the retention period",
    requestUnkept: "The request body was not kept",
    requestTruncated: "The request was too large to save in full",
    responseExpired: "The response is past the retention period",
    responseUnkept: "The response body was not kept",
    failedWithStatus: (status: number, reason: string) => `The upstream answered ${status}: ${reason}`,
    responseCancelled: "Canceled: the client disconnected before the response finished",
    responseTruncated: "The response was too large to save in full",
    responseUnreadable: "The response format is not recognized; the raw body is in the request details",
    noContent: "No conversation content",

    context: "Context",
    cached: (pct: number) => `${pct}% cached`,
    contextBar: (used: string, window: string, cachedPct: number) =>
      `Context ${used} of ${window}, ${cachedPct}% from cache reads`,
    contextLoadFailed: "Could not load the context breakdown",
    partSystem: "System prompt",
    partTools: "Tool definitions",
    partHistory: "Earlier conversation",
    partLastUser: "Last user message",
    partTotal: "Total",
    estimated: "Estimated",
    estimatedTip: "Each part is estimated from the stored request body; it differs from the input the upstream measured.",
  },
);
