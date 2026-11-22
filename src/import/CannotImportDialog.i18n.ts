import { messages } from "@/i18n";

export const cannotImportText = messages(
  {
    title: "无法导入这条链接",
    unsupported: (param: string) => `这条链接含有当前版本不支持的参数「${param}」。`,
    unsupportedUnnamed: "这条链接含有当前版本不支持的参数。",
    update: "更新 ThinkWatch Lite 后再打开这条链接。",
    check: "检查更新",
    install: "安装更新",
    latest: "已是最新版本",
    checkFailed: "检查更新失败",
  },
  {
    title: "Cannot import this link",
    unsupported: (param: string) => `This link contains a parameter this version does not support: “${param}”.`,
    unsupportedUnnamed: "This link contains a parameter this version does not support.",
    update: "Update ThinkWatch Lite, then open this link again.",
    check: "Check for updates",
    install: "Install update",
    latest: "Up to date",
    checkFailed: "Update check failed",
  },
  {
    "zh-Hant": {
      title: "無法匯入這條連結",
      unsupported: (param: string) => `這條連結含有當前版本不支援的引數「${param}」。`,
      unsupportedUnnamed: "這條連結含有當前版本不支援的引數。",
      update: "更新 ThinkWatch Lite 後再開啟這條連結。",
      check: "檢查更新",
      install: "安裝更新",
      checkFailed: "檢查更新失敗",
    },
    ko: {
      check: "업데이트 확인",
      latest: "최신 버전",
      checkFailed: "업데이트 확인 실패",
    },
    es: {
      title: "No se puede importar este enlace",
      unsupported: (param: string) => `Este enlace contiene un parámetro que esta versión no admite: “${param}”.`,
      unsupportedUnnamed: "Este enlace contiene un parámetro que esta versión no admite.",
      update: "Actualiza ThinkWatch Lite, luego abre este enlace de nuevo.",
      check: "Buscar actualizaciones",
      install: "Instalar actualización",
      latest: "Al día",
      checkFailed: "Error al buscar actualizaciones",
    },
  },
);
