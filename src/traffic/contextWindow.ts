import { compact } from "@/format";
import type { TurnContextParts, TurnView } from "@/types";

/**
 * 会话「对话」里每一轮头下那根上下文条的算术。界面在 `Conversation.tsx`（`ContextRow`）。
 *
 * **装了多满**：这一轮送进模型的是新输入加缓存读取（和「每轮输入 token」那张图同一个口径；
 * `TurnView` 里没有缓存写入），除以这一轮的模型的上下文窗口。缓存读取那一截单独画。
 */
export interface ContextFill {
  /** 送进模型的 token：新输入 + 缓存读取 */
  used: number;
  /** 其中缓存读取。上游没报缓存的是 `null`：条上没有那一截，也不写「缓存 0%」 */
  cached: number | null;
  /** 上下文窗口。不知道是 `null`：那就只写用了多少，不画条 */
  window: number | null;
  /** 条上填到哪儿（0–1）。窗口不知道是 `null`。**超过窗口的封到 1**：条画不出 110% */
  fill: number | null;
  /** 条上缓存读取那一截到哪儿（0–1），从 0 起；新输入那一截接在它后面到 `fill` */
  cachedFill: number | null;
  /** 缓存读取占送进去的几成，取整的百分数。一个 token 都没送的是 0 */
  cachedPct: number;
  /** 用了多少的写法：`128k`；知道窗口的是 `128k / 200k` */
  text: string;
}

/**
 * 这一轮的上下文条。**没有用量就没有条**（失败在响应之前的、被取消的、上游没报用量的）：
 * 返回 `null`，那一行不画。
 */
export function contextFill(v: Pick<TurnView, "input_tokens" | "cache_read_tokens" | "context_window">): ContextFill | null {
  if (v.input_tokens == null) return null;
  const cached = v.cache_read_tokens == null ? null : Math.max(0, v.cache_read_tokens);
  const used = Math.max(0, v.input_tokens) + (cached ?? 0);
  const window = v.context_window != null && v.context_window > 0 ? v.context_window : null;
  const frac = (n: number) => (window === null ? null : Math.min(1, n / window));
  return {
    used,
    cached,
    window,
    fill: frac(used),
    cachedFill: frac(cached ?? 0),
    cachedPct: used > 0 ? Math.round(((cached ?? 0) / used) * 100) : 0,
    text: window === null ? compact(used) : `${compact(used)} / ${compact(window)}`,
  };
}

/** 上下文的一部分：多少 token，占估算合计的几成（取整的百分数） */
export interface ContextShare {
  kind: "system" | "tools" | "history" | "last_user";
  tokens: number;
  pct: number;
}

/**
 * 四部分各占几成，按 core 估算的合计算。**合计是 0 时都写 0**，不除零；不按四项之和重算
 * 合计 —— 合计是 core 给的，界面不另算一个。
 */
export function contextShares(p: TurnContextParts): ContextShare[] {
  const pct = (n: number) => (p.total > 0 ? Math.round((n / p.total) * 100) : 0);
  return [
    { kind: "system", tokens: p.system, pct: pct(p.system) },
    { kind: "tools", tokens: p.tools, pct: pct(p.tools) },
    { kind: "history", tokens: p.history, pct: pct(p.history) },
    { kind: "last_user", tokens: p.last_user, pct: pct(p.last_user) },
  ];
}
