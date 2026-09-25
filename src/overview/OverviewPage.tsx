import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Page, PageHeader } from "@/ui/page";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { EmptyState, ErrorState } from "@/ui/states";
import { RangePicker, useRange } from "@/ui/range";
import { IconDashboard } from "@/ui/icons";
import { rangeText } from "@/ui/range.i18n";
import { useNav } from "@/nav";
import type { Dashboard, Overview } from "@/types";
import { useText } from "@/i18n";
import { useOverview, type Shown } from "./useOverview";
import { OverviewStatus } from "./OverviewStatus";
import { OverviewSkeleton } from "./OverviewSkeleton";
import { HeroStats } from "./HeroStats";
import { TrendSection } from "./TrendSection";
import { CacheSection } from "./CacheSection";
import { LatencySection } from "./LatencySection";
import { SecuritySection } from "./SecuritySection";
import type { Metric } from "./series";
import { overviewText } from "./overview.i18n";

/** 图的口径记在这里：换页、重开窗口回来还是上次那一档 */
const METRIC_KEY = "tw-overview-metric";

function useMetric(): [Metric, (m: Metric) => void] {
  const [by, set] = useState<Metric>(() => {
    try {
      return window.localStorage.getItem(METRIC_KEY) === "cost" ? "cost" : "token";
    } catch {
      // 隐私窗口、禁用站点数据都会在这里抛。记不住就用默认的
      return "token";
    }
  });
  const put = useCallback((m: Metric) => {
    set(m);
    try {
      window.localStorage.setItem(METRIC_KEY, m);
    } catch {
      // 存不下就只在这一程里记着
    }
  }, []);
  return [by, put];
}

/**
 * 一次请求都还没记下过：只有本地应答的探测（或者什么都没有）。这时一排零和一张
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
 * 版面：页头（状态一行、时间范围），三个大数，一张按模型分层的趋势图和它的图例
 * （模型排行），然后是缓存、延迟、安全三节。**参照物是原生监控工具，不是网页
 * 后台** —— 没有卡片网格，节与节之间只有留白和细线。
 *
 * 实时档只有图和模型排行是实时的（十分钟，跟着事件流走）；大数、缓存、延迟、安全
 * 按最近 24 小时算，节标题右边标着。
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
  const rt = useText(rangeText);
  const nav = useNav();
  const [range, setRange] = useRange();
  const [by, setBy] = useMetric();
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
        title={t.title}
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
          by={by}
          onBy={setBy}
          switching={o.switching}
          day={rt.preset["1d"]}
          // 按钮写的是「添加上游」：直接打开上游页的新建对话框，不是只把页面打开
          onSetUp={() =>
            ov && ov.providers.length === 0 ? nav.open("upstreams", { create: "upstream" }) : nav.open("clients")
          }
        />
      )}
    </Page>
  );
}

function Body({
  shown,
  ov,
  by,
  onBy,
  switching,
  day,
  onSetUp,
}: {
  shown: Shown;
  ov: Overview | null;
  by: Metric;
  onBy: (m: Metric) => void;
  /** 选中的区间还在取，画的是上一个区间的 */
  switching: boolean;
  /** 「24 小时」：实时档下不跟着图走的那几节按它算 */
  day: string;
  onSetUp: () => void;
}) {
  const t = useText(overviewText);
  const { data: d, range, id } = shown;
  const live = range.live === true;
  // 实时档下，不跟着图走的那几节标出它们的口径
  const scoped = live ? day : undefined;
  const recording = d.storage === null || d.storage.recording;
  const noUpstreams = ov !== null && ov.providers.length === 0;
  return (
    <div
      /*
        **换了区间整块重挂**：数字直接落到新值（不从上一个区间的值滚过去），图从左往右
        重新铺开，行不逐条滑入。切到还没取过的区间时，新数据到之前这一块压暗。
      */
      key={id}
      aria-busy={switching || undefined}
      className={cn(
        "motion-fade transition-opacity duration-(--motion-base) ease-(--motion-ease)",
        switching && "pointer-events-none opacity-45",
      )}
    >
      {/* 存储状态。**正常时不显示** —— 没问题的时候不该占地方 */}
      <Banner
        show={!recording}
        layout="inline"
        tone="warning"
        title={t.recordingUnavailable}
        className="mb-5"
      >
        {d.storage && !d.storage.forwarding_affected && t.forwardingUnaffected}
      </Banner>

      {neverUsed(d) ? (
        <EmptyState
          variant="outlined"
          icon={<IconDashboard />}
          title={t.emptyTitle}
          description={
            <>
              {noUpstreams ? t.emptyHintNoUpstream : t.emptyHint}
              {d.summary.locally_answered > 0 && (
                <>
                  <br />
                  {t.probesAnswered(d.summary.locally_answered)}
                </>
              )}
            </>
          }
          action={
            <Button size="sm" onClick={onSetUp}>
              {noUpstreams ? t.addUpstream : t.setUpClients}
            </Button>
          }
        />
      ) : (
        <>
          <HeroStats d={d} range={range} scope={id} />
          <TrendSection d={d} range={range} scope={id} by={by} onBy={onBy} />
          <CacheSection d={d} scope={id} scoped={scoped} />
          <LatencySection d={d} ov={ov} scope={id} scoped={scoped} />
        </>
      )}
      <SecuritySection d={d} ov={ov} range={range} scoped={scoped} />
    </div>
  );
}
