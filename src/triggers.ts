import type { Dashboard, Overview } from "./types";

/**
 * 高级功能的触发条件（DESIGN.md §0.6）。
 *
 * **不是「折叠到高级设置里」。**折叠面板仍然在告诉用户「这里有你不懂的
 * 东西」，那种焦虑不比直接显示小多少。条件不满足就**不出现**。
 *
 * 而条件要绑在「这个功能解决的问题存在吗」上，**不能绑在某个数量上** ——
 * 数量是偷懒的代理指标，很容易绑错。这个项目已经绑错过一次：把「路由」
 * 整体绑到 provider 数量，就把**单上游多模型**这个最常见的场景一起挡在
 * 了门外。
 *
 * 全都写在一个文件里，是为了让那条反面判据能被真的执行：
 *
 * > 一个只配了一个 API 的用户，会因为这个功能而多看到一样东西吗？
 *
 * 散在各个组件里的 `providers.length >= 2` 回答不了这个问题。
 */
export interface Triggers {
  /**
   * **一直有。**一个上游就有几十个模型 —— 让 opus 实际打到 sonnet、
   * 长上下文走 1M 版本、按模型限额，全都只需要一家上游，而这个问题从
   * 第一天就存在。
   */
  modelRouting: true;
  /** 有 ≥2 个 provider。只有一家的时候「切到哪儿」这个问题不存在 */
  failover: boolean;
  /** 有 ≥3 个 provider，且其中至少两个同类 */
  groups: boolean;
  /** 有 ≥2 个 provider **且** ≥2 个客户端在发请求 */
  perClientRouting: boolean;
  /** 熔断状态。只有一家时熔断本来就是旁路的，显示它没有意义 */
  health: boolean;
  /** 上游之间的对比（测速、延迟排行）。一家没得比 */
  comparison: boolean;
  /** 成本相关。**有过请求才出现** —— 一条都没有的时候它是个空壳 */
  cost: boolean;
}

// 订阅额度那条触发条件**故意不在这里**：界面上现在只有菜单栏显示它，
// 而那条路自己就能判断（有额度头就是订阅账号）。提前在这里接一个没人
// 用的开关，是在制造一个以后没人记得为什么存在的分支。

export function triggers(ov: Overview | null, d: Dashboard | null): Triggers {
  // 没有 overview 时（Dashboard 那条路），从历史里的上游名字数 ——
  // **问题存不存在，看的是实际发生过什么，不是配置里写了几个**
  const providers =
    ov?.providers.length ??
    new Set((d?.history ?? []).filter((r) => !r.local && r.provider).map((r) => r.provider)).size;
  // 「在发请求的客户端」不是「配置里的客户端」—— 配了三把 key 却只有
  // 一个客户端在用，那个问题同样不存在
  const activeClients = new Set((d?.history ?? []).filter((r) => !r.local).map((r) => r.client));
  const s = d?.summary;

  return {
    modelRouting: true,
    failover: providers >= 2,
    // 「至少两个同类」现在用协议近似：同协议的上游才是彼此的替补
    groups: providers >= 3 && hasTwoOfAKind(ov),
    perClientRouting: providers >= 2 && activeClients.size >= 2,
    health: providers >= 2,
    comparison: providers >= 2,
    // **有过请求才出现。**一个还没有任何数据的成本面板是在展示一个
    // 空壳，而它占的地方本来可以放「接下来该做什么」（§7.13）
    cost: !!s && (s.requests > 0 || s.locally_answered > 0),
  };
}

function hasTwoOfAKind(ov: Overview | null): boolean {
  const byProtocol = new Map<string, number>();
  for (const p of ov?.providers ?? []) {
    const k = p.protocol ?? "未知";
    byProtocol.set(k, (byProtocol.get(k) ?? 0) + 1);
  }
  return [...byProtocol.values()].some((n) => n >= 2);
}
