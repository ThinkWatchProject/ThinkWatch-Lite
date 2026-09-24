import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { StackedArea, Y_AXIS_WIDTH } from "@/ui/charts";
import { PageSection } from "@/ui/page";
import { Segmented } from "@/ui/segmented";
import { Tip } from "@/ui/tip";
import { prefersReducedMotion } from "@/ui/motion";
import { bucketFor, type Range } from "@/ui/range";
import { useNav } from "@/nav";
import { compact } from "@/format";
import { usd, type CostBucket, type Dashboard } from "@/types";
import { useText } from "@/i18n";
import { LIVE_BUCKET_MS, LIVE_REACH_MS, useLiveWindow } from "./useLive";
import { buildTrend, fmtBucket, historyTicks, holdY, liveTicks, type Metric, type Tick } from "./series";
import { ModelRanking } from "./ModelRanking";
import { LiveBadge, Scope } from "./parts";
import { overviewText } from "./overview.i18n";

/** 图多高。KPI 下面这一块是整页唯一的视觉锚点 */
const CHART_H = 200;

/**
 * 趋势图和它的图例（模型排行）。
 *
 * **放在一起是因为排行就是图例**：色块和图里那一层同色，口径（token / 费用）
 * 两边一起换。实时档下两者都跟着事件流走（十分钟），每半秒往左挪一步 —— 所以
 * 事件流的订阅在这一层，页面上别的几块不跟着每一帧重画。
 */
export function TrendSection({
  d,
  range,
  scope,
  by,
  onBy,
}: {
  d: Dashboard;
  range: Range;
  /** 数据属于哪个区间（`rangeId`） */
  scope: string;
  by: Metric;
  onBy: (m: Metric) => void;
}) {
  const t = useText(overviewText);
  const nav = useNav();
  const live = range.live === true;
  /*
    **多留一个核宽的样本。**最左边那一格的鼓包有一半来自图外的那几秒；按图的
    宽度留样本的话，左端会凭空塌下去一个口子。
  */
  const win = useLiveWindow(live, range.ms + LIVE_REACH_MS);
  /** 上一次的堆叠次序：**名次要有滞回**，见 `buildTrend` */
  const stack = useRef<string[]>([]);
  /** 图例（模型排行）上指着的那一项：图里突出那一层 */
  const [focus, setFocus] = useState<string | null>(null);
  const yHold = useRef({ key: "", v: 0 });
  const bucketMs = bucketFor(range.ms);
  const trend = buildTrend({
    d,
    live,
    by,
    bucketMs,
    rangeMs: range.ms,
    samples: win.samples,
    fails: win.fails,
    now: Date.now(),
    prevStack: stack.current,
    t,
  });
  stack.current = trend.stack;
  yHold.current = holdY(yHold.current, `${by}/${scope}`, trend.peak, !live);
  const yMax = yHold.current.v || undefined;
  const tokensMode = by === "token";

  /*
    **动画只在换了看法的那一下放一次**：挂上（打开这一页、换了区间 —— 外面按
    区间换 key，这一块整个重挂）时整张图从左往右铺开；换口径时同一批格子的形状
    变过去。之后的刷新一律不动（见 `StackedArea`）。实时档从不动。
  */
  const [anim, setAnim] = useState(() => !live && !prefersReducedMotion());
  const [lastBy, setLastBy] = useState(by);
  if (lastBy !== by) {
    setLastBy(by);
    if (!live && !prefersReducedMotion()) setAnim(true);
  }
  useEffect(() => {
    if (!anim) return;
    const h = setTimeout(() => setAnim(false), 400);
    return () => clearTimeout(h);
  }, [anim, by]);

  const ticks: Tick[] = live
    ? liveTicks(t.liveTicks, t.now)
    : historyTicks(d.since_ms, bucketMs, trend.grid.length, t.now);
  /** 图画出来了才有纵轴那一栏（见 `StackedArea` 的空态） */
  const axis = trend.keys.length > 0 && trend.rows.length > 0 ? Y_AXIS_WIDTH : 0;
  const failures = trend.grid.some((g) => g.failed > 0);
  const openFailed = () => nav.open("requests", { grouped: false, filter: { failedOnly: true } });

  return (
    <>
      <PageSection
        title={
          <span className="flex items-center gap-2.5">
            {t.trend}
            {live && <LiveBadge />}
          </span>
        }
        actions={
          /*
            口径只管这张图和下面的模型排行，所以放在这一节的标题行上，不和页头的
            时间范围挨在一起 —— 两个不同维度的选择并排成一串，读起来就是一排平级选项。
          */
          <Segmented<Metric>
            label={t.metric}
            value={by}
            options={[
              { id: "token", label: t.byTokens },
              { id: "cost", label: t.byCost },
            ]}
            onChange={onBy}
          />
        }
      >
        <StackedArea
          data={trend.rows}
          keys={trend.keys}
          colors={trend.colors}
          tips={trend.tips}
          // 指着的那一项被挤出了前几名（实时档）：不再突出谁，免得整张图一起淡下去
          highlight={focus !== null && trend.keys.includes(focus) ? focus : null}
          height={CHART_H}
          empty={live ? t.waiting : t.noRequests}
          /*
            **纵轴的单位跟着口径走，和悬停里那句一致。**费用那一路的图值是千分之一
            美元（见 `buildTrend`），刻度要换回微分再格式化。
          */
          tickFormat={(v) => (tokensMode ? compact(v) : usd(v * 1000))}
          // 悬停里每个模型那一行**和刻度同一种写法**，先取整：实时档的速率是摊出来的浮点
          valueFormat={(v) => (tokensMode ? compact(Math.round(v)) : usd(Math.round(v * 1000)))}
          yMax={yMax}
          liveEdge={live}
          pulse={win.arrived}
          animate={anim}
        />
        {/*
          基线、失败标记和刻度**只铺到画图区域的右边界**，右边那一栏是纵轴的刻度
          （见 `Y_AXIS_WIDTH`）。图空着的时候没有纵轴，就铺满。
        */}
        <div style={{ marginRight: axis }}>
          <FailureStrip grid={trend.grid} stepMs={live ? LIVE_BUCKET_MS : bucketMs} onOpen={openFailed} />
          <TickRow ticks={ticks} live={live} axis={axis} />
        </div>
        {/* 这一行有没有话说都占一行高：少一句就把下面整块往上提，正是切换时的那种来回动 */}
        <p className="mt-1.5 flex min-h-4 items-center gap-2 tw-label text-muted-foreground">
          {failures && (
            <>
              <span aria-hidden className="inline-block h-[3px] w-3.5 rounded-full bg-destructive" />
              <span>{t.failureMarks}</span>
            </>
          )}
        </p>
      </PageSection>

      <PageSection title={t.models} actions={live ? <Scope>{t.liveWindow}</Scope> : undefined}>
        <ModelRanking
          rows={trend.ranking}
          by={by}
          topBar={trend.topBar}
          scope={scope}
          empty={live ? t.waiting : t.noRequests}
          onFocus={setFocus}
        />
      </PageSection>
    </>
  );
}

/**
 * 基线上的失败标记：有失败的时段在基线下面画一小段红。
 *
 * **不往图的高度里加** —— 加一格固定高度的话，那一格在大桶上看不见、在小桶上
 * 直接翻倍，而它本来就不代表任何数量。每一段**对着图上那一格的点**居中（图上的
 * 点是等距排开、首尾顶格的），不是按「第几格占几分之一」平铺 —— 平铺的话越往右
 * 越偏。可以点：落到流量页，只看失败的请求。
 */
function FailureStrip({
  grid,
  stepMs,
  onOpen,
}: {
  grid: CostBucket[];
  stepMs: number;
  onOpen: () => void;
}) {
  const t = useText(overviewText);
  const n = grid.length;
  return (
    <div className="relative h-2.5">
      <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-border" />
      {n > 1 &&
        grid.map((g, i) => {
          if (g.failed === 0) return null;
          const w = 100 / (n - 1);
          const left = Math.max(0, (i - 0.5) * w);
          const right = Math.min(100, (i + 0.5) * w);
          return (
            <Tip key={g.at_ms} text={t.failedAt(fmtBucket(g.at_ms, stepMs), g.failed)}>
              <span
                role="link"
                tabIndex={-1}
                aria-label={t.failedAt(fmtBucket(g.at_ms, stepMs), g.failed)}
                onClick={onOpen}
                className={cn(
                  "group/fail absolute top-0 flex h-2.5 cursor-pointer justify-center",
                )}
                style={{ left: `${left}%`, width: `max(3px, ${right - left}%)` }}
              >
                <span className="motion-bar mt-px h-[3px] w-full min-w-[3px] rounded-b-sm bg-destructive/85 group-hover/fail:h-[5px] group-hover/fail:bg-destructive" />
              </span>
            </Tip>
          );
        })}
    </div>
  );
}

/**
 * 图下面那排刻度。**标在它说的那个时刻的正下方**：第一个靠左对齐，免得伸出图外；
 * 最后一个（「现在」）压在最后一点下面，右边有纵轴那一栏让它伸过去。
 */
function TickRow({ ticks, live, axis }: { ticks: Tick[]; live: boolean; axis: number }) {
  return (
    <div className="relative mt-1 h-4 tw-label text-muted-foreground">
      {ticks.map((x, i) => (
        <span
          key={`${x.label}-${i}`}
          className={cn("absolute top-0 whitespace-nowrap tw-num", x.now && live && "font-medium text-foreground")}
          style={{
            left: `${x.at * 100}%`,
            transform: i === 0 ? undefined : x.now && axis === 0 ? "translateX(-100%)" : "translateX(-50%)",
          }}
        >
          {x.label}
        </span>
      ))}
    </div>
  );
}
