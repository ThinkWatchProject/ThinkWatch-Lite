import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { KeyLimitView } from "@/types";
import {
  cleanEvery,
  cleanMax,
  everyOf,
  inputOfView,
  inputsOf,
  limitPhrase,
  limitProblems,
  limitRow,
  maxText,
  newRow,
  nextReset,
  parseMax,
  periodText,
  resetText,
  rowsOf,
  usageOf,
  type LimitRow,
} from "./limits";

const view = (x: Partial<KeyLimitView> & Pick<KeyLimitView, "per" | "measure" | "max">): KeyLimitView => ({
  every: 1,
  cache_reads: false,
  used: 0,
  resets_at_ms: null,
  reached: false,
  ...x,
});

const row = (x: Partial<Omit<LimitRow, "id">>): LimitRow =>
  limitRow({ per: "day", every: "1", measure: "cost", max: "5", cacheReads: false, ...x });

afterEach(() => setLang("zh"));

describe("用量上限的一行", () => {
  it("费用在 core 那边是微分，输入框里是美元，来回不走样", () => {
    expect(maxText("cost", 5_000_000)).toBe("5.00");
    expect(maxText("cost", 5_500_000)).toBe("5.50");
    expect(maxText("cost", 125_000)).toBe("0.125");
    expect(maxText("cost", 50_000_000)).toBe("50.00");
    expect(maxText("cost", 1)).toBe("0.000001");
    expect(maxText("tokens", 1_000_000)).toBe("1000000");
    expect(parseMax("cost", "5.5")).toBe(5_500_000);
    expect(parseMax("cost", "0.125")).toBe(125_000);
    expect(parseMax("cost", ".5")).toBe(500_000);
    expect(parseMax("cost", "5.")).toBe(5_000_000);
    expect(parseMax("requests", "30")).toBe(30);
  });

  it("不是正数的上限不收", () => {
    for (const bad of ["", " ", "0", "0.0", ".", "0.0000001"]) expect(parseMax("cost", bad), bad).toBeNull();
    for (const bad of ["", "0", "1.5", "-3"]) expect(parseMax("requests", bad), bad).toBeNull();
  });

  it("输入框只留得下数字，费用多一个小数点、到微分为止", () => {
    expect(cleanMax("requests", "1,000 次")).toBe("1000");
    expect(cleanMax("cost", "$5.5.0")).toBe("5.50");
    expect(cleanMax("cost", "0.12345678")).toBe("0.123456");
  });

  it("打开时照 core 给的，保存时原样交回去", () => {
    const views = [
      view({ per: "minute", measure: "requests", max: 30 }),
      view({ per: "day", measure: "cost", max: 5_000_000 }),
      view({ per: "week", measure: "tokens", max: 900_000, cache_reads: true }),
    ];
    const rows = rowsOf(views);
    expect(rows.map((r) => r.max)).toEqual(["30", "5.00", "900000"]);
    expect(inputsOf(rows)).toEqual(views.map(inputOfView));
  });

  it("缓存读取只跟着 token 上限走", () => {
    expect(inputsOf([row({ measure: "requests", max: "3", cacheReads: true })])).toEqual([
      { per: "day", every: 1, measure: "requests", max: 3, cache_reads: false },
    ]);
  });

  it("每 N 分钟 / 小时：N 来回不走样；天、周、月一直是 1", () => {
    const views = [
      view({ per: "minute", every: 5, measure: "tokens", max: 10_000_000 }),
      view({ per: "hour", every: 24, measure: "requests", max: 500 }),
      view({ per: "day", measure: "cost", max: 5_000_000 }),
    ];
    const rows = rowsOf(views);
    expect(rows.map((r) => r.every)).toEqual(["5", "24", "1"]);
    expect(inputsOf(rows)).toEqual(views.map(inputOfView));
    // 从分钟换成天，原来写的 N 不跟过去
    expect(inputsOf([row({ per: "day", every: "5", max: "3" })])[0]!.every).toBe(1);
  });

  it("N 的范围：分钟 1–60，小时 1–24", () => {
    expect(everyOf("minute", "60")).toBe(60);
    expect(everyOf("minute", "61")).toBeNull();
    expect(everyOf("hour", "24")).toBe(24);
    expect(everyOf("hour", "25")).toBeNull();
    for (const bad of ["", "0", " "]) expect(everyOf("minute", bad), bad).toBeNull();
    expect(everyOf("week", "")).toBe(1);
    expect(cleanEvery("5 分钟")).toBe("5");
    expect(cleanEvery("1234")).toBe("12");
  });
});

describe("当场校验", () => {
  it("和 core 一样：要填、要大于 0、同一种不能有两条", () => {
    const rows = [
      row({ max: "" }),
      row({ per: "hour", max: "0" }),
      row({ per: "week", max: "3" }),
      row({ per: "week", max: "8" }),
    ];
    const p = limitProblems(rows, 90);
    expect(rows.map((r) => p.get(r.id) ?? null)).toEqual(["required", "notPositive", null, "duplicate"]);
  });

  it("算不算缓存读取不一样，就是两条", () => {
    const rows = [
      row({ measure: "tokens", max: "100" }),
      row({ measure: "tokens", max: "900", cacheReads: true }),
      row({ measure: "tokens", max: "900", cacheReads: true }),
    ];
    const p = limitProblems(rows, 90);
    expect(rows.map((r) => p.get(r.id) ?? null)).toEqual([null, null, "duplicate"]);
  });

  it("天、周、月的上限要求记录留够 1、7、31 天；分钟、小时不要；不知道留几天就不拦", () => {
    for (const [per, need] of [["day", 1], ["week", 7], ["month", 31]] as const) {
      const rows = [row({ per })];
      expect(limitProblems(rows, need - 1).get(rows[0]!.id)).toBe("retention");
      expect(limitProblems(rows, need).size).toBe(0);
      expect(limitProblems(rows, null).size).toBe(0);
    }
    expect(limitProblems([row({ per: "minute" }), row({ per: "hour" })], 0).size).toBe(0);
  });

  it("费用上限至少 $0.01，和 core 一样排在重复之前", () => {
    const rows = [row({ max: "0.009999" }), row({ per: "week", max: "0.01" }), row({ per: "week", max: "0.001" })];
    const p = limitProblems(rows, 90);
    expect(rows.map((r) => p.get(r.id) ?? null)).toEqual(["costTooSmall", null, "costTooSmall"]);
    expect(limitProblems([row({ measure: "requests", max: "1" })], 90).size).toBe(0);
  });

  it("N 不对的那一行先说 N；N 不同就不算重复", () => {
    const rows = [
      row({ per: "minute", every: "0", max: "" }),
      row({ per: "hour", every: "25" }),
      row({ per: "minute", every: "5", measure: "tokens", max: "100" }),
      row({ per: "minute", every: "1", measure: "tokens", max: "100" }),
      row({ per: "minute", every: "05", measure: "tokens", max: "100" }),
    ];
    const p = limitProblems(rows, 90);
    expect(rows.map((r) => p.get(r.id) ?? null)).toEqual(["every", "every", null, null, "duplicate"]);
  });

  it("加一行先给还没有的那一种，不一加上就重复", () => {
    const first = newRow([]);
    expect([first.per, first.measure]).toEqual(["day", "cost"]);
    const second = newRow([first]);
    expect([second.per, second.measure]).toEqual(["month", "cost"]);
  });
});

describe("用量", () => {
  it("按周期、量和缓存读取认 core 给的那一条", () => {
    const views = [
      view({ per: "day", measure: "tokens", max: 100, used: 7 }),
      view({ per: "day", measure: "tokens", max: 900, used: 70, cache_reads: true }),
    ];
    expect(usageOf(row({ measure: "tokens", cacheReads: true }), views)?.used).toBe(70);
    expect(usageOf(row({ measure: "tokens" }), views)?.used).toBe(7);
    // 新加的、改成了别的周期的，core 还没数过
    expect(usageOf(row({ per: "week", measure: "tokens" }), views)).toBeUndefined();
  });

  it("每 N 分钟的用量按 N 认", () => {
    const views = [
      view({ per: "minute", every: 5, measure: "tokens", max: 100, used: 50 }),
      view({ per: "minute", measure: "tokens", max: 100, used: 7 }),
    ];
    expect(usageOf(row({ per: "minute", every: "5", measure: "tokens" }), views)?.used).toBe(50);
    expect(usageOf(row({ per: "minute", measure: "tokens" }), views)?.used).toBe(7);
    expect(usageOf(row({ per: "minute", every: "10", measure: "tokens" }), views)).toBeUndefined();
    expect(periodText("minute", 1)).toBe("最近一分钟");
    expect(periodText("minute", 5)).toBe("最近 5 分钟");
    expect(periodText("day", 1)).toBe("今天");
    setLang("en");
    expect(periodText("hour", 3)).toBe("Last 3 hours");
    expect(periodText("hour", 1)).toBe("Last hour");
  });

  it("一条上限说成一句", () => {
    expect(limitPhrase(view({ per: "day", measure: "cost", max: 5_000_000 }))).toBe("每天 $5.00 费用");
    expect(limitPhrase(view({ per: "minute", measure: "requests", max: 30 }))).toBe("每分钟 30 次请求");
    expect(limitPhrase(view({ per: "minute", every: 5, measure: "tokens", max: 10_000_000 }))).toBe(
      "每 5 分钟 10,000,000 token",
    );
    expect(limitPhrase(view({ per: "week", measure: "tokens", max: 1_000_000, cache_reads: true }))).toBe(
      "每周 1,000,000 token（含缓存读取）",
    );
    setLang("en");
    expect(limitPhrase(view({ per: "day", measure: "cost", max: 5_000_000 }))).toBe("$5.00 per day");
    expect(limitPhrase(view({ per: "hour", every: 2, measure: "requests", max: 100 }))).toBe("100 requests per 2 hours");
    expect(limitPhrase(view({ per: "week", measure: "tokens", max: 1_000_000, cache_reads: true }))).toBe(
      "1,000,000 tokens per week (cache reads included)",
    );
  });

  it("一天之内的重置只写钟点，再远带上日期", () => {
    const now = new Date(2026, 9, 5, 17, 30).getTime();
    const midnight = new Date(2026, 9, 6, 0, 0).getTime();
    const monday = new Date(2026, 9, 12, 0, 0).getTime();
    expect(resetText(midnight, now)).toBe("00:00 重置");
    expect(resetText(monday, now)).toBe("10月12日 00:00 重置");
    setLang("en");
    expect(resetText(midnight, now)).toBe("resets at 00:00");
    expect(resetText(monday, now)).toBe("resets Oct 12 at 00:00");
  });

  it("最早要重新算的那一刻：只有天、周、月有", () => {
    expect(nextReset(undefined)).toBeNull();
    expect(
      nextReset([
        { limits: [view({ per: "minute", measure: "requests", max: 3 })] },
        { limits: [view({ per: "month", measure: "cost", max: 9, resets_at_ms: 300 })] },
        { limits: [view({ per: "day", measure: "cost", max: 9, resets_at_ms: 200 })] },
      ]),
    ).toBe(200);
  });
});
