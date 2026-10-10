import { useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { prefersReducedMotion } from "@/ui/motion";
import { lineGeometry, peakOf } from "./geometry";

/**
 * 指标卡上的小图：一两条线，或者一排请求柱。
 *
 * **克制**：细线（1.75px）加一片很淡的面，不画纵轴、不画格线，横轴只在卡片底下标首尾
 * 两头。读的是形状 —— 什么时候多、什么时候少；量有多大写在卡片上那个大数里。没有入场
 * 动画：每次刷新都重演一遍的图，读的人得等它演完。
 *
 * **竖线是联动的**：指着任何一张小图，每一张都在同一个时刻画出竖线和圆点（请求柱是那
 * 一格亮着、别的压淡），数值提示只出现在指着的那一张上。哪一格由卡片网格按时刻算好交
 * 进来（`cursor`），这里只管画。
 */

/** 小图多高。线画在 6px 到 60px 之间：顶上留出圆点的半径，底下留出基线 */
export const SPARK_H = 64;
const TOP = 6;
const BASE = 60;

export interface ChartProps {
  /** 一共几格 */
  n: number;
  /** 联动的那一格：指着的时刻落在这张图的哪一格。不在这张图上、没在指着是 `null` */
  cursor: number | null;
  /** 指针在这张图上指到第几格；离开是 `null` */
  onPoint: (i: number | null) => void;
  /** 只在指针所在的那张图上给：提示框的抬头和数值 */
  tip: { title: string; value: string } | null;
  /** 读屏念的一句话：这张图画的是什么 */
  label: string;
}

/** 一条线 */
export interface Line {
  values: readonly (number | null)[];
  /** CSS 颜色，取 `--data-*` */
  color: string;
  /** 主要的那条：粗一点。对照的那条细一点、淡一点 */
  main?: boolean;
  /** 线下面铺一片淡色。数量（token、费用、流量）铺，分位（首 token）不铺：延迟没有「多少」 */
  wash?: boolean;
}

/**
 * 一两条线。第一条是主要的（蓝），第二条是对照的（橙）。没有样本的格子（`null`）不画
 * 实线，用一段淡的虚线把两头接上（见 `lineGeometry`）。
 */
export function LineChart({ lines, ...p }: ChartProps & { lines: readonly Line[] }) {
  const gid = useId().replace(/:/g, "");
  const max = peakOf(...lines.map((l) => l.values));
  return (
    <Frame {...p} kind="line">
      {(w) => {
        const xs = Array.from({ length: p.n }, (_, i) => xAt(i, p.n, w));
        const y = (v: number) => BASE - (v / max) * (BASE - TOP);
        // 后画的在上面：对照的那条先画，主要的那条压在它上面
        const drawn = lines.map((l, i) => ({ l, i, geo: lineGeometry(l.values, xs, y, SPARK_H) })).reverse();
        const at = p.cursor;
        // 竖线只在这一格有数的时候画：空档里没有点可指
        const hits = at === null ? [] : lines.flatMap((l) => (l.values[at] == null ? [] : [{ l, v: l.values[at]! }]));
        return (
          <svg aria-hidden width={w} height={SPARK_H} className="absolute top-0 left-0 overflow-visible">
            <defs>
              {lines.map((l, i) =>
                l.wash ? (
                  <linearGradient key={i} id={`${gid}-wash-${i}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor={l.color} style={{ stopOpacity: "var(--data-wash)" }} />
                    <stop offset="1" stopColor={l.color} stopOpacity={0} />
                  </linearGradient>
                ) : null,
              )}
              {/*
                竖线的渐变按**整张图的坐标**铺（userSpaceOnUse）：按它自己的外框铺的话，一条
                竖线的外框宽度是零，渐变画不出来
              */}
              <linearGradient id={`${gid}-cursor`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={SPARK_H}>
                <stop offset="0" stopColor="var(--brand-from)" />
                <stop offset="1" stopColor="var(--brand-to)" />
              </linearGradient>
            </defs>
            {drawn.map(({ l, i, geo }) => {
              return (
                <g key={i}>
                  {l.wash && geo.area && <path d={geo.area} fill={`url(#${gid}-wash-${i})`} />}
                  {geo.gap && (
                    <path
                      d={geo.gap}
                      fill="none"
                      stroke={l.color}
                      strokeWidth={1.25}
                      strokeDasharray="2 4"
                      strokeLinecap="round"
                      opacity={0.45}
                    />
                  )}
                  {geo.line && (
                    <path
                      d={geo.line}
                      fill="none"
                      stroke={l.color}
                      strokeWidth={l.main ? 1.75 : 1.5}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      opacity={l.main ? 1 : 0.85}
                    />
                  )}
                  {geo.dots.map((d) => (
                    <circle key={`${d.x}`} cx={d.x} cy={d.y} r={1.75} fill={l.color} />
                  ))}
                </g>
              );
            })}
            {at !== null && hits.length > 0 && (
              <>
                <line
                  x1={xs[at]}
                  x2={xs[at]}
                  y1={0}
                  y2={SPARK_H}
                  stroke={`url(#${gid}-cursor)`}
                  strokeWidth={1.25}
                />
                {[...hits].reverse().map(({ l, v }) => (
                  <circle
                    key={l.color}
                    cx={xs[at]}
                    cy={y(v)}
                    r={l.main ? 4 : 3.5}
                    fill={l.color}
                    stroke="var(--panel)"
                    strokeWidth={2}
                  />
                ))}
              </>
            )}
          </svg>
        );
      }}
    </Frame>
  );
}

/**
 * 一排请求柱：每一格的请求数，其中失败的那一截叠在柱顶、用红色。指着的时候那一格
 * 亮着，别的压淡。和 `@/ui/sparkline` 不同，失败叠在柱顶：这里的柱子高，失败那一截是
 * 「这一格里有几次没成」，叠在顶上读得出占了多少。
 *
 * 用块元素画，不用 SVG：高度变化要能走过渡（`motion-bar`），而 WebKit 对 SVG 几何属性
 * 的过渡支持不齐。有请求的格子至少 2px 高：一次请求的那一格要看得见。
 */
export function BarChart({ total, failed, ...p }: ChartProps & { total: readonly number[]; failed: readonly number[] }) {
  // 峰值**至少按 4 次算**：一格只有一两次请求的图要是也顶满，看起来就和一格几十次的一样忙
  const max = Math.max(4, ...total) * 1.05;
  // 格子少时柱子之间空得开一些；格子多了缝收窄，柱子才不会只剩一条线
  const gap = p.n <= 30 ? "gap-[3px]" : p.n <= 48 ? "gap-[2px]" : "gap-px";
  return (
    <Frame {...p} kind="bar">
      {() => (
        <div aria-hidden className={cn("absolute inset-0 flex items-end border-b border-border", gap)}>
          {total.map((n, i) => {
            const bad = Math.min(failed[i] ?? 0, n);
            const h = n > 0 ? Math.max(2, (n / max) * (BASE - 2)) : 0;
            const fh = n > 0 ? (bad / n) * h : 0;
            const dim = p.cursor !== null && p.cursor !== i;
            return (
              <div
                key={i}
                className={cn(
                  "flex min-w-0 flex-1 flex-col justify-end transition-opacity duration-(--motion-fast) ease-(--motion-ease) motion-reduce:transition-none",
                  dim && "opacity-45",
                )}
              >
                {bad > 0 && <i className="block shrink-0 rounded-t-[2px] bg-data-fail motion-bar" style={{ height: fh }} />}
                <i
                  className={cn("block shrink-0 bg-data-1 motion-bar", bad === 0 && "rounded-t-[2px]")}
                  style={{ height: h - fh }}
                />
              </div>
            );
          })}
        </div>
      )}
    </Frame>
  );
}

/** 第几格的点在横向的哪儿：等距排开，首尾顶格 */
function xAt(i: number, n: number, w: number): number {
  return n > 1 ? (i * w) / (n - 1) : w / 2;
}

/**
 * 一张小图的外框：量宽度、把指针换成第几格、画提示框。
 *
 * 线的点首尾顶格，指针落在离哪个点最近的那一格；柱子平分宽度，指针落在哪根柱子上就是
 * 哪一格。
 */
function Frame({
  n,
  tip,
  label,
  cursor,
  onPoint,
  kind,
  children,
}: ChartProps & { kind: "line" | "bar"; children: (width: number) => ReactNode }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const w = useWidth(box);
  const slot = (e: MouseEvent<HTMLDivElement>): number | null => {
    if (n <= 0 || w <= 0) return null;
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = kind === "line" ? Math.round((x / w) * (n - 1)) : Math.floor((x / w) * n);
    return Math.min(n - 1, Math.max(0, i));
  };
  const center = cursor === null ? 0 : kind === "line" ? xAt(cursor, n, w) : ((cursor + 0.5) * w) / n;
  return (
    <div
      ref={setBox}
      role="img"
      aria-label={label}
      className="relative mt-3"
      style={{ height: SPARK_H }}
      onMouseMove={(e) => {
        const i = slot(e);
        if (i !== cursor) onPoint(i);
      }}
      onMouseLeave={() => onPoint(null)}
    >
      {w > 0 && children(w)}
      {tip && cursor !== null && <TipBox x={center} width={w} title={tip.title} value={tip.value} />}
    </div>
  );
}

/**
 * 数值提示：一个深色的小框，压在图的上方、对着那一格居中，到了卡片边上就停住不出界。
 * 顶上一道品牌渐变。框量出宽度之后才知道往哪放，所以位置在画出来之前（布局阶段）
 * 直接写到元素上；跟着指针换格子时滑过去（系统关了动效就直接跳）。
 */
function TipBox({ x, width, title, value }: { x: number; width: number; title: string; value: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.getBoundingClientRect().width;
    const left = Math.max(-4, Math.min(width - w + 4, x - w / 2));
    el.style.transition = placed.current && !prefersReducedMotion() ? "transform 120ms ease-out" : "none";
    el.style.transform = `translateX(${left}px)`;
    el.style.visibility = "visible";
    placed.current = true;
  });
  return (
    <div
      ref={ref}
      data-slot="spark-tip"
      className="pointer-events-none invisible absolute -top-[34px] left-0 z-10 flex items-baseline gap-1.5 overflow-hidden rounded-md bg-foreground px-2.5 pt-[7px] pb-[5px] tw-label whitespace-nowrap text-background shadow-lg brand-edge"
    >
      <span className="text-background/60 tw-num">{title}</span>
      <span className="font-medium tw-num">{value}</span>
    </div>
  );
}

/** 容器有多宽。在画出来之前量（布局阶段），第一帧就是对的宽度 */
function useWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}
