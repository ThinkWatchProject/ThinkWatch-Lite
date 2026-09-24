import { describe, expect, it } from "vitest";
import { loadUsage, recentIds, recordUse, usageBoost } from "./usage";

/** 一个内存里的 localStorage */
function memory(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v;
    },
  };
}

const DAY = 24 * 3_600_000;

describe("命令面板的使用记录", () => {
  it("记一次加一，时刻换成最新的", () => {
    const s = memory();
    recordUse("page:keys", 1_000, s);
    const u = recordUse("page:keys", 2_000, s);
    expect(u["page:keys"]).toEqual({ n: 2, at: 2_000 });
    expect(loadUsage(s)["page:keys"]).toEqual({ n: 2, at: 2_000 });
  });

  it("最多记八十条，多了去掉最久没用的", () => {
    const s = memory();
    for (let i = 0; i < 85; i++) recordUse(`action:${i}`, i, s);
    const u = loadUsage(s);
    expect(Object.keys(u)).toHaveLength(80);
    expect(u["action:0"]).toBeUndefined();
    expect(u["action:84"]).toBeDefined();
  });

  it("存的东西坏了、读写抛异常：当作没有记录，照常能用", () => {
    expect(loadUsage(memory({ "tw.palette.usage": "{not json" }))).toEqual({});
    expect(loadUsage(memory({ "tw.palette.usage": JSON.stringify({ a: { n: "x" }, b: null }) }))).toEqual({});
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadUsage(throwing)).toEqual({});
    expect(recordUse("page:keys", 1, throwing)).toEqual({ "page:keys": { n: 1, at: 1 } });
    expect(loadUsage(null)).toEqual({});
  });

  it("最近用过的新的在前", () => {
    const u = { a: { n: 9, at: 1 }, b: { n: 1, at: 3 }, c: { n: 1, at: 2 } };
    expect(recentIds(u, 2)).toEqual(["b", "c"]);
  });

  it("常用的加分有上限，而且随时间淡下去", () => {
    const now = 100 * DAY;
    expect(usageBoost(undefined, now)).toBe(0);
    expect(usageBoost({ n: 10_000, at: now }, now)).toBe(0.08);
    const fresh = usageBoost({ n: 3, at: now }, now);
    const weekOld = usageBoost({ n: 3, at: now - 7 * DAY }, now);
    expect(fresh).toBeGreaterThan(0);
    expect(weekOld).toBeCloseTo(fresh / 2);
  });
});
