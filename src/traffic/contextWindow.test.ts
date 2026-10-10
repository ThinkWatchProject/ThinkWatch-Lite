import { describe, expect, it } from "vitest";
import { contextFill, contextShares } from "./contextWindow";

describe("contextFill", () => {
  it("fills the bar with input plus cache reads over the window and draws the cached share", () => {
    const f = contextFill({ input_tokens: 50_000, cache_read_tokens: 78_000, context_window: 200_000 });
    expect(f).toEqual({
      used: 128_000,
      cached: 78_000,
      window: 200_000,
      fill: 0.64,
      cachedFill: 0.39,
      cachedPct: 61,
      text: "128k / 200k",
    });
  });

  it("writes the tokens alone and draws no bar when the window is unknown", () => {
    const f = contextFill({ input_tokens: 1_234, cache_read_tokens: null, context_window: null });
    expect(f).toMatchObject({ used: 1_234, cached: null, window: null, fill: null, cachedFill: null, cachedPct: 0, text: "1.2k" });
  });

  it("is nothing without usage", () => {
    expect(contextFill({ input_tokens: null, cache_read_tokens: null, context_window: 200_000 })).toBeNull();
    expect(contextFill({ input_tokens: null, cache_read_tokens: 10, context_window: null })).toBeNull();
  });

  it("caps the fill at the window and keeps the real numbers in the text", () => {
    const f = contextFill({ input_tokens: 210_000, cache_read_tokens: 20_000, context_window: 200_000 });
    expect(f?.fill).toBe(1);
    expect(f?.cachedFill).toBe(0.1);
    expect(f?.text).toBe("230k / 200k");
  });

  it("treats a zero window as unknown and a zero turn as empty", () => {
    expect(contextFill({ input_tokens: 10, cache_read_tokens: 0, context_window: 0 })?.window).toBeNull();
    expect(contextFill({ input_tokens: 0, cache_read_tokens: 0, context_window: 200_000 })).toMatchObject({
      used: 0,
      fill: 0,
      cachedPct: 0,
      text: "0 / 200k",
    });
  });
});

describe("contextShares", () => {
  it("shares the four parts over core's total", () => {
    const s = contextShares({ system: 8_000, tools: 22_000, history: 95_000, last_user: 5_000, total: 130_000 });
    expect(s.map((x) => [x.kind, x.tokens, x.pct])).toEqual([
      ["system", 8_000, 6],
      ["tools", 22_000, 17],
      ["history", 95_000, 73],
      ["last_user", 5_000, 4],
    ]);
  });

  it("writes 0 for every share of an empty body", () => {
    expect(contextShares({ system: 0, tools: 0, history: 0, last_user: 0, total: 0 }).every((x) => x.pct === 0)).toBe(true);
  });
});
