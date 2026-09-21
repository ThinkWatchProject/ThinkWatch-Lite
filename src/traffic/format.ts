import { textOf } from "@/i18n";
import { sessionsText } from "@/Sessions.i18n";

/** 会话这一侧的三个小格式化。**和请求那侧的 `format.ts` 不是一回事** ——
 *  那边说的是一条请求的时刻和耗时，这边说的是一次任务的跨度。 */
export function when(ms: number) {
  const d = new Date(ms);
  const today = new Date().toDateString() === d.toDateString();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return today ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function dur(ms: number) {
  // 取文案要在调用的那一刻，不能提到模块级 —— 换了语言它不会跟着换
  const t = textOf(sessionsText);
  if (ms < 60_000) return t.seconds(Math.round(ms / 1000));
  if (ms < 3_600_000) return t.minutes(Math.round(ms / 60_000));
  return t.hours((ms / 3_600_000).toFixed(1));
}

export function tokens(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
}

