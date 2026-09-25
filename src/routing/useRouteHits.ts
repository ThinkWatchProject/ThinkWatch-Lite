import { useMemo } from "react";
import { bucketStart } from "@/format";
import { useResource } from "@/lib/resource";
import { coreNow } from "@/traffic/clock";
import type { RouteHits, RouteStats, RuleHits } from "@/types";
import { useNow } from "@/useNow";
import { api } from "./api";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * 命中数看几天。**一周**：一天里没命中的规则多半只是今天没用上（周末、偶尔才切的
 * 模型），一周都没命中才值得标出来。
 */
export const HIT_DAYS = 7;

/** 命中数说的是多长一段：「7 天」「5 小时」「12 分钟」 */
export interface HitSpan {
  n: number;
  unit: "day" | "hour" | "minute";
}

/**
 * 最近一段时间的命中数，连同它们说的是多长一段。
 *
 * **这一段不一定是整个窗口**：库刚建好（新装、升级时重建）时，记录从最老的那条请求
 * 才开始，在那之前「没命中」是「不知道」。这时「未命中」「无请求」说的是记录开始
 * 之后的那一段，`span` 就是那一段。
 */
export type RouteHitsWindow =
  /** 还没读到：画骨架 */
  | { state: "loading" }
  /** 读不到 */
  | { state: "unknown" }
  /** 这段时间一条请求记录都没有：「未命中」什么都说明不了，只说一次没有记录 */
  | { state: "empty" }
  | { state: "counted"; span: HitSpan; routes: readonly RouteHits[] };

/**
 * 最近几天各条路由走了多少请求、各条规则命中了多少（`GET /summary/routes`）。
 *
 * 窗口的起点对齐到整点，一小时挪一格；**请求落地之后重读**，不按时间轮询。看的是一周
 * 的数，多一个少一个请求看不出来，而 core 每读一次要把这一周的记录过一遍 —— 重读的
 * 节流放宽到十秒。记录留得比一周短时窗口按留的天数：更早的请求已经不在了。
 */
export function useRouteHits(rowDays: number): RouteHitsWindow {
  const days = Math.max(1, Math.min(HIT_DAYS, rowDays));
  const now = useNow(60_000);
  const since = bucketStart(now - days * DAY, HOUR);
  // 答案和问的起点放在一起：跨了整点换了起点，新答案回来之前，旧的那份按它自己的起点读
  const { data, loading } = useResource(
    "route-hits",
    async (): Promise<Asked> => ({ from: since, days, stats: await api.routeStats(since) }),
    {
      events: ["request_finished", "request_failed", "request_cancelled"],
      throttleMs: 10_000,
      deps: [since],
    },
  );
  // 记录的起点是 core 的钟：拿 core 此刻的钟去减，不拿本机的（连的可能是另一台机器，
  // 见 `traffic/clock`）
  return useMemo(() => hitsWindow(data, loading, coreNow(now) ?? now), [data, loading, now]);
}

/** 问的是哪一段（起点、几天）和 core 的回答 */
export interface Asked {
  from: number;
  days: number;
  stats: RouteStats;
}

/**
 * 把一次回答读成界面要说的话。记录从起点就有：说窗口的天数；记录开始得比起点晚：说记录
 * 开始以来的那一段；一条记录都没有：什么都不数
 */
export function hitsWindow(data: Asked | undefined, loading: boolean, now: number): RouteHitsWindow {
  if (!data) return loading ? { state: "loading" } : { state: "unknown" };
  const covered = data.stats.covered_since_ms;
  if (covered == null) return { state: "empty" };
  const span: HitSpan = covered <= data.from ? { n: data.days, unit: "day" } : spanSince(covered, now);
  return { state: "counted", span, routes: data.stats.routes };
}

/**
 * 记录从 `coveredSinceMs` 开始，到 `now` 为止有多长。**往短里说**：「5 小时内未命中」
 * 要这 5 小时里都有记录才说得出口，零头宁可不算。两天以内按小时，不到一小时按分钟
 */
export function spanSince(coveredSinceMs: number, now: number): HitSpan {
  const ms = Math.max(0, now - coveredSinceMs);
  if (ms >= 2 * DAY) return { n: Math.floor(ms / DAY), unit: "day" };
  if (ms >= HOUR) return { n: Math.floor(ms / HOUR), unit: "hour" };
  return { n: Math.max(1, Math.floor(ms / MINUTE)), unit: "minute" };
}

/** 一条路由在这段时间里的命中数。`null`：这段时间没有请求走这条路由 */
export function hitsOfRoute(routes: readonly RouteHits[], route: string): RouteHits | null {
  const r = routes.find((x) => x.route === route);
  return r && r.requests > 0 ? r : null;
}

/** 路由里一条规则的命中数。一次都没命中的规则不在统计里，这里补成零 */
export function hitsOfRule(route: RouteHits, rule: string): RuleHits {
  return route.rules.find((x) => x.rule === rule) ?? { rule, decided: 0, requests: 0, failed: 0, last_ms: 0 };
}
