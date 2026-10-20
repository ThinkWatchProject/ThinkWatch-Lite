/**
 * 上游此刻发不了：限流中（上游回了 429）、滚动窗口的用量已满、自然周期的用量已满
 * （`ProviderView.throttle`）。**纯函数**，画的在 `ThrottleTag.tsx`。
 *
 * 这是一个状态，不是警告：它会自己恢复，不进通知、不出横幅，只在上游表那一行写着，
 * 倒数到点就消失。core 改了状态会报 `throttle_changed`（空 = 又可以发了）。
 */
import { textOf } from "@/i18n";
import { periodText as limitPeriodText } from "@/keys/limits";
import { limitsText } from "@/keys/limits.i18n";
import type { CoreEvent, KeyLimitView, ProviderView, Throttle } from "@/types";
import { throttleText } from "./throttle.i18n";

/** 一条上游的用量上限：和密钥的是同一个形状 */
export type UsageLimit = KeyLimitView;

/** 离 `untilMs` 还有几秒，向上取整：还差 0.2 秒也写「1 秒」，到点了是 0 */
export function secondsLeft(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

/**
 * 一段时长写成字：「42 秒」「1 分 10 秒」「2 分钟」「1 小时 5 分」。
 *
 * 和额度的「约 3 小时后重置」不同，**这里要精确到秒**：几十秒的限流，「不到一分钟」
 * 说不清要不要等。一小时以上只写到分钟。
 */
export function durationText(secs: number): string {
  const t = textOf(throttleText);
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return t.seconds(s);
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r === 0 ? t.minutes(m) : t.minSec(m, r);
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m === 0 ? t.hours(h) : t.hourMin(h, m);
}

/** 这一条状态说的是哪一条上限。限流没有；下标越界（配置刚改过）也没有 */
export function limitOf(p: Pick<ProviderView, "limits">, th: Throttle): UsageLimit | null {
  if (th.limit == null) return null;
  return p.limits[th.limit] ?? null;
}

/**
 * 那一行上写什么。到点了（`until_ms` 已过）是 null：状态自己消失，不等 core 再报一条。
 *
 * · 限流中 · 42 秒后恢复
 * · 用量已满 · 1 分 10 秒后恢复（分钟、小时的滚动窗口）
 * · 今日 / 本周 / 本月用量已满（自然周期，到下一期才恢复，倒数没有意义）
 */
export function throttleLabel(p: Pick<ProviderView, "limits">, th: Throttle, nowMs: number): string | null {
  const left = secondsLeft(th.until_ms, nowMs);
  if (left <= 0) return null;
  const t = textOf(throttleText);
  switch (th.kind) {
    case "rate_limited":
      return t.rateLimited(durationText(left));
    case "window_full":
      return t.windowFull(durationText(left));
    case "period_used_up": {
      const per = limitOf(p, th)?.per;
      if (per === "day" || per === "week" || per === "month") return t.periodUsedUp[per];
      // 认不出是哪一期：照滚动窗口那样写什么时候恢复
      return t.windowFull(durationText(left));
    }
  }
}

/** 用量那一行开头：「今天」「本周」「最近一分钟」「最近 5 分钟」 */
export function periodText(l: UsageLimit): string {
  return limitPeriodText(l.per, l.every);
}

const DAY_MS = 24 * 3_600_000;

/**
 * 恢复的时刻：一天之内写到秒（「16:43:07」，限流常常只有几十秒），再远带上日期。写法和
 * 密钥的「00:00 重置」同一套（`limitsText.at` / `on`），按这台机器的时区
 */
export function resumeClock(atMs: number, nowMs: number): string {
  const t = textOf(limitsText);
  const d = new Date(atMs);
  const two = (n: number) => String(n).padStart(2, "0");
  const hm = `${two(d.getHours())}:${two(d.getMinutes())}`;
  if (atMs - nowMs <= DAY_MS) return t.at(`${hm}:${two(d.getSeconds())}`);
  const date = new Intl.DateTimeFormat(t.locale, { month: "short", day: "numeric" }).format(d);
  return t.on(date, hm);
}

/**
 * 尝试链里收到 429、暂停了这家上游的那一跳：「429 · 暂停 30 秒」。没有暂停的是 null
 */
export function pausedText(status: number | null | undefined, pauseMs: number | null | undefined): string | null {
  if (pauseMs == null) return null;
  return textOf(throttleText).paused(status ?? 429, durationText(Math.ceil(pauseMs / 1000)));
}

/**
 * `throttle_changed` 到了、概览还没重读的那一会儿：按事件先改。返回新的一份（没关系的
 * 事件原样返回同一个对象）。键是上游名，值是事件里的新状态（null = 又可以发了）
 */
export function applyThrottleEvent(
  overlay: ReadonlyMap<string, Throttle | null>,
  ev: CoreEvent,
): ReadonlyMap<string, Throttle | null> {
  if (ev.kind !== "throttle_changed") return overlay;
  const next = new Map(overlay);
  next.set(ev.provider, ev.throttle ?? null);
  return next;
}

/** 概览里的上游，按事件改过的那几家换上事件里的状态。都没改原样返回 */
export function withThrottles(
  providers: ProviderView[],
  overlay: ReadonlyMap<string, Throttle | null>,
): ProviderView[] {
  if (overlay.size === 0) return providers;
  let changed = false;
  const out = providers.map((p) => {
    if (!overlay.has(p.name)) return p;
    changed = true;
    return { ...p, throttle: overlay.get(p.name) ?? null };
  });
  return changed ? out : providers;
}
