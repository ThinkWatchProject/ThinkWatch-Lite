import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const logsDialogText = messages(
  {
    title: "日志",
    lead: (name: ReactNode) => <>插件「{name}」通过 console 写下的内容，新的在前。</>,
    refresh: "刷新",
    empty: "尚无日志",
    emptyHint: "插件调用 console.log 等方法时，写下的内容显示在这里。",
    loadFailed: "日志读取失败",
    levels: { log: "日志", info: "信息", warn: "警告", error: "错误" } as Record<string, string>,
    hooks: { request: "请求", reply: "回答" } as Record<string, string>,
    request: (id: string) => `请求 #${id}`,
    openRequest: (id: string) => `打开请求 #${id}`,
    close: "关闭",
  },
  {
    title: "Logs",
    lead: (name: ReactNode) => <>What plugin “{name}” wrote through console, newest first.</>,
    refresh: "Refresh",
    empty: "No logs yet",
    emptyHint: "What the plugin writes with console.log and similar methods appears here.",
    loadFailed: "The logs could not be loaded",
    levels: { log: "log", info: "info", warn: "warn", error: "error" } as Record<string, string>,
    hooks: { request: "Request", reply: "Reply" } as Record<string, string>,
    request: (id: string) => `Request #${id}`,
    openRequest: (id: string) => `Open request #${id}`,
    close: "Close",
  },
);
