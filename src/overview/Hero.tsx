import type { Dashboard } from "@/types";
import type { Range } from "@/ui/range";
import { CardGrid } from "./Cards";
import type { Metric } from "./metric";

/**
 * 用量：六个指标并排，选中的那个画成下面带坐标轴的大图。
 *
 * 占位：先沿用原来的六张指标卡，等这一块换上。
 */
export function Hero({
  d,
  range,
  scope,
  step,
}: {
  d: Dashboard;
  range: Range;
  /** 数据属于哪个区间（`rangeId`）：换了区间，数字直接落到新值 */
  scope: string;
  /** 历史档的格宽（`bucketOf`） */
  step: number;
  metric: Metric;
  onMetric: (m: Metric) => void;
}) {
  return <CardGrid d={d} range={range} scope={scope} step={step} />;
}
