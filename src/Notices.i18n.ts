import { messages } from "@/i18n";

export const noticesText = messages(
  {
    quieted: "此类提醒今后仅在应用内显示，可在设置中更改",
    bell: (n: number) => (n > 0 ? `提醒，${n} 项` : "提醒"),
    title: "提醒",
    empty: "暂无提醒",
    quiet: "不再弹出此类",
    dismiss: (title: string) => `忽略「${title}」`,
  },
  {
    quieted: "Notices of this kind now appear in the app only. This can be changed in Settings.",
    bell: (n: number) => (n > 0 ? `Notices, ${n}` : "Notices"),
    title: "Notices",
    empty: "No notices",
    quiet: "Show this kind in app only",
    dismiss: (title: string) => `Dismiss “${title}”`,
  },
);
