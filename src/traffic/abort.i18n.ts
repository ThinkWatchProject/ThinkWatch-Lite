import { messages } from "@/i18n";

export const abortText = messages(
  {
    abortRequest: "中止请求",
    abortSession: "中止会话",
    title: "中止会话",
    body: (n: number) => `此会话中正在进行的 ${n} 个请求将立即停止，客户端会收到错误。已完成的请求不受影响。`,
    confirm: "中止",
    failed: "未能中止",
  },
  {
    abortRequest: "Abort request",
    abortSession: "Abort session",
    title: "Abort session",
    body: (n: number) =>
      n === 1
        ? "The request in progress in this session stops at once, and its client receives an error. Finished requests are not affected."
        : `The ${n} requests in progress in this session stop at once, and their clients receive an error. Finished requests are not affected.`,
    confirm: "Abort",
    failed: "Not aborted",
  },
);
