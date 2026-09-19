import { messages } from "@/i18n";

export const languageText = messages(
  {
    title: "语言",
    system: (name: string) => `跟随系统（${name}）`,
    saveFailed: "无法保存语言设置",
  },
  {
    title: "Language",
    system: (name: string) => `System default (${name})`,
    saveFailed: "The language setting could not be saved",
  },
);
