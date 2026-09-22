import { describe, expect, it } from "vitest";
import {
  applyEvent,
  applyInFlight,
  interruptInFlight,
  type CoreEvent,
  type RequestRow,
} from "./types";
import { coreText, plain } from "@/i18n/core.i18n";
import { setLang } from "@/i18n";

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
    billing: "per-token",
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

  /** WebSocket 这类认不出模型的请求，core 发的是空串 —— 空串不是一个模型名 */
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
      model: "claude-sonnet-4-5",
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
      model: "claude-sonnet-4-5",
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
      model: "claude-sonnet-4-5",
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
      model: "claude-sonnet-4-5",
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
      model: "claude-sonnet-4-5",
      status: 200,
      bytes: 0,
      duration_ms: 400,
    });
    expect(rows.get(1)?.state).toBe("cancelled");
    expect(rows.get(1)?.inputTokens).toBeUndefined();
    expect(rows.get(1)?.outputTokens).toBeUndefined();
  });

  /** 响应头还没到客户端就断开了。**没有状态码**，那一格就留空，不是 0 */
  it("响应头之前的取消没有状态码", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, {
      kind: "request_cancelled",
      id: 1,
      model: "claude-sonnet-4-5",
      bytes: 0,
      duration_ms: 12_000,
    });
    expect(rows.get(1)?.state).toBe("cancelled");
    expect(rows.get(1)?.status).toBeUndefined();
    expect(rows.get(1)?.durationMs).toBe(12_000);
  });

  /**
   * 流断在中间、或者被防火墙切断。**上游已经为这些 token 计了费**，这一行
   * 要把用量接上，同时照样是失败。
   */
  it("断在中间的失败接上它的用量", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, { kind: "request_headers", id: 1, status: 200, ttfb_ms: 900 });
    applyEvent(rows, {
      kind: "request_failed",
      id: 1,
      model: "claude-sonnet-4-5",
      source: "denied",
      message: plain("流中断：已切断"),
      bytes: 480,
      duration_ms: 3_100,
      usage: { input: 5_000, output: 1, cache_read: 0, cache_write: 0 },
    });
    const r = rows.get(1);
    expect(r?.state).toBe("failed");
    expect(r?.error?.text).toBe("流中断：已切断");
    expect(r?.inputTokens).toBe(5_000);
    expect(r?.durationMs).toBe(3_100);
    expect(r?.bytes).toBe(480);
  });

  /** 响应头之前就失败的：有耗时，**没有用量就不填** */
  it("响应头之前的失败只有耗时", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started());
    applyEvent(rows, {
      kind: "request_failed",
      id: 1,
      model: "claude-sonnet-4-5",
      source: "rate_limited",
      message: plain("`relay` 限流了"),
      duration_ms: 20_000,
    });
    const r = rows.get(1);
    expect(r?.state).toBe("failed");
    expect(r?.durationMs).toBe(20_000);
    expect(r?.inputTokens).toBeUndefined();
    expect(r?.bytes).toBeUndefined();
  });
});

/**
 * 开窗之前就在跑的请求：从 core 的快照补成「进行中」的行。
 *
 * **快照到这边时已经晚了一截。**这几条盯的是合的方向：中途结束的不能补
 * （补进去就永远等不到结局），中途开始的不能再套一遍（会把已经到了的响应
 * 头冲掉）。
 */
describe("用快照补上进行中的行", () => {
  const seen = (started: number[] = [], ended: number[] = []) => ({
    started: new Set(started),
    ended: new Set(ended),
  });

  it("没见过开始事件的请求补成进行中", () => {
    const rows = new Map<number, RequestRow>();
    expect(applyInFlight(rows, [started({ id: 7 })], seen())).toBe(true);
    expect(rows.get(7)?.state).toBe("in_flight");
    expect(rows.get(7)?.model).toBe("claude-sonnet-4-5");
  });

  it("快照在路上时结束了的不补", () => {
    const rows = new Map<number, RequestRow>();
    expect(applyInFlight(rows, [started({ id: 7 })], seen([], [7]))).toBe(false);
    expect(rows.has(7)).toBe(false);
  });

  /** 事件流已经建了这一行，响应头也到了。再套一遍开始事件，状态码就没了 */
  it("事件流已经在跑的那一行不动", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started({ id: 7 }));
    applyEvent(rows, { kind: "request_headers", id: 7, status: 200, ttfb_ms: 812 });
    expect(applyInFlight(rows, [started({ id: 7 })], seen([7]))).toBe(false);
    expect(rows.get(7)?.status).toBe(200);
    // 开始事件还在缓冲里、这一行还没建出来的，同样不补 —— 缓冲落地时会建
    expect(applyInFlight(new Map(), [started({ id: 8 })], seen([8]))).toBe(false);
  });

  /**
   * core 重启后接着库里最大的号往下发，没落库的号会被重新用上。**新请求
   * 顶掉上一次 core 留下的那行**，而不是因为「这个 id 已经有一行」被跳过。
   */
  it("同号的旧行不在跑，就被新请求顶掉", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started({ id: 7, model: "gpt-5.5" }));
    interruptInFlight(rows);
    expect(applyInFlight(rows, [started({ id: 7 })], seen())).toBe(true);
    expect(rows.get(7)?.state).toBe("in_flight");
    expect(rows.get(7)?.model).toBe("claude-sonnet-4-5");
    expect(rows.get(7)?.error).toBeUndefined();
  });
});

/**
 * core 停了：还在跑的行再也等不到结局。**记成失败并写明原因**，结束了的
 * 行一个字都不动。
 */
describe("core 停下时还在跑的行", () => {
  it("只有进行中的行记成中断", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started({ id: 1 }));
    applyEvent(rows, started({ id: 2 }));
    applyEvent(rows, {
      kind: "request_finished",
      id: 2,
      model: "claude-sonnet-4-5",
      status: 200,
      bytes: 10,
      duration_ms: 900,
    });
    expect(interruptInFlight(rows)).toBe(true);
    expect(rows.get(1)?.state).toBe("failed");
    expect(rows.get(2)?.state).toBe("done");
    expect(rows.get(2)?.error).toBeUndefined();
    // 没有在跑的了，再来一次什么都不改
    expect(interruptInFlight(rows)).toBe(false);
  });

  it("原因按界面语言说", () => {
    const rows = new Map<number, RequestRow>();
    applyEvent(rows, started({ id: 1 }));
    interruptInFlight(rows);
    const why = rows.get(1)?.error;
    expect(coreText(why)).toBe("core 在请求完成前停止运行，请求已中断。");
    setLang("en");
    expect(coreText(why)).toBe(
      "The core stopped before the request finished, so the request was cut off.",
    );
  });
});
