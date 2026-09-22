import { messages } from "@/i18n";

export const noticesText = messages(
  {
    bell: (unread: number) => (unread > 0 ? `提醒，${unread} 项未读` : "提醒"),
    title: "提醒",
    empty: "暂无提醒",
    clearAll: "全部清除",
    readAll: "全部已读",
    read: "标为已读",
    readOne: (title: string) => `标为已读：${title}`,
  },
  {
    bell: (unread: number) => (unread > 0 ? `Notices, ${unread} unread` : "Notices"),
    title: "Notices",
    empty: "No notices",
    clearAll: "Clear all",
    readAll: "Mark all as read",
    read: "Mark as read",
    readOne: (title: string) => `Mark as read: ${title}`,
  },
);
