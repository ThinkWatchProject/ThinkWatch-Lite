import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ReplayQuote } from "@/types";
import { notSavedTip } from "./Payload";
import { quoteFor } from "./Replay";

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

/**
 * 「内容」那一页正文不在时，「说明」里说为什么。以前一律说「此记录已超过保留期限」——
 * WebSocket、本地应答的请求从来不存正文，期限之内也没有；总量超了从最早的一天删起，写盘
 * 跟不上时丢下的也一样。和对话那一页同一个判断：早于报文的保留期限才说过了期限。
 */
describe("正文不在时的说明", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 9, 2, 12);

  it("早于保留期限的说已超过保留期限", () => {
    expect(notSavedTip(now - 8 * DAY, 7, now, "request")).toBe("此记录已超过保留期限。");
    expect(notSavedTip(now - 8 * DAY, 7, now, "response")).toBe("此记录已超过保留期限。");
  });

  it("期限之内也没有的不说原因：请求、响应各说各的", () => {
    expect(notSavedTip(now - 60_000, 7, now, "request")).toBe("请求正文未保留。");
    expect(notSavedTip(now - 6 * DAY, 7, now, "response")).toBe("响应正文未保留。");
  });

  it("报文留几天不知道（概览没取到）时不说过了期限", () => {
    expect(notSavedTip(now - 30 * DAY, null, now, "response")).toBe("响应正文未保留。");
  });

  it("英文", () => {
    setLang("en");
    expect(notSavedTip(now - 8 * DAY, 7, now, "request")).toBe("This record is past its retention period.");
    expect(notSavedTip(now - DAY, 7, now, "request")).toBe("The request body was not kept.");
    expect(notSavedTip(now - DAY, 7, now, "response")).toBe("The response body was not kept.");
  });
});
