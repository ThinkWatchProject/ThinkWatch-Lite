import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveView, RunningView } from "@/types";
import { POLL_MS, pollLive, speedsOf, type Speeds } from "./liveSpeed";

function running(id: number, tokens_per_sec: number | null): RunningView {
  return {
    id,
    client: "default",
    client_hint: null,
    model: "gpt-5",
    provider: "openai",
    at_ms: 0,
    elapsed_ms: 1_000,
    session: null,
    route: "default",
    rule: "catch-all",
    group: null,
    upstream: null,
    tokens_per_sec,
    output_tokens: tokens_per_sec == null ? null : 300,
  };
}

const view = (...running: RunningView[]): LiveView => ({
  running,
  tokens_per_sec: running.length === 0 ? null : running.reduce((a, r) => a + (r.tokens_per_sec ?? 0), 0),
});

/** 在跑的请求此刻多快：core 给什么就是什么，还没开口的不写 */
describe("在跑的请求此刻的速度", () => {
  it("只收有速度的那几条：第一个 token 之前没有，开了口又停下的是 0", () => {
    const s = speedsOf(view(running(1, 42), running(2, null), running(3, 0)));
    expect([...s]).toEqual([
      [1, 42],
      [3, 0],
    ]);
  });
});

/** 一个假的页面：问 core 的那一问、窗口藏没藏，都由测试摆布 */
function harness() {
  let hidden = false;
  let onVis: (() => void) | null = null;
  const seen: Speeds[] = [];
  let answer: () => Promise<LiveView> = async () => view(running(1, 42));
  const ask = vi.fn(() => answer());
  const stop = pollLive({
    ask,
    hidden: () => hidden,
    onVisibility: (f) => {
      onVis = f;
      return () => {
        onVis = null;
      };
    },
    emit: (s) => seen.push(s),
  });
  return {
    ask,
    seen,
    stop,
    hide: (h: boolean) => {
      hidden = h;
      onVis?.();
    },
    answer: (f: () => Promise<LiveView>) => {
      answer = f;
    },
  };
}

describe("每秒问一次 core", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("挂上就问，之后每秒一次；停下就不再问，并清空", async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ask).toHaveBeenCalledTimes(1);
    expect(h.seen.at(-1)?.get(1)).toBe(42);
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(h.ask).toHaveBeenCalledTimes(4);
    h.stop();
    expect(h.seen.at(-1)?.size).toBe(0);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(h.ask).toHaveBeenCalledTimes(4);
  });

  it("窗口藏着时不问，露面时马上问一次", async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(0);
    h.hide(true);
    await vi.advanceTimersByTimeAsync(POLL_MS * 5);
    expect(h.ask).toHaveBeenCalledTimes(1);
    h.hide(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.ask).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.ask).toHaveBeenCalledTimes(3);
    h.stop();
  });

  it("上一问没回来不发下一问；问不到就不写速度", async () => {
    const h = harness();
    await vi.advanceTimersByTimeAsync(0);
    let release: (v: LiveView) => void = () => {};
    h.answer(() => new Promise((r) => (release = r)));
    await vi.advanceTimersByTimeAsync(POLL_MS * 10);
    expect(h.ask).toHaveBeenCalledTimes(2);
    // 卡着的时候窗口藏起又露面：也不另起一问
    h.hide(true);
    h.hide(false);
    expect(h.ask).toHaveBeenCalledTimes(2);
    release(view(running(1, 7)));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.seen.at(-1)?.get(1)).toBe(7);
    h.answer(() => Promise.reject(new Error("core 不在")));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(h.seen.at(-1)?.size).toBe(0);
    h.stop();
  });
});
