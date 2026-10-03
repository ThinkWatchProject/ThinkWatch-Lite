import type { ReactNode } from "react";
import { messages } from "@/i18n";

export const trialDialogText = messages(
  {
    title: "试运行",
    lead: (name: ReactNode) => <>用一条已记录的请求运行「{name}」，不发往上游。</>,
    request: "请求",
    option: (id: number, time: string, client: string, model: string) =>
      [`#${id}`, time, client, model].filter(Boolean).join(" · "),
    noneInScope: "最近的请求都不在此插件的适用范围内，以下是全部最近的请求。",
    noRequests: "尚无可用的请求记录。",
    loadFailed: "请求记录读取失败",
    run: "运行",
    runAgain: "再次运行",
    result: "结果",
    sides: { request: "请求", reply: "回答" } as Record<string, string>,
    unchanged: "插件未改动这一部分。",
    rejected: "插件拒绝了这次请求。",
    skipped: "插件未在这一部分运行。",
    failed: "运行出错",
    logs: "日志",
    noLogs: "这次运行没有写日志。",
    close: "关闭",
  },
  {
    title: "Trial run",
    lead: (name: ReactNode) => <>Run “{name}” on a recorded request. Nothing is sent upstream.</>,
    request: "Request",
    option: (id: number, time: string, client: string, model: string) =>
      [`#${id}`, time, client, model].filter(Boolean).join(" · "),
    noneInScope: "None of the recent requests are in this plugin's scope, so all recent requests are listed.",
    noRequests: "No recorded requests are available.",
    loadFailed: "The request history could not be loaded",
    run: "Run",
    runAgain: "Run again",
    result: "Result",
    sides: { request: "Request", reply: "Reply" } as Record<string, string>,
    unchanged: "The plugin left this part unchanged.",
    rejected: "The plugin rejected the request.",
    skipped: "The plugin did not run on this part.",
    failed: "The run failed",
    logs: "Logs",
    noLogs: "This run wrote no logs.",
    close: "Close",
  },
);
