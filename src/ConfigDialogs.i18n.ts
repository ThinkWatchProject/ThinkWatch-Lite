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
  {
    "zh-Hant": {
      fileTitle: "配置檔案",
      fileDescription: "儲存前會校驗；校驗未透過時仍使用上一版本。每次儲存都在備份中生成一個版本。",
      readingFile: "正在讀取配置檔案",
      fileFailed: "配置檔案讀取失敗",
    },
    ko: {
      fileTitle: "설정 파일",
    },
    es: {
      fileTitle: "Archivo de configuración",
      fileDescription: "Los cambios son validados antes de guardarlos. Si la validación falla, la versión anterior permanece en uso. Cada guardar crea una versión en las copias de seguridad.",
      readingFile: "Leyendo el archivo de configuraciónuración",
      fileFailed: "No se pudo leer el archivo de configuraciónuración",
    },
  },
);
