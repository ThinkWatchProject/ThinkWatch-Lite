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
 * 缺口那几句和请求详情的说法一致：内容没有了说「已超过保留期限」（请求详情「未保存」
 * 的悬停说明），客户端先断开的那一句和「时间线」状态那一行是同一句。
 */
export const conversationText = messages(
  {
    loadFailed: "对话读取失败",
    /** 会话的轮次一轮都还没落库 */
    emptyTitle: "尚无已记录的轮次",
    emptyHint: "每轮结束后显示在此处",
    /** 每一轮的内容都已超过保留期限 */
    allLostTitle: "对话内容已超过保留期限",
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

    /** 历史重新开始的那一轮上面的分隔线 */
    restart: "对话历史从此处重新开始",
    /** 那一轮带着的、此前已显示过的历史，收起 */
    earlier: (n: number) => `此前的对话 · ${n} 条消息`,

    // 显示不出来的部分
    lost: "此轮内容已超过保留期限",
    lostRun: (from: number, to: number) => `第 ${from}–${to} 轮的内容已超过保留期限`,
    requestMissing: "请求内容已超过保留期限",
    requestTruncated: "请求过大，未完整保存",
    responseMissing: "响应内容已超过保留期限",
    /** `reason` 是 core 说的失败原因，一整句 */
    responseFailed: (reason: string) => `请求失败：${reason}`,
    responseCancelled: "已取消：客户端在响应结束前断开连接",
    responseTruncated: "响应过大，未完整保存",
    responseUnreadable: "响应格式无法识别，原文见请求详情",
    /** 不生成回答的调用（数 token、压缩上下文）：轮次头上那一句 */
    noContent: "无对话内容",
  },
  {
    loadFailed: "Could not load the conversation",
    emptyTitle: "No turns recorded yet",
    emptyHint: "Each turn appears here when it ends",
    allLostTitle: "The conversation is past the retention period",
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

    restart: "The conversation history starts over here",
    earlier: (n: number) => `Earlier conversation · ${count(n, "message", "messages")}`,

    lost: "This turn is past the retention period",
    lostRun: (from: number, to: number) => `Turns ${from}–${to} are past the retention period`,
    requestMissing: "The request is past the retention period",
    requestTruncated: "The request was too large to save in full",
    responseMissing: "The response is past the retention period",
    responseFailed: (reason: string) => `The request failed: ${reason}`,
    responseCancelled: "Canceled: the client disconnected before the response finished",
    responseTruncated: "The response was too large to save in full",
    responseUnreadable: "The response format is not recognized; the raw body is in the request details",
    noContent: "No conversation content",
  },
);
