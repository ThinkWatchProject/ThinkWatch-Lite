/**
 * 一把密钥的用量上限：对话框里一行一条，和 core 的 `KeyLimitView` / `KeyLimitInput` 来回换。
 *
 * **写得对不对由 core 的配置校验说**（`config.key_limit_*`）。这里当场查的是同一套规则里
 * 填的时候就看得出来的几条：要填、要大于 0、同一个周期同一种量（token 再分算不算缓存
 * 读取）只能有一条、每月的要求请求记录至少留 31 天 —— 免得填完整张对话框，保存时才被拒。
 *
 * 费用在 core 那边是微分（`max`、`used`），输入框里是美元。
 */
import { compact } from "@/format";
import { textOf } from "@/i18n";
import { usd, type KeyLimitInput, type KeyLimitView, type LimitMeasure, type LimitPer } from "@/types";
import { limitsText } from "./limits.i18n";

export const PERS: readonly LimitPer[] = ["minute", "hour", "day", "week", "month"];
export const MEASURES: readonly LimitMeasure[] = ["requests", "tokens", "cost"];

/** 每月上限要求请求记录至少留这么多天：重启之后当月的用量从记录里加回来 */
export const MONTH_ROW_DAYS = 31;

/** 对话框里的一行 */
export interface LimitRow {
  /** 只在对话框里用：行的 key，当场校验按它认行 */
  id: number;
  per: LimitPer;
  measure: LimitMeasure;
  /** 输入框里的字。费用是美元（`5`、`0.5`），别的是整数 */
  max: string;
  /** 计入缓存读取。只有 token 上限有，别的量上一直是 false */
  cacheReads: boolean;
}

let seq = 0;

export function limitRow(r: Omit<LimitRow, "id">): LimitRow {
  seq += 1;
  return { id: seq, ...r };
}

/** 打开对话框时的那几行：照 core 给的，按配置里的顺序 */
export function rowsOf(views: readonly KeyLimitView[] | undefined): LimitRow[] {
  return (views ?? []).map((v) =>
    limitRow({ per: v.per, measure: v.measure, max: maxText(v.measure, v.max), cacheReads: v.cache_reads }),
  );
}

/** 上限写进输入框的样子。费用是微分，写成美元、到分，再往下的照实写：5_500_000 → `5.50`，125_000 → `0.125` */
export function maxText(measure: LimitMeasure, max: number): string {
  if (measure !== "cost") return String(max);
  return (max / 1e6).toFixed(6).replace(/(\.\d\d\d*?)0+$/, "$1");
}

/** 输入框里只留得下数字（费用再加一个小数点、最多到微分那一位） */
export function cleanMax(measure: LimitMeasure, raw: string): string {
  if (measure !== "cost") return raw.replace(/[^0-9]/g, "");
  const s = raw.replace(/[^0-9.]/g, "");
  const dot = s.indexOf(".");
  if (dot < 0) return s;
  return s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, "").slice(0, 6);
}

/** 输入框里的字 → 上限（费用是微分）。空的、不是正数的是 null */
export function parseMax(measure: LimitMeasure, text: string): number | null {
  const s = text.trim();
  if (measure === "cost") {
    if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
    const micros = Math.round(Number(s) * 1e6);
    return micros > 0 && Number.isSafeInteger(micros) ? micros : null;
  }
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}

/** 算不算缓存读取，只对 token 上限有意义 */
function cacheReadsOf(measure: LimitMeasure, cacheReads: boolean): boolean {
  return measure === "tokens" && cacheReads;
}

/** core 认作同一条的：同一个周期、同一种量、缓存读取算法相同 */
function identity(per: LimitPer, measure: LimitMeasure, cacheReads: boolean): string {
  return `${per}:${measure}:${cacheReadsOf(measure, cacheReads)}`;
}

/**
 * 加一行时先给什么：**还没有的那一种**，免得一加上就和已有的重复。先按天算费用 ——
 * 管住一把密钥最常见的就是每天花多少；都有了就还是它，由当场校验说重复
 */
export function newRow(rows: readonly LimitRow[]): LimitRow {
  const taken = new Set(rows.map((r) => identity(r.per, r.measure, r.cacheReads)));
  const order: LimitPer[] = ["day", "month", "week", "hour", "minute"];
  for (const measure of ["cost", "requests", "tokens"] as const) {
    for (const per of order) {
      if (!taken.has(identity(per, measure, false))) return limitRow({ per, measure, max: "", cacheReads: false });
    }
  }
  return limitRow({ per: "day", measure: "cost", max: "", cacheReads: false });
}

export type LimitProblem = "required" | "notPositive" | "duplicate" | "monthRetention";

/**
 * 每一行有什么不对，按行的 id。**一行只说一件**：先说要填，再说要大于 0，再说重复（和
 * 前面哪一行一样，就标在后面那一行上），最后说每月的上限要记录留够天数。
 *
 * `rowDays`：此刻请求记录留几天（概览里的 `retention.row_days`）。不知道就不查这一条，
 * 保存时由 core 说
 */
export function limitProblems(rows: readonly LimitRow[], rowDays: number | null): Map<number, LimitProblem> {
  const out = new Map<number, LimitProblem>();
  const seen = new Set<string>();
  for (const r of rows) {
    const id = identity(r.per, r.measure, r.cacheReads);
    if (r.max.trim() === "") out.set(r.id, "required");
    else if (parseMax(r.measure, r.max) == null) out.set(r.id, "notPositive");
    else if (seen.has(id)) out.set(r.id, "duplicate");
    else if (r.per === "month" && rowDays != null && rowDays < MONTH_ROW_DAYS) out.set(r.id, "monthRetention");
    seen.add(id);
  }
  return out;
}

/** 保存时交给 core 的。**只在没有问题时调用**：填得不对的行在这里会被略过 */
export function inputsOf(rows: readonly LimitRow[]): KeyLimitInput[] {
  return rows.flatMap((r) => {
    const max = parseMax(r.measure, r.max);
    return max == null ? [] : [{ per: r.per, measure: r.measure, max, cache_reads: cacheReadsOf(r.measure, r.cacheReads) }];
  });
}

/** core 给的一条原样写回去（停用、启用这类只改别的字段的保存） */
export function inputOfView(v: KeyLimitView): KeyLimitInput {
  return { per: v.per, measure: v.measure, max: v.max, cache_reads: v.cache_reads };
}

/**
 * 这一行此刻用了多少：core 给的那几条里，周期、量、缓存读取算法都和这一行一样的那条。
 * 新加的、改成了另一种的没有 —— 保存之前 core 没数过它
 */
export function usageOf(row: LimitRow, views: readonly KeyLimitView[]): KeyLimitView | undefined {
  const id = identity(row.per, row.measure, row.cacheReads);
  return views.find((v) => identity(v.per, v.measure, v.cache_reads) === id);
}

/** 一个用量或上限写成字：费用写美元，token 收成 k / M，请求数带千分位 */
export function amount(measure: LimitMeasure, n: number): string {
  if (measure === "cost") return usd(n);
  if (measure === "tokens") return compact(n);
  return n.toLocaleString("en-US");
}

/** 一条上限说成一句：「每天 $5.00 费用」「1,000,000 tokens per day」。数字写全 */
export function limitPhrase(v: Pick<KeyLimitView, "per" | "measure" | "max" | "cache_reads">): string {
  const t = textOf(limitsText);
  const n = v.measure === "cost" ? usd(v.max) : v.max.toLocaleString("en-US");
  return t.phrase(t.per[v.per], n, v.measure, v.cache_reads);
}

const DAY_MS = 24 * 3_600_000;

/**
 * 什么时候重置：一天之内只写钟点（「00:00 重置」），再远带上日期（「10月12日 00:00 重置」）。
 * 按这台机器的时区写 —— core 在别的时区时，钟点照样是同一个时刻
 */
export function resetText(atMs: number, nowMs: number): string {
  const t = textOf(limitsText);
  const d = new Date(atMs);
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (atMs - nowMs <= DAY_MS) return t.resets(t.at(hm));
  const date = new Intl.DateTimeFormat(t.locale, { month: "short", day: "numeric" }).format(d);
  return t.resets(t.on(date, hm));
}

/** 一把密钥有没有哪一条已经到了 */
export function anyReached(views: readonly KeyLimitView[] | undefined): boolean {
  return (views ?? []).some((v) => v.reached);
}

/** 这几把密钥里最早要重新算的那一刻（天、周、月的上限才有）。没有就是 null */
export function nextReset(keys: readonly { limits: readonly KeyLimitView[] }[] | undefined): number | null {
  let soonest: number | null = null;
  for (const k of keys ?? []) {
    for (const l of k.limits) {
      if (l.resets_at_ms != null && (soonest == null || l.resets_at_ms < soonest)) soonest = l.resets_at_ms;
    }
  }
  return soonest;
}
