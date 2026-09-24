import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useCoreEvent } from "@/useCoreEvent";
import type { CoreEvent, LocalEvent } from "@/types";

/**
 * 取数的统一做法：**先给缓存，后台再取**（stale-while-revalidate）。
 *
 * 各页原来各自 `useState` + `useEffect` 取数，一换页就卸掉，回来时从「读取中」
 * 重新开始 —— 每次切页都闪一下。这里的缓存在模块里，不跟组件走：
 *
 * · 回到一页时立刻画上一次的数据，同时在后台重取，取到了再无声替换；
 * · 同一个键同时只有一个请求在飞（两处挂同一份数据只取一次）；
 * · `events` 里的 core 事件到了就重取（节流，和 `useCoreEvent` 同一个节奏）；
 * · `mutate` 先改缓存（乐观更新），返回撤回函数，配 `undoable` 用；
 * · 换了连接（另一个 core）整份缓存清掉：两个 core 的数据不能混（`resetResources`，
 *   App.tsx 已经接好）。
 *
 * 用法见 src/ui/README.md 的「Data」一节：
 *
 *   const keys = useResource("keys", () => call("Keys", null), { events: ["config_reloaded"] });
 *   <Loadable r={keys} …>{(data) => …}</Loadable>
 */

type Kind = CoreEvent["kind"] | LocalEvent["kind"];

export interface Resource<T> {
  /** 最近一次取到的数据。还没取到过是 `undefined` */
  data: T | undefined;
  /** 最近一次取数的错误。**再次成功之前一直在**；有旧数据时照样有旧数据 */
  error: unknown;
  /** 没有数据、正在取：该画骨架 */
  loading: boolean;
  /** 有数据、后台在重取：不用画什么，想画个小转圈可以看它 */
  refreshing: boolean;
  /** 立刻重取。返回取到的数据；失败时返回 `undefined`（错误在 `error` 里） */
  reload: () => Promise<T | undefined>;
  /**
   * 直接改缓存（乐观更新）。返回撤回函数：把缓存恢复成改之前的样子。
   * `revalidate: true` 改完之后再去取一次真值。
   */
  mutate: (next: T | ((prev: T | undefined) => T), opts?: { revalidate?: boolean }) => () => void;
}

interface Entry {
  data: unknown;
  error: unknown;
  /** 正在飞的那个请求 */
  inflight: Promise<unknown> | null;
  /** 最近一次成功的时刻 */
  at: number;
  listeners: Set<() => void>;
  /** 挂着这份数据的 hook 的取数函数。`invalidate` 用其中一个重取 */
  fetchers: Set<() => Promise<unknown>>;
  snap: Snapshot;
}

interface Snapshot {
  data: unknown;
  error: unknown;
  fetching: boolean;
}

const cache = new Map<string, Entry>();
/** 每换一次连接加一。换之前发出去、换之后才回来的结果不写进新缓存 */
let epoch = 0;

function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = {
      data: undefined,
      error: undefined,
      inflight: null,
      at: 0,
      listeners: new Set(),
      fetchers: new Set(),
      snap: { data: undefined, error: undefined, fetching: false },
    };
    cache.set(key, e);
  }
  return e;
}

function publish(e: Entry) {
  e.snap = { data: e.data, error: e.error, fetching: e.inflight !== null };
  for (const f of e.listeners) f();
}

function fetchInto<T>(key: string, fetcher: () => Promise<T>): Promise<T | undefined> {
  const e = entry(key);
  if (e.inflight) return e.inflight as Promise<T | undefined>;
  const mine = epoch;
  const p: Promise<T | undefined> = fetcher().then(
    (data) => {
      if (mine !== epoch) return undefined;
      e.data = data;
      e.error = undefined;
      e.at = Date.now();
      return data;
    },
    (err: unknown) => {
      if (mine !== epoch) return undefined;
      e.error = err;
      return undefined;
    },
  );
  const tracked: Promise<unknown> = p.finally(() => {
    if (e.inflight === tracked) e.inflight = null;
    publish(e);
  });
  e.inflight = tracked;
  publish(e);
  return p;
}

/** 两次挂载之间隔这么短就不重取：同一次渲染里两处挂同一份数据 */
const DEDUPE_MS = 500;

export function useResource<T>(
  key: string | null,
  fetcher: () => Promise<T>,
  opts: {
    /** 这些事件到了就重取 */
    events?: readonly Kind[];
    /** 事件的节流间隔。默认和 `useCoreEvent` 一样 2.5 秒 */
    throttleMs?: number;
    /** 这些值变了就重取（配置版本、筛选条件）。**不换缓存**：变之前的数据先画着 */
    deps?: readonly unknown[];
  } = {},
): Resource<T> {
  const f = useRef(fetcher);
  f.current = fetcher;

  const subscribe = useCallback(
    (cb: () => void) => {
      if (key === null) return () => {};
      const e = entry(key);
      e.listeners.add(cb);
      return () => e.listeners.delete(cb);
    },
    [key],
  );
  const snap = useSyncExternalStore(subscribe, () => (key === null ? IDLE : entry(key).snap));

  const reload = useCallback(
    () => (key === null ? Promise.resolve(undefined) : fetchInto(key, () => f.current())),
    [key],
  );

  // 挂上、换键、依赖变了：取一次（刚取过的不重复取）
  const depKey = JSON.stringify(opts.deps ?? []);
  const lastDeps = useRef<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    const e = entry(key);
    const changed = lastDeps.current !== null && lastDeps.current !== depKey;
    lastDeps.current = depKey;
    if (!changed && e.inflight === null && Date.now() - e.at < DEDUPE_MS && e.data !== undefined) return;
    void fetchInto(key, () => f.current());
  }, [key, depKey]);

  // 让 `invalidate` 找得到一个活着的取数函数
  useEffect(() => {
    if (key === null) return;
    const e = entry(key);
    const run = () => f.current();
    e.fetchers.add(run);
    return () => {
      e.fetchers.delete(run);
    };
  }, [key]);

  useCoreEvent(opts.events ?? NO_EVENTS, () => void reload(), opts.throttleMs);

  const mutate = useCallback(
    (next: T | ((prev: T | undefined) => T), m?: { revalidate?: boolean }) => {
      if (key === null) return () => {};
      const e = entry(key);
      const before = e.data;
      e.data = typeof next === "function" ? (next as (p: T | undefined) => T)(e.data as T | undefined) : next;
      publish(e);
      if (m?.revalidate) void fetchInto(key, () => f.current());
      return () => {
        e.data = before;
        publish(e);
      };
    },
    [key],
  );

  const data = snap.data as T | undefined;
  return {
    data,
    error: snap.error,
    loading: data === undefined && (snap.fetching || snap.error === undefined),
    refreshing: data !== undefined && snap.fetching,
    reload,
    mutate,
  };
}

const IDLE: Snapshot = { data: undefined, error: undefined, fetching: false };
const NO_EVENTS: readonly Kind[] = [];

/**
 * 在别处改了东西、知道某份数据过时了（比如密钥页改完，客户端页的那份也变了）：
 * 挂着它的地方立刻重取；没人挂着的只标成过时，下次挂上时照样先画旧的、再取。
 * `prefix` 以 `:` 结尾时按前缀匹配（`invalidate("upstream:")`）。
 */
export function invalidate(prefix: string) {
  for (const [key, e] of cache) {
    if (key !== prefix && !(prefix.endsWith(":") && key.startsWith(prefix))) continue;
    e.at = 0;
    const live = e.fetchers.values().next().value;
    if (live) void fetchInto(key, live);
  }
}

/**
 * 换了连接：整份缓存作废。**不是清空再重取**：新连接的界面会整个重挂（App.tsx 的
 * `PerConnection`），各页挂上时自己取。
 */
export function resetResources() {
  epoch += 1;
  cache.clear();
}
