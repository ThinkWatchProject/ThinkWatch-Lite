import { useCallback, useEffect, useRef, useState } from "react";
// 大数的字（Geist），打包在应用里：离线也要是这个字。只在概览上用，跟着这一页载入
import "@fontsource/geist/latin-600.css";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/ui/page";
import { useIgnored } from "@/ignore";
import { Banner } from "@/ui/banner";
import { ErrorState } from "@/ui/states";
import { RangePicker, dayRange, useRange } from "@/ui/range";
import type { Dashboard, Overview } from "@/types";
import { useText } from "@/i18n";
import { FirstRequestHint } from "@/guide/FirstRequestHint";
import { SetupGuide } from "@/guide/SetupGuide";
import { bucketOf, rangeId, useOverview, type Shown } from "./useOverview";
import { OverviewStatus } from "./OverviewStatus";
import { OverviewSkeleton } from "./OverviewSkeleton";
import { AttentionStrip } from "./Attention";
import { Hero } from "./Hero";
import { Spend } from "./Spend";
import { Quota, hasQuota } from "./Quota";
import { Year, useUsageHistory } from "./Year";
import { Breakdown, type Dim } from "./Breakdown";
import type { Metric } from "./metric";
import type { YearMetric } from "./yearGrid";
import { useHold } from "./useHold";
import { overviewText } from "./overview.i18n";

/**
 * 一次请求都还没记下过：只有本地应答的探测（或者什么都没有）。这时一排零和几张
 * 空图什么都说明不了，换成一块空状态，说清怎样才会有数据。
 *
 * **看的是库里一共记了多少条**，不是所选区间里有几条：用过、只是这一天没用的，
 * 仍然是那张有零有图的页 —— 它能换区间看以前的。库没起来（`recording` 为假）时
 * 不算：那时顶上有一条横幅在说这件事。
 */
function neverUsed(d: Dashboard): boolean {
  const st = d.storage;
  return st !== null && st.recording && d.summary.requests === 0 && st.rows <= d.summary.locally_answered;
}

/**
 * 用量概览。
 *
 * 这一页的每一个数字都受那条约束：**绝不让估算值混进精确数字里假装准确。**所以
 * 金额旁边永远跟着它的限定词。
 *
 * 版面：页头（状态一行、时间范围）；需要处理的事（没有就不出现）；用量（六个指标并排，
 * 选中的那个画成下面的大图）；去向和额度与余额并排；最近一年的热力图；按模型、上游、
 * 密钥分的明细表。去向和明细按什么分是同一个选择，切一处两处一起换。
 *
 * **跟着时间范围走的放在一起**：用量、去向、明细。额度与余额是此刻的状态，最近一年固定
 * 一年，各自标着自己的口径。
 *
 * 实时档里 token、费用、请求三项是最近十分钟，跟着事件流走；缓存命中、首 token、流量、
 * 去向和明细表按最近 24 小时算，旁边标着。
 */
export default function OverviewPage({
  tick,
  ov,
  onLanded,
}: {
  /** 库里多了请求、手动刷新：重取 */
  tick: number;
  ov: Overview | null;
  /** 第一份数据到了（或者确定取不到了）。启动画面等它再交接 */
  onLanded?: () => void;
}) {
  const t = useText(overviewText);
  const [range, setRange] = useRange();
  const o = useOverview(range, tick);
  // 选中的指标、按什么分放在这一层：几块卡片共用一个选择
  const [metric, setMetric] = useState<Metric>("tokens");
  const [yearMetric, setYearMetric] = useState<YearMetric>("tokens");
  const [dim, setDim] = useState<Dim>("model");
  const history = useUsageHistory(tick);
  const hold = useHold(o.shown?.id);
  const pickDay = useCallback(
    (day: Date, from: HTMLElement) => {
      const r = dayRange(day);
      hold.start(rangeId(r), from);
      setRange(r);
    },
    [setRange, hold.start],
  );

  const landed = useRef(onLanded);
  landed.current = onLanded;
  const settled = o.shown !== null || o.failed;
  useEffect(() => {
    if (settled) landed.current?.();
  }, [settled]);

  return (
    <Page className="@container/page">
      <PageHeader
        summary={<OverviewStatus ov={ov} />}
        actions={<RangePicker value={range} onChange={setRange} align="end" />}
      />
      {o.failed ? (
        <ErrorState title={t.loadFailed} error={o.error} onRetry={() => void o.reload()} retrying={o.retrying} />
      ) : o.shown === null ? (
        <OverviewSkeleton />
      ) : (
        <Body
          shown={o.shown}
          ov={ov}
          switching={o.switching}
          metric={metric}
          onMetric={setMetric}
          yearMetric={yearMetric}
          onYearMetric={setYearMetric}
          onPickDay={pickDay}
          dim={dim}
          onDim={setDim}
          history={history}
          pad={hold.pad}
        />
      )}
    </Page>
  );
}

function Body({
  shown,
  ov,
  switching,
  metric,
  onMetric,
  yearMetric,
  onYearMetric,
  onPickDay,
  dim,
  onDim,
  history,
  pad,
}: {
  shown: Shown;
  ov: Overview | null;
  /** 选中的区间还在取，画的是上一个区间的 */
  switching: boolean;
  metric: Metric;
  onMetric: (m: Metric) => void;
  yearMetric: YearMetric;
  onYearMetric: (m: YearMetric) => void;
  onPickDay: (day: Date, from: HTMLElement) => void;
  dim: Dim;
  onDim: (d: Dim) => void;
  history: ReturnType<typeof useUsageHistory>;
  /** 页尾临时补的空白（`useHold`） */
  pad: number;
}) {
  const t = useText(overviewText);
  const { data: d, range, id } = shown;
  const recording = d.storage === null || d.storage.recording;
  // 「请求记录未能启动」能忽略，只记这一次运行：下次启动还没起来就该再说
  const recordingIg = useIgnored("overview:recording", true, () => true, { session: true });
  const fresh = neverUsed(d);
  return (
    <div
      /*
        **换了区间不重挂这一块。**整块按区间重挂的话，WebKit 在卸下、挂上之间把滚动层拨回
        顶上：在热力图上点一天、或者滚到下面再换区间，页面都跳回页首。换区间时数字直接落到
        新值，由各个大数的 `scope` 管。切到还没取过的区间时，新数据到之前这一块压暗。
      */
      aria-busy={switching || undefined}
      className={cn(
        "flex flex-col gap-3.5 motion-fade transition-opacity duration-(--motion-base) ease-(--motion-ease)",
        switching && "pointer-events-none opacity-45",
      )}
    >
      {/* 存储状态。**正常时不显示** —— 没问题的时候不该占地方 */}
      <Banner
        show={!recording && !recordingIg.ignored}
        layout="inline"
        tone="warning"
        title={t.recordingUnavailable}
        onIgnore={recordingIg.ignore}
      >
        {d.storage && !d.storage.forwarding_affected && t.forwardingUnaffected}
      </Banner>

      {/* 第一条请求到了：指给人去看它。只对走过「开始使用」的人说 */}
      <FirstRequestHint when={!fresh} />

      {fresh ? (
        <SetupGuide upstreams={ov?.providers.length ?? 0} probes={d.summary.locally_answered} />
      ) : (
        <>
          <AttentionStrip d={d} ov={ov} range={range} />
          <Hero
            d={d}
            range={range}
            scope={id}
            step={bucketOf(range)}
            metric={metric}
            onMetric={onMetric}
            detailSince={history.r.data?.detail_since_ms ?? null}
          />
          <div className={cn("grid gap-3.5", hasQuota(d, ov) && "@min-[760px]/page:grid-cols-2")}>
            <Spend d={d} range={range} metric={metric} ov={ov} dim={dim} onDim={onDim} />
            <Quota d={d} ov={ov} />
          </div>
          <Year history={history} range={range} metric={yearMetric} onMetric={onYearMetric} onPickDay={onPickDay} />
          <Breakdown d={d} range={range} ov={ov} dim={dim} onDim={onDim} />
          {pad > 0 && <div aria-hidden style={{ height: pad }} />}
        </>
      )}
    </div>
  );
}

