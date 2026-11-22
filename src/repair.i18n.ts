import { messages } from "@/i18n";

export const repairText = messages(
  {
    title: "可以一键修复",
    action: "一键修复",
    value: (field: string, value: string, now: string) => `${field}：${value} 改为默认值 ${now}`,
    valueNoDefault: (field: string, value: string) => `${field}：删除 ${value}，改用默认值`,
    field: (field: string) => `删除不认识的字段 ${field}`,
    line: (n: number) => `第 ${n} 行`,
    history: "修复前的版本保存在备份中。",
  },
  {
    title: "Can be repaired in one click",
    action: "Repair",
    value: (field: string, value: string, now: string) => `${field}: ${value} → default ${now}`,
    valueNoDefault: (field: string, value: string) => `${field}: remove ${value} and use the default`,
    field: (field: string) => `Remove the unknown field ${field}`,
    line: (n: number) => `Line ${n}`,
    history: "The version before the repair is kept in the backups.",
  },
  {
    "zh-Hant": {
      title: "可以一鍵修復",
      action: "一鍵修復",
      value: (field: string, value: string, now: string) => `${field}：${value} 改為預設值 ${now}`,
      valueNoDefault: (field: string, value: string) => `${field}：刪除 ${value}，改用預設值`,
      field: (field: string) => `刪除不認識的欄位 ${field}`,
      history: "修復前的版本儲存在備份中。",
    },
    es: {
      title: "Se puede reparar con un solo clic",
      action: "Reparación",
      value: (field: string, value: string, now: string) => `${field}: ${value} → por defecto ${now}`,
      valueNoDefault: (field: string, value: string) => `${field}: eliminar ${value} y utilizar el valor predeterminado`,
      field: (field: string) => `Eliminar el campo desconocido ${field}`,
      line: (n: number) => `Línea ${n}`,
      history: "La versión anterior a la reparación se mantiene en las copias de seguridad.",
    },
  },
);
