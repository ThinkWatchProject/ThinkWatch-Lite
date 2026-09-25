import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageSection } from "@/ui/page";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { UpstreamLogo } from "@/ui/logos";
import { useNav } from "@/nav";
import type { Dashboard, LatencyView, Overview } from "@/types";
import { useText } from "@/i18n";
import { fmtMs, latencyRows, ROWS } from "./series";
import { LinkRow, ModelMark, Scope } from "./parts";
import { overviewText } from "./overview.i18n";

/** 样本少于这个数，分位数不可靠：样本数那一格标黄 */
const FEW = 10;

/**
 * 一行里数字那几列的宽度。**表头和每一行用同一套**，列才对得齐。条宽固定：
 * 两栏的条这样才对齐，能横着比。
 */
const COL = {
  bar: "w-20",
  p50: "w-12",
  p95: "w-12",
  samples: "w-9",
} as const;

/**
 * 延迟：首字节时间的 P50 和 P95。
 *
 * **左右两栏，各自纵向长。**「哪个模型慢」的下一步是换模型，「哪个上游慢」的
 * 下一步是换上游 —— 两个问题各占一栏。只有一个上游时右栏没有可比的，不画。
 * 窄窗口里两栏上下排：并排的话模型名会被挤成省略号，而名字是这一栏最要紧的字。
 *
 * 用分位数不用平均值：AI 延迟是长尾分布，平均值会被极端值拉偏。点一行落到流量
 * 页：模型填进搜索框，上游选进「上游」筛选。
 */
export function LatencySection({
  d,
  ov,
  scope,
  scoped,
}: {
  d: Dashboard;
  ov: Overview | null;
  scope: string;
  scoped?: string;
}) {
  const t = useText(overviewText);
  const nav = useNav();
  // 两栏的条按同一把尺子画，才能横着比
  const max = Math.max(1, ...d.latency.map((l) => l.p95), ...d.latency_by_provider.map((l) => l.p95)) * 1.04;
  const upstreams = d.latency_by_provider.length >= 2;
  const providers = new Map((ov?.providers ?? []).map((p) => [p.name, p]));
  return (
    <PageSection
      title={t.latency}
      actions={
        <Scope>
          {t.latencyWhat}
          {scoped && ` · ${scoped}`}
        </Scope>
      }
    >
      {d.latency.length === 0 ? (
        <p className="flex h-8 items-center tw-body text-muted-foreground">{t.notEnoughSamples}</p>
      ) : (
        // 并排按这一块自己的宽度判断，不按窗口：源列表收起、展开时内容区宽度不一样
        <div className="@container">
        <div className={cn("grid gap-x-10 gap-y-6", upstreams && "@min-[800px]:grid-cols-2")}>
          <Spreads
            head={t.byModel}
            rows={d.latency}
            max={max}
            scope={scope}
            mark={(name) => <ModelMark name={name} />}
            onOpen={(name) => nav.open("requests", { grouped: false, filter: { model: name } })}
          />
          {upstreams && (
            <Spreads
              head={t.byUpstream}
              rows={d.latency_by_provider}
              max={max}
              scope={scope}
              mark={(name) => {
                const p = providers.get(name);
                return (
                  <UpstreamLogo
                    name={name}
                    baseUrl={p?.base_url}
                    protocol={p?.protocol}
                    className="text-muted-foreground"
                  />
                );
              }}
              onOpen={(name) => nav.open("requests", { grouped: false, filter: { provider: name } })}
            />
          )}
        </div>
        </div>
      )}
    </PageSection>
  );
}

/**
 * 一栏分位区间，带一行表头。
 *
 * **区间条，不是只有两列数字。**并排的两列时间要逐行读才能比较，而这一栏要回答
 * 的是「哪个又慢又不稳定」—— 那是条的起点加长度，一次扫视就能得到。条左端那道
 * 竖线是 P50：多数请求落在它附近；条伸到 P95。
 */
function Spreads({
  head,
  rows,
  max,
  scope,
  mark,
  onOpen,
}: {
  head: string;
  rows: LatencyView[];
  max: number;
  scope: string;
  mark: (name: string) => ReactNode;
  onOpen: (name: string) => void;
}) {
  const t = useText(overviewText);
  const sorted = latencyRows(rows);
  const shown = usePresentList(sorted.slice(0, ROWS), (l) => l.model);
  return (
    <div className="min-w-0">
      {/* 表头：和下面每一行同一套列宽，行尾留出箭头那一格 */}
      <div className="flex h-6 items-center gap-2.5 tw-label text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{head}</span>
        <span className={cn(COL.bar, "shrink-0")} />
        <span className={cn(COL.p50, "shrink-0 text-right")}>P50</span>
        <span className={cn(COL.p95, "shrink-0 text-right")}>P95</span>
        <span className={cn(COL.samples, "shrink-0 text-right")}>{t.samples}</span>
        <span aria-hidden className="size-3.5 shrink-0" />
      </div>
      {shown.map(({ item: l, key, presence }) => (
        <LinkRow
          key={key}
          className={cn("h-7 gap-2.5", rowMotion(presence))}
          hint={t.viewInTraffic}
          onOpen={() => onOpen(l.model)}
        >
          {mark(l.model)}
          <span className="min-w-0 flex-1 truncate" title={l.model}>
            {l.model}
          </span>
          <span aria-hidden className={cn(COL.bar, "relative flex h-1.5 shrink-0 rounded-full bg-foreground/[0.06]")}>
            <span className="motion-bar shrink-0" style={{ width: `${(l.p50 / max) * 100}%` }} />
            <span
              className="motion-bar relative shrink-0 rounded-full bg-chart-3"
              style={{ width: `max(2px, ${((l.p95 - l.p50) / max) * 100}%)` }}
            >
              <span className="absolute -top-[3px] left-0 h-3 w-0.5 -translate-x-1/2 rounded-full bg-chart-1" />
            </span>
          </span>
          <span className={cn(COL.p50, "shrink-0 text-right")}>
            <AnimatedNumber value={l.p50} format={fmtMs} scope={scope} />
          </span>
          <span className={cn(COL.p95, "shrink-0 text-right text-muted-foreground")}>
            <AnimatedNumber value={l.p95} format={fmtMs} scope={scope} />
          </span>
          {/*
            **样本数要显示**：「800ms」是 3 个样本还是 300 个，含义完全不同。不可靠的
            是**样本数**，不是延迟值 —— 所以只标这个数。
          */}
          {l.samples < FEW ? (
            <Tip text={t.fewSamples}>
              <span className={cn(COL.samples, "shrink-0 text-right tw-num tw-label text-warning")}>{l.samples}</span>
            </Tip>
          ) : (
            <span className={cn(COL.samples, "shrink-0 text-right tw-num tw-label text-muted-foreground")}>
              {l.samples}
            </span>
          )}
        </LinkRow>
      ))}
      {rows.length > ROWS && <p className="mt-1 tw-label text-muted-foreground">{t.moreNotListed(rows.length - ROWS)}</p>}
    </div>
  );
}
