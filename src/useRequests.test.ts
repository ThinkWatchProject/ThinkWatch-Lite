import { describe, expect, it } from "vitest";
import type { HistoryRow, RequestRow } from "./types";
import { LIST_LIMIT, historyQuery, mergeHistory, rowFromHistory, settleAwaiting, type Awaiting } from "./useRequests";

function stored(over: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: 1,
    at_ms: 1_000_000,
    client: "claude-code",
    provider: "official",
    model: "claude-sonnet-4-5",
    path: "/v1/messages",
    status: 200,
    ttfb_ms: 300,
    ttft_ms: 800,
    duration_ms: 4_000,
    tokens_per_sec: 6,
    bytes: 1_234,
    input_tokens: 100,
    output_tokens: 20,
    cache_read_tokens: null,
    cache_write_tokens: null,
    cost_micros: 1_500,
    cost_estimated: false,
    error: null,
    local: false,
    cancelled: false,
    billing: "per-token",
    plugin_changed: false,
    ...over,
  };
}

describe("对账问库要什么", () => {
  it("开窗、事件流说不全的时候读整份", () => {
    expect(historyQuery(true, [])).toEqual({ limit: LIST_LIMIT });
    expect(historyQuery(true, [{ at: 5, misses: 0 }])).toEqual({ limit: LIST_LIMIT });
  });

  it("平时只读落地的那一段：从等着的几行里最早开始的那一刻起", () => {
    const waiting: Awaiting[] = [
      { at: 9_000, misses: 0 },
      // 跑了很久才落地的长请求：开始得早，也要在这一段里
      { at: 2_000, misses: 1 },
      { at: 9_500, misses: 0 },
    ];
    expect(historyQuery(false, waiting)).toEqual({ limit: LIST_LIMIT, from_ms: 2_000 });
  });

  it("没什么要对的就不问", () => {
    expect(historyQuery(false, [])).toBeNull();
  });
});

describe("对完账，哪些不再等", () => {
  it("库里有了的不再等，没对上的下次接着等", () => {
    const awaiting = new Map<number, Awaiting>([
      [1, { at: 1, misses: 0 }],
      [2, { at: 2, misses: 0 }],
    ]);
    settleAwaiting(awaiting, [...awaiting], new Set([1]));
    expect([...awaiting.keys()]).toEqual([2]);
    expect(awaiting.get(2)?.misses).toBe(1);
  });

  it("连着三次没对上就不等了：库没在记的话不能每次都从它读起", () => {
    const awaiting = new Map<number, Awaiting>([[7, { at: 1, misses: 0 }]]);
    for (let i = 0; i < 2; i++) settleAwaiting(awaiting, [...awaiting], new Set());
    expect(awaiting.has(7)).toBe(true);
    settleAwaiting(awaiting, [...awaiting], new Set());
    expect(awaiting.has(7)).toBe(false);
  });

  it("问的这会儿又落地的不动", () => {
    const awaiting = new Map<number, Awaiting>([[1, { at: 1, misses: 0 }]]);
    const asked = [...awaiting];
    // 读的这会儿又来了一条，同一个号又落地了一次
    awaiting.set(2, { at: 2, misses: 0 });
    awaiting.set(1, { at: 3, misses: 0 });
    settleAwaiting(awaiting, asked, new Set([1]));
    expect(awaiting.get(1)).toEqual({ at: 3, misses: 0 });
    expect(awaiting.get(2)).toEqual({ at: 2, misses: 0 });
  });
});

describe("对账不抄没变的行", () => {
  it("库里没有新东西的行，还是原来那个对象", () => {
    const rows = new Map<number, RequestRow>([[1, rowFromHistory(stored())]]);
    const before = rows.get(1);
    expect(mergeHistory(rows, [stored()])).toBe(false);
    expect(rows.get(1)).toBe(before);
  });

  it("变了的行换新对象，只改变了的那几项", () => {
    const rows = new Map<number, RequestRow>([[1, rowFromHistory(stored({ cost_micros: null }))]]);
    const before = rows.get(1)!;
    expect(mergeHistory(rows, [stored({ cost_micros: 2_000, cost_estimated: true })])).toBe(true);
    const after = rows.get(1)!;
    expect(after).not.toBe(before);
    expect(after).toEqual({ ...before, costMicros: 2_000, costEstimated: true });
    expect(before.costMicros).toBeUndefined();
  });
});
