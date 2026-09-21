import { messages } from "@/i18n";

export const noticesText = messages(
  {
    bell: (n: number) => (n > 0 ? `提醒，${n} 项` : "提醒"),
    title: "提醒",
    empty: "暂无提醒",
    dismiss: (title: string) => `忽略「${title}」`,
  },
  {
    bell: (n: number) => (n > 0 ? `Notices, ${n}` : "Notices"),
    title: "Notices",
    empty: "No notices",
    dismiss: (title: string) => `Dismiss “${title}”`,
  },
);
