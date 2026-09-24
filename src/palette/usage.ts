/**
 * 命令面板里用过什么、用过几次。**只给这台机器上的这个窗口排序用**：最近用过的
 * 排进「最近使用」，常用的在搜索结果里靠前一点。
 *
 * 存在 localStorage 里。**读写都可能抛**（隐私窗口、禁用站点数据），抛了就当
 * 没有记录 —— 面板照常能用，只是没有「最近」。不跟着连接走：换一台 core，
 * 「新建密钥」还是常用的那个动作；那边没有的实体（某个上游）自然不会出现。
 */

export interface Use {
  /** 用过几次 */
  n: number;
  /** 最近一次的时刻 */
  at: number;
}

export type Usage = Record<string, Use>;

const KEY = "tw.palette.usage";
/** 最多记这么多条，多了去掉最久没用的 */
const MAX = 80;
/** 一周：常用程度按这个半衰期淡下去，很久以前常用的不一直占着前排 */
const HALF_LIFE_MS = 7 * 24 * 3_600_000;

export function loadUsage(storage: Pick<Storage, "getItem"> | null = safeStorage()): Usage {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Usage = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      const u = v as Partial<Use> | null;
      if (u && typeof u.n === "number" && typeof u.at === "number" && u.n > 0) out[id] = { n: u.n, at: u.at };
    }
    return out;
  } catch {
    return {};
  }
}

/** 记一次使用，返回记完之后的整份（调用方拿去更新自己的状态） */
export function recordUse(
  id: string,
  now = Date.now(),
  storage: Pick<Storage, "getItem" | "setItem"> | null = safeStorage(),
): Usage {
  const all = loadUsage(storage);
  const prev = all[id];
  all[id] = { n: (prev?.n ?? 0) + 1, at: now };
  const kept = Object.entries(all)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX);
  const next = Object.fromEntries(kept);
  try {
    storage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // 记不住只是下次没有「最近」，不值得打断任何事
  }
  return next;
}

/** 最近用过的，新的在前 */
export function recentIds(usage: Usage, limit: number): string[] {
  return Object.entries(usage)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, limit)
    .map(([id]) => id);
}

/**
 * 搜索时的加分，0–0.08。**只拿来分先后，不能让不相干的条目挤进来**：名字只沾一点
 * 边的（0.2 分）加满了也排不过名字开头就对上的（0.9）。
 */
export function usageBoost(u: Use | undefined, now = Date.now()): number {
  if (!u) return 0;
  const decay = Math.pow(0.5, Math.max(0, now - u.at) / HALF_LIFE_MS);
  return Math.min(0.08, Math.log2(1 + u.n) * 0.02 * decay);
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
