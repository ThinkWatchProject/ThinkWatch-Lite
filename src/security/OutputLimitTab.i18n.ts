import { messages } from "@/i18n";

export const outputLimitText = messages(
  {
    title: "上限",
    max: "每次回答",
    unit: "个字符",
    hint: (def: string, ceiling: string) => `按字符计算，默认 ${def}，最大 ${ceiling}。`,
    bad: (ceiling: string) => `须为 1 到 ${ceiling} 之间的整数。`,
    reset: "恢复默认",
    saved: "输出长度上限已保存",
    saveFailed: "未能保存",
  },
  {
    title: "Limit",
    max: "Each answer",
    unit: "characters",
    hint: (def: string, ceiling: string) => `Counted in characters. Default ${def}, at most ${ceiling}.`,
    bad: (ceiling: string) => `A whole number from 1 to ${ceiling}.`,
    reset: "Restore default",
    saved: "Output limit saved",
    saveFailed: "Not saved",
  },
);
