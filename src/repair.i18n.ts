import { messages } from "@/i18n";

export const repairText = messages(
  {
    title: "可以一键修复",
    action: "一键修复",
    value: (field: string, value: string, now: string) => `${field}：${value} 改为默认值 ${now}`,
    valueNoDefault: (field: string, value: string) => `${field}：删除 ${value}，改用默认值`,
    field: (field: string) => `删除不认识的字段 ${field}`,
    line: (n: number) => `第 ${n} 行`,
    history: "修复前的版本保存在「版本历史」中。",
  },
  {
    title: "Can be repaired in one click",
    action: "Repair",
    value: (field: string, value: string, now: string) => `${field}: ${value} → default ${now}`,
    valueNoDefault: (field: string, value: string) => `${field}: remove ${value} and use the default`,
    field: (field: string) => `Remove the unknown field ${field}`,
    line: (n: number) => `Line ${n}`,
    history: "The version before the repair is kept in Version history.",
  },
);
