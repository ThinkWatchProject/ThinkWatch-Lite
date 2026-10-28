import { useId, useLayoutEffect, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { slotTitle, type Grid } from "./series";
import { CHART_H, slotPhase, xTicks, yTicks } from "./HeroAxis";
import { lineGeometry } from "./geometry";
import { overviewText } from "./overview.i18n";

/**
 * 用量的大图：坐标轴、柱或线、逐格的提示。画什么由 `Hero` 按选中的指标算好交进来
 * （`ChartSpec`），这里只管画和指。
 */

/** 提示里的一行：值在前、名目在后，`key` 是前面那一小段线的颜色（图里对得上的那一样才有） */
export type TipRow = { v: string; k: string; key?: string };
export type TipBody = { main: string; rows: TipRow[]; rows2: TipRow[] };

export interface ChartSpec {
  grid: Grid;
  /** 柱：`a` 在下，`b` 叠在上面（失败、下载），中间留 2px */
  bars: { a: readonly number[]; b?: readonly number[]; colorA: string; colorB?: string } | null;
  /** 线：第一条是主要的。`wash`：线下面铺一片淡色 */
  lines: { values: readonly (number | null)[]; color: string; wash?: boolean }[] | null;
  /** 纵轴的顶 */
  top: number;
  axis: (v: number) => string;
  tip: (i: number) => TipBody;
  legend: { label: string; color: string; shape: "rect" | "stroke" }[];
  /** 图例右边：每格多宽，实时档的速率写单位 */
  note: string | null;
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

/** 横轴上一个标签大约占多宽（「10-27」「14:00」「今天」），按它决定最多标几个 */
const TICK_W = 64;

/**
 * 大图：左边纵轴四格，横向网格线，柱或线，下面横轴的日期、时刻。指着（或键盘的左右键）
 * 逐格出提示：柱的那一格底色升一档，线的那一格画竖线和点。正在进行的那一格（到现在为止，
 * 还没过完）画淡一些；「某一天」选的是今天时，此刻之后的格子空着，指不上。
 *
 * 柱子最宽 16px、不超过格宽的七成，顶上 4px 圆角，叠起来的两段之间空 2px；有量的那一段
 * 至少看得见（约 2px）。线 2px，没有样本的格子断开、用一段淡的虚线接上（`lineGeometry`）。
 * 没有入场动画；换区间时柱高走过渡（`motion-bar`），实时档不走 —— 格子每十秒挪一次。
 */
export function Chart({
  spec,
  cursor,
  onPoint,
  now,
  live,
  label,
}: {
  spec: ChartSpec | null;
  cursor: number | null;
  onPoint: (i: number | null) => void;
  now: number;
  live: boolean;
  label: string;
}) {
  const t = useText(overviewText);
  const tipId = useId();
  const [plot, setPlot] = useState<HTMLDivElement | null>(null);
  const w = useWidth(plot);
  if (!spec) {
    return (
      <div className="mt-3 ml-11 flex items-center justify-center tw-label text-muted-foreground" style={{ height: CHART_H }}>
        {t.chartUnavailable}
      </div>
    );
  }
  const { grid, top } = spec;
  const n = grid.at.length;
  const phase = (i: number) => slotPhase(grid, i, now);
  const pctOf = (v: number) => Math.min(100, Math.max(0, (v / top) * 100));
  const ticks = yTicks(top);
  const xs = n > 0 ? xTicks(grid, Math.max(1, Math.floor(w / TICK_W)), { today: t.today, now }) : [];
  // 贴着右边的标签放不下就不写：标签往右排开，右边没有地方
  const shownX = w > 0 ? xs.filter((x) => x.f * w + 36 <= w) : xs;

  const slotAt = (clientX: number, box: DOMRect): number | null => {
    if (n === 0 || box.width <= 0) return null;
    const i = Math.min(n - 1, Math.max(0, Math.floor(((clientX - box.left) / box.width) * n)));
    return phase(i) === "future" ? null : i;
  };
  /** 键盘能走到的最后一格：此刻之后的不算 */
  let lastLive = n - 1;
  while (lastLive > 0 && phase(lastLive) === "future") lastLive -= 1;
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const from = cursor ?? lastLive + 1;
    const next =
      e.key === "ArrowLeft" ? Math.max(0, from - 1)
      : e.key === "ArrowRight" ? Math.min(lastLive, cursor === null ? lastLive : from + 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? lastLive
      : e.key === "Escape" ? null
      : undefined;
    if (next === undefined) return;
    e.preventDefault();
    onPoint(next);
  };

  const center = (i: number) => ((i + 0.5) / n) * 100;
  const tip = cursor !== null ? spec.tip(cursor) : null;

  return (
    <div className="mt-3 flex">
      <div aria-hidden className="relative w-11 shrink-0" style={{ height: CHART_H }}>
        {ticks.map((v, k) => (
          <span
            key={k}
            className="absolute right-2.5 translate-y-1/2 tw-label whitespace-nowrap text-muted-foreground tw-num"
            style={{ bottom: `${(k / (ticks.length - 1)) * 100}%` }}
          >
            {spec.axis(v)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div
          ref={setPlot}
          role="img"
          aria-label={label}
          aria-describedby={tip ? tipId : undefined}
          tabIndex={0}
          className="relative rounded-[2px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          style={{ height: CHART_H }}
          onMouseMove={(e) => {
            const i = slotAt(e.clientX, e.currentTarget.getBoundingClientRect());
            if (i !== cursor) onPoint(i);
          }}
          onMouseLeave={() => onPoint(null)}
          onKeyDown={onKey}
          onBlur={() => onPoint(null)}
        >
          {/* 网格线：最下面那条是基线，深一档 */}
          {ticks.map((_, k) => (
            <span
              key={k}
              aria-hidden
              className={cn("absolute inset-x-0 h-px", k === 0 ? "bg-foreground/15" : "bg-border/70")}
              style={{ bottom: `${(k / (ticks.length - 1)) * 100}%` }}
            />
          ))}

          {spec.lines && <Lines lines={spec.lines} n={n} top={top} />}

          <div aria-hidden className="absolute inset-0 flex">
            {grid.at.map((at, i) => {
              const ph = phase(i);
              const hot = i === cursor;
              let bars: ReactNode = null;
              if (spec.bars && ph !== "future") {
                const a = spec.bars.a[i] ?? 0;
                const b = spec.bars.b?.[i] ?? 0;
                // 有量的那一段至少看得见
                const ah = a > 0 ? Math.max(1.2, pctOf(a)) : 0;
                const bh = b > 0 ? Math.max(1.2, pctOf(b)) : 0;
                const bar = cn(
                  "absolute bottom-0 left-1/2 w-4 max-w-[70%] -translate-x-1/2",
                  !live && "motion-bar",
                  ph === "ongoing" && "opacity-50",
                );
                bars = (
                  <>
                    {ah > 0 && (
                      <span
                        className={cn(bar, bh === 0 && "rounded-t-[4px]")}
                        style={{ height: `${ah}%`, background: spec.bars.colorA }}
                      />
                    )}
                    {bh > 0 && (
                      <span
                        className={cn(bar, "rounded-t-[4px]")}
                        style={{
                          height: `${bh}%`,
                          bottom: ah > 0 ? `calc(${ah}% + 2px)` : 0,
                          background: spec.bars.colorB,
                        }}
                      />
                    )}
                  </>
                );
              }
              return (
                <div
                  key={live ? i : at}
                  className={cn("relative h-full min-w-0 flex-1", hot && spec.bars && "bg-foreground/[0.035]")}
                >
                  {bars}
                </div>
              );
            })}
          </div>

          {/* 线：指着的那一格画竖线，每条线上一个点 */}
          {spec.lines && cursor !== null && (
            <>
              <span
                aria-hidden
                className="absolute inset-y-0 w-px bg-muted-foreground/50"
                style={{ left: `${center(cursor)}%` }}
              />
              {spec.lines.map((l, k) => {
                const v = l.values[cursor];
                if (v == null) return null;
                return (
                  <span
                    key={k}
                    aria-hidden
                    className="absolute size-2 -translate-x-1/2 translate-y-1/2 rounded-full ring-2 ring-panel"
                    style={{ left: `${center(cursor)}%`, bottom: `${pctOf(v)}%`, background: l.color }}
                  />
                );
              })}
            </>
          )}

          {tip && cursor !== null && (
            <TipBox
              id={tipId}
              title={slotTitle(grid, cursor, now, t.now)}
              body={tip}
              x={center(cursor)}
              right={cursor < n / 2}
            />
          )}
        </div>
        <div aria-hidden className="relative mt-[7px] h-4 overflow-hidden">
          {shownX.map((x) => (
            <span
              key={`${x.f}-${x.label}`}
              className="absolute top-0 tw-label whitespace-nowrap text-muted-foreground tw-num"
              style={{ left: `${x.f * 100}%` }}
            >
              {x.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * 线（缓存命中率、首 token 的两条分位、实时档的速率）。画在 1000 × 100 的坐标里横向拉伸，
 * 线宽不跟着拉（`non-scaling-stroke`）。点在每一格的正中。前后都没有邻居的孤点画成小圆点
 * （用 HTML 画，SVG 里拉伸会变成椭圆）。
 */
function Lines({
  lines,
  n,
  top,
}: {
  lines: NonNullable<ChartSpec["lines"]>;
  n: number;
  top: number;
}) {
  const gid = useId().replace(/:/g, "");
  const xs = Array.from({ length: n }, (_, i) => ((i + 0.5) / n) * 1000);
  const y = (v: number) => 100 - Math.min(1, Math.max(0, v / top)) * 100;
  // 后画的在上面：对照的那条先画，主要的那条压在它上面
  const drawn = lines.map((l, i) => ({ l, i, geo: lineGeometry(l.values, xs, y, 100) })).reverse();
  return (
    <>
      <svg
        aria-hidden
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="absolute inset-0 size-full overflow-visible"
      >
        <defs>
          {lines.map((l, i) =>
            l.wash ? (
              <linearGradient key={i} id={`${gid}-wash-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={l.color} style={{ stopOpacity: "var(--data-wash)" }} />
                <stop offset="1" stopColor={l.color} stopOpacity={0} />
              </linearGradient>
            ) : null,
          )}
        </defs>
        {drawn.map(({ l, i, geo }) => (
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
                vectorEffect="non-scaling-stroke"
              />
            )}
            {geo.line && (
              <path
                d={geo.line}
                fill="none"
                stroke={l.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        ))}
      </svg>
      {drawn.flatMap(({ l, i, geo }) =>
        geo.dots.map((p) => (
          <span
            key={`${i}-${p.x}`}
            aria-hidden
            className="absolute size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ left: `${p.x / 10}%`, top: `${p.y}%`, background: l.color }}
          />
        )),
      )}
    </>
  );
}

/**
 * 逐格的提示：哪一段时间，大数，下面几行「值 名目」（图里对得上的那几样前面一小段线做
 * 图例），token 和费用再隔一道线列出这一格排前几的模型。放在那一格的右边（指着右半边时
 * 放左边），贴着图的顶。
 */
function TipBox({ id, title, body, x, right }: { id: string; title: string; body: TipBody; x: number; right: boolean }) {
  const row = (r: TipRow, k: number) => (
    <div key={k} className="flex min-w-0 items-center gap-[7px] leading-[18px]">
      <span aria-hidden className="block h-0.5 w-2.5 shrink-0 rounded-[1px]" style={{ background: r.key ?? "transparent" }} />
      <span className="shrink-0 font-semibold tw-num">{r.v}</span>
      <span className="min-w-0 truncate text-muted-foreground">{r.k}</span>
    </div>
  );
  return (
    <div
      id={id}
      role="tooltip"
      data-slot="hero-tip"
      className="pointer-events-none absolute top-0 z-10 w-[212px] rounded-lg border border-border bg-popover px-[11px] pt-[9px] pb-2 tw-label whitespace-nowrap text-popover-foreground shadow-lg"
      style={right ? { left: `calc(${x}% + 14px)` } : { right: `calc(${100 - x}% + 14px)` }}
    >
      <div className="text-muted-foreground tw-num">{title}</div>
      <div className="mt-px mb-1 tw-title tw-num">{body.main}</div>
      {body.rows.map(row)}
      {body.rows2.length > 0 && (
        <>
          {body.rows.length > 0 && <div className="mt-1.5 mb-[5px] h-px bg-border" />}
          {body.rows2.map(row)}
        </>
      )}
    </div>
  );
}
