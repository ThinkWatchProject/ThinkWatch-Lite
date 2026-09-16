import { describe, expect, it } from "vitest";
import { applyEvent, type CoreEvent, type RequestRow } from "./types";

/**
 * 事件流缝出来的那一行。
 *
 * **这里断了不会报错。**模型和 token 两列会永远显示「—」，而那看起来
 * 和「上游没报用量」一模一样 —— 没有任何东西会提示是镜像少了个字段。
 * 手抄的类型镜像最容易在这上面出问题，所以这几条盯着它。
 */
function started(over: Partial<Extract<CoreEvent, { kind: "request_started" }>> = {}) {
  return {
    kind: "request_started",
    id: 1,
    client: "claude-code",
    provider: "relay",
    model: "claude-sonnet-4-5",
    method: "POST",
    path: "/v1/messages",
    at_ms: 1_000_000,
    ...over,
  } satisfies CoreEvent;
}

describe("从事件缝出一行", () => {
  it("开始就带着模型", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    expect(rows.get(1)?.model).toBe("claude-sonnet-4-5");
  });

  /** 老记录没有这个字段，core 补的是空串 —— 空串不是一个模型名 */
  it("模型是空串时当作不知道", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started({ model: "" }));
    expect(rows.get(1)?.model).toBeUndefined();
  });

  it("跑完之后接上用量", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, {
      kind: "request_finished",
      id: 1,
      status: 200,
      bytes: 4_096,
      duration_ms: 1_827,
      usage: { input: 2_345, output: 463, cache_read: 0, cache_write: 0 },
    });
    expect(rows.get(1)?.inputTokens).toBe(2_345);
    expect(rows.get(1)?.outputTokens).toBe(463);
  });

  /**
   * 上游没报用量时**两个字段都不填**。填 0 的话，表上会出现一行
   * `0→0`，而那说的是「这次没用 token」—— 一件没有发生过的事。
   */
  it("上游没报用量就不填，不是填零", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, {
      kind: "request_finished",
      id: 1,
      status: 200,
      bytes: 4_096,
      duration_ms: 1_827,
    });
    expect(rows.get(1)?.inputTokens).toBeUndefined();
    expect(rows.get(1)?.outputTokens).toBeUndefined();
  });

  /**
   * 价钱**不在事件流里** —— 它是存储层落库时按价目表算的。刚跑完的
   * 那一行必然没有金额，几秒后由 useRequests 回库里对账补上。
   */
  it("事件流给不出金额", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, {
      kind: "request_finished",
      id: 1,
      status: 200,
      bytes: 1,
      duration_ms: 1,
      usage: { input: 1, output: 1, cache_read: 0, cache_write: 0 },
    });
    expect(rows.get(1)?.costMicros).toBeUndefined();
  });

  /**
   * 客户端先断开了（Claude Code 里按 Esc）。**这一行不能停在「进行中」**，
   * 也不能算成失败 —— 上游已经为它计了费，到断开为止的用量要接上。
   */
  it("客户端取消的那一行结束于已取消，并接上到断开为止的用量", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, { kind: "request_headers", id: 1, status: 200, ttfb_ms: 900 });
    applyEvent(rows, {
      kind: "request_cancelled",
      id: 1,
      status: 200,
      bytes: 312,
      duration_ms: 2_500,
      usage: { input: 100_000, output: 1, cache_read: 0, cache_write: 0 },
    });
    const r = rows.get(1);
    expect(r?.state).toBe("cancelled");
    expect(r?.error).toBeUndefined();
    expect(r?.status).toBe(200);
    expect(r?.durationMs).toBe(2_500);
    expect(r?.inputTokens).toBe(100_000);
    expect(r?.outputTokens).toBe(1);
  });

  /** 第一帧之前就断开的，手里没有用量。**不填 0** —— 那说的是「没用 token」 */
  it("断开时还没有用量就不填", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, {
      kind: "request_cancelled",
      id: 1,
      status: 200,
      bytes: 0,
      duration_ms: 400,
    });
    expect(rows.get(1)?.state).toBe("cancelled");
    expect(rows.get(1)?.inputTokens).toBeUndefined();
    expect(rows.get(1)?.outputTokens).toBeUndefined();
  });
});
