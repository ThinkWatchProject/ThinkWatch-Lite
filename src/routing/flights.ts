/**
 * 路由图上「正在走的路」：在途的请求各自经过哪几站。**纯函数**，听事件的是
 * `useFlights`。
 *
 * **只认 core 推来的事件，不猜：**
 * · `request_started`：哪把密钥发的。路由由密钥决定（密钥指定的那条，没指定的用默认
 *   路由），所以这时已经知道「密钥 → 路由」这一段。
 * · `request_routed`：经过哪个策略组、最后由哪个上游服务（尝试链的最后一跳）。到了这一条
 *   才画到上游 —— 之前只知道首选，故障转移之后服务它的可能是另一个。
 * · 三种结局：这条路随之熄灭。
 *
 * 半路才打开这一页时，已经在跑的请求从 `/in-flight` 补上。那里只有开始事件，所以这些
 * 请求只画到路由为止。
 */
import type { CoreEvent, Overview } from "@/types";
import { chainId, edgeId, type Chain } from "./chain";

export interface Flight {
  /** 发请求的密钥 */
  client: string;
  /** 已路由：经过的策略组（规则直接转发给上游时为空）和最后服务它的上游 */
  routed: { group: string | null; upstream: string } | null;
}

/**
 * 一条事件落到在途请求上（原地改 `flights`）。返回 `"changed"`：图要重画；`"ended"`：
 * 这个请求走完了，什么时候拿掉由调用方定（留一小会儿，短请求也看得见）；`null`：
 * 和在途请求无关。
 */
export function applyFlightEvent(flights: Map<number, Flight>, ev: CoreEvent): "changed" | "ended" | null {
  switch (ev.kind) {
    case "request_started":
      flights.set(ev.id, { client: ev.client, routed: null });
      return "changed";
    case "request_routed": {
      const f = flights.get(ev.id);
      const last = ev.attempts[ev.attempts.length - 1];
      if (!f || !last) return null;
      flights.set(ev.id, { ...f, routed: { group: ev.group ?? null, upstream: last.provider } });
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
export function activityOf(
  flights: ReadonlyMap<number, Flight>,
  ov: Pick<Overview, "clients" | "routes">,
  chain: Chain,
): Activity | null {
  if (flights.size === 0) return null;
  const onMap = new Set(chain.nodes.map((n) => n.id));
  const defaultRoute = ov.routes.find((r) => r.default)?.name ?? null;
  const nodes = new Map<string, number>();
  const edges = new Set<string>();
  for (const f of flights.values()) {
    const key = ov.clients.find((c) => c.name === f.client);
    const route = key ? (key.route ?? defaultRoute) : null;
    if (!key || route == null) continue;
    const ids = [chainId.key(key.name), chainId.route(route)];
    if (f.routed) {
      const { group, upstream } = f.routed;
      if (group != null) ids.push(chainId.group(group));
      else if (chain.middle) ids.push(chainId.via(upstream));
      ids.push(chainId.upstream(upstream));
    }
    const cut = ids.findIndex((id) => !onMap.has(id));
    const path = cut < 0 ? ids : ids.slice(0, cut);
    for (const id of path) nodes.set(id, (nodes.get(id) ?? 0) + 1);
    for (let i = 1; i < path.length; i++) edges.add(edgeId(path[i - 1]!, path[i]!));
  }
  return nodes.size > 0 ? { nodes, edges } : null;
}
