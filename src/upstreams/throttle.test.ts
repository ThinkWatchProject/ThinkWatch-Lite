import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { KeyLimitView, ProviderView, Throttle } from "@/types";
import {
  applyThrottleEvent,
  durationText,
  pausedText,
  periodText,
  secondsLeft,
  throttleLabel,
  withThrottles,
  type UsageLimit,
} from "./throttle";

const NOW = 1_760_000_000_000;

const limit = (x: Partial<UsageLimit> & Pick<KeyLimitView, "per" | "measure" | "max">): UsageLimit => ({
  every: 1,
  cache_reads: false,
  used: 0,
  reached: false,
  ...x,
});

const LIMITS: UsageLimit[] = [
  limit({ per: "minute", measure: "requests", max: 30, used: 30, reached: true, every: 5 }),
  limit({ per: "day", measure: "cost", max: 5_000_000, used: 5_000_000, reached: true, resets_at_ms: NOW + 3_600_000 }),
  limit({ per: "week", measure: "tokens", max: 1_000_000, used: 1_000_000, reached: true }),
  limit({ per: "month", measure: "cost", max: 50_000_000, used: 50_000_000, reached: true }),
];

const p = { limits: LIMITS } as Pick<ProviderView, "limits">;

describe("倒数的写法", () => {
  it("精确到秒，一小时以上写到分钟", () => {
    expect(durationText(42)).toBe("42 秒");
    expect(durationText(70)).toBe("1 分 10 秒");
    expect(durationText(120)).toBe("2 分钟");
    expect(durationText(3_900)).toBe("1 小时 5 分");
    expect(durationText(7_200)).toBe("2 小时");
    setLang("en");
    expect(durationText(42)).toBe("42 s");
    expect(durationText(70)).toBe("1 min 10 s");
    expect(durationText(3_600)).toBe("1 hour");
  });

  it("还差零点几秒也写 1 秒，到点是 0", () => {
    expect(secondsLeft(NOW + 200, NOW)).toBe(1);
    expect(secondsLeft(NOW, NOW)).toBe(0);
    expect(secondsLeft(NOW - 5_000, NOW)).toBe(0);
  });
});

describe("上游那一行的状态", () => {
  const rate: Throttle = { kind: "rate_limited", until_ms: NOW + 42_000 };

  it("限流中、用量已满带倒数，每秒都是新的数", () => {
    expect(throttleLabel(p, rate, NOW)).toBe("限流中 · 42 秒后恢复");
    expect(throttleLabel(p, rate, NOW + 1_000)).toBe("限流中 · 41 秒后恢复");
    expect(throttleLabel(p, { kind: "window_full", until_ms: NOW + 70_000, limit: 0 }, NOW)).toBe(
      "用量已满 · 1 分 10 秒后恢复",
    );
  });

  it("自然周期用完了：今日 / 本周 / 本月，不倒数", () => {
    const period = (i: number): Throttle => ({ kind: "period_used_up", until_ms: NOW + 86_400_000, limit: i });
    expect(throttleLabel(p, period(1), NOW)).toBe("今日用量已满");
    expect(throttleLabel(p, period(2), NOW)).toBe("本周用量已满");
    expect(throttleLabel(p, period(3), NOW)).toBe("本月用量已满");
    // 认不出是哪一条（配置刚改过）：照滚动窗口那样说什么时候恢复
    expect(throttleLabel(p, { kind: "period_used_up", until_ms: NOW + 60_000, limit: 9 }, NOW)).toBe(
      "用量已满 · 1 分钟后恢复",
    );
    setLang("en");
    expect(throttleLabel(p, period(1), NOW)).toBe("Daily usage limit reached");
    expect(throttleLabel(p, rate, NOW)).toBe("Rate limited · back in 42 s");
  });

  it("到点就消失，不等 core 再报", () => {
    expect(throttleLabel(p, rate, NOW + 42_000)).toBeNull();
    expect(throttleLabel(p, { kind: "period_used_up", until_ms: NOW, limit: 1 }, NOW)).toBeNull();
  });

  it("用量那一行开头：每 N 分钟、每 N 小时的写最近 N", () => {
    expect(periodText(LIMITS[0]!)).toBe("最近 5 分钟");
    expect(periodText(limit({ per: "hour", measure: "requests", max: 1, every: 2 }))).toBe("最近 2 小时");
    expect(periodText(limit({ per: "minute", measure: "requests", max: 1 }))).toBe("最近一分钟");
    expect(periodText(LIMITS[1]!)).toBe("今天");
  });
});

describe("throttle_changed", () => {
  const providers = [{ name: "anthropic" }, { name: "openrouter", throttle: null }] as ProviderView[];

  it("按事件换上那一家的状态；空 = 又可以发了", () => {
    const th: Throttle = { kind: "rate_limited", until_ms: NOW + 30_000 };
    let overlay = applyThrottleEvent(new Map(), {
      kind: "throttle_changed",
      id: 1,
      provider: "anthropic",
      throttle: th,
      at_ms: NOW,
    });
    let out = withThrottles(providers, overlay);
    expect(out[0]?.throttle).toEqual(th);
    // 没改的那一家是原来的对象
    expect(out[1]).toBe(providers[1]);
    overlay = applyThrottleEvent(overlay, { kind: "throttle_changed", id: 2, provider: "anthropic", throttle: null, at_ms: NOW });
    out = withThrottles(providers, overlay);
    expect(out[0]?.throttle).toBeNull();
  });

  it("别的事件、没有改动：原样返回同一个对象", () => {
    const empty = new Map<string, Throttle | null>();
    expect(applyThrottleEvent(empty, { kind: "models_changed", id: 1, provider: "anthropic", at_ms: NOW })).toBe(empty);
    expect(withThrottles(providers, empty)).toBe(providers);
  });
});

describe("尝试链里收到 429 的那一跳", () => {
  it("写暂停了多久", () => {
    expect(pausedText(429, 30_000)).toBe("429 · 暂停 30 秒");
    expect(pausedText(null, 70_000)).toBe("429 · 暂停 1 分 10 秒");
    expect(pausedText(429, null)).toBeNull();
    setLang("en");
    expect(pausedText(429, 5_000)).toBe("429 · Paused 5 s");
  });
});
