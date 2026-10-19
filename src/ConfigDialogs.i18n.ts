import { messages } from "@/i18n";

export const configDialogsText = messages(
  {
    fileTitle: "配置文件",
    fileDescription: "保存前会校验；校验未通过时仍使用上一版本。每次保存都在备份中生成一个版本。",
    readingFile: "正在读取配置文件",
    fileFailed: "配置文件读取失败",
  },
  {
    fileTitle: "Config file",
    fileDescription:
      "Changes are validated before saving. If validation fails, the previous version stays in use. Every save creates a version in the backups.",
    readingFile: "Reading the config file",
    fileFailed: "Could not read the config file",
  },
);
