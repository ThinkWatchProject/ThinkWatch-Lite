import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { resetResources } from "@/lib/resource";
import { LIVE_RANGE } from "@/ui/range";
import type { Dashboard, ProviderQuota } from "@/types";
import { useOverview } from "./useOverview";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const events = vi.hoisted(() => new Map<string, Set<(e: { payload: unknown }) => void>>());
vi.mock("@/lib/tauriEvent", () => ({
  subscribe: (event: string, handler: (e: { payload: unknown }) => void) => {
    if (!events.has(event)) events.set(event, new Set());
    events.get(event)!.add(handler);
    return () => events.get(event)!.delete(handler);
  },
}));

// 无 DOM 的 hook harness：effect 按依赖提交，缓存变化后显式重画。
// useResource 和 useCoreEvent 都跑真实现，只替换 React 与 Tauri 的边界。
const react = vi.hoisted(() => {
  interface Slot {
    value?: unknown;
    deps?: readonly unknown[];
    effect?: () => void | (() => void);
    cleanup?: void | (() => void);
    dirty?: boolean;
  }
  const slots: Slot[] = [];
  let at = 0;
  const changed = (slot: Slot, deps: readonly unknown[]) =>
    !slot.deps || deps.length !== slot.deps.length || deps.some((v, i) => !Object.is(v, slot.deps![i]));
  return {
    slots,
    start: () => { at = 0; },
    useRef: (init: unknown) => {
      const s = (slots[at++] ??= {});
      s.value ??= { current: init };
      return s.value;
    },
    useEffect: (effect: () => void | (() => void), deps: readonly unknown[]) => {
      const s = (slots[at++] ??= {});
      s.effect = effect;
      if (changed(s, deps)) {
        s.deps = deps;
        s.dirty = true;
      }
    },
    useCallback: (fn: unknown, deps: readonly unknown[]) => {
      const s = (slots[at++] ??= {});
      if (changed(s, deps)) {
        s.value = fn;
        s.deps = deps;
      }
      return s.value;
    },
    useState: (init: unknown) => {
      const s = (slots[at++] ??= { value: init });
      return [s.value, (v: unknown) => { s.value = v; }];
    },
    useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  };
});
vi.mock("react", async (load) => ({
  ...(await load<typeof import("react")>()),
  useRef: react.useRef,
  useEffect: react.useEffect,
  useCallback: react.useCallback,
  useState: react.useState,
  useSyncExternalStore: react.useSyncExternalStore,
}));

function render() {
  react.start();
  const result = useOverview(LIVE_RANGE, 0);
  for (const s of react.slots) {
    if (!s.dirty) continue;
    if (typeof s.cleanup === "function") s.cleanup();
    s.cleanup = s.effect?.();
    s.dirty = false;
  }
  return result;
}

function emitQuota(provider = "chatgpt") {
  for (const handler of events.get("core-event") ?? []) {
    handler({ payload: { kind: "quota_seen", provider, windows: QUOTAS[0]!.windows } });
  }
}

const QUOTAS: ProviderQuota[] = [{
  provider: "chatgpt",
  windows: [{ window: "weekly", used_percent: 21, resets_at_ms: 4_000_000_000_000, status: null }],
}];

// 本测试只消费额度字段；其他 dashboard 字段在这次更新前后不变。
const dashboard = (quotas: ProviderQuota[]): Dashboard => ({ quotas }) as Dashboard;
const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.mocked(invoke).mockReset();
  resetResources();
  react.slots.length = 0;
  events.clear();
});

afterEach(() => {
  for (const s of react.slots) if (typeof s.cleanup === "function") s.cleanup();
  resetResources();
  vi.useRealTimers();
});

describe("概览独立接收后台额度", () => {
  it("没有请求完成、没有进入上游页，后台读到额度后也会更新", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(dashboard([])).mockResolvedValueOnce(dashboard(QUOTAS));
    render();
    await settle();
    expect(render().shown?.data.quotas).toEqual([]);

    emitQuota();
    await vi.advanceTimersByTimeAsync(2_500);
    await settle();
    expect(render().shown?.data.quotas).toEqual(QUOTAS);
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["dashboard", "dashboard"]);
  });

  it("额度在首次读取结束前到达，仍会补取，不会被旧的空结果覆盖", async () => {
    let first!: (data: Dashboard) => void;
    vi.mocked(invoke)
      .mockImplementationOnce(() => new Promise<Dashboard>((resolve) => { first = resolve; }))
      .mockResolvedValueOnce(dashboard(QUOTAS));
    render();
    emitQuota();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(invoke).toHaveBeenCalledTimes(1);

    first(dashboard([]));
    await settle();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(render().shown?.data.quotas).toEqual(QUOTAS);
  });

  it("多个账号的额度事件合并读取，避免逐个重算概览", async () => {
    vi.mocked(invoke).mockResolvedValueOnce(dashboard([])).mockResolvedValueOnce(dashboard(QUOTAS));
    render();
    await settle();
    emitQuota();
    emitQuota("chatgpt-work");
    emitQuota("glm");
    await vi.advanceTimersByTimeAsync(2_500);
    await settle();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(render().shown?.data.quotas).toEqual(QUOTAS);
  });
});
