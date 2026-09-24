import { messages } from "@/i18n";

export const partsText = messages(
  {
    /** 24 小时那一格的次数 */
    requests: (n: number) => `${Math.round(n).toLocaleString()} 次`,
    neverUsed: "从未使用",
    /** 此刻有请求在跑 */
    inProgress: "请求中",
  },
  {
    requests: (n: number) => {
      const v = Math.round(n);
      return v === 1 ? "1 request" : `${v.toLocaleString()} requests`;
    },
    neverUsed: "Never used",
    inProgress: "In progress",
  },
);
