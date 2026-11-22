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
  {
    "zh-Hant": {
      abortRequest: "中止請求",
      abortSession: "中止會話",
      title: "中止會話",
      body: (n: number) => `此會話中正在進行的 ${n} 個請求將立即停止，用戶端會收到錯誤。已完成的請求不受影響。`,
    },
    es: {
      abortRequest: "Abortar solicitud",
      abortSession: "Abortar sesión",
      title: "Abortar sesión",
      body: (n: number) => n === 1
        ? "La solicitud en curso en esta sesión se detiene inmediatamente, y su cliente recibe un error. Las solicitudes terminadas no se ven afectadas."
        : `Las ${n} solicitudes en curso en esta sesión se detienen inmediatamente, y sus clientes reciben un error. Las solicitudes terminadas no se ven afectadas.`,
      confirm: "Abortar",
      failed: "Sin abortar",
    },
  },
);
