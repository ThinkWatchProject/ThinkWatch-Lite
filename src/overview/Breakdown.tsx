import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Segmented } from "@/ui/segmented";
import { Tip } from "@/ui/tip";
import { rangeText } from "@/ui/range.i18n";
import type { Range } from "@/ui/range";
import { useNav } from "@/nav";
import type { Filter } from "@/requestTable";
import { compact, msShort } from "@/format";
import { usd, type CostBucketGroup, type Dashboard, type LatencyView, type TokenRateView } from "@/types";
import { useText } from "@/i18n";
import { breakdown, rankCost, ROWS, type BreakdownRow } from "./series";
import { LinkText } from "./parts";
import { overviewText } from "./overview.i18n";

/** 明细表按什么分 */
type Dim = "model" | "provider" | "client";

/** 一行里名字以外那几列。**表头和每一行用同一套**，列才对得齐 */
const COLS =
  "grid grid-cols-[minmax(0,1fr)_3.5rem_4rem_4.5rem_4rem_4rem_4rem] gap-x-3 @min-[760px]:grid-cols-[minmax(0,1fr)_4.5rem_repeat(5,5.25rem)] @min-[760px]:gap-x-4";

/**
 * 指标卡下面的明细表：按模型、上游、密钥分，每一行是这段时间的请求、token、费用、
 * 缓存命中、首 token 和生成速度。请求多的在前，先列几行，其余的写出有几项、点开再看。
 *
 * 点一行落到流量页，筛好那一个模型、上游或密钥。没有名字的那一行（没到上游的请求、
 * 认不出的密钥）只说不点 —— 没有东西可筛。
 *
 * 实时档按 24 小时算：十分钟里撑不起一张有意义的表。
 */
export function Breakdown({ d, range }: { d: Dashboard; range: Range }) {
  const t = useText(overviewText);
  const rt = useText(rangeText);
  const nav = useNav();
  const [dim, setDim] = useState<Dim>("model");
  const [all, setAll] = useState(false);
  const groups: CostBucketGroup[] | null =
    dim === "model" ? d.buckets_by_model : dim === "provider" ? d.buckets_by_provider : d.buckets_by_client;
  const rows = groups ? breakdown(groups) : [];
  const shown = all ? rows : rows.slice(0, ROWS);
  const latency = new Map<string, LatencyView>(
    (dim === "model" ? d.latency : dim === "provider" ? d.latency_by_provider : null)?.map((l) => [l.model, l]) ?? [],
  );
  // TODO(C1)：按密钥的首 token 要 core 的 `LatencyByClient`（dashboard 命令里加一问）；按密钥的
  // 生成速度 core 还没有端点（不在 C1 里）。在那之前密钥那一页这两列写「—」
  const speed = new Map<string, TokenRateView>(
    (dim === "model" ? d.token_rate : dim === "provider" ? d.token_rate_by_provider : null)?.map((r) => [r.model, r]) ?? [],
  );
  const head = { model: t.tabModels, provider: t.tabUpstreams, client: t.tabKeys }[dim];
  const filterOf = (name: string): Partial<Filter> =>
    dim === "model" ? { model: name } : dim === "provider" ? { provider: name } : { client: name };
  const unnamed = { model: t.unknownModel, provider: t.noUpstream, client: t.unknownKey }[dim];

  return (
    <section className="@container" data-slot="overview-breakdown" aria-label={t.tableLabel}>
      <div className="flex h-7 items-center gap-2.5">
        <Segmented<Dim>
          label={t.tableLabel}
          value={dim}
          options={[
            { id: "model", label: t.tabModels },
            { id: "provider", label: t.tabUpstreams },
            { id: "client", label: t.tabKeys },
          ]}
          onChange={(v) => {
            setDim(v);
            setAll(false);
          }}
        />
        {range.live && <span className="tw-label text-muted-foreground">{rt.preset["1d"]}</span>}
        {rows.length > ROWS && (
          <button
            type="button"
            onClick={() => setAll((x) => !x)}
            aria-expanded={all}
            className="ml-auto inline-flex items-center gap-1 rounded-sm tw-label text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {all ? t.less : t.more(rows.length - ROWS)}
            <ChevronDownIcon aria-hidden className={cn("size-3 transition-transform motion-reduce:transition-none", all && "rotate-180")} />
          </button>
        )}
      </div>

      <div role="table" aria-label={head} className="mt-2">
        <div role="row" className={cn(COLS, "h-7 items-center border-b border-border tw-label text-muted-foreground")}>
          <span role="columnheader" className="truncate">
            {head}
          </span>
          <span role="columnheader" className="text-right">{t.colRequests}</span>
          <span role="columnheader" className="text-right">{t.colTokens}</span>
          <span role="columnheader" className="text-right">{t.colCost}</span>
          <span role="columnheader" className="truncate text-right">{t.colCache}</span>
          <span role="columnheader" className="truncate text-right">{t.colLatency}</span>
          <span role="columnheader" className="truncate text-right">{t.colSpeed}</span>
        </div>
        {groups === null ? (
          <p className="flex h-8 items-center tw-body text-muted-foreground">{t.tableUnavailable}</p>
        ) : rows.length === 0 ? (
          <p className="flex h-8 items-center tw-body text-muted-foreground">{t.tableEmpty}</p>
        ) : (
          shown.map((r) => (
            <Row
              key={`row:${r.name}`}
              r={r}
              label={r.name || unnamed}
              mono={dim === "model" && r.name !== ""}
              latency={latency.get(r.name)}
              speed={speed.get(r.name)}
              onOpen={r.name ? () => nav.open("requests", { grouped: false, filter: filterOf(r.name) }) : undefined}
              onUnpriced={
                r.name ? () => nav.open("requests", { grouped: false, filter: { ...filterOf(r.name), unpricedOnly: true } }) : undefined
              }
            />
          ))
        )}
      </div>
    </section>
  );
}

/**
 * 一行。能点的行悬停压暗一档、行尾出现箭头；读屏读作链接，Enter 和空格都能打开。
 */
function Row({
  r,
  label,
  mono,
  latency,
  speed,
  onOpen,
  onUnpriced,
}: {
  r: BreakdownRow;
  label: string;
  mono: boolean;
  latency?: LatencyView;
  speed?: TokenRateView;
  onOpen?: () => void;
  onUnpriced?: () => void;
}) {
  const t = useText(overviewText);
  const cost = rankCost(r, t);
  const hit = r.ctx > 0 ? r.read / r.ctx : null;
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
    : { role: "row" };
  return (
    <div
      {...link}
      className={cn(
        COLS,
        "group/row h-[31px] items-center border-b border-border tw-body tw-num last:border-b-0",
        onOpen &&
          "cursor-pointer outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease) hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.045] focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      <span className="flex min-w-0 items-center gap-1">
        <span className={cn("min-w-0 truncate", mono && "font-mono", !onOpen && "text-muted-foreground")} title={label}>
          {label}
        </span>
        {onOpen && (
          <>
            <span className="sr-only">{t.viewInTraffic}</span>
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
            />
          </>
        )}
      </span>
      <span className="text-right">{r.requests.toLocaleString()}</span>
      <Tip text={t.tokens(r.tokens.toLocaleString(), r.tokens)}>
        <span className="text-right">{compact(r.tokens)}</span>
      </Tip>
      <span className="min-w-0 truncate text-right">
        <CostCell c={cost} amount={r.cost} unpriced={r.unpriced > 0 ? onUnpriced : undefined} />
      </span>
      <span className={cn("text-right", hit === null && "text-muted-foreground")}>
        {hit === null ? "—" : `${Math.round(hit * 100)}%`}
      </span>
      {latency ? (
        <Tip text={t.latencyCellTip(msShort(latency.p50), msShort(latency.p95), latency.samples)}>
          <span className="text-right">{msShort(latency.p50)}</span>
        </Tip>
      ) : (
        <span className="text-right text-muted-foreground">—</span>
      )}
      {speed ? (
        <Tip text={t.speedTip(Math.round(speed.p50).toLocaleString(), speed.samples)}>
          <span className="text-right">{t.speedCell(Math.round(speed.p50).toLocaleString())}</span>
        </Tip>
      ) : (
        <span className="text-right text-muted-foreground">—</span>
      )}
    </div>
  );
}

/**
 * 费用那一格，写法见 `rankCost`。有说明的写在悬停里、金额带虚线下划线；「无法计价」是
 * 琥珀色，**可以点**：落到流量页这一行里没算出费用的那一批 —— 看到它之后要做的就是去补价。
 */
function CostCell({
  c,
  amount,
  unpriced,
}: {
  c: ReturnType<typeof rankCost>;
  amount: number;
  unpriced?: () => void;
}) {
  const t = useText(overviewText);
  if (c.kind === "amount" && c.notes.length === 0) return <>{usd(amount)}</>;
  const shown = c.kind === "unpriced" ? t.unpricedCell : c.kind === "noUsage" ? t.noUsageCell : c.prefix + usd(amount);
  const look =
    c.kind === "amount"
      ? "underline decoration-dotted underline-offset-2"
      : c.kind === "unpriced"
        ? "text-warning"
        : "text-muted-foreground";
  const tip = (
    <div className="space-y-1">
      {c.notes.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
  return (
    <Tip text={tip}>
      {unpriced ? (
        <LinkText className={cn(look, "hover:decoration-solid")} onOpen={unpriced}>
          {shown}
          <span className="sr-only">{t.viewUnpriced}</span>
        </LinkText>
      ) : (
        <span className={look}>{shown}</span>
      )}
    </Tip>
  );
}
