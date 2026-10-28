import type { CostBucketGroup, LatencyView } from "@/types";
import { additive, type Metric } from "./metric";
import { breakdown, type BreakdownRow } from "./series";

/**
 * 「去向」那张卡片的数：按模型、上游、密钥排出所选指标。
 *
 * **和明细表同一份合计**（`breakdown`：各格加成每个名字一行），只多一样流量。抽成纯函数
 * 是为了能测：排序、占比、没有值的项排在哪儿，写在 JSX 里没有东西会回答。
 */

/** 去向先列几行。超出的写出来有几项，**不静默丢掉** */
export const SPEND_ROWS = 5;

/** 一项（一个模型、上游或密钥）在这段时间里的合计，比明细表的那一行多上传加下载的字节 */
export interface SpendItem extends BreakdownRow {
  bytes: number;
}

/** 排好的一行 */
export interface SpendRow {
  item: SpendItem;
  /**
   * 所选指标的值：token、费用（微分）、请求、字节是合计；缓存命中是这一项自己的命中率
   * （0–1）；首 token 是这一项的 P50（毫秒）。**说不出的是 `null`**（没有送上下文、
   * 没有流式请求的样本）：不是 0，排在最后、画「—」
   */
  value: number | null;
  /** 占合计的比例（0–1）。只有能加起来的指标有，合计是 0 时也没有 */
  share: number | null;
  /** 条的长度（0–1），按最大的那一项归一 */
  bar: number;
}

/** 各项合计：底下那一行写它 */
export interface SpendTotal {
  /** 能加起来的指标：各项的和（费用另带三态，见 `rankCost`） */
  sum: number;
  cost: { cost: number; estimated: number; unpriced: number; noUsage: number };
  /** 整体命中率：各项读缓存之和除以上下文之和。没有上下文是 `null` */
  hit: number | null;
}

/** 把按格、按名字分的那份加成每个名字一项。顺序同明细表（请求多的在前） */
export function spendItems(groups: readonly CostBucketGroup[]): SpendItem[] {
  const bytes = new Map<string, number>();
  for (const g of groups) bytes.set(g.name, (bytes.get(g.name) ?? 0) + g.sent_bytes + g.received_bytes);
  return breakdown(groups).map((r) => ({ ...r, bytes: bytes.get(r.name) ?? 0 }));
}

/** 一项在所选指标上的值 */
export function valueOf(m: Metric, it: SpendItem, latency: ReadonlyMap<string, LatencyView>): number | null {
  switch (m) {
    case "tokens":
      return it.tokens;
    case "cost":
      return it.cost;
    case "requests":
      return it.requests;
    case "traffic":
      return it.bytes;
    case "cache":
      return it.ctx > 0 ? it.read / it.ctx : null;
    case "ttft":
      return latency.get(it.name)?.p50 ?? null;
  }
}

/**
 * 按所选指标从大到小排。说不出值的排在最后；一样大的按请求多少、再按名字，换指标时
 * 顺序不乱跳。
 */
export function rankSpend(
  m: Metric,
  items: readonly SpendItem[],
  latency: ReadonlyMap<string, LatencyView>,
): { rows: SpendRow[]; total: SpendTotal } {
  const add = additive(m);
  const valued = items.map((item) => ({ item, value: valueOf(m, item, latency) }));
  valued.sort(
    (a, b) =>
      (b.value ?? -Infinity) - (a.value ?? -Infinity) ||
      b.item.requests - a.item.requests ||
      a.item.name.localeCompare(b.item.name),
  );
  const max = Math.max(0, ...valued.map((x) => x.value ?? 0));
  const total: SpendTotal = {
    sum: add ? valued.reduce((s, x) => s + (x.value ?? 0), 0) : 0,
    cost: { cost: 0, estimated: 0, unpriced: 0, noUsage: 0 },
    hit: null,
  };
  let ctx = 0;
  let read = 0;
  for (const { item } of valued) {
    total.cost.cost += item.cost;
    total.cost.estimated += item.estimated;
    total.cost.unpriced += item.unpriced;
    total.cost.noUsage += item.noUsage;
    ctx += item.ctx;
    read += item.read;
  }
  total.hit = ctx > 0 ? read / ctx : null;
  const rows = valued.map(({ item, value }) => ({
    item,
    value,
    share: add && total.sum > 0 && value !== null ? value / total.sum : null,
    bar: max > 0 && value !== null ? value / max : 0,
  }));
  return { rows, total };
}

/**
 * 占比写成百分数。**有量就不写 0%**：不到百分之一的写「<1%」 —— 写成 0% 等于说它没用。
 * 真的是零才写 0%。
 */
export function shareText(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}
