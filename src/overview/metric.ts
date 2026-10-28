/**
 * 「用量」那张卡片上六个指标里选中的那一个。
 *
 * **一个选择管两处**：大图画它，「去向」按它排。放在页面这一层（`OverviewPage`），
 * 换时间范围时不丢。
 */
export type Metric = "tokens" | "cost" | "requests" | "cache" | "ttft" | "traffic";

export const METRICS: readonly Metric[] = ["tokens", "cost", "requests", "cache", "ttft", "traffic"];

/** 能加起来的几样：去向写得出占比，热力图能按天合计 */
export function additive(m: Metric): boolean {
  return m === "tokens" || m === "cost" || m === "requests" || m === "traffic";
}
