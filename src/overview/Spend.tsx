import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Segmented } from "@/ui/segmented";
import { rangeText } from "@/ui/range.i18n";
import type { Range } from "@/ui/range";
import { useNav } from "@/nav";
import type { Filter } from "@/requestTable";
import { compact, msShort, size } from "@/format";
import type { CostBucketGroup, Dashboard, LatencyView, Overview } from "@/types";
import { useText } from "@/i18n";
import { rankCost } from "./series";
import { additive, type Metric } from "./metric";
import { CostCell, ItemLogo, type Dim } from "./Breakdown";
import { SPEND_ROWS, rankSpend, shareText, spendItems, type SpendRow, type SpendTotal } from "./spendRank";
import { spendText } from "./Spend.i18n";
import { overviewText } from "./overview.i18n";

/**
 * 去向：按模型、上游、密钥排出所选指标（「用量」那张卡片上选中的那一个）。
 *
 * 每一行是标志、名字、值、能加起来的指标再带占比；后面一条淡色的条，长度按最大的那一项
 * 归一。token、费用、请求、流量是各项的合计，缓存命中是各项自己的命中率，首 token 是各项
 * 的 P50。先列五行，其余的写出有几项。底下一行是合计（或整体命中率、整体 P50）。
 *
 * 点一行落到流量页，筛好那一项（和明细表一样）。没有名字的那一项只说不点。
 *
 * 实时档和明细表一样按 24 小时算，右上角的口径写着。
 */
export function Spend({ d, range, metric, ov }: { d: Dashboard; range: Range; metric: Metric; ov?: Overview | null }) {
  const t = useText(spendText);
  const rt = useText(rangeText);
  const nav = useNav();
  const [dim, setDim] = useState<Dim>("model");
  const groups: CostBucketGroup[] | null =
    dim === "model" ? d.buckets_by_model : dim === "provider" ? d.buckets_by_provider : d.buckets_by_client;
  const latency = new Map<string, LatencyView>(
    (dim === "model" ? d.latency : dim === "provider" ? d.latency_by_provider : d.latency_by_client)?.map((l) => [
      l.model,
      l,
    ]) ?? [],
  );
  const { rows, total } = rankSpend(metric, groups ? spendItems(groups) : [], latency);
  const shown = rows.slice(0, SPEND_ROWS);
  const filterOf = (name: string): Partial<Filter> =>
    dim === "model" ? { model: name } : dim === "provider" ? { provider: name } : { client: name };
  const caption = t.caption(t.metrics[metric], range.live ? rt.preset["1d"] : range.label);

  return (
    <section
      aria-label={t.label}
      data-slot="overview-spend"
      className="flex min-w-0 flex-col rounded-[10px] border border-border bg-panel px-3 pt-3 pb-2.5"
    >
      <div className="flex h-7 items-center gap-2.5 px-1">
        <Segmented<Dim>
          label={t.label}
          value={dim}
          options={[
            { id: "model", label: t.dims.model },
            { id: "provider", label: t.dims.provider },
            { id: "client", label: t.dims.client },
          ]}
          onChange={setDim}
        />
        <span className="ml-auto truncate tw-label text-muted-foreground">{caption}</span>
      </div>

      {groups === null ? (
        <p className="mt-2.5 flex h-8 items-center px-2.5 tw-body text-muted-foreground">{t.unavailable}</p>
      ) : rows.length === 0 ? (
        <p className="mt-2.5 flex h-8 items-center px-2.5 tw-body text-muted-foreground">{t.empty}</p>
      ) : (
        <ol className="mt-2.5 flex flex-col gap-1" aria-label={t.dims[dim]}>
          {shown.map((r) => (
            <li key={`row:${r.item.name}`}>
              <SpendLine
                r={r}
                metric={metric}
                logo={<ItemLogo dim={dim} name={r.item.name} ov={ov} />}
                label={r.item.name || t.unnamed[dim]}
                mono={dim === "model" && r.item.name !== ""}
                onOpen={
                  r.item.name
                    ? () => nav.open("requests", { grouped: false, filter: filterOf(r.item.name) })
                    : undefined
                }
              />
            </li>
          ))}
        </ol>
      )}

      {groups !== null && rows.length > 0 && (
        <div className="mt-auto flex items-baseline gap-3 px-2.5 pt-2 tw-label text-muted-foreground">
          <Foot metric={metric} total={total} ttft={d.ttft?.p50_ms ?? null} />
          {rows.length > SPEND_ROWS && <span className="ml-auto">{t.more[dim](rows.length - SPEND_ROWS)}</span>}
        </div>
      )}
    </section>
  );
}

/**
 * 一行。整行能点（读屏读作链接，Enter 和空格都能打开）；悬停压暗一档。条铺在整行底下，
 * 从左往右，`--data-1` 按 `--data-wash` 的浓度。
 */
function SpendLine({
  r,
  metric,
  logo,
  label,
  mono,
  onOpen,
}: {
  r: SpendRow;
  metric: Metric;
  logo: ReactNode;
  label: string;
  mono: boolean;
  onOpen?: () => void;
}) {
  const t = useText(spendText);
  const link = onOpen
    ? {
        role: "link",
        tabIndex: 0,
        onClick: onOpen,
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen();
          }
        },
      }
    : {};
  return (
    <div
      {...link}
      className={cn(
        "relative flex h-[34px] items-center gap-2.5 rounded-md px-2.5 tw-body",
        onOpen &&
          "cursor-pointer outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease) hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.045] focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      {r.bar > 0 && (
        <span
          aria-hidden
          className="motion-bar pointer-events-none absolute inset-y-0 left-0 rounded-md bg-data-1"
          style={{ width: `${r.bar * 100}%`, opacity: "var(--data-wash)" }}
        />
      )}
      <span className="relative flex shrink-0">{logo}</span>
      <span
        className={cn("relative min-w-0 flex-1 truncate", mono && "font-mono", !onOpen && "text-muted-foreground")}
        title={label}
      >
        {label}
      </span>
      <span className="relative tw-num whitespace-nowrap">
        <Value metric={metric} r={r} />
      </span>
      {additive(metric) && (
        <span className="relative w-[34px] shrink-0 text-right tw-label tw-num text-muted-foreground">
          {r.share === null ? "" : shareText(r.share)}
        </span>
      )}
      {onOpen && <span className="sr-only">{t.viewInTraffic}</span>}
    </div>
  );
}

/** 一行的值，按指标的写法。说不出的写「—」 */
function Value({ metric, r }: { metric: Metric; r: SpendRow }) {
  if (metric === "cost") return <Cost c={r.item} />;
  if (r.value === null) return <span className="text-muted-foreground">—</span>;
  return <>{figure(metric, r.value)}</>;
}

function figure(metric: Exclude<Metric, "cost">, v: number): string {
  switch (metric) {
    case "tokens":
      return compact(v);
    case "requests":
      return v.toLocaleString();
    case "traffic":
      return size(v);
    case "cache":
      return `${Math.round(v * 100)}%`;
    case "ttft":
      return msShort(v);
  }
}

/** 费用，写法同明细表那一格（`rankCost`）：**限定词一直看得见**，「≥」「~」写在金额前面 */
function Cost({ c }: { c: { cost: number; estimated: number; unpriced: number; noUsage: number } }) {
  const t = useText(overviewText);
  return <CostCell c={rankCost(c, t)} amount={c.cost} />;
}

/** 底下那一行：合计；比率写整体命中率，首 token 写整段的 P50 */
function Foot({ metric, total, ttft }: { metric: Metric; total: SpendTotal; ttft: number | null }) {
  const t = useText(spendText);
  if (metric === "cost") {
    return (
      <span className="tw-num">
        {t.total("")}
        <Cost c={total.cost} />
      </span>
    );
  }
  if (metric === "cache") return <span className="tw-num">{t.overallHit(total.hit === null ? "—" : `${Math.round(total.hit * 100)}%`)}</span>;
  if (metric === "ttft") return <span className="tw-num">{t.overallP50(ttft === null ? "—" : msShort(ttft))}</span>;
  return <span className="tw-num">{t.total(figure(metric, total.sum))}</span>;
}
