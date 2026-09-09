import type { HistoryRow } from "./types";

/** 一个时间桶。 */
interface Bucket {
  at: number;
  requests: number;
  costMicros: number;
  failed: number;
}

/**
 * 把历史分成等宽的时间桶。
 *
 * **桶宽由跨度决定，不是固定的。**十分钟的数据分成一小时的桶，会得到
 * 一根柱子；一天的数据分成一分钟的桶，会得到一千根 —— 两种都不是图。
 */
export function bucketize(rows: HistoryRow[], now: number, count = 40): Bucket[] {
  const real = rows.filter((r) => !r.local);
  if (real.length === 0) return [];
  const oldest = Math.min(...real.map((r) => r.at_ms));
  // 至少给十分钟的跨度 —— 只有两条记录时，一个几秒宽的图没有意义
  const span = Math.max(now - oldest, 10 * 60_000);
  const width = span / count;
  const buckets: Bucket[] = Array.from({ length: count }, (_, i) => ({
    at: now - span + i * width,
    requests: 0,
    costMicros: 0,
    failed: 0,
  }));
  for (const r of real) {
    const i = Math.min(count - 1, Math.max(0, Math.floor((r.at_ms - (now - span)) / width)));
    const b = buckets[i];
    if (!b) continue;
    b.requests += 1;
    b.costMicros += r.cost_micros ?? 0;
    if (r.error) b.failed += 1;
  }
  return buckets;
}

/**
 * 最近一段时间的请求量。
 *
 * **画的是请求数，不是花费。**花费的柱子在一个便宜模型的会话里几乎全是
 * 零高度，而请求数在任何用法下都有形状 —— 这张图要回答的是「刚才发生了
 * 什么」，那是个节奏问题，不是金额问题（金额在上面那几个数字里）。
 *
 * 失败的那部分单独叠一层：**一段红色比一个「失败 3 条」的数字更容易在
 * 余光里被发现**，而这张图的用途正是扫一眼。
 */
export default function Sparkline({ rows, now }: { rows: HistoryRow[]; now: number }) {
  const buckets = bucketize(rows, now);
  if (buckets.length === 0) return null;
  const peak = Math.max(...buckets.map((b) => b.requests), 1);
  const w = 100;
  const h = 24;
  const bw = w / buckets.length;

  const span = now - (buckets[0]?.at ?? now);
  const label = span >= 3600_000 ? `${Math.round(span / 3600_000)} 小时` : `${Math.round(span / 60_000)} 分钟`;

  return (
    <div>
      <div className="flex items-baseline gap-2">
        <span className="text-xs text-neutral-500">最近 {label}</span>
        <span className="text-xs text-neutral-400">峰值 {peak} 条/格</span>
      </div>
      {/*
        用 SVG 而不是 canvas：这张图几十个矩形，而 SVG 跟着主题走、
        在缩放下不糊、也不必管 devicePixelRatio。
      */}
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="mt-1 h-8 w-full"
        role="img"
        aria-label={`最近 ${label}的请求量`}
      >
        {buckets.map((b, i) => {
          const total = (b.requests / peak) * h;
          const bad = (b.failed / peak) * h;
          return (
            <g key={b.at}>
              <rect
                x={i * bw}
                y={h - total}
                width={Math.max(bw - 0.4, 0.4)}
                height={total}
                className="fill-neutral-300 dark:fill-neutral-700"
              />
              {bad > 0 && (
                <rect
                  x={i * bw}
                  y={h - bad}
                  width={Math.max(bw - 0.4, 0.4)}
                  height={bad}
                  className="fill-red-400 dark:fill-red-500"
                />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
