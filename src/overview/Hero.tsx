import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import type { Range } from "@/ui/range";
import { rangeText } from "@/ui/range.i18n";
import { useNav } from "@/nav";
import { compact, msShort, traffic } from "@/format";
import { usd, type Dashboard } from "@/types";
import { useText } from "@/i18n";
import { LIVE_REACH_MS, useLiveWindow } from "./useLive";
import {
  cacheOf,
  cellModels,
  costTag,
  costText,
  delta,
  historySeries,
  liveModelsAt,
  liveSeries,
  rankCost,
  totalCost,
  totalTokens,
  type Delta,
  type TopModels,
} from "./series";
import { byteUnit, niceTicks } from "./HeroAxis";
import { Chart, type ChartSpec, type TipRow } from "./HeroChart";
import { METRICS, type Metric } from "./metric";
import { LinkText } from "./parts";
import { overviewText } from "./overview.i18n";

type Text = (typeof overviewText)["zh"];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const fmtTokens = (n: number) => compact(Math.round(n));
const fmtCount = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${Math.round(n)}%`;

// 数据颜色只取 `--data-*`
const C1 = "var(--data-1)";
const C2 = "var(--data-2)";
const CREST = "var(--data-rest)";
const CFAIL = "var(--data-fail)";

/**
 * 用量：六个指标并排，选中的那个画成下面带坐标轴的大图。
 *
 * 每个指标是名目、大数、环比。**大数和图是同一段时间**：
 *
 * · 历史档（24 小时、7 天、30 天、自定义、某一天）六个都是所选的区间，和上一个等长区间比。
 * · 实时档 token、费用、请求三个是最近十分钟，图跟着事件流走；十分钟里的样本撑不起有意义
 *   的命中率和分位，缓存命中、首 token、流量三个按 24 小时算，名目旁边标着。
 *
 * 大图一律画线：可加的（token、费用、请求、流量）是线下铺一片淡色的面积曲线，两段的是
 * 主量的面积加对照量的一条细线（请求数和失败数、上传和下载）；比率和延迟只画线（缓存命中、
 * 首 token）。实时档 token、费用读的是速率。图上方一行是选中指标的细项，费用的限定词在
 * 那里一直写着。指着（或键盘聚焦）大图时逐格出提示。
 *
 * 实时档的事件流订阅在这一层：每半秒往左挪一步时只重画这一块，页面上别的部分不跟着
 * 每一帧重画。
 */
export function Hero({
  d,
  range,
  scope,
  step,
  metric,
  onMetric,
  detailSince = null,
}: {
  d: Dashboard;
  range: Range;
  /** 数据属于哪个区间（`rangeId`）：换了区间，数字直接落到新值 */
  scope: string;
  /** 历史档的格宽（`bucketOf`） */
  step: number;
  metric: Metric;
  onMetric: (m: Metric) => void;
  /** 逐条记录从哪一刻起有（`UsageHistory.detail_since_ms`）。图上早于它的格子是「未记录」 */
  detailSince?: number | null;
}) {
  const t = useText(overviewText);
  const rt = useText(rangeText);
  const uid = useId();
  const live = range.live === true;
  // 多留一个核宽的样本：最左边那一格的鼓包有一半来自图外
  const win = useLiveWindow(live, range.ms + LIVE_REACH_MS);
  const now = Date.now();
  // **图的右端是 `range.to ?? 现在`**：「某一天」画到那一天的终点
  const hist = historySeries(d, range.to ?? now, step);
  const lv = live ? liveSeries(win.samples, win.ends, now, range.ms) : null;
  const s = d.summary;
  const p = d.prev;
  // 实时档里按 24 小时算的那几个，名目旁边标出口径
  const dayScope = live ? rt.preset["1d"] : undefined;
  const period = range.compare;

  // ── 六个大数
  const tokens = lv ? lv.totals.tokens : totalTokens(s);
  const output = lv ? lv.totals.output : s.output_tokens;
  const costRow = lv
    ? {
        cost: lv.totals.cost,
        estimated: lv.totals.estimated,
        unpriced: lv.totals.unpriced,
        noUsage: 0,
        pending: lv.totals.pending,
      }
    : {
        cost: totalCost(s),
        estimated: s.cost_micros_estimated,
        unpriced: s.unpriced_requests,
        noUsage: s.no_usage_requests,
        pending: 0,
      };
  const cost = rankCost(costRow, t);
  const requests = lv ? lv.totals.requests : s.requests;
  const failed = lv ? lv.totals.failed : s.failed;
  const cache = cacheOf(s);
  const prevCache = p ? cacheOf(p) : null;
  const ttftNow = d.ttft?.p50_ms ?? null;

  const tiles: Record<Metric, TileSpec> = {
    tokens: {
      label: t.kpiTokens,
      value: <AnimatedNumber value={tokens} format={fmtTokens} scope={scope} />,
      delta: !live && p && (
        <Change d={delta(tokens, totalTokens(p))} period={period} before={fmtTokens(totalTokens(p))} now={fmtTokens(tokens)} />
      ),
    },
    cost: {
      label: t.kpiCost,
      value: <CostValue c={cost} amount={costRow.cost} scope={scope} />,
      delta: !live && p && (
        <Change
          d={delta(costRow.cost, totalCost(p))}
          good="down"
          period={period}
          before={usd(totalCost(p))}
          now={usd(costRow.cost)}
        />
      ),
      tag: <CostTag tag={costTag(costRow, t)} notes={cost.notes} />,
    },
    requests: {
      label: t.kpiRequests,
      value: <AnimatedNumber value={requests} format={fmtCount} scope={scope} />,
      delta: !live && p && (
        <Change d={delta(requests, p.requests)} period={period} before={fmtCount(p.requests)} now={fmtCount(requests)} />
      ),
    },
    cache: {
      label: t.kpiCache,
      scopeTag: dayScope,
      value: cache.hit === null ? "—" : <AnimatedNumber value={cache.hit * 100} format={pct} scope={scope} />,
      delta: cache.hit !== null && prevCache && (
        <Change
          d={delta(cache.hit, prevCache.hit ?? 0)}
          good="up"
          period={period}
          before={prevCache.hit !== null ? pct(prevCache.hit * 100) : "—"}
          now={pct(cache.hit * 100)}
        />
      ),
    },
    ttft: {
      label: t.kpiLatency,
      scopeTag: dayScope,
      value: ttftNow === null ? "—" : msShort(ttftNow),
      delta: ttftNow !== null && d.prev_ttft && (
        <Change
          // 上一个区间没有样本：没有可比的幅度（「—」）
          d={delta(ttftNow, d.prev_ttft.p50_ms ?? 0)}
          good="down"
          period={period}
          before={d.prev_ttft.p50_ms != null ? msShort(d.prev_ttft.p50_ms) : "—"}
          now={msShort(ttftNow)}
        />
      ),
    },
    traffic: {
      label: t.kpiTraffic,
      scopeTag: dayScope,
      value: traffic(s.sent_bytes + s.received_bytes),
      delta: p && (
        <Change
          d={delta(s.sent_bytes + s.received_bytes, p.sent_bytes + p.received_bytes)}
          period={period}
          before={traffic(p.sent_bytes + p.received_bytes)}
          now={traffic(s.sent_bytes + s.received_bytes)}
        />
      ),
    },
  };

  // ── 选中指标的细项（图上方那一行）
  const detail: Record<Metric, ReactNode> = {
    tokens: t.inOut(fmtTokens(tokens - output), fmtTokens(output)),
    cost: <CostDetail row={costRow} kind={cost.kind} prefix={cost.prefix} requests={requests} />,
    requests: <RequestsDetail requests={requests} failed={failed} />,
    cache: <CacheDetail read={cache.read} plain={cache.plain} write={cache.write} saved={s.cache_saved_micros} />,
    ttft:
      d.ttft === null
        ? t.chartUnavailable
        : d.ttft.p50_ms == null || d.ttft.p95_ms == null
          ? t.noSamples
          : t.latDetail(msShort(d.ttft.p50_ms), msShort(d.ttft.p95_ms)),
    traffic: `${t.upload(traffic(s.sent_bytes))} · ${t.download(traffic(s.received_bytes))}`,
  };

  const spec = chartSpec(metric, { d, hist, lv, samples: win.samples, step, t });

  // 指着哪一格。记着是哪个指标的：换了指标（格子可能不一样多）就不再指着
  const [hover, setHover] = useState<{ metric: Metric; i: number } | null>(null);
  const n = spec?.grid.at.length ?? 0;
  const cursor = hover && hover.metric === metric && hover.i < n ? hover.i : null;
  const point = useCallback((i: number | null) => setHover(i === null ? null : { metric, i }), [metric]);
  const clear = useCallback(() => setHover(null), []);
  useHoverOff(cursor !== null, clear);

  const tabId = (m: Metric) => `${uid}-tab-${m}`;
  const panelId = `${uid}-panel`;
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = METRICS.indexOf(metric);
    const next =
      e.key === "ArrowRight" ? (k + 1) % METRICS.length
      : e.key === "ArrowLeft" ? (k - 1 + METRICS.length) % METRICS.length
      : e.key === "Home" ? 0
      : e.key === "End" ? METRICS.length - 1
      : null;
    if (next === null) return;
    e.preventDefault();
    const m = METRICS[next]!;
    onMetric(m);
    document.getElementById(tabId(m))?.focus();
  };

  return (
    <section
      aria-label={t.usageLabel}
      data-slot="overview-hero"
      className="min-w-0 rounded-[10px] border border-border bg-panel"
    >
      <div
        role="tablist"
        aria-label={t.metricsLabel}
        onKeyDown={onTabKey}
        className="grid grid-cols-3 border-b border-border @min-[760px]/page:grid-cols-6"
      >
        {METRICS.map((m, i) => (
          <Tile
            key={m}
            id={tabId(m)}
            panel={panelId}
            on={m === metric}
            index={i}
            spec={tiles[m]}
            onPick={() => onMetric(m)}
          />
        ))}
      </div>
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(metric)} className="pt-3.5 pr-5 pb-3.5 pl-3">
        <div className="flex min-h-5 flex-wrap items-center gap-x-4 gap-y-1 pl-11">
          <div className="min-w-0 tw-body text-foreground/85">{detail[metric]}</div>
          <div className="ml-auto flex shrink-0 items-center gap-3.5 tw-label whitespace-nowrap text-muted-foreground">
            {spec?.legend.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={cn("block shrink-0", l.shape === "rect" ? "size-2.5 rounded-[2px]" : "h-0.5 w-3.5 rounded-[1px]")}
                  style={{ background: l.color }}
                />
                {l.label}
              </span>
            ))}
            {spec?.note && <span>{spec.note}</span>}
          </div>
        </div>
        <Chart
          // 换了指标从头画：线不从上一个指标的形状变过去
          key={metric}
          spec={spec}
          unrecorded={live ? 0 : unrecordedSlots(hist.grid, detailSince)}
          cursor={cursor}
          onPoint={point}
          now={now}
          live={live}
          label={t.chartOf(tiles[metric].label)}
        />
      </div>
    </section>
  );
}

/** 一个指标：名目（实时档里按 24 小时算的旁边标着）、大数、环比，费用还有它的限定词 */
interface TileSpec {
  label: string;
  scopeTag?: string;
  value: ReactNode;
  delta?: ReactNode;
  tag?: ReactNode;
}

/**
 * 六个指标里的一个。宽的时候六个一排，窄于 760px 排成 3 × 2：格子之间的分隔线、四个角
 * 的圆角跟着换。选中的那个底色升一档、下沿一道 `--data-1`。
 */
function Tile({
  id,
  panel,
  on,
  index,
  spec,
  onPick,
}: {
  id: string;
  panel: string;
  on: boolean;
  index: number;
  spec: TileSpec;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-selected={on}
      aria-controls={panel}
      tabIndex={on ? 0 : -1}
      onClick={onPick}
      className={cn(
        "relative flex min-w-0 cursor-pointer flex-col items-start gap-px border-border px-4 pt-3 pb-[11px] text-left outline-none",
        "transition-colors duration-(--motion-fast) ease-(--motion-ease) focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset",
        on ? "bg-foreground/[0.04]" : "hover:bg-foreground/[0.02]",
        // 分隔线：一排六个时左边一道；3 × 2 时第二排上面一道、每排第一个左边没有
        index === 1 || index === 2 ? "border-l" : "",
        index === 3 && "border-t @min-[760px]/page:border-t-0 @min-[760px]/page:border-l",
        index >= 4 && "border-t border-l @min-[760px]/page:border-t-0",
        // 圆角跟着卡片的外框（10px 减去 1px 边）
        index === 0 && "rounded-tl-[9px]",
        index === 2 && "rounded-tr-[9px] @min-[760px]/page:rounded-tr-none",
        index === 5 && "@min-[760px]/page:rounded-tr-[9px]",
      )}
    >
      <span className="flex h-[18px] max-w-full min-w-0 items-center gap-1.5">
        <span className={cn("truncate tw-head", on ? "text-foreground" : "text-muted-foreground")}>{spec.label}</span>
        {spec.scopeTag && <span className="shrink-0 tw-label text-muted-foreground/80">{spec.scopeTag}</span>}
      </span>
      <span className="max-w-full truncate tw-display leading-[30px]">{spec.value}</span>
      <span className="flex h-4 max-w-full min-w-0 items-center gap-1.5 tw-label text-muted-foreground">
        {spec.delta}
        {spec.tag}
      </span>
      <span
        aria-hidden
        className={cn(
          "absolute inset-x-0 -bottom-px h-0.5 transition-colors duration-(--motion-fast) ease-(--motion-ease)",
          on ? "bg-data-1" : "bg-transparent",
        )}
      />
    </button>
  );
}

/**
 * 环比：方向和幅度，悬停写出和什么比、从多少到多少。
 *
 * **没有参照系的数字只能读，不能判断。**只有好坏分明的那几样上色：费用少了、命中率高了、
 * 首 token 快了。用量和请求数两个方向都不上色 —— 多用掉一些 token 不是问题，少用也不是
 * 成绩。不到百分之一算持平，箭头放平。上一个区间是零、取不到时都不画。
 */
function Change({
  d,
  good,
  period,
  before,
  now,
}: {
  d: Delta | null;
  good?: "up" | "down";
  /** 「24 小时」「7 天」「等长区间」 */
  period: string;
  before: string;
  now: string;
}) {
  const t = useText(overviewText);
  // 上一个区间没有记录（库是那之后才有的，或者那时还没用）：没有可比的，这一行空着。
  // 六个指标下面各挂一道「—」只是六处噪点
  if (!d || d.kind === "noPrior") return null;
  const shown = Math.round(Math.abs(d.ratio * 100));
  const flat = shown === 0;
  const better = !flat && ((good === "down" && d.ratio < 0) || (good === "up" && d.ratio > 0));
  const Icon = flat ? ArrowRightIcon : d.ratio < 0 ? ArrowDownRightIcon : ArrowUpRightIcon;
  const tip = t.deltaTip(period, before, now);
  return (
    <Tip text={tip}>
      <span aria-label={tip} className={cn("inline-flex shrink-0 items-center gap-0.5 tw-num", better && "text-success")}>
        <Icon aria-hidden className="size-3" />
        {shown.toLocaleString()}%
      </span>
    </Tip>
  );
}

/**
 * 费用那个大数。写什么见 `rankCost`：有算不出来的请求时是下限（「≥」），含估算的带「~」。
 * 一条都没算出来时不写 $0，写「—」，限定词写着为什么。
 */
function CostValue({ c, amount, scope }: { c: ReturnType<typeof rankCost>; amount: number; scope: string }) {
  if (c.kind !== "amount") return <>—</>;
  /*
    指标只有一百多像素宽：「≥~」两个限定符按大数的字号写，「≥~$52.57」就放不下了。限定符
    缩小写在前面，意思不变；一千美元以上不写分，写满几位的整数
  */
  return (
    <>
      {c.prefix && <span className="mr-0.5 tw-head text-muted-foreground">{c.prefix}</span>}
      <AnimatedNumber value={amount} format={tileUsd} scope={scope} />
    </>
  );
}

/** 指标上的费用：一千美元以上不写分 */
function tileUsd(micros: number): string {
  const v = Math.round(micros);
  return v >= 1e9 ? `$${Math.round(v / 1e6).toLocaleString("en-US")}` : usd(v);
}

/**
 * 费用指标上**一直看得见**的限定词（`costTag`）。完整的几句在悬停里，选中费用时细项那一行
 * 也逐条写着。
 */
function CostTag({ tag, notes }: { tag: string | null; notes: string[] }) {
  if (!tag) return null;
  const word = <span className="min-w-0 truncate">{tag}</span>;
  if (notes.length === 0) return word;
  return (
    <Tip
      text={
        <div className="space-y-1">
          {notes.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      }
    >
      {word}
    </Tip>
  );
}

/** 一段细项之间的「 · 」 */
function Dots({ items }: { items: ReactNode[] }) {
  return (
    <>
      {items.map((x, i) => (
        <span key={i}>
          {i > 0 && " · "}
          {x}
        </span>
      ))}
    </>
  );
}

/**
 * 费用的细项：平均每次请求多少，和**金额之外的那几样**（含估算多少、几条无法计价、几条
 * 没有用量、实时档几条尚在计算），各写一段。无法计价的点进去是流量页里那一批。
 */
function CostDetail({
  row,
  kind,
  prefix,
  requests,
}: {
  row: { cost: number; estimated: number; unpriced: number; noUsage: number; pending: number };
  kind: "amount" | "unpriced" | "noUsage";
  prefix: string;
  requests: number;
}) {
  const t = useText(overviewText);
  const nav = useNav();
  const items: ReactNode[] = [];
  if (kind === "amount")
    items.push(requests > 0 ? t.avgCost(prefix + usd(Math.round(row.cost / requests))) : t.noRequestsShort);
  if (row.estimated > 0) items.push(t.estimated(usd(row.estimated)));
  if (row.unpriced > 0)
    items.push(
      <Tip text={t.rankUnpriced(row.unpriced)}>
        <LinkText onOpen={() => nav.open("requests", { grouped: false, filter: { unpricedOnly: true } })}>
          {t.shortUnpriced(row.unpriced)}
          <span className="sr-only">{t.showUnpriced}</span>
        </LinkText>
      </Tip>,
    );
  if (row.noUsage > 0)
    items.push(
      <Tip text={t.rankNoUsage(row.noUsage)}>
        <span>{t.shortNoUsage(row.noUsage)}</span>
      </Tip>,
    );
  if (row.pending > 0)
    items.push(
      <Tip text={t.rankPending(row.pending)}>
        <span>{t.shortPending(row.pending)}</span>
      </Tip>,
    );
  return <Dots items={items} />;
}

/** 请求的细项：失败几次（红的，点进去是流量页里失败的那一批）和失败率；没有失败就说没有 */
function RequestsDetail({ requests, failed }: { requests: number; failed: number }) {
  const t = useText(overviewText);
  const nav = useNav();
  if (failed === 0) return <>{requests > 0 ? t.noFailures : t.noRequestsShort}</>;
  return (
    <>
      <Tip text={t.showFailed}>
        <LinkText
          className="text-destructive"
          onOpen={() => nav.open("requests", { grouped: false, filter: { failedOnly: true } })}
        >
          {t.failedSub(failed)}
        </LinkText>
      </Tip>
      {t.rateSuffix(((failed / Math.max(1, requests)) * 100).toFixed(1))}
    </>
  );
}

/**
 * 缓存的细项：一根小条，三段按单价从低到高排（读缓存最便宜、写缓存最贵），亮的那一段越长
 * 越省 —— **这根条就是命中率的公式本身**；后面写出三段各是多少，和省下（或净增）的费用。
 */
function CacheDetail({ read, plain, write, saved }: { read: number; plain: number; write: number; saved: number }) {
  const t = useText(overviewText);
  const ctx = read + plain + write;
  if (ctx === 0) return <>{t.noTokens}</>;
  const parts = [
    { key: "read", color: "bg-data-1", name: t.cacheReads, n: read },
    { key: "plain", color: "bg-data-rest", name: t.uncachedInput, n: plain },
    { key: "write", color: "bg-data-2", name: t.cacheWrites, n: write },
  ];
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      <span aria-hidden className="flex h-1.5 w-16 shrink-0 gap-0.5 overflow-hidden rounded-[2px] bg-foreground/[0.06]">
        {parts.map((p) =>
          p.n > 0 ? <span key={p.key} className={cn("motion-bar", p.color)} style={{ width: `${(p.n / ctx) * 100}%` }} /> : null,
        )}
      </span>
      {parts.map((p) => (
        <Tip key={p.key} text={t.tokens(p.n.toLocaleString(), p.n)}>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", p.color)} />
            {p.name}
            <span className="tw-num">{fmtTokens(p.n)}</span>
          </span>
        </Tip>
      ))}
      <span>{saved < 0 ? t.netCost(usd(-saved)) : t.saved(usd(saved))}</span>
    </span>
  );
}

// ───────────────────────────────────────────── 大图：选中的指标画成什么

/** 一格多宽，写成「6 小时」「1 天」 */
function widthOf(step: number, t: Text): string {
  return step >= DAY ? t.days(Math.round(step / DAY)) : t.hours(Math.round(step / HOUR));
}

/** 纵轴上的 token：整齐的刻度不写「.0」（「8M」，不是「8.0M」） */
const axisTokens = (v: number) => compact(v).replace(/\.0(?=[kMB]$)/, "");
/** 纵轴上的钱：整齐的刻度写几位就几位，不补零 */
const axisMoney = (v: number) => `$${(v / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
/** 纵轴上的毫秒：一秒以内写 ms，以上写 s */
const axisMs = (v: number) => (v < 1000 ? `${Math.round(v)}ms` : `${Number((v / 1000).toPrecision(4))}s`);
const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"];

/** 一格里排前几的模型，写成提示里的几行 */
function modelRows(m: TopModels | null, by: "tokens" | "cost", t: Text): TipRow[] {
  if (!m) return [];
  const v = (r: TopModels["top"][number]) => (by === "tokens" ? fmtTokens(r.tokens) : costText(r, t));
  return [
    ...m.top.map((r) => ({ v: v(r), k: r.name || t.unknownModel })),
    ...(m.other ? [{ v: v(m.other), k: t.otherModels(m.other.count) }] : []),
  ];
}

const peak = (...xs: readonly (readonly (number | null)[])[]) => {
  let m = 0;
  for (const x of xs) for (const v of x) if (v != null && v > m) m = v;
  return m;
};

/**
 * 选中的指标画成什么。那一样取不到（读取失败）时是 `null`：写「暂时取不到」，不画成零。
 */
function chartSpec(
  metric: Metric,
  {
    d,
    hist,
    lv,
    samples,
    step,
    t,
  }: {
    d: Dashboard;
    hist: ReturnType<typeof historySeries>;
    lv: ReturnType<typeof liveSeries> | null;
    samples: Parameters<typeof liveModelsAt>[0];
    step: number;
    t: Text;
  },
): ChartSpec | null {
  const cellAt = (i: number) => hist.cells[i];
  const slot = t.perSlot(widthOf(step, t));
  const hourly = t.perSlot(widthOf(HOUR, t));
  switch (metric) {
    case "tokens": {
      if (lv) {
        const v = lv.tokens!;
        return {
          grid: lv.grid,
            lines: [{ values: v, color: C1, wash: true }],
          ticks: niceTicks(peak(v)),
          axis: axisTokens,
          tip: (i) => ({
            main: t.tokenRate(fmtTokens(v[i] ?? 0)),
            rows: [],
            rows2: modelRows(liveModelsAt(samples, lv.grid.at[i] ?? 0, "tokens"), "tokens", t),
          }),
          legend: [],
          note: t.tokenUnit,
        };
      }
      const v = hist.tokens;
      const out = hist.output;
      if (!v || !out) return null;
      return {
        grid: hist.grid,
        lines: [{ values: v, color: C1, wash: true }],
        ticks: niceTicks(peak(v), { integer: true }),
        axis: axisTokens,
        tip: (i) => {
          const n = v[i] ?? 0;
          if (n === 0) return { main: t.tokens("0", 0), rows: [], rows2: [] };
          const o = out[i] ?? 0;
          return {
            main: t.tokens(fmtTokens(n), n),
            rows: [
              { v: fmtTokens(n - o), k: t.input },
              { v: fmtTokens(o), k: t.output },
            ],
            rows2: modelRows(cellModels(d.buckets_by_model, hist.grid.at[i] ?? 0, "tokens"), "tokens", t),
          };
        },
        legend: [],
        note: slot,
      };
    }
    case "cost": {
      if (lv) {
        const v = lv.cost!;
        return {
          grid: lv.grid,
            lines: [{ values: v, color: C1, wash: true }],
          ticks: niceTicks(peak(v) || 10_000),
          axis: axisMoney,
          tip: (i) => ({
            main: t.costRate(usd(Math.round(v[i] ?? 0))),
            rows: modelRows(liveModelsAt(samples, lv.grid.at[i] ?? 0, "cost"), "cost", t),
            rows2: [],
          }),
          legend: [],
          note: t.costUnit,
        };
      }
      const v = hist.cost;
      if (!v) return null;
      return {
        grid: hist.grid,
        lines: [{ values: v, color: C1, wash: true }],
        // 一分钱都没有的图，纵轴写到 $0.04，不写到百万分之四
        ticks: niceTicks(peak(v) || 10_000),
        axis: axisMoney,
        tip: (i) => {
          const c = cellAt(i);
          if (!c || c.requests === 0) return { main: t.noRequestsShort, rows: [], rows2: [] };
          return {
            main: costText(
              {
                cost: c.cost_micros_exact + c.cost_micros_estimated,
                estimated: c.cost_micros_estimated,
                unpriced: c.unpriced_requests,
                noUsage: c.no_usage_requests,
              },
              t,
            ),
            rows: modelRows(cellModels(d.buckets_by_model, c.at_ms, "cost"), "cost", t),
            rows2: [],
          };
        },
        legend: [],
        note: slot,
      };
    }
    case "requests": {
      const src = lv ?? hist;
      const total = src.requests;
      const bad = src.failed;
      if (!total || !bad) return null;
      const ok = total.map((n, i) => Math.max(0, n - (bad[i] ?? 0)));
      return {
        grid: src.grid,
        lines: [
          { values: total, color: C1, wash: true },
          { values: bad, color: CFAIL },
        ],
        ticks: niceTicks(peak(total), { integer: true }),
        axis: fmtCount,
        tip: (i) => {
          const n = total[i] ?? 0;
          if (n === 0) return { main: t.noRequestsShort, rows: [], rows2: [] };
          return {
            main: t.reqCount(fmtCount(n), n),
            rows: [
              { v: fmtCount(ok[i] ?? 0), k: t.succeeded, key: C1 },
              { v: fmtCount(bad[i] ?? 0), k: t.failed, key: CFAIL },
            ],
            rows2: [],
          };
        },
        legend: [
          { label: t.kpiRequests, color: C1, shape: "stroke" },
          { label: t.failed, color: CFAIL, shape: "stroke" },
        ],
        note: lv ? t.perSlot(t.seconds(Math.round(lv.grid.step / 1000))) : slot,
      };
    }
    case "cache": {
      const v = hist.hit;
      if (!v) return null;
      return {
        grid: hist.grid,
        lines: [{ values: v, color: C1, wash: true }],
        ticks: niceTicks(0.9),
        axis: (x) => pct(x * 100),
        tip: (i) => {
          const c = cellAt(i);
          const h = v[i];
          if (!c || h == null) return { main: t.noTokens, rows: [], rows2: [] };
          return {
            main: t.hitRate(pct(h * 100)),
            rows: [
              { v: fmtTokens(c.cache_read_tokens), k: t.cacheReads, key: C1 },
              { v: fmtTokens(c.input_tokens), k: t.uncachedInput, key: CREST },
              { v: fmtTokens(c.cache_write_tokens), k: t.cacheWrites, key: C2 },
            ],
            rows2: [],
          };
        },
        legend: [],
        note: lv ? hourly : slot,
      };
    }
    case "ttft": {
      const a = hist.p50;
      const b = hist.p95;
      if (!a || !b) return null;
      return {
        grid: hist.grid,
        // 分位不铺面：延迟没有「多少」
        lines: [
          { values: a, color: C1 },
          { values: b, color: C2 },
        ],
        ticks: niceTicks(peak(a, b) || 1000),
        axis: axisMs,
        tip: (i) => {
          const x = a[i];
          const y = b[i];
          if (x == null || y == null) return { main: t.noSamples, rows: [], rows2: [] };
          return {
            main: msShort(x),
            rows: [
              { v: msShort(x), k: "P50", key: C1 },
              { v: msShort(y), k: "P95", key: C2 },
            ],
            rows2: [],
          };
        },
        legend: [
          { label: "P50", color: C1, shape: "stroke" },
          { label: "P95", color: C2, shape: "stroke" },
        ],
        note: lv ? hourly : slot,
      };
    }
    case "traffic": {
      const up = hist.sent;
      const down = hist.received;
      if (!up || !down) return null;
      const max = peak(up, down);
      const { unit, level } = byteUnit(max);
      return {
        grid: hist.grid,
        lines: [
          { values: up, color: C1, wash: true },
          { values: down, color: C2 },
        ],
        ticks: niceTicks(max, { integer: level === 0, unit }),
        axis: (x) => `${Number((x / unit).toPrecision(4))} ${BYTE_UNITS[level]}`,
        tip: (i) => {
          const u = up[i] ?? 0;
          const w = down[i] ?? 0;
          if (u + w === 0) return { main: traffic(0), rows: [], rows2: [] };
          return {
            main: traffic(u + w),
            rows: [
              { v: traffic(u), k: t.sent, key: C1 },
              { v: traffic(w), k: t.received, key: C2 },
            ],
            rows2: [],
          };
        },
        legend: [
          { label: t.sent, color: C1, shape: "stroke" },
          { label: t.received, color: C2, shape: "stroke" },
        ],
        note: lv ? hourly : slot,
      };
    }
  }
}

/**
 * 前几格整格早于逐条记录的起点：那时库里还没有这几格的请求（库是那之后才建的，或者已经
 * 过了保留期），画成零就是说「那几天没用」。跨着起点的那一格照常画。
 */
export function unrecordedSlots(grid: { at: readonly number[]; step: number }, detailSince: number | null): number {
  if (detailSince === null) return 0;
  let k = 0;
  while (k < grid.at.length && (grid.at[k] ?? 0) + grid.step <= detailSince) k += 1;
  return k;
}

/**
 * 指针离开的方式不止「移到旁边去」一种，而只有那一种会送来 mouseleave：切走应用、截图
 * 工具接管指针、把鼠标甩到另一块屏幕上，竖线和提示框都会永远停在原地。这几种在这里收。
 * `mouseout` 且 `relatedTarget` 为空，说的正是「指针去了文档外面」。
 */
function useHoverOff(on: boolean, off: () => void) {
  useEffect(() => {
    if (!on) return;
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) off();
    };
    window.addEventListener("blur", off);
    document.addEventListener("mouseleave", off);
    document.addEventListener("mouseout", out);
    document.addEventListener("visibilitychange", off);
    return () => {
      window.removeEventListener("blur", off);
      document.removeEventListener("mouseleave", off);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("visibilitychange", off);
    };
  }, [on, off]);
}
