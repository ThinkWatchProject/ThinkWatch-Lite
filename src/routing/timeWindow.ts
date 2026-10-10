/**
 * 路由条件「时段」的值：`[<星期> ]<HH:MM>-<HH:MM>`，和 core 同一套语法。
 *
 * **纯函数**：对话框里的星期选择和两个时间框从这里换成字符串，列表和试算从字符串换成
 * 人话。按 core 所在机器的本地时间判断；开始含、结束不含，结束可以写 `24:00`；结束早于
 * 开始是跨夜时段（`22:00-06:00`），星期指的是时段**开始**的那天。
 *
 *   mon-fri 09:00-18:00      工作日白天
 *   sat,sun 00:00-24:00      周末全天
 *   22:00-06:00              每天夜里
 *   fri-mon 20:00-08:00      星期可以绕过周日（周五到周一）
 */
import { textOf } from "@/i18n";
import { timeWindowText } from "./timeWindow.i18n";

/** 星期在语法里的写法，周一在前；`days` 数组的下标就是这个顺序 */
export const DAY_CODES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type DayCode = (typeof DAY_CODES)[number];

export interface TimeWindow {
  /** 七个，周一在前：这一天是否在时段里 */
  days: boolean[];
  /** 开始，从零点起的分钟数（0–1439） */
  start: number;
  /** 结束，从零点起的分钟数（0–1440，1440 是 `24:00`） */
  end: number;
}

export const EVERY_DAY: readonly boolean[] = [true, true, true, true, true, true, true];

/** 新加一个时段时的默认值：每天 09:00–18:00 */
export function blankTimeWindow(): TimeWindow {
  return { days: [...EVERY_DAY], start: 9 * 60, end: 18 * 60 };
}

/**
 * 一个时间：`09:00`、`9:00`、`24:00`。小时 0–24、分钟 0–59，`24` 只能带 `:00`。
 * 写不对返回 null
 */
export function parseTime(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24) return min === 0 ? 1440 : null;
  return h <= 23 ? h * 60 + min : null;
}

/** 分钟数 → `09:00`；1440 → `24:00` */
export function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 星期部分：`mon-fri`、`sat,sun`、`fri-mon`（绕过周日）。大小写不论。
 * 认不出的名字、空的段返回 null
 */
function parseDays(text: string): boolean[] | null {
  const days = DAY_CODES.map(() => false);
  for (const part of text.split(",")) {
    const seg = part.trim().toLowerCase();
    if (!seg) return null;
    const range = seg.split("-");
    if (range.length > 2) return null;
    const from = DAY_CODES.indexOf(range[0]! as DayCode);
    const to = range.length === 2 ? DAY_CODES.indexOf(range[1]! as DayCode) : from;
    if (from < 0 || to < 0) return null;
    // 绕过周日的范围：从 from 数到 to，到周日再从周一接着数
    for (let i = from; ; i = (i + 1) % 7) {
      days[i] = true;
      if (i === to) break;
    }
  }
  return days;
}

/**
 * 一个值 → 时段。多余的空白不计；开始和结束相同的不算一个时段（它什么都不包含）。
 * 写不对返回 null，界面上就按原文显示
 */
export function parseTimeWindow(value: string): TimeWindow | null {
  const m = /^\s*(?:(\S+)\s+)?(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$/.exec(value);
  if (!m) return null;
  const days = m[1] == null ? [...EVERY_DAY] : parseDays(m[1]);
  if (!days) return null;
  const start = parseTime(m[2]!);
  const end = parseTime(m[3]!);
  if (start == null || end == null || start === 1440 || start === end) return null;
  return { days, start, end };
}

/**
 * 连着的几天并成一段：`[0,1,2,3,4]` → `mon-fri`。两天不写成范围（`sat,sun`），和 core
 * 的示例一致。周日接着周一的算连着（`fri-mon`），只有三天以上才这样写，`sun,mon` 拆开各归
 * 各位；几段按周一在前的顺序排。七天全选不写星期部分
 */
export function formatDays(days: readonly boolean[]): string {
  if (days.every(Boolean)) return "";
  // 从第一个「前一天没选」的日子起数，绕一圈：这样跨过周日的一段不会被从中间切开
  let first = 0;
  while (first < 7 && !(days[first] && !days[(first + 6) % 7])) first += 1;
  const runs: [number, number][] = [];
  let open: [number, number] | null = null;
  for (let k = 0; k < 7; k++) {
    const i = (first + k) % 7;
    if (!days[i]) {
      open = null;
      continue;
    }
    if (open && open[1] === (i + 6) % 7) open[1] = i;
    else runs.push((open = [i, i]));
  }
  const len = ([a, b]: [number, number]) => ((b - a + 7) % 7) + 1;
  const parts = runs.flatMap((run): [number, number][] =>
    run[1] < run[0] && len(run) === 2 ? [[run[0], run[0]], [run[1], run[1]]] : [run],
  );
  return parts
    .sort((x, y) => x[0] - y[0])
    .map(([a, b]) => {
      const n = len([a, b]);
      if (n === 1) return DAY_CODES[a];
      if (n === 2) return `${DAY_CODES[a]},${DAY_CODES[b]}`;
      return `${DAY_CODES[a]}-${DAY_CODES[b]}`;
    })
    .join(",");
}

/** 时段 → 写进配置的值。一天都没选时返回 null：空的星期部分在语法里是「每天」 */
export function formatTimeWindow(w: TimeWindow): string | null {
  if (!w.days.some(Boolean)) return null;
  const days = formatDays(w.days);
  const time = `${formatTime(w.start)}-${formatTime(w.end)}`;
  return days ? `${days} ${time}` : time;
}

/** 跨夜：结束早于开始，到次日为止 */
export function isOvernight(w: Pick<TimeWindow, "start" | "end">): boolean {
  return w.end < w.start;
}

/**
 * 时段写成人话：`周一至周五 09:00–18:00`、`周六、周日 00:00–24:00`、`22:00–次日 06:00`；
 * 英文 `Mon–Fri 09:00–18:00`、`22:00–06:00 next day`。每天只写时间
 */
export function describeTimeWindow(w: TimeWindow): string {
  const t = textOf(timeWindowText);
  const time = isOvernight(w)
    ? t.overnight(formatTime(w.start), formatTime(w.end))
    : t.span(formatTime(w.start), formatTime(w.end));
  const days = describeDays(w.days);
  return days ? t.withDays(days, time) : time;
}

/** 星期写成人话：`周一至周五`、`周六、周日`、`周五至周一`；每天为空 */
export function describeDays(days: readonly boolean[]): string {
  const t = textOf(timeWindowText);
  if (days.every(Boolean)) return "";
  // 和 formatDays 同一种分段，只是名字和连接方式不同
  const code = formatDays(days);
  return code
    .split(",")
    .map((seg) => {
      const [a, b] = seg.split("-") as [DayCode, DayCode?];
      return b ? t.dayRange(t.days[a], t.days[b]) : t.days[a];
    })
    .join(t.daySep);
}

/**
 * 条件的值写成人话；写不对的按原文。试算里「实际」那一栏是 core 给的当前时刻
 * （`fri 16:42`），也走这里
 */
export function timeValueText(value: string): string {
  const w = parseTimeWindow(value);
  if (w) return describeTimeWindow(w);
  const now = /^\s*(mon|tue|wed|thu|fri|sat|sun)\s+(\d{1,2}:\d{2})\s*$/i.exec(value);
  if (now) {
    const minutes = parseTime(now[2]!);
    if (minutes != null && minutes < 1440) {
      const t = textOf(timeWindowText);
      return t.withDays(t.days[now[1]!.toLowerCase() as DayCode], formatTime(minutes));
    }
  }
  return value;
}
