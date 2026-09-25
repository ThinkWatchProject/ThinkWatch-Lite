import { describe, expect, it } from "vitest";
import { setLang, textOf } from "@/i18n";
import type { RouteHits } from "@/types";
import { routeDialogText } from "./RouteDialog.i18n";
import { routingText } from "./routing.i18n";
import { hitsWindow, spanSince, type HitSpan } from "./useRouteHits";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 8, 25, 8, 42);

describe("命中数说的是多长一段", () => {
  const routes: RouteHits[] = [{ route: "default", requests: 3, failed: 0, last_ms: NOW - MIN, rules: [] }];
  const from = NOW - 7 * DAY - 42 * MIN;

  it("还没读到是骨架，读不到是读不到", () => {
    expect(hitsWindow(undefined, true, NOW)).toEqual({ state: "loading" });
    expect(hitsWindow(undefined, false, NOW)).toEqual({ state: "unknown" });
  });

  it("一条请求记录都没有：什么都不数，不是整段都没命中", () => {
    const w = hitsWindow({ from, days: 7, stats: { covered_since_ms: null, routes: [] } }, false, NOW);
    expect(w).toEqual({ state: "empty" });
  });

  it("记录从窗口起点就有：说窗口的天数", () => {
    const w = hitsWindow({ from, days: 7, stats: { covered_since_ms: from, routes } }, false, NOW);
    expect(w).toEqual({ state: "counted", span: { n: 7, unit: "day" }, routes });
  });

  it("记录开始得晚：说记录开始以来的那一段", () => {
    const w = hitsWindow({ from, days: 7, stats: { covered_since_ms: NOW - 5 * HOUR - 40 * MIN, routes } }, false, NOW);
    expect(w).toEqual({ state: "counted", span: { n: 5, unit: "hour" }, routes });
  });

  it("往短里说：零头不算，不到一小时按分钟，两天以内按小时", () => {
    expect(spanSince(NOW - 20 * 1000, NOW)).toEqual({ n: 1, unit: "minute" });
    expect(spanSince(NOW - 59 * MIN - 59_000, NOW)).toEqual({ n: 59, unit: "minute" });
    expect(spanSince(NOW - HOUR, NOW)).toEqual({ n: 1, unit: "hour" });
    expect(spanSince(NOW - 47 * HOUR - 59 * MIN, NOW)).toEqual({ n: 47, unit: "hour" });
    expect(spanSince(NOW - 2 * DAY, NOW)).toEqual({ n: 2, unit: "day" });
    expect(spanSince(NOW - 6 * DAY - 23 * HOUR, NOW)).toEqual({ n: 6, unit: "day" });
    // 本机的钟比记录的起点还早一点：说最短的那一段，不说「0 分钟」
    expect(spanSince(NOW + 5_000, NOW)).toEqual({ n: 1, unit: "minute" });
  });
});

describe("命中数的说法", () => {
  const week: HitSpan = { n: 7, unit: "day" };
  const hours: HitSpan = { n: 5, unit: "hour" };
  const minute: HitSpan = { n: 1, unit: "minute" };

  it("中文：整个窗口照旧写天数，记录开始得晚时写实际那一段", () => {
    setLang("zh");
    const rt = textOf(routingText);
    const dt = textOf(routeDialogText);
    expect(rt.hitsIn(week)).toBe("7 天命中");
    expect(rt.hitsIn(hours)).toBe("5 小时命中");
    expect(rt.requestsIn(hours, 1234)).toBe("5 小时 1,234 次请求");
    expect(rt.noRequestsIn(minute)).toBe("1 分钟内无请求");
    expect(dt.hits(week, 12)).toBe("7 天命中 12 次");
    expect(dt.noHits(hours)).toBe("5 小时内未命中");
  });

  it("英文：单数不加 s，表头是复合形容词", () => {
    setLang("en");
    const rt = textOf(routingText);
    const dt = textOf(routeDialogText);
    expect(rt.hitsIn(week)).toBe("7-day hits");
    expect(rt.hitsIn(hours)).toBe("5-hour hits");
    expect(rt.requestsIn(minute, 1)).toBe("1 request in 1 minute");
    expect(rt.noRequestsIn(hours)).toBe("No requests in 5 hours");
    expect(dt.hits({ n: 1, unit: "day" }, 3)).toBe("3 hits in 1 day");
    expect(dt.noHits(minute)).toBe("No hits in 1 minute");
    setLang("zh");
  });
});
