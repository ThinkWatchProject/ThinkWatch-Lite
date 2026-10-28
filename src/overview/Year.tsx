import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { call } from "@/control";
import { compact } from "@/format";
import { useText } from "@/i18n";
import { useResource } from "@/lib/resource";
import { usd } from "@/types";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { Tip } from "@/ui/tip";
import { windowStart, type Range } from "@/ui/range";
import { useStartOf } from "@/useNow";
import { overviewText } from "./overview.i18n";
import { rankCost } from "./series";
import {
  DAY_MS,
  WEEKS,
  YEAR_DAYS,
  addDays,
  drawn,
  gridStart,
  layout,
  levelOf,
  monthLabels,
  overlaps,
  recorded,
  statsOf,
  step,
  thresholds,
  valueOf,
  type Day,
  type DayUsage,
  type YearMetric,
} from "./yearGrid";
import { yearText } from "./Year.i18n";

type Text = (typeof yearText)["zh"];
type OverviewText = (typeof overviewText)["zh"];

/** 五级的颜色：0 是空格子的灰，1–4 是 `--chart-*` 那一条蓝由浅到深（暗色下由暗到亮） */
const LEVEL = ["bg-surface", "bg-chart-5", "bg-chart-3", "bg-chart-2", "bg-chart-1"] as const;

const METRICS: YearMetric[] = ["tokens", "cost", "requests"];

/**
 * 上次选的指标。**换时间范围时概览整块重挂**（点一个格子就是换范围），放在组件的 state
 * 里的话，选了「费用」再点一天，就弹回了 Token。只记在这一程里
 */
let lastMetric: YearMetric = "tokens";

/**
 * 最近一年：一天一格的热力图，固定一年，不跟时间范围走；所选时间范围在格子上描边。
 *
 * 53 列（周）× 7 行（周一在上），最右一列是本周，今天之后的不画；格子随卡片宽度伸缩。
 * 开始记录之前的日子画成虚线框「未记录」—— **不是「没有用量」**，那时还没在记。
 *
 * 颜色按「有用量的日子」的四分位分五级。四个统计只算记录里的日子。费用的限定词（含估算、
 * 无法计价）一直写在统计下面，全文在悬停里。
 *
 * 数据：`UsageHistory`，从网格第一天的本地零点起、一天一格；`tick` 变了重取，重取时上一份
 * 照样画着。
 */
export function Year({
  range,
  tick,
  onPickDay,
}: {
  range: Range;
  /** 库里多了请求、手动刷新：重取 */
  tick: number;
  /** 点了某一天：时间范围切到那一天 */
  onPickDay: (day: Date) => void;
}) {
  const t = useText(yearText);
  const ot = useText(overviewText);
  const [metric, setMetricState] = useState<YearMetric>(() => lastMetric);
  const setMetric = (m: YearMetric) => {
    lastMetric = m;
    setMetricState(m);
  };
  // 今天的零点：过了零点就换，网格往前走一格
  const today = useStartOf(DAY_MS);
  const from = gridStart(today);
  const r = useResource("usage-history", () => call("UsageHistory", { from_ms: from, to_ms: null, bucket_ms: DAY_MS }), {
    deps: [tick, from],
  });
  const h = r.data ?? null;
  const days = useMemo(() => layout(today, h), [today, h]);
  const failed = h === null && !r.loading && r.error !== undefined;

  const firstDay = addDays(today, -(YEAR_DAYS - 1));
  // 记录不满一年：标题行和第一个统计说「开始记录以来」
  const since = h?.since_ms ?? null;
  const partial = h !== null && (since === null || since > firstDay);

  return (
    <section
      aria-labelledby="overview-year-title"
      className="@container/year rounded-[10px] border border-border bg-panel px-[18px] pt-3 pb-3.5"
    >
      <div className="flex h-7 items-center gap-3">
        <h3 id="overview-year-title" className="shrink-0 tw-head text-muted-foreground">
          {t.title}
        </h3>
        <Segmented<YearMetric>
          label={t.metricLabel}
          value={metric}
          options={METRICS.map((m) => ({ id: m, label: t.metric[m] }))}
          onChange={setMetric}
        />
        {h && (
          <span className="ml-auto min-w-0 truncate tw-label text-muted-foreground">
            {partial && since !== null ? t.spanSince(new Date(since)) : t.spanYear(new Date(firstDay))}
          </span>
        )}
      </div>

      {h ? (
        <Body days={days} metric={metric} partial={partial} range={range} onPickDay={onPickDay} t={t} ot={ot} />
      ) : (
        <Placeholder days={days} failed={failed} t={t} />
      )}
    </section>
  );
}

/** 还在取：同尺寸的骨架。取不到：同样大的一块，正中一句「暂时取不到」—— 不画成全零 */
function Placeholder({ days, failed, t }: { days: Day[]; failed: boolean; t: Text }) {
  return (
    <div className="relative" role={failed ? undefined : "status"} aria-busy={failed ? undefined : true}>
      <div aria-hidden className={cn(failed && "invisible")}>
        <div className="mt-3 grid grid-cols-2 gap-4 @min-[520px]/year:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col">
              <div className="flex h-4 items-center">
                <Skeleton className="h-2.5 w-12 rounded-sm" />
              </div>
              <div className="flex h-[29px] items-center">
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-2.5 w-24 rounded-sm opacity-60" />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 pl-[30px]">
          <div className="h-[14px]" />
          <div className="mt-[3px] grid motion-shimmer gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
            {byRows(days).map((d) => (
              <span key={d.at} className={cn("aspect-square rounded-[2.5px]", drawn(d) && "bg-surface")} />
            ))}
          </div>
        </div>
        <div className="mt-2.5 h-4" />
      </div>
      {failed && (
        <p className="absolute inset-0 flex items-center justify-center tw-body text-muted-foreground">{t.unavailable}</p>
      )}
    </div>
  );
}

/** 网格的 DOM 按行排（一行是同一个星期几）：读屏按行读、CSS 网格按行流；数据按列排 */
function byRows(days: Day[]): Day[] {
  const out: Day[] = [];
  for (let row = 0; row < 7; row++) for (let col = 0; col < WEEKS; col++) out.push(days[col * 7 + row]!);
  return out;
}

function Body({
  days,
  metric,
  partial,
  range,
  onPickDay,
  t,
  ot,
}: {
  days: Day[];
  metric: YearMetric;
  partial: boolean;
  range: Range;
  onPickDay: (day: Date) => void;
  t: Text;
  ot: OverviewText;
}) {
  const th = useMemo(() => thresholds(days.filter(recorded).map((d) => valueOf(d, metric))), [days, metric]);
  const s = useMemo(() => statsOf(days, metric), [days, metric]);
  const months = useMemo(() => monthLabels(days), [days]);

  // 所选时间范围：画图的一方以 `range.to ?? 现在` 作为右端
  const rFrom = windowStart(range);
  const rTo = range.to ?? Date.now();
  const inRange = (d: Day) => recorded(d) && overlaps(d, rFrom, rTo);
  const anyInRange = days.some(inRange);
  const anyUnrecorded = days.some((d) => d.state === "unrecorded");

  const fmt = (v: number) => fmtValue(metric, v, t);
  const qualifier = metric === "cost" ? costParts(s, ot) : null;

  const stats: { label: string; value: ReactNode; sub: ReactNode; tip?: string[] }[] = [
    {
      label: partial ? t.totalSince : t.totalYear,
      value: qualifier ? qualifier.value(s.total) : fmt(s.total),
      sub: [t.usedDays(s.usedDays), ...(qualifier ? shortNotes(s, t) : [])].join(" · "),
      tip: qualifier?.notes,
    },
    {
      label: t.average,
      value: s.average === null ? "—" : qualifier ? qualifier.value(Math.round(s.average)) : fmt(Math.round(s.average)),
      sub: t.averageNote,
    },
    {
      label: t.peak,
      value: s.peak ? (metric === "cost" ? dayCost(s.peak.usage!, ot).text : fmt(valueOf(s.peak, metric))) : "—",
      sub: s.peak ? t.dateShort(new Date(s.peak.at)) : "",
    },
    { label: t.streak, value: t.days(s.streak), sub: t.longest(s.longest) },
  ];

  return (
    <>
      <div className="mt-3 grid grid-cols-2 gap-4 @min-[520px]/year:grid-cols-4">
        {stats.map((x) => (
          <div key={x.label} className="min-w-0">
            <div className="h-4 truncate tw-label text-muted-foreground">{x.label}</div>
            <div className="truncate tw-display tw-num">{x.value}</div>
            {x.tip && x.tip.length > 0 ? (
              <Tip text={<Notes lines={x.tip} />}>
                <div className="h-4 truncate tw-label text-muted-foreground underline decoration-dotted underline-offset-2">
                  {x.sub}
                </div>
              </Tip>
            ) : (
              <div className="h-4 truncate tw-label text-muted-foreground">{x.sub}</div>
            )}
          </div>
        ))}
      </div>

      <Grid
        days={days}
        months={months}
        level={(d) => (recorded(d) ? levelOf(valueOf(d, metric), th) : 0)}
        inRange={inRange}
        metric={metric}
        onPickDay={onPickDay}
        t={t}
        ot={ot}
      />

      <div className="mt-2.5 flex items-center gap-4 pl-[30px] tw-label text-muted-foreground">
        {anyInRange && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] bg-chart-3 ring-[1.5px] ring-foreground/70" />
            {t.legendRange}
          </span>
        )}
        {anyUnrecorded && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-[2px] border border-dashed border-input" />
            {t.unrecorded}
          </span>
        )}
        <span aria-hidden className="ml-auto flex items-center gap-[3px]">
          <span className="mr-1">{t.less}</span>
          {LEVEL.map((c) => (
            <span key={c} className={cn("size-2.5 rounded-[2px]", c)} />
          ))}
          <span className="ml-1">{t.more}</span>
        </span>
      </div>
    </>
  );
}

function Grid({
  days,
  months,
  level,
  inRange,
  metric,
  onPickDay,
  t,
  ot,
}: {
  days: Day[];
  months: (number | null)[];
  level: (d: Day) => number;
  inRange: (d: Day) => boolean;
  metric: YearMetric;
  onPickDay: (day: Date) => void;
  t: Text;
  ot: OverviewText;
}) {
  const todayIdx = useMemo(() => {
    for (let j = days.length - 1; j >= 0; j--) if (drawn(days[j]!)) return j;
    return 0;
  }, [days]);
  // 网格只占一个 tab 位：方向键在格子之间挪（roving tabindex），记着挪到了哪一格
  const [active, setActive] = useState<number | null>(null);
  const cur = active !== null && drawn(days[active]!) ? active : todayIdx;
  const [hover, setHover] = useState<number | null>(null);
  // 键盘聚焦的那一格也给提示。点出来的焦点不算（指针移走了提示就该收起来）
  const [focused, setFocused] = useState<number | null>(null);
  const shown = hover ?? focused;

  const cells = useRef(new Map<number, HTMLElement>());
  const wrap = useRef<HTMLDivElement>(null);

  const pick = (d: Day) => {
    if (recorded(d)) onPickDay(new Date(d.at));
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(days[i]!);
      return;
    }
    const j = step(days, i, e.key);
    if (j === i && !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    setHover(null);
    setActive(j);
    cells.current.get(j)?.focus();
  };

  return (
    <div ref={wrap} className="relative mt-3 pl-[30px]" onMouseLeave={() => setHover(null)}>
      {/* 月份：那一列的周一换了月就写 */}
      <div aria-hidden className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}>
        {months.map((m, col) => (
          <span key={col} className="h-[14px] overflow-visible tw-label leading-[14px] whitespace-nowrap text-muted-foreground">
            {m === null ? "" : t.month(m)}
          </span>
        ))}
      </div>
      <div
        role="grid"
        aria-label={t.gridLabel}
        className="mt-[3px] grid gap-[3px]"
        style={{ gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` }}
        onMouseOver={(e) => {
          const el = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
          setHover(el ? Number(el.dataset.i) : null);
        }}
      >
        {[0, 1, 2, 3, 4, 5, 6].map((row) => (
          <div key={row} role="row" className="contents">
            {days
              .filter((d) => d.row === row)
              .map((d) => {
                const i = d.col * 7 + d.row;
                // 左边那一列：周一、周三、周五
                const wd =
                  d.col === 0 && (row === 0 || row === 2 || row === 4) ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-1/2 right-[calc(100%+7px)] -translate-y-1/2 tw-label leading-none whitespace-nowrap text-muted-foreground"
                    >
                      {t.weekday((row + 1) % 7)}
                    </span>
                  ) : null;
                if (!drawn(d)) {
                  return (
                    <span key={d.at} role="gridcell" aria-hidden className="relative aspect-square">
                      {wd}
                    </span>
                  );
                }
                const lv = level(d);
                const unrec = d.state === "unrecorded";
                return (
                  <span
                    key={d.at}
                    ref={(el) => {
                      if (el) cells.current.set(i, el);
                      else cells.current.delete(i);
                    }}
                    role="gridcell"
                    data-i={i}
                    tabIndex={i === cur ? 0 : -1}
                    aria-label={t.cell(t.dateFull(new Date(d.at)), mainText(d, metric, t, ot))}
                    aria-disabled={unrec || undefined}
                    onClick={() => {
                      setActive(i);
                      pick(d);
                    }}
                    onKeyDown={(e) => onKey(e, i)}
                    onFocus={(e) => {
                      setActive(i);
                      if (e.currentTarget.matches(":focus-visible")) setFocused(i);
                    }}
                    onBlur={() => setFocused((f) => (f === i ? null : f))}
                    className={cn(
                      "relative aspect-square rounded-[2.5px] outline-none",
                      unrec ? "border border-dashed border-input" : [LEVEL[lv], "cursor-pointer"],
                      shown === i ? "ring-2 ring-foreground" : inRange(d) && "ring-[1.5px] ring-foreground/70",
                    )}
                  >
                    {wd}
                  </span>
                );
              })}
          </div>
        ))}
      </div>
      {shown !== null && drawn(days[shown]!) && (
        <DayTip day={days[shown]!} cell={cells.current.get(shown) ?? null} wrap={wrap.current} metric={metric} t={t} ot={ot} />
      )}
    </div>
  );
}

/**
 * 一天的提示：日期 + 星期、主值、输入 / 输出 / 缓存读取、费用、请求次数（值在前、名目在后）。
 *
 * 位置在画出来之前（布局阶段）量好写到元素上：在那一格正上方居中，**靠边的往里收**，
 * 不伸出卡片。
 */
function DayTip({
  day,
  cell,
  wrap,
  metric,
  t,
  ot,
}: {
  day: Day;
  cell: HTMLElement | null;
  wrap: HTMLElement | null;
  metric: YearMetric;
  t: Text;
  ot: OverviewText;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !cell || !wrap) return;
    const w = wrap.getBoundingClientRect();
    const c = cell.getBoundingClientRect();
    const tip = el.getBoundingClientRect();
    const x = Math.max(-6, Math.min(w.width - tip.width + 6, c.left - w.left + c.width / 2 - tip.width / 2));
    const y = c.top - w.top - tip.height - 8;
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.visibility = "visible";
  });

  const u = day.usage;
  const rows: { v: string; k: string }[] = [];
  let notes: string[] = [];
  if (u) {
    const cost = dayCost(u, ot);
    notes = cost.notes;
    if (metric !== "tokens") rows.push({ v: compact(u.tokens), k: t.tokensRow });
    rows.push({ v: compact(u.input), k: t.input }, { v: compact(u.output), k: t.output }, { v: compact(u.cacheRead), k: t.cacheRead });
    if (metric !== "cost") rows.push({ v: cost.text, k: t.costRow });
    if (metric !== "requests") rows.push({ v: t.times(u.requests.toLocaleString("en-US")), k: t.requestsRow });
  }

  return (
    <div
      ref={ref}
      aria-hidden
      data-slot="year-tip"
      className="pointer-events-none invisible absolute top-0 left-0 z-10 min-w-[200px] rounded-lg border border-border bg-popover px-[11px] pt-[9px] pb-2 tw-label whitespace-nowrap text-popover-foreground shadow-lg"
    >
      <div className="text-muted-foreground">{t.dateFull(new Date(day.at))}</div>
      <div className="mt-px mb-1 tw-title tw-num">{mainText(day, metric, t, ot)}</div>
      {rows.map((r) => (
        <div key={r.k} className="flex items-center gap-[7px] leading-[18px]">
          <span className="font-semibold tw-num">{r.v}</span>
          <span className="text-muted-foreground">{r.k}</span>
        </div>
      ))}
      {notes.length > 0 && (
        <div className="mt-1 border-t border-border pt-1 text-muted-foreground">
          <Notes lines={notes} />
        </div>
      )}
    </div>
  );
}

function Notes({ lines }: { lines: string[] }) {
  return (
    <div className="space-y-1">
      {lines.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
}

/** 统计和「最多的一天」的数：token 收成三四位、费用写金额、请求写次数 */
function fmtValue(m: YearMetric, v: number, t: Text): string {
  if (m === "tokens") return compact(v);
  if (m === "cost") return usd(v);
  return t.times(v.toLocaleString("en-US"));
}

/** 一天的主值：未记录、没有请求，或者选中指标的那个数 */
function mainText(d: Day, m: YearMetric, t: Text, ot: OverviewText): string {
  if (d.state === "unrecorded") return t.unrecorded;
  if (!d.usage) return t.noRequests;
  if (m === "tokens") return t.tokensMain(compact(d.usage.tokens));
  if (m === "cost") return dayCost(d.usage, ot).text;
  return t.requestsMain(d.usage.requests.toLocaleString("en-US"));
}

/**
 * 一天的费用写什么，和明细表同一套写法（`rankCost`）：一条都没算出费用的写「无法计价」，
 * 连用量都没有的写「无用量」，其余写金额，含估算带「~」、缺着的带「≥」。
 */
function dayCost(u: DayUsage, ot: OverviewText): { text: string; notes: string[] } {
  const r = rankCost({ cost: u.cost, estimated: u.estimated, unpriced: u.unpriced, noUsage: u.noUsage }, ot);
  const text = r.kind === "unpriced" ? ot.unpricedCell : r.kind === "noUsage" ? ot.noUsageCell : r.prefix + usd(u.cost);
  return { text, notes: r.notes };
}

/** 一年合计的费用：金额带上记号（日均跟着合计用同一个记号），悬停里是全文 */
function costParts(
  s: { total: number; estimated: number; unpriced: number; noUsage: number },
  ot: OverviewText,
): { value: (micros: number) => ReactNode; notes: string[] } {
  const r = rankCost({ cost: s.total, estimated: s.estimated, unpriced: s.unpriced, noUsage: s.noUsage }, ot);
  return {
    value: (micros) =>
      r.kind === "unpriced" ? (
        <span className="text-warning">{ot.unpricedCell}</span>
      ) : r.kind === "noUsage" ? (
        <span className="text-muted-foreground">{ot.noUsageCell}</span>
      ) : (
        r.prefix + usd(micros)
      ),
    notes: r.notes,
  };
}

/** 统计下面那一行里费用限定词的短写法 */
function shortNotes(s: { estimated: number; unpriced: number; noUsage: number }, t: Text): string[] {
  return [
    ...(s.estimated > 0 ? [t.estimatedShort(usd(s.estimated))] : []),
    ...(s.unpriced > 0 ? [t.unpricedShort(s.unpriced)] : []),
    ...(s.noUsage > 0 ? [t.noUsageShort(s.noUsage)] : []),
  ];
}
