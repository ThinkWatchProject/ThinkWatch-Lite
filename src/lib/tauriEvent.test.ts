import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { RETRY_MS, subscribe, useTauriEvent } from "./tauriEvent";

/**
 * 假的 `listen`：每订阅一次登记一条，注册什么时候完成、退订会不会失败都由测试来定。
 * `emit` 发给 Tauri 那边**还登记着**的监听 —— 退订失败的那一条照样收得到，和真应用
 * 里那条没退掉的监听一样。
 */
interface Reg {
  event: string;
  options: unknown;
  handler: (e: Event<unknown>) => void;
  unlisten: Mock<() => Promise<void>>;
  /** 注册完成：`listen` 兑现，交出退订函数 */
  register: () => void;
  /** 注册失败（不在应用里） */
  fail: (e: unknown) => void;
  /** Tauri 那边已经退掉了 */
  gone: boolean;
}

const tauri = vi.hoisted(() => ({ regs: [] as Reg[] }));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    (event: string, handler: (e: Event<unknown>) => void, options?: unknown) =>
      new Promise((resolve, reject) => {
        const reg: Reg = {
          event,
          options,
          handler,
          unlisten: vi.fn(async () => {
            reg.gone = true;
          }),
          register: () => resolve(() => reg.unlisten()),
          fail: reject,
          gone: false,
        };
        tauri.regs.push(reg);
      }),
  ),
}));

/**
 * 只够 `useTauriEvent` 用的一个 React：`useRef`、`useEffect` 按调用顺序占格子，`mount`、
 * `rerender` 跑一遍组件再提交 effect。**StrictMode 的开发模式**照 React 自己的做法：第一次
 * 挂上时 effect 跑完、清理、再跑一遍。仓库里没有 DOM 测试环境，所以照着这个顺序重放。
 */
const react = vi.hoisted(() => {
  interface Slot {
    ref?: { current: unknown };
    effect?: () => void | (() => void);
    deps?: readonly unknown[];
    cleanup?: void | (() => void);
    dirty?: boolean;
  }
  const slots: Slot[] = [];
  let at = 0;
  return {
    slots,
    start: () => {
      at = 0;
    },
    useRef: (init: unknown) => {
      const s = (slots[at++] ??= {});
      s.ref ??= { current: init };
      return s.ref;
    },
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const s = (slots[at++] ??= {});
      s.effect = effect;
      if (!s.deps || !deps || deps.some((d, i) => !Object.is(d, s.deps?.[i]))) {
        s.deps = deps;
        s.dirty = true;
      }
    },
  };
});

vi.mock("react", async (load) => ({
  ...(await load<typeof import("react")>()),
  useRef: react.useRef,
  useEffect: react.useEffect,
}));

function mount<P>(component: (props: P) => void, props: P, { strict = false } = {}) {
  const cleanup = () => {
    for (const s of react.slots) if (typeof s.cleanup === "function") s.cleanup();
  };
  const commit = () => {
    for (const s of react.slots) {
      if (!s.dirty) continue;
      if (typeof s.cleanup === "function") s.cleanup();
      s.cleanup = s.effect?.();
      s.dirty = false;
    }
  };
  react.start();
  component(props);
  commit();
  if (strict) {
    // StrictMode：挂上、卸掉、再挂上，三步之间没有任何异步
    cleanup();
    for (const s of react.slots) s.cleanup = s.effect?.();
  }
  return {
    rerender(next: P) {
      react.start();
      component(next);
      commit();
    },
    unmount: cleanup,
  };
}

/** 发一个事件给 Tauri 那边还登记着的监听 */
function emit(event: string, payload: unknown) {
  for (const r of tauri.regs) if (r.event === event && !r.gone) r.handler({ event, id: 0, payload });
}

/**
 * 跑完所有排着的微任务，再过一轮事件循环。Node 在这之间检查没人接的 rejection，
 * `rejections` 收得到的话就是在这之前漏的
 */
const settle = () => new Promise<void>((r) => setImmediate(r));

const rejections: unknown[] = [];
const onRejection = (e: unknown) => rejections.push(e);

beforeEach(() => {
  tauri.regs.length = 0;
  react.slots.length = 0;
  rejections.length = 0;
  process.on("unhandledRejection", onRejection);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  await settle();
  process.off("unhandledRejection", onRejection);
  vi.useRealTimers();
  // 每一条都不许漏出没人接的 rejection
  expect(rejections).toEqual([]);
});

/** Tauri 的 `_unlisten` 在登记脚本还没到页面时抛的那个错 */
const notYet = () => new TypeError("undefined is not an object (evaluating 'listeners[eventId].handlerId')");

describe("subscribe", () => {
  it("注册完成后退订：退一次，之后的事件不再进回调", async () => {
    const seen: unknown[] = [];
    const off = subscribe<number>("core-state", (e) => seen.push(e.payload));
    const [reg] = tauri.regs;
    reg!.register();
    await settle();
    emit("core-state", 1);
    off();
    await settle();
    emit("core-state", 2);
    expect(seen).toEqual([1]);
    expect(reg!.unlisten).toHaveBeenCalledTimes(1);
  });

  it("注册完成前就退订：完成的那一刻退，只退一次", async () => {
    const seen: unknown[] = [];
    const off = subscribe("core-event", (e) => seen.push(e.payload));
    off();
    const [reg] = tauri.regs;
    expect(reg!.unlisten).not.toHaveBeenCalled();
    reg!.register();
    await settle();
    expect(reg!.unlisten).toHaveBeenCalledTimes(1);
    emit("core-event", "late");
    expect(seen).toEqual([]);
  });

  it("退订两次只退一次，注册前后都一样", async () => {
    const early = subscribe("a", () => {});
    early();
    early();
    tauri.regs[0]!.register();
    await settle();
    early();

    const late = subscribe("b", () => {});
    tauri.regs[1]!.register();
    await settle();
    late();
    late();
    await settle();
    late();

    expect(tauri.regs[0]!.unlisten).toHaveBeenCalledTimes(1);
    expect(tauri.regs[1]!.unlisten).toHaveBeenCalledTimes(1);
  });

  /**
   * 真应用里的那个空档：注册完成时登记脚本还没到页面，退订抛错（Tauri 的退订函数是
   * async 的，抛错就是一个 rejection）。**不往外漏**，隔一会儿再退一次就退掉了；
   * 中间 Tauri 照旧发来的事件不进回调
   */
  it("退订失败不往外抛，隔一会儿再退一次", async () => {
    const seen: unknown[] = [];
    const off = subscribe("core-event", (e) => seen.push(e.payload));
    off();
    const [reg] = tauri.regs;
    reg!.unlisten.mockRejectedValueOnce(notYet());
    reg!.register();
    await settle();
    expect(reg!.unlisten).toHaveBeenCalledTimes(1);
    emit("core-event", "still registered");
    expect(seen).toEqual([]);

    vi.advanceTimersByTime(RETRY_MS);
    await settle();
    expect(reg!.unlisten).toHaveBeenCalledTimes(2);
    expect(reg!.gone).toBe(true);
    vi.advanceTimersByTime(RETRY_MS * 10);
    await settle();
    expect(reg!.unlisten).toHaveBeenCalledTimes(2);
  });

  it("退订函数同步抛错也一样接住", async () => {
    const off = subscribe("core-event", () => {});
    const [reg] = tauri.regs;
    reg!.unlisten.mockImplementationOnce(() => {
      throw notYet();
    });
    reg!.register();
    await settle();
    off();
    await settle();
    vi.advanceTimersByTime(RETRY_MS);
    await settle();
    expect(reg!.unlisten).toHaveBeenCalledTimes(2);
    expect(reg!.gone).toBe(true);
  });

  it("两次都退不掉就算了：不再重试，也不往外抛", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    const seen: unknown[] = [];
    const off = subscribe("core-event", (e) => seen.push(e.payload));
    const [reg] = tauri.regs;
    reg!.unlisten.mockRejectedValue(notYet());
    reg!.register();
    await settle();
    off();
    await settle();
    vi.advanceTimersByTime(RETRY_MS * 10);
    await settle();
    expect(reg!.unlisten).toHaveBeenCalledTimes(2);
    // 监听还登记着，回调照样失效
    emit("core-event", "after");
    expect(seen).toEqual([]);
    expect(debug).toHaveBeenCalledTimes(1);
    debug.mockRestore();
  });

  /** 「先挂上监听再读一次现状」等的是它 */
  it("ready 在注册完成时兑现，退订过也一样", async () => {
    const off = subscribe("connection", () => {});
    let ready = false;
    void off.ready.then(() => {
      ready = true;
    });
    off();
    await settle();
    expect(ready).toBe(false);
    tauri.regs[0]!.register();
    await settle();
    expect(ready).toBe(true);
  });

  /** 不在应用里（浏览器里看 `pnpm dev`、截图页没 mock 的事件）：没人等也不漏 rejection */
  it("注册失败时 ready 拒绝；没人等它也不漏，退订什么都不做", async () => {
    const quiet = subscribe("language-changed", () => {});
    tauri.regs[0]!.fail(new Error("not in Tauri"));
    await settle();
    quiet();

    const waited = subscribe("core-state", () => {});
    tauri.regs[1]!.fail(new Error("not in Tauri"));
    await expect(waited.ready).rejects.toThrow("not in Tauri");
    waited();
    await settle();
  });

  /** 窗口范围的事件（`getCurrentWindow().listen` 那一种）：`target` 原样交给 `listen` */
  it("options 原样交给 listen", () => {
    const target = { kind: "Window", label: "main" } as const;
    subscribe("tauri://focus", () => {}, { target });
    expect(tauri.regs[0]!.options).toEqual({ target });
  });
});

describe("useTauriEvent", () => {
  function Probe({ event, onEvent }: { event: string; onEvent: (p: unknown) => void }) {
    useTauriEvent(event, (e) => onEvent(e.payload));
  }

  /**
   * 开发模式下 StrictMode 把挂上的 effect 跑两遍，中间清理一次，**三步都在第一个
   * `listen` 兑现之前**。以前这正是成串报错的地方：第一份在兑现的那一刻被退订
   */
  it("StrictMode 双跑：第一份兑现时退一次，只剩一份在听", async () => {
    const seen: unknown[] = [];
    mount(Probe, { event: "notices-changed", onEvent: (p) => seen.push(p) }, { strict: true });
    expect(tauri.regs).toHaveLength(2);
    const [first, second] = tauri.regs;
    first!.unlisten.mockRejectedValueOnce(notYet());
    first!.register();
    second!.register();
    await settle();
    emit("notices-changed", "x");
    expect(seen).toEqual(["x"]);
    vi.advanceTimersByTime(RETRY_MS);
    await settle();
    expect(first!.unlisten).toHaveBeenCalledTimes(2);
    expect(first!.gone).toBe(true);
    expect(second!.unlisten).not.toHaveBeenCalled();
  });

  it("回调换了不重新订阅，事件交给最新的回调", async () => {
    const a: unknown[] = [];
    const b: unknown[] = [];
    const view = mount(Probe, { event: "update-step", onEvent: (p) => a.push(p) });
    tauri.regs[0]!.register();
    await settle();
    view.rerender({ event: "update-step", onEvent: (p) => b.push(p) });
    emit("update-step", 1);
    expect(tauri.regs).toHaveLength(1);
    expect(a).toEqual([]);
    expect(b).toEqual([1]);
  });

  it("事件名换了：退掉旧的、订新的；卸掉时退掉", async () => {
    const view = mount(Probe, { event: "a", onEvent: () => {} });
    tauri.regs[0]!.register();
    await settle();
    view.rerender({ event: "b", onEvent: () => {} });
    tauri.regs[1]!.register();
    await settle();
    expect(tauri.regs.map((r) => [r.event, r.unlisten.mock.calls.length])).toEqual([
      ["a", 1],
      ["b", 0],
    ]);
    view.unmount();
    await settle();
    expect(tauri.regs[1]!.unlisten).toHaveBeenCalledTimes(1);
  });
});
