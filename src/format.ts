/**
 * 表格里的显示格式。
 *
 * 抽出来是因为这几条都有「边界看起来对、其实不对」的地方，而它们错了
 * 不会报错，只会让一列数字读起来是错的。
 */

/**
 * 相对时间。
 *
 * 列表里要的是「刚才那条」而不是一个绝对时间戳 —— 排查时的定位方式是
 * 「我刚发的那次」。绝对时间留给悬停。
 *
 * **不做「刚刚」这种模糊档**：两条相差 3 秒的记录都显示「刚刚」，就没法
 * 按时间对上号了，而这一列存在的全部意义就是对号。
 */
export function ago(atMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - atMs) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/**
 * 首字节和总耗时合成一列。
 *
 * 非流式请求两者几乎相同（`253ms / 254ms`），两列占着宽度却只有一个
 * 信息。**只在它们真的差得开时才显示两个数** —— 那时差值本身就是结论：
 * 首字节快而总耗时长 = 模型在慢慢吐；两者都长 = 卡在网络或排队。
 *
 * 阈值 50ms：低于这个差别在感知上不存在，显示出来只是噪音。
 */
export function latency(
  ttfbMs: number | undefined,
  durationMs: number | undefined,
): string {
  if (durationMs == null) return ttfbMs != null ? `${ttfbMs}ms` : "—";
  if (ttfbMs == null) return `${durationMs}ms`;
  if (durationMs - ttfbMs < 50) return `${durationMs}ms`;
  return `${ttfbMs}→${durationMs}ms`;
}

/**
 * 字节数。
 *
 * 四位数以上换 KB —— 一列 `1486` 和 `85` 混排时，位数差本身会被误读成
 * 数量级差。
 */
export function bytes(n: number | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return String(n);
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}K`;
  return `${(n / 1024 / 1024).toFixed(1)}M`;
}

/**
 * 这一行的某个值和上一行是否相同。
 *
 * 相同就淡化 —— 一列 25 个 `relay` 以全权重重复，占掉宽度却零信息，
 * 而眼睛要找的恰恰是**变化的那一行**。抓包工具都这么做。
 *
 * **不省略，只淡化。**省略之后复制一行会缺字段，而「复制这一行」是
 * 右键菜单里就有的动作。
 */
export function repeated<T>(rows: T[], i: number, get: (r: T) => string): boolean {
  const prev = rows[i - 1];
  const cur = rows[i];
  if (i <= 0 || prev === undefined || cur === undefined) return false;
  return get(prev) === get(cur);
}

/** 状态码的语义分档。**眼睛要能一眼扫到那个 5xx。** */
export function statusTone(
  status: number | undefined,
  state: "in_flight" | "done" | "failed",
): "pending" | "ok" | "warn" | "bad" {
  if (state === "in_flight") return "pending";
  if (state === "failed") return "bad";
  if (status == null) return "ok";
  if (status >= 500) return "bad";
  if (status >= 400) return "warn";
  return "ok";
}

/** 一个时间桶（和 core 的 `/summary/buckets` 对应）。 */
export interface CostBucket {
  at_ms: number;
  requests: number;
  failed: number;
  cost_micros_exact: number;
  cost_micros_estimated: number;
  unpriced_requests: number;
}

/**
 * 把稀疏的桶补成稠密的一排。
 *
 * **core 刻意不补**：GROUP BY 只产出有数据的桶，而要画多少格只有界面
 * 知道。补空桶这件事必须做，但要在这里做。
 *
 * 为什么必须做：跳过空桶的话，一天里的空档会被两边的柱子挤没，图上
 * 看起来就是**连续在用** —— 而「昨天下午我根本没碰它」恰恰是看这张图
 * 想确认的事。一张会把「没用过」画成「在用」的图，比没有图更糟。
 */
export function densify(
  buckets: CostBucket[],
  sinceMs: number,
  untilMs: number,
  bucketMs: number,
): CostBucket[] {
  if (bucketMs <= 0 || untilMs <= sinceMs) return [];
  const by = new Map(buckets.map((b) => [b.at_ms, b]));
  const out: CostBucket[] = [];
  // 上限是防御性的：跨度和桶宽算出几万格时，那不是一张图，是一次卡死
  const n = Math.min(500, Math.ceil((untilMs - sinceMs) / bucketMs));
  for (let i = 0; i < n; i++) {
    const at = sinceMs + i * bucketMs;
    out.push(
      by.get(at) ?? {
        at_ms: at,
        requests: 0,
        failed: 0,
        cost_micros_exact: 0,
        cost_micros_estimated: 0,
        unpriced_requests: 0,
      },
    );
  }
  return out;
}
