/**
 * 路由图上「正在走的路」：在途的请求各自经过哪几站。**纯函数**，听事件的是
 * `useFlights`。
 *
 * **只认 core 推来的事件，不按配置去猜：**
 * · `request_started`：哪把密钥、走的哪条路由、哪条规则做的决定、交给了哪个策略组。
 *   路由的第一阶段在开始之前就走完了，所以这时已经画得到策略组，被规则拒绝的画到拒绝。
 *   不按密钥现在的配置推路由：请求开始之后，那份配置可能已经改过了。
 * · `request_routed`：最后由哪个上游接下（尝试链里 `served` 的那一跳）。到了这一条才画到
 *   上游 —— 之前只知道首选，故障转移之后接下它的可能是另一个。选定上游之后被拒的、
 *   一个上游都没接下的，画不到上游。
 * · 三种结局：这条路随之熄灭。
 *
 * 半路才打开这一页时，已经在跑的请求从 `/in-flight` 补上：每个请求到目前为止的事件照原样
 * 重放一遍，已经路由了的一打开就画到上游。
 */
import type { CoreEvent } from "@/types";
import { chainId, edgeId, type Chain } from "./chain";

export interface Flight {
  /** 发请求的密钥 */
  client: string;
  /** 走的哪条路由、哪条规则决定了去向 */
  route: string;
  rule: string;
  /** 规则交给的策略组。规则直连上游、拒绝了它时为空 */
  group: string | null;
  /** 接下它的上游。路由之前、被拒、一个都没接下时为空 */
  upstream: string | null;
}

/**
 * 一条事件落到在途请求上（原地改 `flights`）。返回 `"changed"`：图要重画；`"ended"`：
 * 这个请求走完了，什么时候拿掉由调用方定（留一小会儿，短请求也看得见）；`null`：
 * 和在途请求无关。
 */
export function applyFlightEvent(flights: Map<number, Flight>, ev: CoreEvent): "changed" | "ended" | null {
  switch (ev.kind) {
    case "request_started":
      flights.set(ev.id, { client: ev.client, route: ev.route, rule: ev.rule, group: ev.group ?? null, upstream: null });
      return "changed";
    case "request_routed": {
      const f = flights.get(ev.id);
      if (!f) return null;
      const served = ev.attempts.find((a) => a.outcome === "served");
      flights.set(ev.id, {
        ...f,
        route: ev.route,
        rule: ev.rule,
        group: ev.group ?? null,
        upstream: served?.provider ?? null,
      });
      return "changed";
    }
    case "request_finished":
    case "request_failed":
    case "request_cancelled":
      return flights.has(ev.id) ? "ended" : null;
    default:
      return null;
  }
}

/** 在途请求经过的节点（和经过它的请求数）与线 */
export interface Activity {
  nodes: ReadonlyMap<string, number>;
  edges: ReadonlySet<string>;
}

/**
 * 在途请求落在图上的哪几站、哪几段线。**图上没有的那一站到此为止**（配置刚换过，
 * 或者密钥已经删了）：不往下画，也不另起一段。
 */
export function activityOf(flights: ReadonlyMap<number, Flight>, chain: Chain): Activity | null {
  if (flights.size === 0) return null;
  const onMap = new Set(chain.nodes.map((n) => n.id));
  const nodes = new Map<string, number>();
  const edges = new Set<string>();
  for (const f of flights.values()) {
    const ids = [chainId.key(f.client), chainId.route(f.route), ...stationsOf(f, chain)];
    const cut = ids.findIndex((id) => !onMap.has(id));
    const path = cut < 0 ? ids : ids.slice(0, cut);
    for (const id of path) nodes.set(id, (nodes.get(id) ?? 0) + 1);
    for (let i = 1; i < path.length; i++) edges.add(edgeId(path[i - 1]!, path[i]!));
  }
  return nodes.size > 0 ? { nodes, edges } : null;
}

/** 一个在途请求在路由之后经过的那几站 */
function stationsOf(f: Flight, chain: Chain): string[] {
  const up = f.upstream;
  if (f.group != null) return up != null ? [chainId.group(f.group), chainId.upstream(up)] : [chainId.group(f.group)];
  if (up != null) return chain.middle ? [chainId.via(up), chainId.upstream(up)] : [chainId.upstream(up)];
  // 没有策略组、也没有上游接下：规则拒绝了它时画到拒绝。直连上游的规则在上游接下之前
  // 不画 —— 那一段线要一直连到上游，停在半路的一截读不出是什么
  const stations = chain.rules.get(f.route)?.get(f.rule);
  return stations?.[0] === chainId.deny ? [chainId.deny] : [];
}
