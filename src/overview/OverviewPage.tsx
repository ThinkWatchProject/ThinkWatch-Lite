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
import { bucketOf, useOverview, type Shown } from "./useOverview";
import { OverviewStatus } from "./OverviewStatus";
import { OverviewSkeleton } from "./OverviewSkeleton";
import { AttentionStrip } from "./Attention";
import { Hero } from "./Hero";
import { Spend } from "./Spend";
import { Quota, hasQuota } from "./Quota";
import { Year } from "./Year";
import { Breakdown } from "./Breakdown";
import type { Metric } from "./metric";
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
 * 密钥分的明细表。
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
  // 选中的指标放在这一层：换时间范围时下面整块重挂，选择不该跟着丢
  const [metric, setMetric] = useState<Metric>("tokens");
  const pickDay = useCallback((day: Date) => setRange(dayRange(day)), [setRange]);

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
          tick={tick}
          metric={metric}
          onMetric={setMetric}
          onPickDay={pickDay}
        />
      )}
    </Page>
  );
}

function Body({
  shown,
  ov,
  switching,
  tick,
  metric,
  onMetric,
  onPickDay,
}: {
  shown: Shown;
  ov: Overview | null;
  /** 选中的区间还在取，画的是上一个区间的 */
  switching: boolean;
  tick: number;
  metric: Metric;
  onMetric: (m: Metric) => void;
  onPickDay: (day: Date) => void;
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
        **换了区间整块重挂**：数字直接落到新值（不从上一个区间的值滚过去），行不逐条滑入。
        切到还没取过的区间时，新数据到之前这一块压暗。
      */
      key={id}
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
          <Hero d={d} range={range} scope={id} step={bucketOf(range)} metric={metric} onMetric={onMetric} />
          <div className={cn("grid gap-3.5", hasQuota(d, ov) && "@min-[760px]/page:grid-cols-2")}>
            <Spend d={d} range={range} metric={metric} />
            <Quota d={d} ov={ov} />
          </div>
          <Year range={range} tick={tick} onPickDay={onPickDay} />
          <Breakdown d={d} range={range} />
        </>
      )}
    </div>
  );
}
