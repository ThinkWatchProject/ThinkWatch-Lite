import { Table, TableHeader, TableHead, TableBody, TableRow, TableCell } from "@/ui/table";
import { Button } from "@/ui/button";
import { useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, KeyRoundIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Segmented } from "@/ui/segmented";
import { Tip } from "@/ui/tip";
import { ClientLogo, ModelLogo, UpstreamLogo, clientGlyph } from "@/ui/logos";
import { rangeText } from "@/ui/range.i18n";
import type { Range } from "@/ui/range";
import { useNav } from "@/nav";
import type { Filter } from "@/requestTable";
import { compact, msShort } from "@/format";
import { usd, type CostBucketGroup, type Dashboard, type LatencyView, type Overview, type TokenRateView } from "@/types";
import { useText } from "@/i18n";
import { breakdown, rankCost, ROWS, type BreakdownRow } from "./series";
import { LinkText } from "./parts";
import { overviewText } from "./overview.i18n";

/** 明细表（和「去向」）按什么分 */
export type Dim = "model" | "provider" | "client";

/**
 * 一项前面的标志：模型按出它的那一家（`modelGlyph`），上游按地址（`UpstreamLogo`，地址从
 * `ov` 里找；没有 `ov` 时只按名字认），密钥按它是为哪个客户端生成的（`ClientView.client`；
 * 名字本身就是客户端 id 的也认），对不上客户端的画一把钥匙。认不出来的画首字母方块。
 *
 * 没有名字的那一项（未知模型、未到上游、未知密钥）不画标志，只留出位置，名字才对得齐。
 */
export function ItemLogo({ dim, name, ov }: { dim: Dim; name: string; ov?: Overview | null }) {
  const cls = "text-muted-foreground";
  if (!name) return <span aria-hidden className="size-4 shrink-0" />;
  if (dim === "model") return <ModelLogo name={name} className={cls} />;
  if (dim === "provider") {
    const p = ov?.providers.find((x) => x.name === name);
    return <UpstreamLogo name={name} baseUrl={p?.base_url} protocol={p?.protocol} className={cls} />;
  }
  const client = ov?.clients.find((k) => k.name === name)?.client ?? (clientGlyph(name) ? name : null);
  return client ? (
    <ClientLogo id={client} name={name} className={cls} />
  ) : (
    <KeyRoundIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
  );
}

/**
 * 页面最下面的明细表（一张卡片，标题「明细」，和上面几块同一副外框）：按模型、上游、密钥
 * 分，每一行是这段时间的请求、token、费用、缓存命中、首 token 和生成速度。请求多的在前，
 * 先列几行，其余的写出有几项、点开再看。
 *
 * 点一行落到流量页，筛好那一个模型、上游或密钥。没有名字的那一行（没到上游的请求、
 * 认不出的密钥）只说不点 —— 没有东西可筛。
 *
 * 实时档按 24 小时算：十分钟里撑不起一张有意义的表。
 *
 * 名称格前面是标志（`ItemLogo`）。`ov` 给了，上游按地址认、密钥认得出是哪个客户端的。
 */
export function Breakdown({
  d,
  range,
  ov,
  dim,
  onDim,
}: {
  d: Dashboard;
  range: Range;
  ov?: Overview | null;
  /** 按什么分。**和「去向」是同一个选择**（放在页面那一层） */
  dim: Dim;
  onDim: (d: Dim) => void;
}) {
  const t = useText(overviewText);
  const rt = useText(rangeText);
  const nav = useNav();
  // 展开记在是哪一页上：换了按什么分（这里或「去向」那边切的），回到只列几行
  const [open, setOpen] = useState<Dim | null>(null);
  const all = open === dim;
  const groups: CostBucketGroup[] | null =
    dim === "model" ? d.buckets_by_model : dim === "provider" ? d.buckets_by_provider : d.buckets_by_client;
  const rows = groups ? breakdown(groups) : [];
  const shown = all ? rows : rows.slice(0, ROWS);
  const latency = new Map<string, LatencyView>(
    (dim === "model" ? d.latency : dim === "provider" ? d.latency_by_provider : d.latency_by_client)?.map((l) => [
      l.model,
      l,
    ]) ?? [],
  );
  // 按密钥的生成速度 core 没有端点：密钥那一页这一列写「—」
  const speed = new Map<string, TokenRateView>(
    (dim === "model" ? d.token_rate : dim === "provider" ? d.token_rate_by_provider : null)?.map((r) => [r.model, r]) ?? [],
  );
  const head = { model: t.tabModels, provider: t.tabUpstreams, client: t.tabKeys }[dim];
  const filterOf = (name: string): Partial<Filter> =>
    dim === "model" ? { model: name } : dim === "provider" ? { provider: name } : { client: name };
  const unnamed = { model: t.unknownModel, provider: t.noUpstream, client: t.unknownKey }[dim];

  return (
    <section
      className="@container rounded-[10px] border border-border bg-panel px-4 pt-3 pb-1"
      data-slot="overview-breakdown"
      aria-label={t.tableLabel}
    >
      <div className="flex h-7 items-center gap-3">
        <h3 className="shrink-0 tw-head text-muted-foreground">{t.tableLabel}</h3>
        <Segmented<Dim>
          label={t.tableLabel}
          value={dim}
          options={[
            { id: "model", label: t.tabModels },
            { id: "provider", label: t.tabUpstreams },
            { id: "client", label: t.tabKeys },
          ]}
          onChange={onDim}
        />
        {range.live && <span className="tw-label text-muted-foreground">{rt.preset["1d"]}</span>}
        {rows.length > ROWS && (
          <Button variant="ghost" size="xs"
            type="button"
            onClick={() => setOpen(all ? null : dim)}
            aria-expanded={all}
            className="h-auto min-h-6 whitespace-normal ml-auto inline-flex items-center gap-1 rounded-sm tw-label text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {all ? t.less : t.more(rows.length - ROWS)}
            <ChevronDownIcon aria-hidden className={cn("size-3 transition-transform motion-reduce:transition-none", all && "rotate-180")} />
          </Button>
        )}
      </div>

      <Table aria-label={head} className="mt-2 table-fixed [&_th]:h-7 [&_th]:px-1.5 [&_th:first-child]:pl-0 [&_td]:px-1.5 [&_td]:py-1 [&_td:first-child]:pl-0">
        <TableHeader><TableRow className="tw-label text-muted-foreground">
          <TableHead className="w-auto truncate">
            {head}
          </TableHead>
          <TableHead className="w-16 @min-[760px]:w-24 text-right">{t.colRequests}</TableHead>
          <TableHead className="w-16 @min-[760px]:w-24 text-right">{t.colTokens}</TableHead>
          <TableHead className="w-16 @min-[760px]:w-24 text-right">{t.colCost}</TableHead>
          <TableHead className="w-16 @min-[760px]:w-24 truncate text-right">{t.colCache}</TableHead>
          <TableHead className="w-16 @min-[760px]:w-24 truncate text-right">{t.colLatency}</TableHead>
          <TableHead className="w-16 @min-[760px]:w-24 truncate text-right">{t.colSpeed}</TableHead>
        </TableRow></TableHeader>
        <TableBody>{groups === null ? (
          <TableRow><TableCell colSpan={7} className="h-8 tw-body text-muted-foreground">{t.tableUnavailable}</TableCell></TableRow>
        ) : rows.length === 0 ? (
          <TableRow><TableCell colSpan={7} className="h-8 tw-body text-muted-foreground">{t.tableEmpty}</TableCell></TableRow>
        ) : (
          shown.map((r) => (
            <Row
              key={`row:${r.name}`}
              r={r}
              label={r.name || unnamed}
              logo={<ItemLogo dim={dim} name={r.name} ov={ov} />}
              mono={dim === "model" && r.name !== ""}
              latency={latency.get(r.name)}
              speed={speed.get(r.name)}
              onOpen={r.name ? () => nav.open("requests", { grouped: false, filter: filterOf(r.name) }) : undefined}
              onUnpriced={
                r.name ? () => nav.open("requests", { grouped: false, filter: { ...filterOf(r.name), unpricedOnly: true } }) : undefined
              }
            />
          ))
        )}</TableBody>
      </Table>
    </section>
  );
}

/**
 * 一行。名称按钮支持键盘操作；整行也能点击，保留表格的行与列语义。
 */
function Row({
  r,
  label,
  logo,
  mono,
  latency,
  speed,
  onOpen,
  onUnpriced,
}: {
  r: BreakdownRow;
  label: string;
  logo: React.ReactNode;
  mono: boolean;
  latency?: LatencyView;
  speed?: TokenRateView;
  onOpen?: () => void;
  onUnpriced?: () => void;
}) {
  const t = useText(overviewText);
  const cost = rankCost(r, t);
  const hit = r.ctx > 0 ? r.read / r.ctx : null;
  return (
    <TableRow
      onClick={onOpen}
      className={cn(
        "group/row h-[31px] items-center border-b border-border tw-body tw-num last:border-b-0",
        onOpen &&
          "cursor-pointer outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease) hover:bg-foreground/[0.03] focus-visible:bg-foreground/[0.045] focus-visible:ring-2 focus-visible:ring-ring/40",
      )}
    >
      <TableCell><Button variant="ghost" size="xs" disabled={!onOpen} onClick={(event) => { event.stopPropagation(); onOpen?.(); }} className="flex h-auto w-full min-w-0 justify-start gap-1 p-0 font-normal disabled:opacity-100">
        <span className="mr-1 flex shrink-0">{logo}</span>
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
      </Button></TableCell>
      <TableCell className="text-right">{r.requests.toLocaleString()}</TableCell>
      <TableCell className="text-right"><Tip text={t.tokens(r.tokens.toLocaleString(), r.tokens)}>
        <span className="text-right">{compact(r.tokens)}</span>
      </Tip></TableCell>
      <TableCell className="min-w-0 truncate text-right">
        <CostCell c={cost} amount={r.cost} unpriced={r.unpriced > 0 ? onUnpriced : undefined} />
      </TableCell>
      <TableCell className={cn("text-right", hit === null && "text-muted-foreground")}>
        {hit === null ? "—" : `${Math.round(hit * 100)}%`}
      </TableCell>
      <TableCell className="text-right">{latency ? (
        <Tip text={t.latencyCellTip(msShort(latency.p50), msShort(latency.p95), latency.samples)}>
          <span className="text-right">{msShort(latency.p50)}</span>
        </Tip>
      ) : (
        <span className="text-right text-muted-foreground">—</span>
      )}</TableCell>
      <TableCell className="text-right">{speed ? (
        <Tip text={t.speedTip(Math.round(speed.p50).toLocaleString(), speed.samples)}>
          <span className="text-right">{t.speedCell(Math.round(speed.p50).toLocaleString())}</span>
        </Tip>
      ) : (
        <span className="text-right text-muted-foreground">—</span>
      )}</TableCell>
    </TableRow>
  );
}

/**
 * 费用那一格，写法见 `rankCost`。有说明的写在悬停里、金额带虚线下划线；「无法计价」是
 * 琥珀色，**可以点**：落到流量页这一行里没算出费用的那一批 —— 看到它之后要做的就是去补价。
 * 「去向」那张卡片也用它（不给 `unpriced`：那一整行本来就能点）。
 */
export function CostCell({
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
