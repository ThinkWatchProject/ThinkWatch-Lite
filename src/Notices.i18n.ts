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
  {
    "zh-Hant": {
      bell: (unread: number) => (unread > 0 ? `提醒，${unread} 項未讀` : "提醒"),
      empty: "暫無提醒",
      readAll: "全部已讀",
      read: "標為已讀",
      readOne: (title: string) => `標為已讀：${title}`,
    },
    ja: {
      bell: (unread: number) => (unread > 0 ? `通知、未読 ${unread} 件` : "通知"),
      title: "通知",
      empty: "通知はありません",
      clearAll: "すべて消去",
      readAll: "すべて既読にする",
      read: "既読にする",
      readOne: (title: string) => `既読にする：${title}`,
    },
    ko: {
      bell: (unread: number) => (unread > 0 ? `Notices, ${unread} unread` : "알림"),
      title: "알림",
      empty: "알림 없음",
      clearAll: "모두 지우기",
      readAll: "모두 읽음으로 표시",
      read: "읽음으로 표시",
      readOne: (title: string) => `읽음으로 표시: ${title}`,
    },
    es: {
      bell: (unread: number) => (unread > 0 ? `Avisos, ${unread} no leídos` : "Avisos"),
      title: "Avisos",
      empty: "No hay avisos",
      clearAll: "Borrar todo",
      readAll: "Marcar todo como leído",
      read: "Marcar como leído",
      readOne: (title: string) => `Marque el texto como sigue: ${title}`,
    },
  },
);
