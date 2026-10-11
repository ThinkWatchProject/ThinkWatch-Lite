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
);
