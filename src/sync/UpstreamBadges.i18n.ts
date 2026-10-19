import { messages } from "@/i18n";

export const upstreamBadgesText = messages(
  {
    notSynced: "不同步",
    notSyncedTip: "此上游不参与同步：不上传，也不被其他设备的同名上游覆盖。在设置 › 同步与备份中修改。",
    urlChanged: "地址经同步变更",
    urlChangedTitle: "地址经同步变更",
    urlChangedBody: (from: string, to: string) => `地址由 ${from} 变更为 ${to}。`,
    by: (device: string, when: string) => `${device}，${when}`,
    when: (when: string) => when,
    plainNote: "同步内容未加密，地址的变更在这里提示一次。",
    markRead: "标为已读",
  },
  {
    notSynced: "Not synced",
    notSyncedTip:
      "This upstream is left out of sync: it is not uploaded and not replaced by an upstream of the same name from another device. Change this in Settings › Sync & backup.",
    urlChanged: "URL changed by sync",
    urlChangedTitle: "URL changed by sync",
    urlChangedBody: (from: string, to: string) => `The URL changed from ${from} to ${to}.`,
    by: (device: string, when: string) => `${device}, ${when}`,
    when: (when: string) => when,
    plainNote: "Synced content is not encrypted, so a URL change is pointed out here once.",
    markRead: "Mark as read",
  },
);
