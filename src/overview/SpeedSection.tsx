import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Meter } from "@/ui/meter";
import { PageSection } from "@/ui/page";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { UpstreamLogo } from "@/ui/logos";
import { useNav } from "@/nav";
import type { Dashboard, Overview, TokenRateView } from "@/types";
import { useText } from "@/i18n";
import { ROWS } from "./series";
import { LinkRow, ModelMark, Scope } from "./parts";
import { overviewText } from "./overview.i18n";

/** 样本少于这个数，中位数不可靠：样本数那一格标黄。和延迟一节同一条线 */
const FEW = 10;

/**
 * 一行里数字那几列的宽度。**和延迟一节对齐**：条从同一处起，长度占掉延迟的条和它的
 * P50 那两格，速度的数字落在延迟的 P95 那一格，样本数落在样本数那一格 —— 两节上下
 * 对着看的是同一个模型的两个数。
 */
const COL = {
  bar: "w-[8.625rem]",
  p50: "w-12",
  samples: "w-9",
} as const;

/**
 * 生成速度：每秒输出多少 token 的中位数，按模型、按上游。
 *
 * 和「延迟」同一个样子：两栏，各自纵向长；行的顺序也一样（用得多的在前）。条从零
 * 画到中位数，越长越快。样本是跑完的流式请求：非流式的整段一起到，没有速度。点一行
 * 落到流量页，和延迟一节一样。
 */
export function SpeedSection({
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
  // 取不到（`null`）不是样本不足：按模型那份取不到，整块写「暂时取不到」；按上游那份
  // 取不到，就只画按模型的那一栏
  const byModel = d.token_rate ?? [];
  const byUpstream = d.token_rate_by_provider ?? [];
  // 两栏的条按同一把尺子画，才能横着比
  const max = Math.max(1, ...byModel.map((l) => l.p50), ...byUpstream.map((l) => l.p50)) * 1.04;
  const upstreams = byUpstream.length >= 2;
  const providers = new Map((ov?.providers ?? []).map((p) => [p.name, p]));
  return (
    <PageSection
      title={t.speed}
      actions={
        <Scope>
          {t.speedWhat}
          {scoped && ` · ${scoped}`}
        </Scope>
      }
    >
      {byModel.length === 0 ? (
        <p className="flex h-8 items-center tw-body text-muted-foreground">
          {d.token_rate === null ? t.speedUnavailable : t.notEnoughSamples}
        </p>
      ) : (
        <div className="@container">
          <div className={cn("grid gap-x-10 gap-y-6", upstreams && "@min-[800px]:grid-cols-2")}>
            <Bars
              head={t.byModel}
              rows={byModel}
              max={max}
              scope={scope}
              mark={(name) => <ModelMark name={name} />}
              onOpen={(name) => nav.open("requests", { grouped: false, filter: { model: name } })}
            />
            {upstreams && (
              <Bars
                head={t.byUpstream}
                rows={byUpstream}
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

/** 一栏速度，带一行表头。顺序和延迟一节的 `latencyRows` 一样：样本多的在前 */
function Bars({
  head,
  rows,
  max,
  scope,
  mark,
  onOpen,
}: {
  head: string;
  rows: TokenRateView[];
  max: number;
  scope: string;
  mark: (name: string) => ReactNode;
  onOpen: (name: string) => void;
}) {
  const t = useText(overviewText);
  const sorted = [...rows].sort((a, b) => b.samples - a.samples || a.model.localeCompare(b.model));
  const shown = usePresentList(sorted.slice(0, ROWS), (l) => l.model);
  return (
    <div className="min-w-0">
      {/* 表头：和下面每一行同一套列宽，行尾留出箭头那一格 */}
      <div className="flex h-6 items-center gap-2.5 tw-label text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">{head}</span>
        <span className={cn(COL.bar, "shrink-0")} />
        <span className={cn(COL.p50, "shrink-0 text-right")}>P50</span>
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
          {/* 条的右端那道竖线是中位数，和延迟一节的 P50 竖线同一个记号 */}
          <Meter value={l.p50} max={max} color="var(--chart-3)" mark="end" className={cn(COL.bar, "shrink-0")} />
          <span className={cn(COL.p50, "shrink-0 text-right")}>
            <AnimatedNumber value={l.p50} format={(n) => Math.round(n).toLocaleString()} scope={scope} />
          </span>
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
