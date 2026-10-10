/**
 * 上游余额的写法：上游表「额度 / 计费」一格、它的悬停、检测连接结果里的那一行。
 *
 * **纯函数**，不碰 React：钱包、总额度、时间窗口、读取失败各写成什么样，`balance.test.ts`
 * 一条条对。
 *
 * 一格里只画一样，**画最紧张的那一样**，和账号额度同一个道理：总额度和各个窗口里，已用
 * 比例最高的那个决定什么时候用完，其余的在悬停里。钱包说不出「用了多少」，跟在那一行
 * 后面；只有钱包时写余额，下面一行照旧是计费方式。余额、额度、窗口都没有，只知道用掉了
 * 多少的（不限额的密钥、没设额度的 OpenRouter 密钥），写「本月已用 $12.40」，不画条；
 * 花的是账号整体的（企业网关上没设限额的密钥），写「账号本月已用 $12.40」。读取失败、
 * 手上又没有读到过的数时，写一个琥珀色的「余额读取失败」；读到过的照常写那一份，失败
 * 只在悬停里。
 *
 * 数的单位：`USD` / `CNY` 是钱，`tokens` / `requests` 是计数，`unknown` 是上游没说按什么
 * 计的一个数（New API 站点没说它的额度怎么显示）—— **只写数，不带货币符号**，写成美元
 * 就说错了。
 */
import { compact, resetAt, whenMinute } from "@/format";
import { textOf } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import type { Balance, BalanceSource, BalanceWindow, ProviderView, Spent } from "@/types";
import { balanceText } from "./balance.i18n";
import { billingLabel, quotaWindowBefore, quotaWindowLabel } from "./labels";
import { labelsText } from "./labels.i18n";
import { quotaTone } from "./QuotaBar";

type Tone = ReturnType<typeof quotaTone>;

/** 余额从哪儿读的：服务的名字，中英一样 */
const SOURCES: Record<BalanceSource, string> = {
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  moonshot: "Moonshot",
  sub2api: "Sub2API",
  newapi: "New API",
  thinkwatch: "ThinkWatch",
};

/** 认不出来的来源原样写：core 多了一种，写出那个词比写「未知」好 */
export function sourceLabel(source: BalanceSource): string {
  return SOURCES[source] ?? source;
}

const SYMBOLS: Record<string, string> = { USD: "$", CNY: "¥" };

/** 上游没说数是按什么计的：只写数 */
const UNKNOWN = "UNKNOWN";

/**
 * 一笔钱。`$` 美元、`¥` 人民币，别的币种写代码（「EUR 12.50」）；单位是 `unknown` 的只写数
 * （「12.50」），不写成「UNKNOWN 12.50」。
 *
 * 格子里（默认）到分为止，整数不带小数（「$100」「$42.18」）；不到半分的正数写「<$0.01」
 * —— 写成「$0」等于说它一分钱都没有了。悬停里（`exact`）一律两位小数，不到一分的写到四位。
 */
export function cash(amount: number, currency: string, exact = false): string {
  const code = currency.toUpperCase();
  const sym = SYMBOLS[code];
  const put = (digits: string) => (sym ? `${sym}${digits}` : code === UNKNOWN ? digits : `${code} ${digits}`);
  if (amount < 0) return `-${cash(-amount, currency, exact)}`;
  if (exact) {
    const tiny = amount > 0 && amount < 0.01;
    return put(amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: tiny ? 4 : 2 }));
  }
  if (amount > 0 && amount < 0.005) return `<${put("0.01")}`;
  const cents = Math.round(amount * 100) / 100;
  const digits = Number.isInteger(cents) ? 0 : 2;
  return put(cents.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }));
}

/**
 * 一个数，不带单位：金额带符号（单位不明的只写数）；token 收成 k / M（悬停里写全），
 * 请求数写整数。限额多是整数（5M、500k）：收成「5.0M」的那个「.0」不写
 */
function figure(v: number, unit: string, exact: boolean): string {
  if (unit === "tokens") {
    return exact ? Math.round(v).toLocaleString("en-US") : compact(Math.round(v)).replace(/\.0(?=[kM]$)/, "");
  }
  if (unit === "requests") return Math.round(v).toLocaleString("en-US");
  return cash(v, unit, exact);
}

/** 计数的单位跟在后面（「1.2M token」「420 次」）；金额的符号已经在数前面了 */
function withUnit(s: string, unit: string): string {
  const t = textOf(balanceText).units;
  if (unit === "tokens") return t.tokens(s);
  if (unit === "requests") return t.requests(s);
  return s;
}

/** 一个数带单位：「$42.18」「1.2M token」 */
export function measure(v: number, unit: string, exact = false): string {
  return withUnit(figure(v, unit, exact), unit);
}

/** 一对数带单位：「$42.18 / $100」「1.2M / 5M token」 */
export function measurePair(a: number, b: number, unit: string, exact = false): string {
  return withUnit(`${figure(a, unit, exact)} / ${figure(b, unit, exact)}`, unit);
}

/** 已用的比例，可能过 100。总额是 0 或负数时说不出比例 */
export function usedPercent(used: number, limit: number): number | null {
  return limit > 0 ? (Math.max(0, used) / limit) * 100 : null;
}

/** 「剩余 $42.18 / $100」：总额减已用，用超了的写 0 */
function leftOf(x: { limit: number; used: number; unit: string }, exact = false): string {
  return textOf(balanceText).left(measurePair(Math.max(0, x.limit - x.used), x.limit, x.unit, exact));
}

/**
 * 还作数的窗口。**过了重置时刻的不算**：手上的数是重置之前读的，拿它画一根满格的条，
 * 说的是一件已经不成立的事（和账号额度同一条规矩）
 */
export function liveWindows(windows: readonly BalanceWindow[], now: number): BalanceWindow[] {
  return windows.filter((w) => w.resets_at_ms == null || w.resets_at_ms > now);
}

/** 还作数、说得出比例的窗口里最紧张的那个 */
export function tightestWindow(
  windows: readonly BalanceWindow[],
  now: number,
): { w: BalanceWindow; percent: number } | null {
  let best: { w: BalanceWindow; percent: number } | null = null;
  for (const w of liveWindows(windows, now)) {
    const percent = usedPercent(w.used, w.limit);
    if (percent !== null && (!best || percent > best.percent)) best = { w, percent };
  }
  return best;
}

/**
 * 多久之前读的：「刚刚读取」「3 分钟前读取」「2 小时前读取」，隔了一天以上写时刻。
 * 精确的时刻在悬停里
 */
export function readAgo(atMs: number, now: number): string {
  const t = textOf(balanceText).read;
  const mins = Math.floor((now - atMs) / 60_000);
  if (mins < 1) return t.now;
  if (mins < 60) return t.minutes(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.hours(hours);
  return t.at(whenMinute(atMs, now));
}

/**
 * 「本月已用 $12.40」；花的是账号整体的（`scope: user`，账号下几把密钥合计）写「账号本月
 * 已用 $12.40」，这把密钥自己的和没说的照旧。按 token 计的写成计数（「累计已用 1.2M token」）
 */
function spentOf(x: Spent, exact = false): string {
  const t = textOf(balanceText);
  return (x.scope === "user" ? t.accountSpent : t.spent)[x.period](measure(x.amount, x.currency, exact));
}

/** 「余额 $18.40」 */
function walletOf(w: NonNullable<Balance["wallet"]>, exact = false): string {
  return textOf(balanceText).wallet(measure(w.amount, w.currency, exact));
}

/** 本地日历上的日期：「2026-11-01」 */
function ymd(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 上游表「额度 / 计费」一格画什么 */
export type BalanceFace =
  /** 读取失败，手上没有读到过的数：琥珀色的标签，原因在悬停里；下面一行是计费方式 */
  | { kind: "failed"; reason: string }
  /**
   * 只有钱包：「余额 $18.40」；余额、额度、窗口都没有，只知道用掉多少：「本月已用 $12.40」。
   * 都不画条，下面一行是计费方式
   */
  | { kind: "wallet"; main: string }
  /**
   * 总额度最紧：「剩余 $42.18 / $100」（有钱包就接在后面）、条、从哪儿读的和多久前。
   * 总额是 0 时说不出比例：只写已用多少，不画条（`percent` 是 null）
   */
  | { kind: "quota"; main: string; percent: number | null; tone: Tone; sub: string }
  /**
   * 某个窗口最紧：和账号额度一个样子 ——「已用 86%」、窗口与多久后重置、条，下面一行是
   * 这个窗口还剩多少（有钱包就接在后面）。账号的限额（`scope: user`，账号下每把密钥共用）
   * 在那一行前面写「账号额度」，这把密钥自己的不用说
   */
  | { kind: "window"; window: string; used: string; label: string; percent: number; tone: Tone; sub: string };

/** 这一份余额在格子里的样子。没有余额、或者什么都没读到也没出错时是 null：那一格照旧说计费 */
export function balanceFace(b: Balance | null | undefined, now: number): BalanceFace | null {
  if (!b) return null;
  const t = textOf(balanceText);
  const wallet = b.wallet ? walletOf(b.wallet) : null;
  const q = b.quota;
  const qPercent = q ? usedPercent(q.used, q.limit) : null;
  const tight = tightestWindow(b.windows, now);
  if (tight && (qPercent === null || tight.percent > qPercent)) {
    const reset = resetAt(tight.w.resets_at_ms, now);
    const label = quotaWindowLabel(tight.w.window);
    return {
      kind: "window",
      window: tight.w.window,
      used: t.used(Math.round(tight.percent)),
      label: reset ? `${label} · ${reset}` : label,
      percent: tight.percent,
      tone: quotaTone(tight.percent),
      sub: [tight.w.scope === "user" && t.accountLimit, leftOf(tight.w), wallet].filter(Boolean).join(" · "),
    };
  }
  if (q) {
    return {
      kind: "quota",
      main: [qPercent === null ? t.usedAmount(measure(q.used, q.unit)) : leftOf(q), wallet].filter(Boolean).join(" · "),
      percent: qPercent,
      tone: quotaTone(qPercent ?? 0),
      sub: `${t.sourceQuota(sourceLabel(b.source))} · ${readAgo(b.read_at_ms, now)}`,
    };
  }
  if (wallet) return { kind: "wallet", main: wallet };
  if (b.spent) return { kind: "wallet", main: spentOf(b.spent) };
  if (b.error) return { kind: "failed", reason: coreText(b.error) };
  return null;
}

/**
 * 悬停里的每一行，数写全：从哪儿读的、什么时候；钱包；用掉多少；总额度；每个还作数的
 * 窗口（带它是这把密钥的还是账号的）；到期；最近一次失败。读取失败、没有读到过的数时
 * 只有来源和原因
 */
export function balanceTip(b: Balance, now: number): string[] {
  const t = textOf(balanceText);
  const source = sourceLabel(b.source);
  const face = balanceFace(b, now);
  if (!face || face.kind === "failed") return [source, ...(b.error ? [coreText(b.error)] : [])];
  const out = [`${source} · ${t.read.at(whenMinute(b.read_at_ms, now))}`];
  if (b.wallet) out.push(walletOf(b.wallet, true));
  if (b.spent) out.push(spentOf(b.spent, true));
  const q = b.quota;
  if (q) {
    out.push(
      q.limit > 0
        ? t.quotaLine(measurePair(q.used, q.limit, q.unit, true), measure(Math.max(0, q.limit - q.used), q.unit, true))
        : t.quotaUsed(measure(q.used, q.unit, true)),
    );
  }
  for (const w of liveWindows(b.windows, now)) {
    const percent = usedPercent(w.used, w.limit);
    if (percent === null) continue;
    out.push(
      t.windowLine(
        quotaWindowBefore(w.window),
        w.scope ? t.scopes[w.scope] : null,
        measurePair(w.used, w.limit, w.unit, true),
        Math.round(percent),
        resetAt(w.resets_at_ms, now),
      ),
    );
  }
  if (b.expires_at_ms != null) out.push(t.expires(ymd(b.expires_at_ms)));
  if (b.error) out.push(t.lastFailed(coreText(b.error)));
  return out;
}

/**
 * 检测连接结果里的一行：来源，和格子里写的那几样排成一行（总额度、钱包、最紧的窗口；
 * 这些都没有时是用掉多少）。读取失败、没有读到过的数时是失败的原因（`failed`，琥珀色）。
 * 没什么可说的是 null
 */
export function balanceBrief(
  b: Balance | null | undefined,
  now: number,
): { source: string; text: string; failed: boolean } | null {
  const face = balanceFace(b, now);
  if (!b || !face) return null;
  const t = textOf(balanceText);
  const source = sourceLabel(b.source);
  if (face.kind === "failed") return { source, text: t.failedReason(face.reason), failed: true };
  const q = b.quota;
  const tight = tightestWindow(b.windows, now);
  const parts = [
    q && (usedPercent(q.used, q.limit) === null ? t.usedAmount(measure(q.used, q.unit)) : leftOf(q)),
    b.wallet && walletOf(b.wallet),
    tight &&
      t.windowBrief(
        quotaWindowBefore(tight.w.window),
        tight.w.scope === "user" ? t.scopes.user : null,
        Math.round(tight.percent),
      ),
  ].filter(Boolean);
  if (parts.length === 0 && b.spent) parts.push(spentOf(b.spent));
  return { source, text: parts.join(" · "), failed: false };
}

/**
 * 只有钱包、或者读取失败时，那一格的第二行：「按量计费 · 默认价目表」「不计费」。
 * 没有余额的上游照旧是两行（计费方式，价目表），不用它
 */
export function billingLine(p: Pick<ProviderView, "billing" | "pricing">): string {
  if (p.billing !== "per-token") return billingLabel(p.billing);
  const sheet = p.pricing ? textOf(balanceText).sheet(p.pricing) : textOf(labelsText).defaultSheet;
  return `${billingLabel(p.billing)} · ${sheet}`;
}
