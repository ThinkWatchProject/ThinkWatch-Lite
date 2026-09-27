import { beforeEach, describe, expect, it } from "vitest";
import { fetchInto, resetResources } from "./resource";

/** 一个手动放行的取数：`fetch` 交给 `fetchInto`，`land` 让它带着某个值落地 */
function gate<T>() {
  const pending: ((v: T) => void)[] = [];
  let calls = 0;
  return {
    fetch: () => {
      calls += 1;
      return new Promise<T>((r) => pending.push(r));
    },
    land: (v: T) => pending.shift()?.(v),
    get calls() {
      return calls;
    },
  };
}

/** 让已经放行的那几步（`then`、`finally`）都走完 */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => resetResources());

/**
 * 取数飞着的时候又被要求重取。
 *
 * **飞着的那一个是在要求之前发出去的**：刚改完配置、事件说库里多了东西、筛选条件
 * 换了，它带回来的正是改之前的样子。搭上它的话，最后那一次要求就丢了 —— 页面停在
 * 改之前的数上。
 */
describe("飞着的时候又要重取", () => {
  it("落地之后再取一次，要求的那一处拿到的是补取的那一份", async () => {
    const before = gate<string>();
    const after = gate<string>();
    const first = fetchInto("k", before.fetch);
    // 飞着的时候，服务器那边改了，又要求重取
    const second = fetchInto("k", after.fetch);
    expect(after.calls).toBe(0);
    before.land("改之前");
    expect(await first).toBe("改之前");
    await settle();
    expect(after.calls).toBe(1);
    after.land("改之后");
    expect(await second).toBe("改之后");
  });

  /** 飞着的时候要求了好几次也只补一次，用最后那个取数函数（筛选条件以最后一次为准） */
  it("要求几次都只补一次，用最后那个取数函数", async () => {
    const inflight = gate<string>();
    const a = gate<string>();
    const b = gate<string>();
    fetchInto("k", inflight.fetch);
    const x = fetchInto("k", a.fetch);
    const y = fetchInto("k", b.fetch);
    inflight.land("旧");
    await settle();
    expect(a.calls).toBe(0);
    expect(b.calls).toBe(1);
    b.land("新");
    expect(await x).toBe("新");
    expect(await y).toBe("新");
  });

  /** 只是又有一处挂上了这份数据：搭上飞着的那一个，不多取 */
  it("只是挂上的，搭上飞着的那一个", async () => {
    const inflight = gate<string>();
    const other = gate<string>();
    const first = fetchInto("k", inflight.fetch);
    const joined = fetchInto("k", other.fetch, true);
    inflight.land("一份");
    expect(await first).toBe("一份");
    expect(await joined).toBe("一份");
    await settle();
    expect(other.calls).toBe(0);
  });

  /** 换了连接：那一份缓存已经作废，排着的补取也作废 */
  it("换过连接就不补取", async () => {
    const inflight = gate<string>();
    const again = gate<string>();
    fetchInto("k", inflight.fetch);
    const queued = fetchInto("k", again.fetch);
    resetResources();
    inflight.land("旧连接的");
    expect(await queued).toBeUndefined();
    expect(again.calls).toBe(0);
  });
});
