import { messages } from "@/i18n";

export const securityPageText = messages(
  {
    log: "日志",
    loading: "读取中…",
    loadFailed: (error: string) => `读取失败：${error}`,
  },
  {
    log: "Log",
    loading: "Loading…",
    loadFailed: (error: string) => `Could not load: ${error}`,
  },
);
