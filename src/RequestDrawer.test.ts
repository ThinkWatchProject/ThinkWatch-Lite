import { describe, expect, it } from "vitest";
import type { ReplayQuote } from "./types";
import { quoteFor } from "./RequestDrawer";

/** 给某一家报的价 */
const quote = (provider: string): ReplayQuote => ({
  model: "claude-sonnet-5",
  provider,
  body_bytes: 48_000,
  input_tokens: 12_000,
  cost_micros: 41_000,
  billing: "per-token",
  will_redact: false,
  pricing_date: "2026-09-20",
});

/**
 * 重放会产生费用，所以先报价、再确认。**确认发出去的必须是报过价的那一家。**
 *
 * 报价在路上的时候换了下拉框（或者上游列表刷新、默认的那一家换了），回来的是上一家的
 * 报价：原来它照样显示，点「确认发送」发的却是此刻选着的那一家 —— 一家没报过价的。
 */
describe("重放的报价", () => {
  it("报的是选着的那一家：可以确认", () => {
    const q = quote("official");
    expect(quoteFor(q, "official")).toBe(q);
  });

  it("报价回来时已经换了一家：这份作废，要重新报价", () => {
    expect(quoteFor(quote("relay"), "official")).toBeNull();
  });

  it("还没报价：没有可确认的", () => {
    expect(quoteFor(null, "official")).toBeNull();
  });
});
