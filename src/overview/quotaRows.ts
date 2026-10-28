/**
 * 概览「额度与余额」那一块的行：哪几个上游说得出额度或余额，每一行画什么。
 *
 * **读法和说法照上游页**（只读引用，不改那边）：订阅额度窗口过了重置时刻的不算
 * （`UpstreamTable` 的 `QuotaCell`），积分写上游给的剩余（`quotaLeft`），余额有没有可说的、
 * 读取失败时说什么看 `balanceFace`，悬停用 `balanceTip`，紧张不紧张按 `quotaTone`
 * （八成琥珀、用满红）。
 *
 * 纯函数，`quotaRows.test.ts` 一条条对。
 */
import { textOf } from "@/i18n";
import type { Balance, Dashboard, Overview, ProviderView, QuotaWindow } from "@/types";
import { balanceText } from "@/upstreams/balance.i18n";
import { balanceFace, balanceTip, liveWindows, measure, measurePair, sourceLabel, usedPercent } from "@/upstreams/balance";
import { protocolLabel, quotaLeft, quotaWindowLabel } from "@/upstreams/labels";
import { labelsText } from "@/upstreams/labels.i18n";
import { quotaTone } from "@/upstreams/QuotaBar";
import { quotaText } from "./Quota.i18n";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * 下一次重置的时刻。**一天以内只写钟点**（「16:32」：不会和明天的同一时刻弄混），更远的
 * 带上本地日历的月日（「11-01 21:00」）。已经过了的是 null（那个窗口作废了，见上）。
 */
export function resetClock(atMs: number | null | undefined, now: number): string | null {
  if (atMs == null || atMs <= now) return null;
  const d = new Date(atMs);
  const clock = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return atMs - now < DAY ? clock : `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock}`;
}

/** 一根条：一个额度窗口，或余额接口给的总额度 */
export interface Gauge {
  key: string;
  /** 「5 小时」「每周」「总额度」 */
  label: string;
  /** 已用的比例，0–100，可能过 100 */
  percent: number;
  tone: ReturnType<typeof quotaTone>;
  /** 还剩多少：积分制窗口的剩余积分、余额窗口的「剩余 $42.18 / $100」。没有是 null */
  left: string | null;
  /** 什么时候重置。上游没说、或者是总额度，是 null */
  resetsAt: number | null;
  /** 悬停里那一句 */
  tip: string;
}

/** 一行：一个上游 */
export interface QuotaRow {
  provider: ProviderView;
  /** 名字后面那个词：「ChatGPT 账号」「账号登录」「余额」、余额的来源。没有是 null */
  kind: string | null;
  gauges: Gauge[];
  /** 最近要重置的那一刻（右上角）。没有窗口说得出是 null */
  reset: number | null;
  /** 钱包余额（右上角的大数）。没有是 null */
  amount: string | null;
  /** 下面那一行：用掉多少（没有上限可比的）、总额度说不出比例时的已用 */
  sub: string | null;
  /** 余额读取失败、手上又没有读到过的数：core 说的原因。别的时候是 null */
  failed: string | null;
  /** 余额那几行悬停（`balanceTip`）。没有余额是 null */
  tip: string[] | null;
}

function gaugeOf(
  key: string,
  label: string,
  percent: number,
  left: string | null,
  resetsAt: number | null,
  now: number,
): Gauge {
  const q = textOf(quotaText);
  const clock = resetClock(resetsAt, now);
  return {
    key,
    label,
    percent,
    tone: quotaTone(percent),
    left,
    resetsAt,
    tip: q.gaugeTip(label, Math.round(percent), left, clock && q.resetAt(clock)),
  };
}

/** 订阅额度（`/quota`）的窗口，过了重置时刻的不算 */
function quotaGauges(windows: readonly QuotaWindow[], now: number): Gauge[] {
  return windows
    .filter((w) => w.resets_at_ms == null || w.resets_at_ms > now)
    .map((w) => gaugeOf(`q:${w.window}`, quotaWindowLabel(w.window), w.used_percent, quotaLeft(w), w.resets_at_ms ?? null, now));
}

/** 余额接口给的总额度和时间窗口，说得出比例的才画条 */
function balanceGauges(b: Balance, now: number): Gauge[] {
  const bt = textOf(balanceText);
  const out: Gauge[] = [];
  const q = b.quota;
  const qp = q ? usedPercent(q.used, q.limit) : null;
  if (q && qp !== null) {
    const left = bt.left(measurePair(Math.max(0, q.limit - q.used), q.limit, q.unit));
    out.push(gaugeOf("b:total", textOf(quotaText).total, qp, left, null, now));
  }
  for (const w of liveWindows(b.windows, now)) {
    const p = usedPercent(w.used, w.limit);
    if (p === null) continue;
    const left = bt.left(measurePair(Math.max(0, w.limit - w.used), w.limit, w.unit));
    // 账号下每把密钥共用的限额要说一声，这把密钥自己的不用说（同上游页）
    const label = w.scope === "user" ? textOf(quotaText).scoped(quotaWindowLabel(w.window), bt.scopes.user) : quotaWindowLabel(w.window);
    out.push(gaugeOf(`b:${w.window}:${w.scope ?? ""}`, label, p, left, w.resets_at_ms, now));
  }
  return out;
}

/** 名字后面那个词：怎么登录的（订阅额度），或者余额从哪儿读的 */
function kindOf(p: ProviderView, hasQuota: boolean, b: Balance | null): string | null {
  if (hasQuota) {
    if (p.protocol === "chatgpt") return protocolLabel("chatgpt");
    if (p.signed_in) return textOf(labelsText).accountSignIn;
  }
  if (b?.wallet) return textOf(quotaText).wallet;
  if (b) return sourceLabel(b.source);
  return null;
}

/**
 * 说得出额度或余额的上游，顺序同上游页。**停用的不列**：那是有意关掉的，它的额度和余额
 * 这时说明不了什么。
 */
export function quotaRows(d: Pick<Dashboard, "quotas">, ov: Pick<Overview, "providers"> | null, now: number): QuotaRow[] {
  if (!ov) return [];
  const bt = textOf(balanceText);
  const out: QuotaRow[] = [];
  for (const p of ov.providers) {
    if (p.disabled) continue;
    const gauges = quotaGauges(d.quotas?.find((q) => q.provider === p.name)?.windows ?? [], now);
    const hasQuota = gauges.length > 0;
    const face = p.balance ? balanceFace(p.balance, now) : null;
    const b = face ? p.balance : null;
    if (!hasQuota && !b) continue;
    let amount: string | null = null;
    let sub: string | null = null;
    let failed: string | null = null;
    if (b && face) {
      gauges.push(...balanceGauges(b, now));
      if (face.kind === "failed") failed = face.reason;
      if (b.wallet) amount = measure(b.wallet.amount, b.wallet.currency);
      const q = b.quota;
      if (q && usedPercent(q.used, q.limit) === null) sub = bt.usedAmount(measure(q.used, q.unit));
      else if (b.spent) sub = (b.spent.scope === "user" ? bt.accountSpent : bt.spent)[b.spent.period](measure(b.spent.amount, b.spent.currency));
    }
    const resets = gauges.flatMap((g) => (g.resetsAt != null && g.resetsAt > now ? [g.resetsAt] : []));
    out.push({
      provider: p,
      kind: kindOf(p, hasQuota, b),
      gauges,
      reset: resets.length > 0 ? Math.min(...resets) : null,
      amount,
      sub,
      failed,
      tip: b ? balanceTip(b, now) : null,
    });
  }
  return out;
}
