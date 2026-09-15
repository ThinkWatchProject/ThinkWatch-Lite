import { Tip } from "@/ui/tip";

/**
 * 概览上的两种图。
 *
 * **手写 SVG，不引图表库。**recharts 是给 Web 后台的：坐标轴、图例、
 * 响应式容器、动画 —— 一百多 KB 里我们要的只有「一排柱子」和「一排
 * 横条」。而它的默认视觉（圆角柱、渐变、浮动图例）在一个菜单栏应用里
 * 一眼就是网页。
 *
 * 两种图共用同一条纪律：**没有数据的那一格要画出来，不能跳过**。
 * 跳过的话，一天里的空档会被两边的柱子挤没，图上看起来就是连续在用 ——
 * 而「昨天下午我根本没用」正是看这张图想确认的事。
 */

/** 一根柱子。`value` 是主高度，`sub` 叠在上面（失败/估算那部分）。 */
export interface Bar {
  at: number;
  value: number;
  sub?: number;
  label: string;
}

export function BarChart({
  bars,
  height = 56,
  /** 主色之外，叠加部分的色。默认是失败的红 */
  subClass = "fill-red-500/70",
  barClass = "fill-neutral-400 dark:fill-neutral-600",
  empty,
}: {
  bars: Bar[];
  height?: number;
  subClass?: string;
  barClass?: string;
  empty?: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value + (b.sub ?? 0)));
  if (bars.length === 0) {
    return <p className="tw-label text-neutral-500">{empty ?? "还没有数据"}</p>;
  }
  // 柱宽按格子数平分，留 1px 缝。**不设最小宽度** —— 一格窄到 2px 也
  // 要画，那正是「这段时间几乎没用」的形状。
  const w = 100 / bars.length;
  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
    >
      {bars.map((b, i) => {
        const total = b.value + (b.sub ?? 0);
        const h = (total / max) * height;
        const subH = ((b.sub ?? 0) / max) * height;
        return (
          <Tip key={b.at} text={b.label} side="top">
            <g>
              {/* 透明的整列热区：柱子矮的时候也要能悬停到 */}
              <rect x={i * w} y={0} width={w} height={height} className="fill-transparent" />
              {h > 0 && (
                <rect
                  x={i * w + 0.15}
                  y={height - h}
                  width={Math.max(0.2, w - 0.3)}
                  height={h - subH}
                  className={barClass}
                />
              )}
              {subH > 0 && (
                <rect
                  x={i * w + 0.15}
                  y={height - subH}
                  width={Math.max(0.2, w - 0.3)}
                  height={subH}
                  className={subClass}
                />
              )}
            </g>
          </Tip>
        );
      })}
    </svg>
  );
}

/**
 * 横条排行（钱花在哪儿）。
 *
 * 横条而不是饼图：**饼图比不出 12% 和 15%**，而这张图的用途恰恰是排序
 * 和比例。条目也不多，前五个之外的意义很小。
 */
export function BarRows({
  rows,
  unit,
}: {
  rows: { name: string; value: number; note?: string }[];
  unit: (v: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) {
    return <p className="tw-label text-neutral-500">还没有数据</p>;
  }
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span className="w-40 shrink-0 truncate tw-body">{r.name}</span>
          <div className="relative h-3 min-w-0 flex-1 overflow-hidden rounded-sm bg-neutral-200/60 dark:bg-neutral-800">
            <div
              className="h-full rounded-sm bg-neutral-400 dark:bg-neutral-600"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
          <span className="w-20 shrink-0 text-right tw-body tw-num">{unit(r.value)}</span>
          {r.note && (
            <span className="w-24 shrink-0 tw-label text-amber-700 dark:text-amber-400">
              {r.note}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
