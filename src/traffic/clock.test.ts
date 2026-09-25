import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coreNow, noteCoreTime, onTick, resetCoreClock, stopwatch, syncCoreClock } from "./clock";

/**
 * core 的钟。**在跑的请求跑了多久 = core 的现在 − core 的开始时刻**，两个都要是
 * core 的钟：连着另一台机器上的 core 时，拿本机的钟去减，两边差多少就错多少。
 */
describe("core 的时钟", () => {
  beforeEach(() => resetCoreClock());

  it("还没对过钟时不知道 core 的现在", () => {
    expect(coreNow(1_000)).toBeNull();
  });

  /** 快照在问出去和收回来之间的某一刻拍的：按中点算，差不过往返的一半 */
  it("快照按一去一回的中点对", () => {
    // 本机 1000 问出去、1100 收到，core 那一刻是 60_050：core 快了 59 秒
    syncCoreClock(60_050, 1_000, 1_100);
    expect(coreNow(2_000)).toBe(61_000);
  });

  /**
   * core 的钟比本机快一分钟：开始事件的 `at_ms` 在本机看来是「将来」。按本机的钟减，
   * 已跑时长一直是负的（显示成 0）；按 core 的钟减，就是它真的跑了多久。
   */
  it("另一台机器上的 core 钟快了一分钟，已跑时长照样对", () => {
    syncCoreClock(160_000, 100_000, 100_000);
    const started = 160_000 - 12_000; // 快照前 12 秒开始的
    expect(coreNow(100_000)! - started).toBe(12_000);
    expect(coreNow(103_000)! - started).toBe(15_000);
  });

  /** 开始事件收到时，core 的钟至少走到了它的 `at_ms` */
  it("开始事件只把估计往上抬，不往下拉", () => {
    syncCoreClock(10_000, 1_000, 1_000); // core 快 9 秒
    noteCoreTime(12_500, 3_000); // 收到时 core 至少 12_500：快了至少 9.5 秒
    expect(coreNow(3_000)).toBe(12_500);
    noteCoreTime(11_000, 3_000); // 一条在路上走了很久的：不往回拉
    expect(coreNow(3_000)).toBe(12_500);
  });

  it("没有快照时，开始事件也能定出 core 的钟", () => {
    noteCoreTime(50_000, 20_000);
    expect(coreNow(21_000)).toBe(51_000);
  });

  /** 快照是这一刻的实测：之前被开始事件抬上去的估计按它重定 */
  it("新的快照重定，不留之前抬上去的", () => {
    noteCoreTime(50_000, 20_000);
    syncCoreClock(40_000, 20_000, 20_000);
    expect(coreNow(20_000)).toBe(40_000);
  });

  it("换了连接，之前那个 core 的钟作废", () => {
    syncCoreClock(10_000, 1_000, 1_000);
    resetCoreClock();
    expect(coreNow(1_000)).toBeNull();
  });
});

/** 所有显示已跑时长的地方共用一根秒针：没人看就不走 */
describe("秒针", () => {
  afterEach(() => vi.useRealTimers());

  it("有人在看才走，全都摘掉就停；钟重新对过时也重画一次", () => {
    vi.useFakeTimers();
    let a = 0;
    let b = 0;
    const offA = onTick(() => (a += 1));
    const offB = onTick(() => (b += 1));
    vi.advanceTimersByTime(3_000);
    expect([a, b]).toEqual([3, 3]);
    syncCoreClock(1_000, 0, 0);
    expect([a, b]).toEqual([4, 4]);
    offA();
    vi.advanceTimersByTime(1_000);
    expect([a, b]).toEqual([4, 5]);
    offB();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("已跑时长的写法", () => {
  it("和菜单栏一样：分:秒，过了一小时带上小时", () => {
    expect(stopwatch(0)).toBe("0:00");
    expect(stopwatch(7_900)).toBe("0:07");
    expect(stopwatch(59_999)).toBe("0:59");
    expect(stopwatch(725_000)).toBe("12:05");
    expect(stopwatch(3_800_000)).toBe("1:03:20");
  });
});
