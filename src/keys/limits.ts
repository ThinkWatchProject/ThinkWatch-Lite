/**
 * 用量上限：对话框里一行一条，和 core 的 `KeyLimitView` / `KeyLimitInput` 来回换。密钥和上游
 * 用的是同一套（上游的是 `ProviderView::limits` / `ProviderInput::limits`）。
 *
 * **写得对不对由 core 的配置校验说**（`config.key_limit_*`、`config.upstream_limit_*`）。这里
 * 当场查的是同一套规则里填的时候就看得出来的几条：分钟、小时的「每 N」在 1–60 / 1–24 之间、
 * 要填、要大于 0、费用至少 $0.01、同一个周期同一种量（token 再分算不算缓存读取）只能有一条、
 * 天 / 周 / 月的上限要求请求记录至少留 1 / 7 / 31 天 —— 免得填完整张对话框，保存时才被拒。
 *
 * 分钟、小时是滚动的一段，可以是「每 5 分钟」（`every`）；天、周、月是自然的一期，`every`
 * 一直是 1。
 *
 * 费用在 core 那边是微分（`max`、`used`），输入框里是美元。
 */
import { compact } from "@/format";
import { textOf } from "@/i18n";
import { usd, type KeyLimitInput, type KeyLimitView, type LimitMeasure, type LimitPer } from "@/types";
import { limitsText } from "./limits.i18n";

export const PERS: readonly LimitPer[] = ["minute", "hour", "day", "week", "month"];
export const MEASURES: readonly LimitMeasure[] = ["requests", "tokens", "cost"];

/** 滚动的两种周期，「每 N」最多写几（core 的 `every` 规则） */
export const MAX_EVERY: Readonly<Partial<Record<LimitPer, number>>> = { minute: 60, hour: 24 };

/** 分钟、小时：滚动的一段，有「每 N」 */
export const isRolling = (per: LimitPer): boolean => MAX_EVERY[per] != null;

/**
 * 天、周、月的上限要求请求记录至少留几天：重启之后这一期的用量从记录里加回来，留得比一期
 * 短就加不全（core 的 `row_days_needed`）。分钟、小时的从空的开始，不要记录
 */
export const ROW_DAYS_NEEDED: Readonly<Partial<Record<LimitPer, number>>> = { day: 1, week: 7, month: 31 };

/** 费用上限最少多少，微分（$0.01，core 的 `COST_MIN`） */
export const COST_MIN_MICROS = 10_000;

/** 对话框里的一行 */
export interface LimitRow {
  /** 只在对话框里用：行的 key，当场校验按它认行 */
  id: number;
  per: LimitPer;
  /** 「每 N 分钟 / 小时」的 N，输入框里的字。天、周、月不看它 */
  every: string;
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

/** 一条上限的设定部分：core 的视图、输入，导入链接里的一条都有这几项 */
export type LimitSetting = Pick<KeyLimitView, "per" | "every" | "measure" | "max" | "cache_reads">;

/** 打开对话框时的那几行：照 core 给的，按配置里的顺序 */
export function rowsOf(views: readonly LimitSetting[] | undefined): LimitRow[] {
  return (views ?? []).map((v) =>
    limitRow({
      per: v.per,
      every: String(isRolling(v.per) ? v.every : 1),
      measure: v.measure,
      max: maxText(v.measure, v.max),
      cacheReads: v.cache_reads,
    }),
  );
}

/** 「每 N」的输入框只留得下数字 */
export function cleanEvery(raw: string): string {
  return raw.replace(/[^0-9]/g, "").slice(0, 2);
}

/**
 * 这一行的「每 N」：分钟 1 到 60、小时 1 到 24 的整数；天、周、月一直是 1。写得不对是 null
 */
export function everyOf(per: LimitPer, text: string): number | null {
  const most = MAX_EVERY[per];
  if (most == null) return 1;
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= most ? n : null;
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

/** 认作同一条的：同一个周期（连同「每 N」）、同一种量、缓存读取算法相同 */
function identity(per: LimitPer, every: number | null, measure: LimitMeasure, cacheReads: boolean): string {
  return `${per}:${isRolling(per) ? every : 1}:${measure}:${cacheReadsOf(measure, cacheReads)}`;
}

const rowIdentity = (r: LimitRow) => identity(r.per, everyOf(r.per, r.every), r.measure, r.cacheReads);

/**
 * 加一行时先给什么：**还没有的那一种**，免得一加上就和已有的重复。先按天算费用 ——
 * 管住一把密钥最常见的就是每天花多少；都有了就还是它，由当场校验说重复
 */
export function newRow(rows: readonly LimitRow[]): LimitRow {
  const taken = new Set(rows.map(rowIdentity));
  const order: LimitPer[] = ["day", "month", "week", "hour", "minute"];
  for (const measure of ["cost", "requests", "tokens"] as const) {
    for (const per of order) {
      if (!taken.has(identity(per, 1, measure, false)))
        return limitRow({ per, every: "1", measure, max: "", cacheReads: false });
    }
  }
  return limitRow({ per: "day", every: "1", measure: "cost", max: "", cacheReads: false });
}

export type LimitProblem = "every" | "required" | "notPositive" | "costTooSmall" | "duplicate" | "retention";

/**
 * 每一行有什么不对，按行的 id。**一行只说一件**，按一行从左到右的顺序：先说「每 N」不在
 * 范围里，再说要填，再说要大于 0，再说费用不到 $0.01，再说重复（和前面哪一行一样，就标在
 * 后面那一行上），最后说天、周、月的上限要记录留够天数（`ROW_DAYS_NEEDED`）。
 *
 * `rowDays`：此刻请求记录留几天（概览里的 `retention.row_days`）。不知道就不查这一条，
 * 保存时由 core 说
 */
export function limitProblems(rows: readonly LimitRow[], rowDays: number | null): Map<number, LimitProblem> {
  const out = new Map<number, LimitProblem>();
  const seen = new Set<string>();
  for (const r of rows) {
    const id = rowIdentity(r);
    const max = parseMax(r.measure, r.max);
    const need = ROW_DAYS_NEEDED[r.per];
    if (everyOf(r.per, r.every) == null) out.set(r.id, "every");
    else if (r.max.trim() === "") out.set(r.id, "required");
    else if (max == null) out.set(r.id, "notPositive");
    else if (r.measure === "cost" && max < COST_MIN_MICROS) out.set(r.id, "costTooSmall");
    else if (seen.has(id)) out.set(r.id, "duplicate");
    else if (need != null && rowDays != null && rowDays < need) out.set(r.id, "retention");
    seen.add(id);
  }
  return out;
}

/** 保存时交给 core 的。**只在没有问题时调用**：填得不对的行在这里会被略过 */
export function inputsOf(rows: readonly LimitRow[]): KeyLimitInput[] {
  return rows.flatMap((r) => {
    const max = parseMax(r.measure, r.max);
    const every = everyOf(r.per, r.every);
    return max == null || every == null
      ? []
      : [{ per: r.per, every, measure: r.measure, max, cache_reads: cacheReadsOf(r.measure, r.cacheReads) }];
  });
}

/** core 给的一条原样写回去（停用、启用这类只改别的字段的保存） */
export function inputOfView(v: LimitSetting): KeyLimitInput {
  return { per: v.per, every: v.every, measure: v.measure, max: v.max, cache_reads: v.cache_reads };
}

/**
 * 这一行此刻用了多少：core 给的那几条里，周期（连同「每 N」）、量、缓存读取算法都和这一行
 * 一样的那条。新加的、改成了另一种的没有 —— 保存之前 core 没数过它
 */
export function usageOf(row: LimitRow, views: readonly KeyLimitView[]): KeyLimitView | undefined {
  const id = rowIdentity(row);
  return views.find((v) => identity(v.per, v.every, v.measure, v.cache_reads) === id);
}

/** 一个用量或上限写成字：费用写美元，token 收成 k / M，请求数带千分位 */
export function amount(measure: LimitMeasure, n: number): string {
  if (measure === "cost") return usd(n);
  if (measure === "tokens") return compact(n);
  return n.toLocaleString("en-US");
}

/** 一条上限说成一句：「每天 $5.00 费用」「每 5 分钟 10,000,000 token」「1,000,000 tokens per day」。数字写全 */
export function limitPhrase(v: LimitSetting): string {
  const t = textOf(limitsText);
  const n = v.measure === "cost" ? usd(v.max) : v.max.toLocaleString("en-US");
  return t.phrase(t.span(v.per, isRolling(v.per) ? v.every : 1), n, v.measure, v.cache_reads);
}

/** 用量那一行开头说的是哪一段：「今天」「最近一分钟」「最近 5 分钟」 */
export function periodText(per: LimitPer, every: number): string {
  const t = textOf(limitsText);
  return isRolling(per) && every > 1 ? t.lastN(t.span(per, every)) : t.period[per];
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
