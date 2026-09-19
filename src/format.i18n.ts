import { messages } from "@/i18n";

/**
 * 额度还有多久重置（`resetIn`）。
 *
 * 中文接在「重置」「过期」前面，英文跟在动词后面（resets in 3 h、
 * expires in 4 days）—— 两种语言都要能单独放。
 */
export const formatText = messages(
  {
    resetIn: {
      now: "刚刚",
      underMinute: "1 分钟内",
      minutes: (n: number) => `${n} 分钟后`,
      hours: (n: number) => `${n} 小时后`,
      days: (n: number) => `${n} 天后`,
    },
  },
  {
    resetIn: {
      now: "now",
      underMinute: "within 1 min",
      minutes: (n: number) => `in ${n} min`,
      hours: (n: number) => `in ${n} h`,
      days: (n: number) => (n === 1 ? "in 1 day" : `in ${n} days`),
    },
  },
);
