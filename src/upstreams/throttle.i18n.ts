import { messages } from "@/i18n";

/** 英文的单复数 */
const unit = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 上游此刻发不了（限流中、用量已满）的说法：上游表那一行的状态、悬停，和尝试链里
 * 「429 · 暂停 30 秒」那一跳共用一套时长写法。
 */
export const throttleText = messages(
  {
    /** 一段时长：「42 秒」「1 分 10 秒」「2 分钟」「1 小时 5 分」 */
    seconds: (s: number) => `${s} 秒`,
    minutes: (m: number) => `${m} 分钟`,
    minSec: (m: number, s: number) => `${m} 分 ${s} 秒`,
    hours: (h: number) => `${h} 小时`,
    hourMin: (h: number, m: number) => `${h} 小时 ${m} 分`,
    /** 上游表那一行的状态 */
    rateLimited: (left: string) => `限流中 · ${left}后恢复`,
    windowFull: (left: string) => `用量已满 · ${left}后恢复`,
    periodUsedUp: {
      day: "今日用量已满",
      week: "本周用量已满",
      month: "本月用量已满",
    },
    /** 悬停：什么时候恢复（钟点，一天以外带日期；钟点的写法同密钥的「00:00 重置」） */
    rateLimitedTip: (at: string) => `上游返回 429，${at} 恢复发送。`,
    resumesAt: (at: string) => `${at} 恢复发送。`,
    /** 悬停里每条上限一行之前的标题 */
    limitsTitle: "用量上限",
    /** 尝试链里收到 429、暂停了这家上游的那一跳 */
    paused: (status: number, d: string) => `${status} · 暂停 ${d}`,
  },
  {
    seconds: (s: number) => `${s} s`,
    minutes: (m: number) => `${m} min`,
    minSec: (m: number, s: number) => `${m} min ${s} s`,
    hours: (h: number) => unit(h, "hour", "hours"),
    hourMin: (h: number, m: number) => `${h} h ${m} min`,
    rateLimited: (left: string) => `Rate limited · back in ${left}`,
    windowFull: (left: string) => `Usage limit reached · back in ${left}`,
    periodUsedUp: {
      day: "Daily usage limit reached",
      week: "Weekly usage limit reached",
      month: "Monthly usage limit reached",
    },
    rateLimitedTip: (at: string) => `The upstream answered 429. Sending resumes ${at}.`,
    resumesAt: (at: string) => `Sending resumes ${at}.`,
    limitsTitle: "Usage limits",
    paused: (status: number, d: string) => `${status} · Paused ${d}`,
  },
);
