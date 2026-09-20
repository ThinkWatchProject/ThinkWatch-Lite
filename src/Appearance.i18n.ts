import { messages } from "@/i18n";

export const appearanceText = messages(
  {
    title: "外观",
    system: "跟随系统",
    light: "浅色",
    dark: "深色",
    /** 选了跟随系统时，把系统现在是哪一档写出来 */
    systemNow: (name: string) => `系统当前为${name}。`,
    saveFailed: "无法保存外观设置",
  },
  {
    title: "Appearance",
    system: "System",
    light: "Light",
    dark: "Dark",
    systemNow: (name: string) => `The system is currently set to ${name.toLowerCase()}.`,
    saveFailed: "The appearance setting could not be saved",
  },
);
