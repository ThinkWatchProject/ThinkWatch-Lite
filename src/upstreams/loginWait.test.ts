import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreEvent, LoginStatus } from "@/types";
import { waitForLogin, type LoginResult } from "./loginWait";

type Status = LoginResult & { account?: string | null };

/** 一条 core 事件的通道：测试往里推事件 */
function channel() {
  const subs = new Set<(ev: CoreEvent) => void>();
  return {
    listen: (on: (ev: CoreEvent) => void) => {
      subs.add(on);
      return () => subs.delete(on);
    },
    finished(login: string, status: LoginStatus, provider: string | null = null) {
      const ev = { kind: "login_finished", id: 1, login, status, provider, error: null, at_ms: 0 } as CoreEvent;
      for (const f of subs) f(ev);
    },
    get size() {
      return subs.size;
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe("等账号登录的结果", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("收到事件就问一次状态，按状态收尾（状态里才有登上的账号）", async () => {
    const ch = channel();
    const fetchStatus = vi.fn(async (id: string): Promise<Status> => ({ id, status: "done", provider: "chatgpt", account: "dev@example.com" }));
    const settled: Status[] = [];
    waitForLogin({ login: "L1", fetchStatus, onSettled: (s) => settled.push(s), listen: ch.listen });
    ch.finished("L1", "done", "chatgpt");
    await flush();
    expect(fetchStatus).toHaveBeenCalledWith("L1");
    expect(settled).toEqual([{ id: "L1", status: "done", provider: "chatgpt", account: "dev@example.com" }]);
  });

  it("事件到了、状态问不到：按事件收尾", async () => {
    const ch = channel();
    const settled: Status[] = [];
    waitForLogin<Status>({
      login: "L1",
      fetchStatus: () => Promise.reject(new Error("connection reset")),
      onSettled: (s) => settled.push(s),
      listen: ch.listen,
    });
    ch.finished("L1", "expired");
    await flush();
    expect(settled).toEqual([{ id: "L1", status: "expired", provider: null, error: null }]);
  });

  it("别的登录的事件不理", async () => {
    const ch = channel();
    const fetchStatus = vi.fn(async (id: string): Promise<Status> => ({ id, status: "done" }));
    const onSettled = vi.fn();
    waitForLogin({ login: "L1", fetchStatus, onSettled, listen: ch.listen });
    ch.finished("L0", "done");
    await flush();
    expect(fetchStatus).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("事件漏了：轮询问到结果也收尾；pending 不算结果，问不通下一轮再问", async () => {
    const ch = channel();
    const answers: (Status | Error)[] = [
      { id: "L1", status: "pending" },
      new Error("connection reset"),
      { id: "L1", status: "failed", error: { code: "x", args: {}, text: "denied" } },
    ];
    const fetchStatus = vi.fn(async (): Promise<Status> => {
      const a = answers.shift()!;
      if (a instanceof Error) throw a;
      return a;
    });
    const settled: Status[] = [];
    waitForLogin({ login: "L1", fetchStatus, onSettled: (s) => settled.push(s), listen: ch.listen, pollMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled.map((s) => s.status)).toEqual(["failed"]);
  });

  it("事件和轮询都报了结果：只收一次尾", async () => {
    const ch = channel();
    const fetchStatus = vi.fn(async (id: string): Promise<Status> => ({ id, status: "done", provider: "zai" }));
    const onSettled = vi.fn();
    waitForLogin({ login: "L1", fetchStatus, onSettled, listen: ch.listen, pollMs: 2_000 });
    ch.finished("L1", "done", "zai");
    await vi.advanceTimersByTimeAsync(6_000);
    ch.finished("L1", "done", "zai");
    await flush();
    expect(onSettled).toHaveBeenCalledTimes(1);
  });

  it("停下之后：不再问、不再回调，在路上的回答落地了也不管，事件退订", async () => {
    const ch = channel();
    let answer: (s: Status) => void = () => {};
    const fetchStatus = vi.fn(() => new Promise<Status>((r) => (answer = r)));
    const onSettled = vi.fn();
    const stop = waitForLogin({ login: "L1", fetchStatus, onSettled, listen: ch.listen, pollMs: 2_000 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    stop();
    answer({ id: "L1", status: "done", provider: "chatgpt" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(onSettled).not.toHaveBeenCalled();
    expect(ch.size).toBe(0);
  });
});
