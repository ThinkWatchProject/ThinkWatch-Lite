import type { RequestRow } from "./types";
import { coreText } from "@/i18n/core.i18n";

/**
 * 请求表的排序与过滤。
 *
 * **抽出来是因为它要能被测。**一个「按耗时排序」写在 JSX 里的
 * `.sort()`，它对进行中的行(没有耗时)怎么办、对失败的行怎么办，没有
 * 任何东西会回答；而这两种恰恰是排查时最该看见的行。
 */

export type SortKey = "time" | "duration" | "ttfb" | "tokens" | "cost" | "status";
export type SortDir = "asc" | "desc";

export interface Filter {
  /** 自由文本：客户端、上游、路径、模型都算 */
  q: string;
  /** 只看失败的 */
  failedOnly: boolean;
  /** 限定某个客户端。空串 = 不限 */
  client: string;
  /** 限定某个上游。空串 = 不限 */
  provider: string;
  /**
   * 只看没算出金额的。
   *
   * **「无法计价」在概览上是一个数字，而它该是一个可以点进来的问题** ——
   * 「533 条无法计价」告诉你有一批请求没进账，却不告诉你是哪些模型。
   */
  unpricedOnly: boolean;
}

export const EMPTY_FILTER: Filter = {
  q: "",
  failedOnly: false,
  client: "",
  provider: "",
  unpricedOnly: false,
};

export function hasAnyFilter(f: Filter): boolean {
  return (
    f.q !== "" ||
    f.failedOnly ||
    f.unpricedOnly ||
    f.client !== "" ||
    f.provider !== ""
  );
}

/**
 * 这一轮送进去的全部输入：新输入加缓存读取、缓存写入。
 *
 * **core 的「输入」不含缓存。**三者不重叠，加起来才是全部（和 Anthropic 的用量
 * 同一个口径，别家在 core 里换算成这个口径）。一轮带着五万 token 上下文的请求，
 * 新输入常常只有一两千 —— 只看它，「上下文有多大」就答不出来。上游没报用量时
 * 是 `undefined`，不是 0。
 */
export function promptTokens(r: RequestRow): number | undefined {
  if (r.inputTokens == null) return undefined;
  return r.inputTokens + (r.cacheReadTokens ?? 0) + (r.cacheWriteTokens ?? 0);
}

function valueOf(r: RequestRow, key: SortKey): number | null {
  switch (key) {
    case "time":
      return r.atMs;
    case "duration":
      return r.durationMs ?? null;
    case "ttfb":
      return r.ttfbMs ?? null;
    case "tokens": {
      // 按总量排。**只按输出排会把长上下文的那几次藏起来**，而那恰恰是
      // 账单上最贵的部分。输入算上缓存读写，见 `promptTokens`
      const prompt = promptTokens(r);
      return prompt != null && r.outputTokens != null ? prompt + r.outputTokens : null;
    }
    case "cost":
      return r.costMicros ?? null;
    case "status":
      return r.status ?? null;
  }
}

/**
 * 排序。
 *
 * **没有值的行永远排在最后，不管升序还是降序。**一个还在跑的请求没有
 * 耗时，把它当成 0 会让它在「最快」那一头堆成一片，把它当成无穷大会
 * 在「最慢」那一头堆成一片 —— 两种都是在用缺失值冒充一个测量结果。
 * 排在最后是唯一诚实的做法：它没有参与这次比较。
 */
export function sortRows(
  rows: RequestRow[],
  key: SortKey,
  dir: SortDir,
): RequestRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = valueOf(a, key);
    const y = valueOf(b, key);
    if (x == null && y == null) return b.atMs - a.atMs; // 都没有 → 按时间
    if (x == null) return 1;
    if (y == null) return -1;
    if (x === y) return b.atMs - a.atMs; // 并列 → 新的在前，顺序才稳定
    return (x - y) * sign;
  });
}

export function filterRows(rows: RequestRow[], f: Filter): RequestRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.failedOnly && r.state !== "failed") return false;
    /*
      **没算出金额，不等于金额是零。**跑完了、也报了用量，却没有单价
      的那些才是「无法计价」；还在跑的和失败的没有金额是另一回事，
      混进来会让「哪些模型该补价」这个问题答不出来。
    */
    if (f.unpricedOnly && (r.costMicros != null || r.state !== "done"))
      return false;
    if (f.client && r.client !== f.client) return false;
    if (f.provider && r.provider !== f.provider) return false;
    if (!q) return true;
    // 路径、密钥、应用、来源、上游、模型、错误信息都算 —— 排查时记得住的
    // 往往是错误里的那半句话，而不是哪个字段装着它。
    return (
      r.path.toLowerCase().includes(q) ||
      r.client.toLowerCase().includes(q) ||
      (r.hint ?? "").toLowerCase().includes(q) ||
      (r.peer ?? "").includes(q) ||
      r.provider.toLowerCase().includes(q) ||
      (r.model ?? "").toLowerCase().includes(q) ||
      coreText(r.error).toLowerCase().includes(q)
    );
  });
}

/** 出现过的客户端/上游，用来填过滤下拉。**按出现过的，不是按配置里的** */
export function facets(rows: RequestRow[]): {
  clients: string[];
  providers: string[];
} {
  const c = new Set<string>();
  const p = new Set<string>();
  for (const r of rows) {
    if (r.client) c.add(r.client);
    if (r.provider) p.add(r.provider);
  }
  return {
    clients: [...c].sort(),
    providers: [...p].sort(),
  };
}
