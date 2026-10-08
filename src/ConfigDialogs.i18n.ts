import { messages } from "@/i18n";

export const configDialogsText = messages(
  {
    fileTitle: "配置文件",
    fileDescription: "保存前会校验；校验未通过时仍使用上一版本，并在版本历史中保留每一次保存。",
    readingFile: "正在读取配置文件",
    fileFailed: "配置文件读取失败",
    historyTitle: "版本历史",
    historyDescription: "恢复某个版本会生成一个新版本，当前版本保留在历史中。",
    historyFailed: "版本历史读取失败",
    noVersions: "暂无历史版本",
    noVersionsHint: "每次保存配置都会在此生成一个版本。",
    time: "时间",
    origin: "来源",
    version: "版本",
    current: "当前版本",
    restore: "恢复此版本",
  },
  {
    fileTitle: "Config file",
    fileDescription:
      "Changes are validated before saving. If validation fails, the previous version stays in use, and every save is kept in the version history.",
    readingFile: "Reading the config file",
    fileFailed: "Could not read the config file",
    historyTitle: "Version history",
    historyDescription: "Restoring a version creates a new version; the current version stays in the history.",
    historyFailed: "Could not read the version history",
    noVersions: "No versions yet",
    noVersionsHint: "Every save of the config creates a version here.",
    time: "Time",
    origin: "Source",
    version: "Version",
    current: "Current version",
    restore: "Restore this version",
  },
);
