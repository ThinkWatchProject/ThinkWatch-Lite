import { messages } from "@/i18n";

/**
 * `format.ts` 里要说成话的几样。
 *
 * `resetIn`：额度还有多久重置。中文接在「重置」「过期」前面，英文跟在动词后面
 * （resets in 3 h、expires in 4 days）—— 两种语言都要能单独放。
 */
export const formatText = messages(
  {
    /** 一次会话的跨度（`span`） */
    span: {
      seconds: (n: number) => `${n} 秒`,
      minutes: (n: number) => `${n} 分`,
      hours: (n: string) => `${n} 小时`,
    },
    resetIn: {
      now: "刚刚",
      underMinute: "1 分钟内",
      minutes: (n: number) => `${n} 分钟后`,
      hours: (n: number) => `${n} 小时后`,
      days: (n: number) => `${n} 天后`,
    },
  },
  {
    span: {
      seconds: (n: number) => `${n} s`,
      minutes: (n: number) => `${n} min`,
      hours: (n: string) => `${n} h`,
    },
    resetIn: {
      now: "now",
      underMinute: "within 1 min",
      minutes: (n: number) => `in ${n} min`,
      hours: (n: number) => `in ${n} h`,
      days: (n: number) => (n === 1 ? "in 1 day" : `in ${n} days`),
    },
  },
  {
    "zh-Hant": {
      span: {
        seconds: (n: number) => `${n} 秒`,
        minutes: (n: number) => `${n} 分`,
        hours: (n: string) => `${n} 小時`,
      },
      resetIn: {
        now: "剛剛",
        underMinute: "1 分鐘內",
        minutes: (n: number) => `${n} 分鐘後`,
        hours: (n: number) => `${n} 小時後`,
        days: (n: number) => `${n} 天后`,
      },
    },
    ja: {
      span: {
        seconds: (n: number) => `${n} 秒`,
        minutes: (n: number) => `${n} 分`,
        hours: (n: string) => `${n} 時間`,
      },
      resetIn: {
        now: "今",
        underMinute: "1 分以内",
        minutes: (n: number) => `${n} 分後`,
        hours: (n: number) => `${n} 時間後`,
        days: (n: number) => `${n} 日後`,
      },
    },
    es: {
      resetIn: {
        now: "Ahora",
        underMinute: "en un plazo de 1 min",
        minutes: (n: number) => `en ${n} min`,
        hours: (n: number) => `en ${n} h`,
        days: (n: number) => (n === 1 ? "en 1 día" : `en ${n} días`),
      },
    },
  },
);
