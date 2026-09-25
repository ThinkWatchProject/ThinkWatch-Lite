import { bucketStart } from "@/format";
import { useResource, type Resource } from "@/lib/resource";
import type { RouteHits, RuleHits } from "@/types";
import { useNow } from "@/useNow";
import { api } from "./api";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * 命中数看几天。**一周**：一天里没命中的规则多半只是今天没用上（周末、偶尔才切的
 * 模型），一周都没命中才值得标出来。
 */
export const HIT_DAYS = 7;

export interface RouteHitsWindow {
  hits: Resource<RouteHits[]>;
  /** 窗口是几天。记录留得比一周短时按留的天数：更早的请求已经不在了，说不上命中过没有 */
  days: number;
}

/**
 * 最近几天各条路由走了多少请求、各条规则命中了多少（`GET /summary/routes`）。
 *
 * 窗口的起点对齐到整点，一小时挪一格；**请求落地之后重读**，不按时间轮询。看的是一周
 * 的数，多一个少一个请求看不出来，而 core 每读一次要把这一周的记录过一遍 —— 重读的
 * 节流放宽到十秒。
 */
export function useRouteHits(rowDays: number): RouteHitsWindow {
  const days = Math.max(1, Math.min(HIT_DAYS, rowDays));
  const now = useNow(60_000);
  const since = bucketStart(now - days * DAY, HOUR);
  const hits = useResource("route-hits", () => api.routeStats(since), {
    events: ["request_finished", "request_failed", "request_cancelled"],
    throttleMs: 10_000,
    deps: [since],
  });
  return { hits, days };
}

/**
 * 一条路由在窗口里的命中数。`undefined`：还没读到或读不到；`null`：读到了，这段时间
 * 没有请求走这条路由。
 */
export function hitsOfRoute(hits: readonly RouteHits[] | undefined, route: string): RouteHits | null | undefined {
  if (hits === undefined) return undefined;
  const r = hits.find((x) => x.route === route);
  return r && r.requests > 0 ? r : null;
}

/** 路由里一条规则的命中数。一次都没命中的规则不在统计里，这里补成零 */
export function hitsOfRule(route: RouteHits, rule: string): RuleHits {
  return route.rules.find((x) => x.rule === rule) ?? { rule, decided: 0, requests: 0, failed: 0, last_ms: 0 };
}
