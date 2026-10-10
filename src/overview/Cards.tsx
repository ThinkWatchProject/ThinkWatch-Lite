import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import type { Range } from "@/ui/range";
import { rangeText } from "@/ui/range.i18n";
import { useNav } from "@/nav";
import { compact, monthDay, msShort, traffic } from "@/format";
import { usd, type Dashboard, type Percentiles } from "@/types";
import { useText } from "@/i18n";
import { LIVE_REACH_MS, useLiveWindow } from "./useLive";
import {
  cacheOf,
  delta,
  historySeries,
  liveSeries,
  rankCost,
  slotOf,
  slotTitle,
  totalCost,
  totalTokens,
  type Delta,
  type Grid,
} from "./series";
import { BarChart, LineChart, SPARK_H } from "./Spark";
import { LinkText } from "./parts";
import { overviewText } from "./overview.i18n";

/** 六张卡片 */
type CardId = "tokens" | "cost" | "cache" | "requests" | "latency" | "traffic";

/** 联动的竖线：指着哪张卡片、哪一刻 */
type Hover = { card: CardId; at: number } | null;

const fmtTokens = (n: number) => compact(Math.round(n));
const fmtCount = (n: number) => Math.round(n).toLocaleString();
const pct = (n: number) => `${Math.round(n)}%`;

/**
 * 概览的指标卡：Token · 费用 · 缓存命中 / 请求 · 首 token · 流量，三列两行（窄窗口下两列）。
 *
 * 每张卡片一个大数、一句注解、一张小图。**大数和图是同一段时间**：
 *
 * · 历史档（24 小时、7 天、30 天、自定义）六张都是所选的区间，和上一个等长区间比。
 * · 实时档 token、费用、请求三张是最近十分钟，跟着事件流走；十分钟里的样本撑不起有
 *   意义的命中率和分位，缓存命中、首 token、流量三张按 24 小时算，标签旁边标着。
 *
 * 实时档的事件流订阅在这一层：每半秒往左挪一步时只重画卡片，页面上别的部分不跟着
 * 每一帧重画。
 */
export function CardGrid({
  d,
  range,
  scope,
  step,
}: {
  d: Dashboard;
  range: Range;
  /** 数据属于哪个区间（`rangeId`）：换了区间，数字直接落到新值 */
  scope: string;
  /** 历史档的格宽（`bucketOf`）。实时档是 24 小时一小时一格的那一份 */
  step: number;
}) {
  const t = useText(overviewText);
  const rt = useText(rangeText);
  const live = range.live === true;
  // 多留一个核宽的样本：最左边那一格的鼓包有一半来自图外
  const win = useLiveWindow(live, range.ms + LIVE_REACH_MS);
  const now = Date.now();
  const hist = historySeries(d, now, step);
  const lv = live ? liveSeries(win.samples, win.ends, now, range.ms) : null;
  /** token、费用、请求三张卡片的那一份：实时档是十分钟，别的档是所选区间 */
  const main = lv ?? hist;
  const s = d.summary;
  const p = d.prev;
  const day = rt.preset["1d"];
  // 实时档里按 24 小时算的那几张卡片，标签旁边标出口径
  const dayScope = live ? day : undefined;
  const period = range.compare;

  const [hover, setHover] = useState<Hover>(null);
  const clear = useCallback(() => setHover(null), []);
  useHoverOff(hover !== null, clear);

  /** 一张图的联动：哪一格亮着、指针在它上面时交出哪一刻，提示框开没开，首尾两头写什么 */
  const sync = (card: CardId, grid: Grid): Sync => ({
    n: grid.at.length,
    cursor: hover ? slotOf(grid, hover.at) : null,
    onPoint: (i: number | null) => {
      const at = i === null ? undefined : grid.at[i];
      setHover(at === undefined ? null : { card, at });
    },
    title: (i: number) => slotTitle(grid, i, now, t.now),
    tipOn: hover?.card === card,
    ends: [
      grid.kind === "instant"
        ? t.liveAgo
        : live
          ? t.ago(day)
          : range.custom
            ? monthDay(d.since_ms)
            : t.ago(range.label),
      t.now,
    ],
  });

  // ── token
  const tokens = lv ? lv.totals.tokens : totalTokens(s);
  const output = lv ? lv.totals.output : s.output_tokens;
  // ── 费用
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
      };
  const cost = rankCost(costRow, t);
  // ── 请求
  const requests = lv ? lv.totals.requests : s.requests;
  const failed = lv ? lv.totals.failed : s.failed;
  // ── 缓存：实时档也按 24 小时
  const cache = cacheOf(s);
  const prevCache = p ? cacheOf(p) : null;
  // ── 首 token、流量：实时档也按 24 小时（`hist`）
  const ttftNow = d.ttft?.p50_ms ?? null;

  const tok = sync("tokens", main.grid);
  const money = sync("cost", main.grid);
  const req = sync("requests", main.grid);

  return (
    <div className="@container" data-slot="overview-cards">
      <div className="grid grid-cols-2 gap-3 @min-[680px]:grid-cols-3">
        <Card
          label={t.kpiTokens}
          hovered={tok.tipOn}
          pill={
            !live &&
            p && (
              <DeltaPill
                d={delta(tokens, totalTokens(p))}
                period={period}
                before={fmtTokens(totalTokens(p))}
                now={fmtTokens(tokens)}
              />
            )
          }
          value={<AnimatedNumber value={tokens} format={fmtTokens} scope={scope} />}
          sub={t.inOut(fmtTokens(tokens - output), fmtTokens(output))}
          ends={tok.ends}
        >
          {main.tokens ? (
            <LineChart
              {...chartOf(tok)}
              label={t.chartOf(t.kpiTokens)}
              lines={[{ values: main.tokens, color: "var(--data-1)", main: true, wash: true }]}
              tip={tipAt(tok, (i) => {
                const v = main.tokens?.[i] ?? 0;
                return live ? t.tokenRate(fmtTokens(v)) : fmtTokens(v);
              })}
            />
          ) : (
            <Unavailable />
          )}
        </Card>

        <Card
          label={t.kpiCost}
          hovered={money.tipOn}
          pill={
            !live &&
            p && (
              <DeltaPill
                d={delta(costRow.cost, totalCost(p))}
                good="down"
                period={period}
                before={usd(totalCost(p))}
                now={usd(costRow.cost)}
              />
            )
          }
          value={<CostValue c={cost} amount={costRow.cost} scope={scope} />}
          sub={
            cost.kind === "unpriced"
              ? t.unpricedCell
              : cost.kind === "noUsage"
                ? t.noUsageCell
                : requests > 0
                  ? t.avgCost(cost.prefix + usd(Math.round(costRow.cost / requests)))
                  : t.noRequestsShort
          }
          ends={money.ends}
        >
          {main.cost ? (
            <LineChart
              {...chartOf(money)}
              label={t.chartOf(t.kpiCost)}
              lines={[{ values: main.cost, color: "var(--data-1)", main: true, wash: true }]}
              tip={tipAt(money, (i) => {
                const v = Math.round(main.cost?.[i] ?? 0);
                return live ? t.costRate(usd(v)) : usd(v);
              })}
            />
          ) : (
            <Unavailable />
          )}
        </Card>

        <Card
          label={t.kpiCache}
          scopeTag={dayScope}
          pill={
            cache.hit !== null &&
            prevCache && (
              <DeltaPill
                d={delta(cache.hit, prevCache.hit ?? 0)}
                good="up"
                period={period}
                before={prevCache.hit !== null ? pct(prevCache.hit * 100) : "—"}
                now={pct(cache.hit * 100)}
              />
            )
          }
          value={cache.hit === null ? "—" : <AnimatedNumber value={cache.hit * 100} format={pct} scope={scope} />}
          sub={
            cache.ctx === 0
              ? t.noTokens
              : s.cache_saved_micros < 0
                ? t.netCost(usd(-s.cache_saved_micros))
                : t.saved(usd(s.cache_saved_micros))
          }
        >
          <CacheParts read={cache.read} plain={cache.plain} write={cache.write} />
        </Card>

        <Card
          label={t.kpiRequests}
          hovered={req.tipOn}
          pill={
            !live &&
            p && (
              <DeltaPill
                d={delta(requests, p.requests)}
                period={period}
                before={fmtCount(p.requests)}
                now={fmtCount(requests)}
              />
            )
          }
          value={<AnimatedNumber value={requests} format={fmtCount} scope={scope} />}
          sub={<RequestsSub requests={requests} failed={failed} />}
          ends={req.ends}
        >
          {main.requests && main.failed ? (
            <BarChart
              {...chartOf(req)}
              label={t.chartOf(t.kpiRequests)}
              total={main.requests}
              failed={main.failed}
              tip={tipAt(req, (i) => t.reqTip(main.requests?.[i] ?? 0, main.failed?.[i] ?? 0))}
            />
          ) : (
            <Unavailable />
          )}
        </Card>

        <LatencyCard
          ttft={d.ttft}
          series={hist.p50 && hist.p95 ? { p50: hist.p50, p95: hist.p95, sync: sync("latency", hist.grid) } : null}
          pill={
            ttftNow !== null &&
            d.prev_ttft && (
              <DeltaPill
                // 上一个区间没有样本：没有可比的幅度（「—」）
                d={delta(ttftNow, d.prev_ttft.p50_ms ?? 0)}
                good="down"
                period={period}
                before={d.prev_ttft.p50_ms != null ? msShort(d.prev_ttft.p50_ms) : "—"}
                now={msShort(ttftNow)}
              />
            )
          }
          scopeTag={dayScope}
        />

        <TrafficCard
          sent={s.sent_bytes}
          received={s.received_bytes}
          series={hist.sent && hist.received ? { sent: hist.sent, received: hist.received, sync: sync("traffic", hist.grid) } : null}
          pill={
            p && (
              <DeltaPill
                d={delta(s.sent_bytes + s.received_bytes, p.sent_bytes + p.received_bytes)}
                period={period}
                before={traffic(p.sent_bytes + p.received_bytes)}
                now={traffic(s.sent_bytes + s.received_bytes)}
              />
            )
          }
          scopeTag={dayScope}
        />
      </div>
    </div>
  );
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

/** 一张小图的联动：交给图的三样，外加提示框开没开、抬头怎么写、首尾两头写什么 */
type Sync = {
  n: number;
  cursor: number | null;
  onPoint: (i: number | null) => void;
  title: (i: number) => string;
  tipOn: boolean;
  ends: [string, string];
};

/** 交给小图的那三样 */
function chartOf(s: Sync) {
  return { n: s.n, cursor: s.cursor, onPoint: s.onPoint };
}

/** 提示框：只在指着的那张图上、指着某一格时有 */
function tipAt(s: Sync, value: (i: number) => string): { title: string; value: string } | null {
  return s.tipOn && s.cursor !== null ? { title: s.title(s.cursor), value: value(s.cursor) } : null;
}

/**
 * 一张卡片：名目（实时档里按 24 小时算的旁边标着）、环比、大数、一句注解、一张小图和
 * 它首尾两头的时刻。指着它的小图时，边换成品牌的青→品红。
 */
function Card({
  label,
  scopeTag,
  pill,
  value,
  sub,
  hovered = false,
  ends,
  children,
}: {
  label: string;
  scopeTag?: string;
  pill?: ReactNode;
  value: ReactNode;
  sub: ReactNode;
  hovered?: boolean;
  /** 小图下面首尾两头写什么。没有小图的卡片（缓存命中）不给 */
  ends?: [string, string];
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-col rounded-[10px] border px-4 pt-3.5 pb-3 transition-shadow duration-(--motion-fast) ease-(--motion-ease)",
        // 渐变边自己铺卡片的面：和 `border-border`、`bg-panel` 一起写的话，谁压过谁要看样式表里的先后
        hovered ? "brand-border" : "border-border bg-panel",
      )}
    >
      <div className="flex h-5 min-w-0 items-center gap-2">
        <h3 className="truncate tw-head text-muted-foreground">{label}</h3>
        {scopeTag && <span className="shrink-0 tw-label text-muted-foreground/80">{scopeTag}</span>}
        <span className="ml-auto flex shrink-0 items-center">{pill}</span>
      </div>
      <p className="mt-1.5 truncate tw-display">{value}</p>
      <div className="mt-[3px] flex h-4 min-w-0 items-center tw-label text-muted-foreground">
        <span className="min-w-0 truncate">{sub}</span>
      </div>
      {children}
      {ends && (
        <div className="mt-1.5 flex justify-between gap-2 tw-label text-muted-foreground">
          <span className="truncate">{ends[0]}</span>
          <span className="shrink-0">{ends[1]}</span>
        </div>
      )}
    </section>
  );
}

/**
 * 环比：方向和幅度，悬停写出和什么比、从多少到多少。
 *
 * **没有参照系的数字只能读，不能判断。**只有好坏分明的那几样上色：费用少了、命中率高了、
 * 首 token 快了。用量和请求数两个方向都不上色 —— 多用掉一些 token 不是问题，少用也不是
 * 成绩。不到百分之一算持平，箭头放平。上一个区间是零时写「—」，取不到时整格不画。
 */
function DeltaPill({
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
  if (!d) return null;
  if (d.kind === "noPrior")
    return (
      <Tip text={t.noPrior(period)}>
        <span className="inline-flex h-5 items-center rounded-md bg-foreground/[0.05] px-1.5 tw-label tw-num text-muted-foreground">
          —
        </span>
      </Tip>
    );
  const shown = Math.round(Math.abs(d.ratio * 100));
  const flat = shown === 0;
  const better = !flat && ((good === "down" && d.ratio < 0) || (good === "up" && d.ratio > 0));
  const Icon = flat ? ArrowRightIcon : d.ratio < 0 ? ArrowDownRightIcon : ArrowUpRightIcon;
  const tip = t.deltaTip(period, before, now);
  return (
    <Tip text={tip}>
      <span
        aria-label={tip}
        className={cn(
          "inline-flex h-5 items-center gap-0.5 rounded-md px-1.5 tw-label tw-num",
          better ? "bg-success/12 text-success-foreground" : "bg-foreground/[0.05] text-muted-foreground",
        )}
      >
        <Icon aria-hidden className="size-3" />
        {shown.toLocaleString()}%
      </span>
    </Tip>
  );
}

/**
 * 费用那个大数。写什么见 `rankCost`：有算不出来的请求时是下限（「≥」），含估算的带「~」，
 * 说明写在悬停里、数字带虚线下划线。一条都没算出来时不写 $0，写「—」，注解那一行说为什么。
 */
function CostValue({ c, amount, scope }: { c: ReturnType<typeof rankCost>; amount: number; scope: string }) {
  if (c.kind !== "amount") return <>—</>;
  const n = <AnimatedNumber value={amount} format={(v) => c.prefix + usd(Math.round(v))} scope={scope} />;
  if (c.notes.length === 0) return n;
  return (
    <Tip
      text={
        <div className="space-y-1">
          {c.notes.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      }
    >
      <span className="underline decoration-muted-foreground/50 decoration-dotted decoration-2 underline-offset-4">{n}</span>
    </Tip>
  );
}

/** 请求卡片的注解：失败几次（红的，点进去是流量页里失败的那一批）和失败率；没有失败就说没有 */
function RequestsSub({ requests, failed }: { requests: number; failed: number }) {
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
 * 缓存的构成：一根条，三段按单价从低到高排（读缓存最便宜、写缓存最贵），亮的那一段越长
 * 越省；下面三行写出各是多少。**这根条就是命中率的公式本身**。
 */
function CacheParts({ read, plain, write }: { read: number; plain: number; write: number }) {
  const t = useText(overviewText);
  const ctx = read + plain + write;
  const parts = [
    { key: "read", color: "bg-data-1", name: t.cacheReads, n: read },
    { key: "plain", color: "bg-data-rest", name: t.uncachedInput, n: plain },
    { key: "write", color: "bg-data-2", name: t.cacheWrites, n: write },
  ];
  return (
    <>
      <div className="mt-3.5 flex h-2.5 gap-0.5 overflow-hidden rounded-[3px] bg-foreground/[0.06]">
        {ctx > 0 &&
          parts.map((p) =>
            p.n > 0 ? <span key={p.key} className={cn("motion-bar", p.color)} style={{ width: `${(p.n / ctx) * 100}%` }} /> : null,
          )}
      </div>
      <div className="mt-2.5 flex flex-col gap-[5px] tw-label">
        {parts.map((p) => (
          <Tip key={p.key} text={t.tokens(p.n.toLocaleString(), p.n)}>
            <div className="flex min-w-0 items-center gap-2">
              <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", p.color)} />
              <span className="min-w-0 truncate text-muted-foreground">{p.name}</span>
              <span className="ml-auto shrink-0 tw-num">{fmtTokens(p.n)}</span>
            </div>
          </Tip>
        ))}
      </div>
    </>
  );
}

/** 图取不到（那一样读取失败）：**不是没有**，不画一条贴底的线 */
function Unavailable() {
  const t = useText(overviewText);
  return (
    <div className="mt-3 flex items-center justify-center tw-label text-muted-foreground" style={{ height: SPARK_H }}>
      {t.chartUnavailable}
    </div>
  );
}

/**
 * 首 token：第一个 token 到的时刻，P50 一条线、P95 一条线（只有流式请求有样本）。用分位
 * 不用平均值：AI 的延迟是长尾的，平均值会被几个极端值拉偏。
 *
 * 大数是**整段时间**的 P50（core 拿整段的样本求的；各格、各模型的分位合不出整体的），
 * 注解兼作图例、写整段的 P95。没有样本的格子线断开，用虚线跨过去。
 */
function LatencyCard({
  ttft,
  series,
  pill,
  scopeTag,
}: {
  /** 整段时间的分位。取不到是 `null`，没有样本是 `samples` 为 0 */
  ttft: Percentiles | null;
  series: { p50: (number | null)[]; p95: (number | null)[]; sync: Sync } | null;
  /** 环比（`DeltaPill`，`good="down"`）：比上一个区间的整体 P50 */
  pill?: ReactNode;
  scopeTag?: string;
}) {
  const t = useText(overviewText);
  const p50 = ttft?.p50_ms ?? null;
  const p95 = ttft?.p95_ms ?? null;
  const sub =
    p50 !== null && p95 !== null ? (
      <span className="inline-flex items-center gap-1">
        <Swatch color="bg-data-1" />
        P50 ·
        <Swatch color="bg-data-2" className="ml-1" />
        {t.p95(msShort(p95))}
      </span>
    ) : ttft === null ? (
      t.chartUnavailable
    ) : (
      t.noSamples
    );
  return (
    <Card
      label={t.kpiLatency}
      scopeTag={scopeTag}
      pill={pill}
      value={p50 === null ? "—" : msShort(p50)}
      sub={sub}
      hovered={series?.sync.tipOn}
      ends={series?.sync.ends}
    >
      {series ? (
        <LineChart
          {...chartOf(series.sync)}
          label={t.chartOf(t.kpiLatency)}
          lines={[
            { values: series.p50, color: "var(--data-1)", main: true },
            { values: series.p95, color: "var(--data-2)" },
          ]}
          tip={tipAt(series.sync, (i) => {
            const a = series.p50[i];
            const b = series.p95[i];
            return a == null || b == null ? t.noSamples : t.latTip(msShort(a), msShort(b));
          })}
        />
      ) : (
        <Unavailable />
      )}
    </Card>
  );
}

/**
 * 流量：网关和上游之间的请求体与回答体（线上的样子：网关压缩之后、解压之前），上传一条线、
 * 下载一条线。故障转移试过的每一跳都算；本地应答的没有流量。
 */
function TrafficCard({
  sent,
  received,
  series,
  pill,
  scopeTag,
}: {
  sent: number;
  received: number;
  series: { sent: number[]; received: number[]; sync: Sync } | null;
  /** 环比（`DeltaPill`）：比上一个区间的上传加下载 */
  pill?: ReactNode;
  scopeTag?: string;
}) {
  const t = useText(overviewText);
  const s = series;
  return (
    <Card
      label={t.kpiTraffic}
      scopeTag={scopeTag}
      pill={pill}
      value={traffic(sent + received)}
      sub={
        <span className="inline-flex items-center gap-1">
          <Swatch color="bg-data-1" />
          {t.upload(traffic(sent))} ·
          <Swatch color="bg-data-2" className="ml-1" />
          {t.download(traffic(received))}
        </span>
      }
      hovered={s?.sync.tipOn}
      ends={s?.sync.ends}
    >
      {s ? (
        <LineChart
          {...chartOf(s.sync)}
          label={t.chartOf(t.kpiTraffic)}
          lines={[
            { values: s.sent, color: "var(--data-1)", main: true, wash: true },
            { values: s.received, color: "var(--data-2)" },
          ]}
          tip={tipAt(s.sync, (i) => t.trafficTip(traffic(s.sent[i] ?? 0), traffic(s.received[i] ?? 0)))}
        />
      ) : (
        <Unavailable />
      )}
    </Card>
  );
}

/** 注解里的色块：两条线的卡片，注解那一行兼作图例 */
function Swatch({ color, className }: { color: string; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2 shrink-0 rounded-[2px]", color, className)} />;
}
