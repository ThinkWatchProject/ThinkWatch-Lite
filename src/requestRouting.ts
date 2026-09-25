import type { AttemptView, HistoryRow, Msg } from "./types";

/**
 * 一条请求的路由结论，给详情抽屉的「路由」那一页和几处列表用。全是 core 记下的事实
 * （`RoutingView`、失败的那一句），这里只把它们排成要显示的几行，不猜。
 */

/** 规则拒绝时 core 说的那一句：`gw.route.denied {rule, reason}`。码和参数名是契约 */
const DENIED = "gw.route.denied";

/**
 * 一条请求为什么没有发往任何上游：
 *
 * · `denied`：规则拒绝了它（选定上游之前）
 * · `unavailable`：规则选中的上游一个都接不了（停用、不在范围内、不提供这个模型）
 *
 * 发往了上游的、本地应答的、还没有结局的是 `null`。
 *
 * **上游是空的就是没有发往任何上游**：core 只在规则做了决定、请求却一个上游都不会去时
 * 把上游记成空的（本地应答另有 `local`）。是哪一种看失败的那一句：规则拒绝的是
 * `gw.route.denied`，其余是选中的上游接不了。
 */
export type NotSent = "denied" | "unavailable";

export function notSent(r: { local?: boolean; provider: string; error?: Msg | null }): NotSent | null {
  if (r.local || r.provider !== "" || !r.error) return null;
  return r.error.code === DENIED ? "denied" : "unavailable";
}

/** 尝试链里的一跳。`denied`：选定上游之后的规则在这一跳拒绝了它，**没有发给这个上游** */
export interface Hop {
  attempt: AttemptView;
  denied: boolean;
}

/**
 * 尝试链下面那一句。只说字面上成立的事：
 *
 * · `failover`：前 `failed` 个上游失败，换到了下一个（最后一跳的结果在它自己那一行）
 * · `failover_denied`：前 `failed` 个上游失败，换到下一个之后被规则 `rule` 拒绝，没有发给它
 * · `denied_after_pick`：唯一的那一跳被规则 `rule` 拒绝：没有发往任何上游
 * · `denied_before_pick`：选定上游之前规则 `rule` 就拒绝了它：没有发往任何上游
 * · `unavailable`：规则选中的上游都接不了：没有发往任何上游
 * · `pending`：还在跑，路由还没有结论
 * · `none`：没有尝试记录（上游应答之前客户端就走了、被请求防护挡下……）
 *
 * 一次就成的是 `null`：没有要说的。
 */
export type RoutingNote =
  | { kind: "failover"; failed: number }
  | { kind: "failover_denied"; failed: number; rule: string }
  | { kind: "denied_after_pick"; rule: string }
  | { kind: "denied_before_pick"; rule: string }
  | { kind: "unavailable" }
  | { kind: "pending" }
  | { kind: "none" };

/** 「原因」那一行：规则里写的拒绝理由（用户自己写的字），或者 core 说的那一句 */
export type RoutingReason = { text: string } | { msg: Msg };

export interface RoutingFacts {
  /** 走的哪条路由 */
  route: string;
  /** 决定去向的那条规则 */
  rule: string;
  /** 这条规则就是拒绝：选定上游之前就被拒绝了 */
  ruleDenied: boolean;
  group: string | null;
  /** 改写了参数的规则，**按求值的顺序**（先选上游之前的，再每一跳之后的） */
  rewrittenBy: string[];
  /** 选定上游之后才判断、拒绝了它的那条规则 */
  deniedBy: string | null;
  reason: RoutingReason | null;
  hops: Hop[];
  note: RoutingNote | null;
}

/** `gw.route.denied` 里规则写的那句理由。规则没写理由时是空的，当作没有 */
function denyReason(m: Msg | null | undefined): string | null {
  if (m?.code !== DENIED) return null;
  return m.args?.reason || null;
}

/**
 * 把一条请求的路由记录排成「路由」那一页要显示的样子。本地应答的没有路由，是 `null`。
 *
 * `running`：请求还在跑。那时尝试链是空的只是还没走完，不是没有尝试。
 */
export function routingFacts(
  r: Pick<HistoryRow, "routing" | "error" | "provider" | "local">,
  running: boolean,
): RoutingFacts | null {
  const routing = r.routing;
  if (!routing) return null;
  const attempts = routing.attempts;
  const n = attempts.length;
  const why = notSent(r);
  // 选定上游之前就被拒绝：一跳都没有，失败的那一句是规则拒绝
  const ruleDenied = n === 0 && why === "denied";
  const deniedBy = routing.denied_by ?? null;
  // 被拒的那一跳（链的最后一跳）自己带着那一句；它和请求失败的那一句是同一句
  const deniedHop = deniedBy && n > 0 ? attempts[n - 1] : undefined;

  let reason: RoutingReason | null = null;
  if (ruleDenied || deniedBy) {
    const text = denyReason(deniedHop?.error) ?? denyReason(r.error);
    reason = text ? { text } : null;
  } else if (why === "unavailable" && r.error) {
    reason = { msg: r.error };
  }

  let note: RoutingNote | null = null;
  if (n === 0) {
    if (ruleDenied) note = { kind: "denied_before_pick", rule: routing.rule };
    else if (why === "unavailable") note = { kind: "unavailable" };
    else note = { kind: running ? "pending" : "none" };
  } else if (deniedBy) {
    // 被拒的那一跳不算切换成功：前面几跳失败、换过来，才被拒绝
    note =
      n > 1
        ? { kind: "failover_denied", failed: n - 1, rule: deniedBy }
        : { kind: "denied_after_pick", rule: deniedBy };
  } else if (n > 1) {
    note = { kind: "failover", failed: n - 1 };
  }

  return {
    route: routing.route,
    rule: routing.rule,
    ruleDenied,
    group: routing.group ?? null,
    rewrittenBy: routing.rewritten_by,
    deniedBy,
    reason,
    hops: attempts.map((attempt, i) => ({ attempt, denied: deniedBy !== null && i === n - 1 })),
    note,
  };
}
