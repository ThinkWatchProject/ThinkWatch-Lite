import type { AttemptView, HistoryRow, Msg, Stay } from "./types";

/**
 * 一条请求的路由结论，给详情抽屉的「路由」那一页和几处列表用。全是 core 记下的事实
 * （`RoutingView`、失败的那一句），这里只把它们排成要显示的几行，不猜。
 */

/** 规则拒绝时 core 说的那一句：`gw.route.denied {rule, reason}`。码和参数名是契约 */
const DENIED = "gw.route.denied";
/** 网关密钥的用量上限拒绝时的那几句：`gw.key_limit.*`，一种量、一种周期一句 */
const KEY_LIMIT = "gw.key_limit.";
/** 能服务的上游都满着、等过了也没空出位置：`gw.busy_all {upstreams}` */
const BUSY_ALL = "gw.busy_all";

/**
 * 一条请求为什么没有上游接下：
 *
 * · `denied`：规则拒绝了它（选定上游之前）
 * · `unavailable`：规则选中的上游一个都接不了（停用、不在范围内、不提供这个模型）
 * · `limited`：这把网关密钥的用量上限拒绝了它（选定上游之后、发出之前）
 * · `busy`：能服务它的上游都满着（各自的并发上限），等过了也没空出位置
 *
 * 发往了上游的、本地应答的、还没有结局的是 `null`。
 *
 * **上游是空的就是没有发往任何上游**：core 只在请求一个上游都不会去时把上游记成空的
 * （本地应答另有 `local`）。是哪一种看失败的那一句：规则拒绝的是 `gw.route.denied`，
 * 用量上限的是 `gw.key_limit.*`，其余是选中的上游接不了。
 *
 * **`busy` 的上游不是空的**：那一行归在尝试链的最后一跳，也就是最后看过、满着的那一家。
 * 可那一家一个字节都没收到，结局也不是它的失败 —— 这一格写「并发已满」，不写它的名字
 */
export type NotSent = "denied" | "unavailable" | "limited" | "busy";

export function notSent(r: { local?: boolean; provider: string; error?: Msg | null }): NotSent | null {
  if (r.local || !r.error) return null;
  if (r.error.code === BUSY_ALL) return "busy";
  if (r.provider !== "") return null;
  if (r.error.code === DENIED) return "denied";
  return r.error.code.startsWith(KEY_LIMIT) ? "limited" : "unavailable";
}

/**
 * 尝试链里这家满着、没有发出去就换了下一家的一跳（`skipped`）。另一种没发出去的一跳 ——
 * 选定上游之后被规则拒绝 —— 由 `Hop.denied` 认
 */
export function skippedHop(a: AttemptView): boolean {
  return a.skipped != null;
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
 * · `switched`：前 `count` 跳没有接下它，换到了下一跳。其中有满着跳过的、或者开头超时
 *   放弃的 —— 那两种不是上游的失败，不说「失败」（每一跳为什么没接下在它自己那一行）
 * · `limited`：这把网关密钥的用量上限拒绝了它：没有发往任何上游
 * · `busy`：剩下的上游都满着，等过了也没空出位置。`tried` 是在那之前真的发出去、没成的
 *   几跳；0 就是没有发往任何上游
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
  | { kind: "switched"; count: number }
  | { kind: "limited" }
  | { kind: "busy"; tried: number }
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
  /**
   * 这段对话之前的去向起的作用：沿用了这一轮开头定下的路由（`heldRoute`），排在最前面的
   * 是上次回答它的那一家、为什么留下（`stayed`）。都没有的是 `null`
   */
  continuity: { heldRoute: boolean; stayed: Stay | null } | null;
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
  } else if ((why === "unavailable" || why === "limited" || why === "busy") && r.error) {
    // 用量上限的那一句说清是哪一条、用了多少、什么时候重置；满着的那一句列出是哪几家
    reason = { msg: r.error };
  }

  let note: RoutingNote | null = null;
  if (why === "busy") {
    // 满着跳过的几跳都没发出去。之前真的发出去、没成的那几跳另算
    note = { kind: "busy", tried: attempts.filter((a) => !skippedHop(a)).length };
  } else if (n === 0) {
    if (ruleDenied) note = { kind: "denied_before_pick", rule: routing.rule };
    else if (why === "unavailable") note = { kind: "unavailable" };
    else if (why === "limited") note = { kind: "limited" };
    else note = { kind: running ? "pending" : "none" };
  } else if (deniedBy) {
    // 被拒的那一跳不算切换成功：前面几跳失败、换过来，才被拒绝
    note =
      n > 1
        ? { kind: "failover_denied", failed: n - 1, rule: deniedBy }
        : { kind: "denied_after_pick", rule: deniedBy };
  } else if (n > 1) {
    // 满着跳过、开头超时放弃都不是上游的失败
    const plain = attempts.slice(0, -1).every((a) => !skippedHop(a) && a.outcome !== "slow_start");
    note = plain ? { kind: "failover", failed: n - 1 } : { kind: "switched", count: n - 1 };
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
    continuity:
      routing.affinity && (routing.affinity.held_route || routing.affinity.stayed)
        ? { heldRoute: routing.affinity.held_route, stayed: routing.affinity.stayed ?? null }
        : null,
  };
}
