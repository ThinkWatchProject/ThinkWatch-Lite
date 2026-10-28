import type { CostBucket, UsageHistory } from "@/types";

/**
 * 「最近一年」热力图的纯计算：日期网格、等级、统计、连续天数。界面在 `Year.tsx`（文件名不能叫 `year.ts`：不分大小写的文件系统上 `./Year` 会先解析到它）。
 *
 * **日子一律按本地日历数，不加 86400000**：夏令时那两天一天是 23 或 25 小时，
 * 按毫秒往后数，零点就会滑到前一天的 23 点或当天的 1 点。
 */

export const DAY_MS = 86_400_000;
/** 网格有几列（周）。最右一列是本周 */
export const WEEKS = 53;
/** 「最近一年」是几天：今天和它前面的 364 天 */
export const YEAR_DAYS = 365;

export type YearMetric = "tokens" | "cost" | "requests";

/** 一天的合计 */
export interface DayUsage {
  requests: number;
  failed: number;
  /** 没命中缓存的输入加写入缓存的：和输出、缓存读取三项加起来就是 `tokens` */
  input: number;
  output: number;
  cacheRead: number;
  tokens: number;
  /** 微分：实测加估算 */
  cost: number;
  /** 其中估算的部分，微分 */
  estimated: number;
  /** 算不出费用的条数：没有价格的、没有用量的 */
  unpriced: number;
  noUsage: number;
}

/**
 * 一格的状态。
 *
 * · `future`：今天之后（本周还没过完的那几天），不画。
 * · `outside`：第一列里早于「最近一年」的那几天，不画。
 * · `unrecorded`：开始记录之前。**不是「没有用量」**：那时候还没在记。
 * · `none`：记着，那一天没有请求。
 * · `used`：有请求。
 */
export type DayState = "future" | "outside" | "unrecorded" | "none" | "used";

export interface Day {
  /** 那一天的本地零点 */
  at: number;
  /** 第二天的本地零点 */
  end: number;
  /** 第几列（周），0 是最早的那一周 */
  col: number;
  /** 第几行，0 是周一 */
  row: number;
  state: DayState;
  /** 只有 `used` 有 */
  usage: DayUsage | null;
}

/** 本地零点：那一刻所在的那一天 */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 从某一天的零点往后（往前）数几天，按日历 */
export function addDays(dayMs: number, n: number): number {
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

/**
 * 网格的第一天：本周的周一往前 52 周的那个周一，本地零点。取数从它起
 * （`UsageHistory` 的 `from_ms`）。
 */
export function gridStart(now: number): number {
  const today = startOfDay(now);
  // getDay()：周日是 0。换成周一是 0
  const back = (new Date(today).getDay() + 6) % 7;
  return addDays(today, -back - 7 * (WEEKS - 1));
}

/** 本地日历上的那一天，当作键 */
function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * 按本地日期合计后端给的格子。
 *
 * **拿格子起点往后 12 小时那一刻落在哪一天**：格子是 `from + k × 24 小时` 分的，过了夏令时
 * 切换的那一天，格子的起点就在本地的 23 点或 1 点上，直接拿起点对日期会错到前一天去。
 */
export function byDay(buckets: readonly CostBucket[]): Map<string, DayUsage> {
  const out = new Map<string, DayUsage>();
  for (const b of buckets) {
    const key = dayKey(b.at_ms + DAY_MS / 2);
    const u = out.get(key) ?? {
      requests: 0,
      failed: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      tokens: 0,
      cost: 0,
      estimated: 0,
      unpriced: 0,
      noUsage: 0,
    };
    u.requests += b.requests;
    u.failed += b.failed;
    u.input += b.input_tokens + b.cache_write_tokens;
    u.output += b.output_tokens;
    u.cacheRead += b.cache_read_tokens;
    u.tokens += b.input_tokens + b.cache_write_tokens + b.output_tokens + b.cache_read_tokens;
    u.cost += b.cost_micros_exact + b.cost_micros_estimated;
    u.estimated += b.cost_micros_estimated;
    u.unpriced += b.unpriced_requests;
    u.noUsage += b.no_usage_requests;
    out.set(key, u);
  }
  return out;
}

/**
 * 整张网格，按列排（`col * 7 + row`）：`WEEKS` 列 × 7 行。
 *
 * `history` 是 `null` 时（还在取、取不到）只排日子、不对数据：每一格都按「记着、没有请求」排，
 * 骨架拿它画同样的格子。
 */
export function layout(now: number, history: UsageHistory | null): Day[] {
  const today = startOfDay(now);
  const first = addDays(today, -(YEAR_DAYS - 1));
  const start = gridStart(now);
  const usage = history ? byDay(history.buckets) : null;
  const since = history ? history.since_ms : Number.NEGATIVE_INFINITY;
  const days: Day[] = [];
  for (let i = 0; i < WEEKS * 7; i++) {
    const at = addDays(start, i);
    const end = addDays(start, i + 1);
    const u = usage?.get(dayKey(at)) ?? null;
    const state: DayState =
      at > today
        ? "future"
        : at < first
          ? "outside"
          : since === null || end <= since
            ? "unrecorded"
            : u && u.requests > 0
              ? "used"
              : "none";
    days.push({ at, end, col: Math.floor(i / 7), row: i % 7, state, usage: state === "used" ? u : null });
  }
  return days;
}

/** 这一天画不画（今天之后、一年之前的不画） */
export function drawn(d: Day): boolean {
  return d.state !== "future" && d.state !== "outside";
}

/** 这一天在记录里（「最近一年」的统计只算这些） */
export function recorded(d: Day): boolean {
  return d.state === "none" || d.state === "used";
}

export function valueOf(d: Day, m: YearMetric): number {
  if (!d.usage) return 0;
  return m === "tokens" ? d.usage.tokens : m === "cost" ? d.usage.cost : d.usage.requests;
}

/**
 * 分级的三个切点：**有用量的日子**（这个指标大于 0 的）的四分位。返回 `[q1, q2, q3]`；
 * 一天都没有时是三个 0。
 */
export function thresholds(values: readonly number[]): [number, number, number] {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  const q = (p: number) => (v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))]! : 0);
  return [q(0.25), q(0.5), q(0.75)];
}

/** 0 是没有用量，1–4 由少到多 */
export function levelOf(v: number, th: readonly [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (!(v > 0)) return 0;
  if (v <= th[0]) return 1;
  if (v <= th[1]) return 2;
  if (v <= th[2]) return 3;
  return 4;
}

export interface YearStats {
  /** 选中指标的合计（费用是微分） */
  total: number;
  /** 费用的三态（不论选中的是哪个指标都给，费用的限定词用） */
  estimated: number;
  unpriced: number;
  noUsage: number;
  /** 有请求的日子 */
  usedDays: number;
  /** 合计除以有请求的日子。一天都没有是 `null` */
  average: number | null;
  /** 这个指标最多的那一天（并列取早的）。一天都没有是 `null` */
  peak: Day | null;
  /** 到今天为止连着有请求的天数。今天还没有请求的话从昨天数起 */
  streak: number;
  /** 记录里最长的一段 */
  longest: number;
}

/** 统计只算记录里的日子：开始记录之前的、今天之后的不算 */
export function statsOf(days: readonly Day[], m: YearMetric): YearStats {
  const rec = days.filter(recorded);
  let total = 0;
  let estimated = 0;
  let unpriced = 0;
  let noUsage = 0;
  let usedDays = 0;
  let peak: Day | null = null;
  let run = 0;
  let longest = 0;
  for (const d of rec) {
    const v = valueOf(d, m);
    total += v;
    if (d.usage) {
      estimated += d.usage.estimated;
      unpriced += d.usage.unpriced;
      noUsage += d.usage.noUsage;
    }
    if (d.state === "used") {
      usedDays += 1;
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
    if (v > 0 && (peak === null || v > valueOf(peak, m))) peak = d;
  }
  return {
    total,
    estimated,
    unpriced,
    noUsage,
    usedDays,
    average: usedDays > 0 ? total / usedDays : null,
    peak,
    streak: streakOf(rec),
    longest,
  };
}

/** 记录里的日子（按时间先后，最后一天是今天）到今天为止连着有请求的天数 */
export function streakOf(rec: readonly Day[]): number {
  let i = rec.length - 1;
  // 今天还没用：不算断，从昨天数起
  if (i >= 0 && rec[i]!.state !== "used") i -= 1;
  let n = 0;
  for (; i >= 0 && rec[i]!.state === "used"; i--) n += 1;
  return n;
}

/**
 * 每一列上面写不写月份：那一列的周一换了月就写（写的是月份，0 起）。
 *
 * **第一列太靠月底的不写**（周一在 21 号之后）：下一列多半就换月了，两个月份会挤在一起。
 */
export function monthLabels(days: readonly Day[]): (number | null)[] {
  const out: (number | null)[] = [];
  let prev = -1;
  for (let col = 0; col < WEEKS; col++) {
    const monday = new Date(days[col * 7]!.at);
    const m = monday.getMonth();
    let label: number | null = null;
    if (m !== prev) {
      if (!(col === 0 && monday.getDate() > 21)) label = m;
      prev = m;
    }
    out.push(label);
  }
  return out;
}

/** 这一天和 `[from, to)` 有没有交集（所选时间范围描边） */
export function overlaps(d: Day, from: number, to: number): boolean {
  return d.at < to && d.end > from;
}

/**
 * 方向键从第 `i` 格往哪走：左右是一周，上下是一天。走到画不出来的格子（一年之前、今天之后）
 * 或者出了网格就停在原地。`Home` / `End` 是最早的一天和今天。
 */
export function step(days: readonly Day[], i: number, key: string): number {
  const ok = (j: number) => j >= 0 && j < days.length && drawn(days[j]!);
  const to =
    key === "ArrowLeft"
      ? i - 7
      : key === "ArrowRight"
        ? i + 7
        : key === "ArrowUp"
          ? days[i]!.row > 0
            ? i - 1
            : -1
          : key === "ArrowDown"
            ? days[i]!.row < 6
              ? i + 1
              : -1
            : key === "Home"
              ? days.findIndex(drawn)
              : key === "End"
                ? lastDrawn(days)
                : -1;
  return ok(to) ? to : i;
}

function lastDrawn(days: readonly Day[]): number {
  for (let j = days.length - 1; j >= 0; j--) if (drawn(days[j]!)) return j;
  return -1;
}
