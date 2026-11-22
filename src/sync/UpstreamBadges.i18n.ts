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
      "This upstream is left out of sync: it is not uploaded and not replaced by an upstream of the same name from another device. Change this in Settings › Sync and backup.",
    urlChanged: "URL changed by sync",
    urlChangedTitle: "URL changed by sync",
    urlChangedBody: (from: string, to: string) => `The URL changed from ${from} to ${to}.`,
    by: (device: string, when: string) => `${device}, ${when}`,
    when: (when: string) => when,
    plainNote: "Synced content is not encrypted, so a URL change is pointed out here once.",
    markRead: "Mark as read",
  },
  {
    "zh-Hant": {
      notSyncedTip: "此上游不參與同步：不上傳，也不被其他裝置的同名上游覆蓋。在設定 › 同步與備份中修改。",
      urlChanged: "地址經同步變更",
      urlChangedTitle: "地址經同步變更",
      urlChangedBody: (from: string, to: string) => `地址由 ${from} 變更為 ${to}。`,
      plainNote: "同步內容未加密，地址的變更在這裡提示一次。",
      markRead: "標為已讀",
    },
    ko: {
      markRead: "읽음으로 표시",
    },
    es: {
      notSynced: "Sin sincronizar",
      notSyncedTip: "Este upstream se deja fuera de sincronización: no se carga y no se reemplaza por un upsteam del mismo nombre desde otro dispositivo. Cambie esto en Configuración › Sincronización y respaldo.",
      urlChanged: "URL cambiada por sincronización",
      urlChangedTitle: "URL cambiada por sincronización",
      urlChangedBody: (from: string, to: string) => `La URL cambió de ${from} a ${to}.`,
      plainNote: "El contenido sincronizado no está cifrado, por lo que un cambio de URL se señala aquí una vez.",
      markRead: "Marcar como leído",
    },
  },
);
