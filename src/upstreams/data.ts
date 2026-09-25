/**
 * 上游页的几份数据：24 小时统计、默认价目表的状态、账号类上游的额度、在途请求。
 *
 * 前三份走 `useResource`：切走再回来先画上一次的数，后台再取，不闪。在途请求是
 * 跟着事件流走的一份现状，不缓存。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { bucketStart } from "@/format";
import { useResource, type Resource } from "@/lib/resource";
import type { CoreEvent, CostBucketGroup, ProviderView } from "@/types";
import { useNow } from "@/useNow";
import { api, type UpstreamStats } from "./api";

export const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 走势画几格：24 个整点，加上现在所在的这一小时 */
export const SLOTS = 25;

/**
 * 「24 小时」从哪一刻算起：**对齐到整点**，和概览实时档的起点是同一个
 * （`windowStart` 的 live 分支）。两页上的「24 小时」数字对得上，走势的格子
 * 也不会随着看的时刻来回滑。
 */
export function dayStart(now: number): number {
  return bucketStart(now - DAY, HOUR);
}

/**
 * 每个上游 24 小时的请求、费用、首字节耗时、订阅额度和按小时的走势。
 *
 * **请求落地之后重读**，不按时间轮询：这些数只在请求落地时才变。随时间变的只有
 * 窗口本身 —— 起点每过一个整点往前挪一格（`deps`），窗口重新拿到焦点时补一次。
 * 订阅额度的事件里就是完整的数，收到直接换上。
 */
export function useUpstreamStats(): { stats: Resource<UpstreamStats>; since: number } {
  const now = useNow(60_000);
  const since = dayStart(now);
  const stats = useResource("upstream-stats", () => api.upstreamStats(since, HOUR), {
    events: ["request_finished", "request_failed", "request_cancelled"],
    deps: [since],
  });
  const { mutate, reload } = stats;

  useEffect(() => {
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      if (ev.kind !== "quota_seen") return;
      mutate(
        patch((s) => ({
          ...s,
          quotas: [
            ...s.quotas.filter((q) => q.provider !== ev.provider),
            { provider: ev.provider, windows: ev.windows },
          ],
        })),
      );
    });
    return () => void un.then((f) => f());
  }, [mutate]);

  useEffect(() => {
    const again = () => void reload();
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, [reload]);

  return { stats, since };
}

/** 给 `mutate` 用：手里还没有数据时什么都不改（`mutate` 要的是一个新值，拿不出就原样还回去） */
export function patch<T>(f: (s: T) => T): (s: T | undefined) => T {
  return (s) => (s === undefined ? (s as unknown as T) : f(s));
}

/** 一个小时格：请求数、其中失败的 */
export interface Slot {
  at: number;
  requests: number;
  failed: number;
}

/**
 * 把稀疏的格子按上游摊成定长的一排（`SLOTS` 格）。**没有请求的小时也要占一格**：
 * 跳过的话，一天里的空档被两边挤没，走势看起来就是一直在用。
 */
export function slotsByUpstream(buckets: CostBucketGroup[] | undefined, since: number): Map<string, Slot[]> {
  const out = new Map<string, Slot[]>();
  for (const b of buckets ?? []) {
    const i = Math.round((b.at_ms - since) / HOUR);
    if (i < 0 || i >= SLOTS) continue;
    let row = out.get(b.name);
    if (!row) {
      row = Array.from({ length: SLOTS }, (_, k) => ({ at: since + k * HOUR, requests: 0, failed: 0 }));
      out.set(b.name, row);
    }
    row[i]!.requests += b.requests;
    row[i]!.failed += b.failed;
  }
  return out;
}

/** 默认价目表的状态。配置换了一版（改了价目表、开关了自动更新）就重读 */
export function usePricingStatus(configVersion: string) {
  return useResource("pricing-status", () => api.pricingStatus(), { deps: [configVersion] });
}

/**
 * 账号类上游的额度：**打开这一页时问一次它自己。**
 *
 * 登的是哪个账号、什么套餐不用问 —— core 从这份凭据自己的令牌里读，就在上游视图里
 * （`oauth.account`）。额度不一样：平时是跟着真实流量白捡的，刚启动、或者这个账号
 * 今天还没被用过时，不问就什么都没有。问一次是一次真实调用：**失败了也不重试**，
 * 连不上时反复问只会把错误刷满日志；单个账号问不到不影响别的。问完 core 记下了
 * 额度，`onAnswered` 让统计从 core 再读一遍，免得这里和它各存一份。
 */
export function useAccountQuotas(providers: ProviderView[], onAnswered: () => void): void {
  const names = providers
    .filter((p) => p.protocol === "chatgpt" && !p.disabled)
    .map((p) => p.name)
    .sort();
  const key = names.join("\n");
  const answered = useRef(onAnswered);
  answered.current = onAnswered;
  useResource(
    names.length > 0 ? "upstream-account-quotas" : null,
    async () => {
      const got = await Promise.all(names.map((n) => api.chatgptUsage(n).then(() => true, () => false)));
      const n = got.filter(Boolean).length;
      if (n > 0) answered.current();
      return n;
    },
    { deps: [key] },
  );
}

/** 在途请求记住多少条已经结束的 id（结束事件比快照先到时用来排除）。只是防御性的上限 */
const ENDED_CAP = 512;

/**
 * 此刻每个上游有几个请求在途。
 *
 * 开始事件里就有上游；换了上游（转移）以 `request_routed` 的最后一跳为准；三种结局
 * 都算结束。**页面半路挂上**时，已经在飞的那几个没有开始事件可听 —— 挂上时读一次
 * `/in-flight` 的快照，把每个请求到目前为止的事件照原样重放（比快照先到的结束事件
 * 记下来，免得补回一个已经结束的）。core 停了、重启了，在途的全部作废：它们不会再有
 * 结局。
 */
export function useInFlight(): ReadonlyMap<string, number> {
  const live = useRef(new Map<number, string>());
  const ended = useRef(new Set<number>());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const bump = () => alive && setTick((n) => n + 1);
    /** 开始、路由落到「哪个请求在哪个上游」上。事件流和快照重放用的是同一段 */
    const track = (ev: CoreEvent) => {
      if (ev.kind === "request_started") live.current.set(ev.id, ev.provider);
      else if (ev.kind === "request_routed") {
        const last = ev.attempts[ev.attempts.length - 1];
        if (last && live.current.has(ev.id)) live.current.set(ev.id, last.provider);
      }
    };
    const seed = () => {
      api
        .inFlight()
        .then((open) => {
          if (!alive) return;
          for (const { id, events } of open.requests) {
            if (ended.current.has(id) || live.current.has(id)) continue;
            for (const ev of events) track(ev);
          }
          bump();
        })
        .catch(() => {
          // 读不到快照：之后的开始事件照样记，只是漏掉此刻已经在飞的几个
        });
    };
    const end = (id: number) => {
      live.current.delete(id);
      ended.current.add(id);
      if (ended.current.size > ENDED_CAP) {
        const oldest = ended.current.values().next().value;
        if (oldest !== undefined) ended.current.delete(oldest);
      }
    };
    const unEvents = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      switch (ev.kind) {
        case "request_started":
          if (!ended.current.has(ev.id)) track(ev);
          break;
        case "request_routed":
          track(ev);
          break;
        case "request_finished":
        case "request_failed":
        case "request_cancelled":
          end(ev.id);
          break;
        default:
          return;
      }
      bump();
    });
    const unState = listen<string>("core-state", (e) => {
      live.current.clear();
      bump();
      if (e.payload.startsWith("running:")) seed();
    });
    seed();
    return () => {
      alive = false;
      void unEvents.then((f) => f());
      void unState.then((f) => f());
    };
  }, []);

  return useMemo(() => {
    const by = new Map<string, number>();
    for (const provider of live.current.values()) by.set(provider, (by.get(provider) ?? 0) + 1);
    return by;
    // `tick` 是 `live` 这份可变状态的版本号
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);
}
