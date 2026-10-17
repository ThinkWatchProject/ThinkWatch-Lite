import { useEffect, useSyncExternalStore } from "react";
import { call } from "@/control";
import type { LiveView } from "@/types";

/**
 * 流量页里在跑的那几行此刻生成得多快。
 *
 * **事件流不带这个数**：请求跑着的时候，此刻多快只有 core 知道（`/live`）。所以流量页在
 * 眼前、列表里有在跑的请求时，每秒问 core 一次；没有在跑的、换了页、窗口藏着时不问。
 *
 * **数不经过行的渲染。**和已跑时长一样（`Elapsed`）：每一秒每一条在跑的请求都换一个数，
 * 放进行对象里的话，整行、整张表跟着重画。这里是一份小仓库，那一格里的小组件只订阅自己
 * 那一条。
 */

/** 隔多久问一次。和已跑时长的秒针同一个节拍 */
export const POLL_MS = 1_000;

/** 请求 id → 此刻每秒多少 token。**第一个 token 之前、非流式的不在里面** */
export type Speeds = ReadonlyMap<number, number>;

const EMPTY: Speeds = new Map();
let speeds: Speeds = EMPTY;
const listeners = new Set<() => void>();

function publish(next: Speeds): void {
  if (next === speeds || (next.size === 0 && speeds.size === 0)) return;
  speeds = next;
  for (const f of listeners) f();
}

function subscribe(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** core 那一份里有速度的那几条 */
export function speedsOf(v: LiveView): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of v.running) if (r.tokens_per_sec != null) out.set(r.id, r.tokens_per_sec);
  return out;
}

/** 这一条此刻的速度。还没开口（或者没在问）是 `undefined` */
export function useLiveSpeed(id: number): number | undefined {
  return useSyncExternalStore(subscribe, () => speeds.get(id));
}

/**
 * 一圈一圈地问：问完一次隔 `POLL_MS` 再问，**上一问没回来不发下一问**（core 卡住时不越
 * 积越多）。藏着时停下，露面时马上问一次。问不到就清空：一个旧的数挂在那儿，比不写更
 * 误导。返回停下的函数，停下时也清空。
 */
export function pollLive({
  ask,
  hidden,
  onVisibility,
  emit,
}: {
  ask: () => Promise<LiveView>;
  hidden: () => boolean;
  /** 挂上「露面 / 藏起」的回调，返回摘掉它的函数 */
  onVisibility: (f: () => void) => () => void;
  emit: (s: Speeds) => void;
}): () => void {
  let alive = true;
  let asking = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const next = async () => {
    timer = null;
    if (!alive || asking || hidden()) return;
    asking = true;
    try {
      const v = await ask();
      if (alive) emit(speedsOf(v));
    } catch {
      if (alive) emit(EMPTY);
    } finally {
      asking = false;
    }
    if (alive && !hidden()) timer = setTimeout(() => void next(), POLL_MS);
  };
  const off = onVisibility(() => {
    if (!hidden() && timer === null) void next();
  });
  void next();
  return () => {
    alive = false;
    off();
    if (timer !== null) clearTimeout(timer);
    emit(EMPTY);
  };
}

/**
 * 流量页挂着、`running`（列表里有在跑的请求）时每秒问一次 core。页面卸下（换了页）、
 * 没有在跑的了，就停下并清空。
 */
export function useLiveSpeeds(running: boolean): void {
  useEffect(() => {
    if (!running) return;
    return pollLive({
      ask: () => call("Live", null),
      hidden: () => document.visibilityState === "hidden",
      onVisibility: (f) => {
        document.addEventListener("visibilitychange", f);
        return () => document.removeEventListener("visibilitychange", f);
      },
      emit: publish,
    });
  }, [running]);
}
