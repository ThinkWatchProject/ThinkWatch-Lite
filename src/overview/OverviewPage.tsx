import { useEffect, useRef } from "react";
// 大数的字（Geist），打包在应用里：离线也要是这个字。只在概览上用，跟着这一页载入
import "@fontsource/geist/latin-600.css";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/ui/page";
import { Banner } from "@/ui/banner";
import { ErrorState } from "@/ui/states";
import { RangePicker, useRange } from "@/ui/range";
import type { Dashboard, Overview } from "@/types";
import { useText } from "@/i18n";
import { FirstRequestHint } from "@/guide/FirstRequestHint";
import { SetupGuide } from "@/guide/SetupGuide";
import { bucketOf, useOverview, type Shown } from "./useOverview";
import { OverviewStatus } from "./OverviewStatus";
import { OverviewSkeleton } from "./OverviewSkeleton";
import { AttentionStrip } from "./Attention";
import { CardGrid } from "./Cards";
import { Breakdown } from "./Breakdown";
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
 * 版面：页头（状态一行、时间范围）；需要处理的事（没有就不出现）；六张指标卡，每张一个
 * 大数和一张小图，指着任何一张，每一张都停在同一个时刻；下面一张按模型、上游、密钥分的
 * 明细表。
 *
 * 实时档里 token、费用、请求三张卡片是最近十分钟，跟着事件流走；缓存命中、首 token、
 * 流量和明细表按最近 24 小时算，旁边标着。
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

  const landed = useRef(onLanded);
  landed.current = onLanded;
  const settled = o.shown !== null || o.failed;
  useEffect(() => {
    if (settled) landed.current?.();
  }, [settled]);

  return (
    <Page>
      <PageHeader
        summary={<OverviewStatus ov={ov} />}
        actions={<RangePicker value={range} onChange={setRange} align="end" />}
      />
      {o.failed ? (
        <ErrorState title={t.loadFailed} error={o.error} onRetry={() => void o.reload()} retrying={o.retrying} />
      ) : o.shown === null ? (
        <OverviewSkeleton />
      ) : (
        <Body shown={o.shown} ov={ov} switching={o.switching} />
      )}
    </Page>
  );
}

function Body({
  shown,
  ov,
  switching,
}: {
  shown: Shown;
  ov: Overview | null;
  /** 选中的区间还在取，画的是上一个区间的 */
  switching: boolean;
}) {
  const t = useText(overviewText);
  const { data: d, range, id } = shown;
  const recording = d.storage === null || d.storage.recording;
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
      <Banner show={!recording} layout="inline" tone="warning" title={t.recordingUnavailable}>
        {d.storage && !d.storage.forwarding_affected && t.forwardingUnaffected}
      </Banner>

      {/* 第一条请求到了：指给人去看它。只对走过「开始使用」的人说 */}
      <FirstRequestHint when={!fresh} />

      {fresh ? (
        <SetupGuide upstreams={ov?.providers.length ?? 0} probes={d.summary.locally_answered} />
      ) : (
        <>
          <AttentionStrip d={d} ov={ov} range={range} />
          <CardGrid d={d} range={range} scope={id} step={bucketOf(range)} />
          <div className="mt-2.5">
            <Breakdown d={d} range={range} />
          </div>
        </>
      )}
    </div>
  );
}
