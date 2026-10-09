import { memo, useMemo, useRef, useState, type ReactNode } from "react";
import { call } from "@/control";
import { useText } from "@/i18n";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/resource";
import { notSent } from "@/requestRouting";
import type { RequestRow, SessionDetail, TurnView } from "@/types";
import { Button } from "@/ui/button";
import { UpstreamLogo } from "@/ui/logos";
import { Meter } from "@/ui/meter";
import { AnimatedNumber } from "@/ui/motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { StatusDot, StatusLabel } from "@/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Tip } from "@/ui/tip";
import { PanelHeader, PanelHeaderSkeleton, PanelSkeleton } from "./PanelHeader";
import { SessionCost } from "./SessionCost";
import { sessionsText } from "./Sessions.i18n";
import { Conversation } from "./Conversation";
import { unrecorded } from "./transcript";
import { turnCost, type TurnCost } from "./costCell";
import { compact, span, whenMinute } from "@/format";
import { tally } from "./grouping";

/**
 * 一次会话，在右侧浮层里。**点开立刻出来**：先是和内容同样形状的骨架，取到了
 * 落进去；读失败就在浮层里说，带「重试」。原来要等取完才打开，读失败时只弹一个
 * toast，点了组头像是没点中。
 *
 * **任务还在进行的话，详情要跟得上。**打开一次会话多半是想看这次的费用，而那时
 * 它往往还在跑：有请求落地就重读（按事件节流，和会话列表同一个节奏）。数据在
 * 模块里缓存着：再点开同一次会话是立刻出来的。详情是从库里读的，一轮落了库才有；
 * 在跑的那一轮、刚落地还没重读的那一轮从表里的行补上（`rows`）。第一轮还在跑的
 * 会话库里还没有，core 说「没有这次会话」—— 那不是读失败，照样画，全靠行。
 *
 * 会话和请求走同一种浮层。比请求那一层宽：叠起来的时候左边露出一截，那一截就是
 * 「下面还有一层」唯一的说明。
 */
export function SessionSheet({
  id,
  rows,
  onClose,
  onOpenTurn,
}: {
  /** 开着的那次会话。`null` 是关着 */
  id: string | null;
  /** 表里这次会话的行 */
  rows: readonly RequestRow[];
  onClose: () => void;
  /** 点了其中一轮 —— 在这一层之上再叠一层请求详情 */
  onOpenTurn: (id: number) => void;
}) {
  const t = useText(sessionsText);
  const r = useResource(id === null ? null : `session:${id}`, () => call("SessionDetail", null, id ?? ""), {
    events: ["request_finished", "request_failed", "request_cancelled"],
  });
  const early = r.data === undefined && rows.length > 0 && unrecorded(r.error);
  const now = id === null ? undefined : r.data ? { id, d: r.data, rows } : early ? { id, d: null, rows } : undefined;
  /** 关上的那一下还要画着刚才那一份：浮层是滑出去的，不是一下没了 */
  const last = useRef(now);
  if (now) last.current = now;
  const shown = id === null ? last.current : now;

  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="flex flex-col gap-0 p-0 data-[side=right]:w-[min(46rem,94vw)] data-[side=right]:sm:max-w-none"
        // 打开时聚焦浮层本身，不落在关闭钮上（理由见 RequestDrawer）
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t.title}</SheetTitle>
        </SheetHeader>
        {shown ? (
          // 换一次会话从「概况」看起，和请求详情换一条从「时间线」看起一样
          <SessionPanel
            key={shown.id}
            id={shown.id}
            d={shown.d}
            rows={shown.rows}
            onOpenTurn={onOpenTurn}
            onClose={onClose}
          />
        ) : r.error !== undefined ? (
          // 重试的时候留在这里，按钮转着 —— 换回骨架的话，看起来像是点了没反应
          <>
            <PanelHeader title={t.title} onClose={onClose} />
            <ErrorState title={t.loadFailed} error={r.error} onRetry={() => void r.reload()} retrying={r.loading} />
          </>
        ) : (
          <SessionSkeleton onClose={onClose} />
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * 会话详情，两个标签：「概况」是几个总数、每轮的输入、每轮的费用；「对话」把这次会话按
 * 对话的样子重放出来（`Conversation`）。
 *
 * 瀑布里的一轮就是一条请求（`TurnView.id` 就是请求 id）：从「这次任务第 12 轮
 * 特别贵」走到「那一条请求到底发了什么」，点一下就到。
 *
 * `d` 是库里的详情，一轮落了库才算进去；`rows` 是表里这次会话的行，详情里还没有的
 * 那几轮（在跑的、刚落地还没重读的）从这里补进轮数、失败数、时长和瀑布（见 `tally`）。
 * 费用、用量和每轮输入只看详情：它们按落了库的用量算。`d` 是 `null`：库里还没有这次
 * 会话，全靠行。
 */
export function SessionPanel({
  id,
  d,
  rows,
  onOpenTurn,
  onClose,
}: {
  id: string;
  d: SessionDetail | null;
  rows: readonly RequestRow[];
  onOpenTurn: (id: number) => void;
  onClose: () => void;
}) {
  const t = useText(sessionsText);
  const s = d?.session ?? null;
  const turns = d?.turns ?? NO_TURNS;
  const pending = useMemo(() => unrecordedRows(turns, rows), [turns, rows]);
  const n = tally(s, rows, pending);
  // 走过哪几个上游，按第一次出现的先后。一次任务中途换过上游，这里能看出来。
  // 没有发往任何上游的那几轮（被规则拒绝）上游是空的，不算；上游都满着的那几轮记在最后
  // 看过的那一家上，那一家没收到它，也不算（见 `notSent`）
  const providers = [
    ...new Set([...turns, ...pending].filter((x) => notSent(x) === null).map((x) => x.provider).filter(Boolean)),
  ];
  const client = s?.client ?? pending[0]?.client;
  const [tab, setTab] = useState<Tab>("summary");
  /** 「对话」打开过：之后切走也留着（读到哪儿、展开了哪几条都在），见 `PANE` */
  const [seen, setSeen] = useState(false);
  const show = (v: Tab) => {
    setTab(v);
    if (v === "conversation") setSeen(true);
  };
  /** 还在跑的那几轮在「对话」末尾各占一行。序号和瀑布里一样：接在落了库的那几轮后面 */
  const running = pending.flatMap((r, i) => (r.state === "in_flight" ? [{ row: r, n: turns.length + i + 1 }] : []));
  return (
    <Tabs value={tab} onValueChange={(v) => show(v as Tab)} className="flex min-h-0 flex-1 flex-col gap-0">
      {/* 第二行和请求详情同一个顺序：上游、密钥，然后是这次用过的模型 */}
      <PanelHeader
        title={t.title}
        meta={t.startedAt(whenMinute(n.started))}
        onClose={onClose}
        tabs={
          <TabsList variant="line">
            <TabsTrigger value="summary">{t.tabSummary}</TabsTrigger>
            <TabsTrigger value="conversation">{t.tabConversation}</TabsTrigger>
          </TabsList>
        }
      >
        {/* 名字太长时截断（这一行宽不过浮层），悬停看全 */}
        {providers.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <UpstreamLogo name={providers[0] ?? ""} className="opacity-70" />
            <Tip clip text={providers.join(" · ")}>
              <span className="truncate">{providers.join(" · ")}</span>
            </Tip>
          </span>
        )}
        {client && (
          <Tip clip text={client}>
            <span className="min-w-0 truncate">{client}</span>
          </Tip>
        )}
        <Tip clip text={n.models.join(t.modelSep)}>
          <span className="min-w-0 truncate">{n.models.join(t.modelSep)}</span>
        </Tip>
      </PanelHeader>
      <div className="relative min-h-0 flex-1">
        <TabsContent value="summary" forceMount className={PANE}>
          <Summary d={d} rows={rows} pending={pending} onOpenTurn={onOpenTurn} />
        </TabsContent>
        <TabsContent value="conversation" forceMount className={PANE}>
          {seen && (
            <Conversation
              id={id}
              turns={turns}
              running={running}
              onOpenTurn={onOpenTurn}
              onShowSummary={() => setTab("summary")}
            />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

type Tab = "summary" | "conversation";

const NO_TURNS: TurnView[] = [];

/** 表里这次会话的行里，详情里还没有的那几轮（在跑的、刚落地还没重读的），按时间排 */
function unrecordedRows(turns: readonly TurnView[], rows: readonly RequestRow[]): RequestRow[] {
  const recorded = new Set(turns.map((x) => x.id));
  return rows.filter((r) => !recorded.has(r.id)).sort((a, b) => a.atMs - b.atMs);
}

/**
 * 「概况」：几个总数、每轮的输入、每轮的费用。
 *
 * **`memo`**：切到「对话」再切回来时它不重画。几百轮的会话，每轮输入的柱子和每轮费用的
 * 行各几百个，切一次标签就整页重画一遍，那一下是卡的。
 */
const Summary = memo(function Summary({
  d,
  rows,
  pending,
  onOpenTurn,
}: {
  d: SessionDetail | null;
  rows: readonly RequestRow[];
  pending: readonly RequestRow[];
  onOpenTurn: (id: number) => void;
}) {
  const t = useText(sessionsText);
  const s = d?.session ?? null;
  const turns = d?.turns ?? NO_TURNS;
  const n = tally(s, rows, pending);
  return (
    <>
      <dl className="grid grid-cols-4 overflow-hidden rounded-lg border border-border">
        <Stat label={t.turns} value={<AnimatedNumber value={n.turns} />} />
        <Stat label={t.duration} value={span(n.ended - n.started)} />
        {/* 库里还没有这次会话：一轮费用都还没算出来 */}
        <Stat label={t.cost} value={s ? <SessionCost s={s} /> : <span className="text-muted-foreground">—</span>} />
        <Stat
          label={t.failedTurns}
          value={
            n.failed > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-destructive">
                <StatusDot tone="error" />
                <AnimatedNumber value={n.failed} />
              </span>
            ) : (
              <span className="text-muted-foreground">0</span>
            )
          }
        />
      </dl>
      {s && (
        <p className="mt-2 tw-label text-muted-foreground">
          {t.usage(compact(s.input_tokens), compact(s.output_tokens), compact(s.cache_read_tokens))}
        </p>
      )}

      {turns.length > 0 && <Growth turns={turns} />}
      <Waterfall steps={[...turns.map(fromTurn), ...pending.map(fromRow)]} onOpen={onOpenTurn} />
    </>
  );
});

/**
 * 两个标签页**叠在一起，切走的那一页只是藏起来**（`forceMount` 加 `invisible`），不卸掉。
 * 一次几百轮的对话，读到一半切去看费用再回来，还停在原来那一轮、展开的还展开着；
 * 卸掉的话从头开始。藏起来用 `visibility` 而不是 `display: none`：后者会丢掉滚动位置。
 * 每一页自己滚。切回来的那一页照常淡入（`motion-fade` 在藏起来时摘掉，回来时重新播一次）。
 */
const PANE =
  "absolute inset-0 overflow-y-auto px-4 pt-4 pb-6 data-[state=inactive]:invisible data-[state=inactive]:animate-none";

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="border-l border-border px-3 py-2.5 first:border-l-0">
      <dt className="tw-label text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 tw-num tw-head text-foreground">{value}</dd>
    </div>
  );
}

/**
 * 每轮送进去多少 token。**一眼看出哪次任务的上下文失控了**。
 *
 * 用条形而不是折线：轮次是离散的，而「第 12 轮突然翻倍」正是要找的那个东西 ——
 * 折线会把那一跳平滑掉一部分。
 *
 * **一根柱子是缓存读取加新输入，两段叠着画。**core 的「输入」不含缓存；原来把
 * 缓存读取当成输入的一部分画在柱子里面，带缓存的会话缓存读取常常是新输入的几十
 * 倍，那一截从柱子里冲出去，盖满整个浮层。颜色和概览的缓存构成条一样。缓存写入
 * 不在里面：每一轮的数据（`TurnView`）没有这一项。
 */
function Growth({ turns }: { turns: TurnView[] }) {
  const t = useText(sessionsText);
  const total = (x: TurnView) => (x.input_tokens ?? 0) + (x.cache_read_tokens ?? 0);
  const peak = Math.max(0, ...turns.map(total));
  const max = Math.max(1, peak);
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline gap-3">
        <h3 className="tw-head text-foreground">{t.growthTitle}</h3>
        <span className="tw-label text-muted-foreground">{t.peak(compact(peak))}</span>
      </div>
      <div role="img" aria-label={t.growthTitle} className="flex h-20 items-end gap-px border-b border-border">
        {turns.map((x, i) => {
          const read = x.cache_read_tokens ?? 0;
          const input = x.input_tokens ?? 0;
          return (
            <Tip key={x.id} text={t.growthBar(i + 1, total(x).toLocaleString(), read.toLocaleString(), input.toLocaleString())}>
              {/* 悬停的范围是整根柱子那一列，不只是画出来的那一截 */}
              <span className="flex h-full min-w-px flex-1 flex-col justify-end">
                {input > 0 && (
                  <span className="motion-bar w-full rounded-t-[2px] bg-cache-plain" style={{ height: `${(input / max) * 100}%` }} />
                )}
                {read > 0 && (
                  <span
                    className={cn("motion-bar w-full bg-cache-hit", input === 0 && "rounded-t-[2px]")}
                    style={{ height: `${(read / max) * 100}%` }}
                  />
                )}
              </span>
            </Tip>
          );
        })}
      </div>
      <div className="mt-2 flex items-center gap-4 tw-label text-muted-foreground">
        <Swatch className="bg-cache-hit">{t.cacheReads}</Swatch>
        <Swatch className="bg-cache-plain">{t.uncachedInput}</Swatch>
      </div>
    </section>
  );
}

function Swatch({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2 rounded-[2px]", className)} />
      {children}
    </span>
  );
}

/**
 * 瀑布里的一轮：落了库的（`TurnView`），或者表里的一行 —— 还在跑的，刚落地、详情还
 * 没重读的。费用那一格写什么见 `turnCost`。
 */
interface Step extends TurnCost {
  id: number;
  model: string;
  state: RequestRow["state"];
}

const fromTurn = (x: TurnView): Step => ({
  id: x.id,
  model: x.model,
  cost: x.cost_micros,
  estimated: x.cost_estimated,
  state: x.error ? "failed" : x.cancelled ? "cancelled" : "done",
  usage: x.input_tokens != null,
  billing: x.billing,
  recorded: true,
});

const fromRow = (r: RequestRow): Step => ({
  id: r.id,
  model: r.model ?? "",
  cost: r.costMicros ?? null,
  estimated: r.costEstimated === true,
  state: r.state,
  usage: r.inputTokens != null,
  // 表里的那几轮还没落库，费用那一格只看它有没有金额（见 `turnCost`）
  billing: "per-token",
  recorded: false,
});

/**
 * 每轮的费用 —— 找出那个 8 万 token 的文件读取。一轮一行，点开是那一条请求。
 *
 * 行尾「失败」「已取消」那一格只在有这样的轮次时才占位：一次顺利的任务，金额
 * 贴着右边，不留一截空白。**在跑的那一轮写在金额的位置**：它还没有金额，而一轮
 * 开始、结束就让那一格出现又消失的话，整列金额跟着左右跳。
 */
function Waterfall({ steps, onOpen }: { steps: Step[]; onOpen: (id: number) => void }) {
  const t = useText(sessionsText);
  const max = Math.max(1, ...steps.map((x) => x.cost ?? 0));
  const marks = steps.some((x) => x.state === "failed" || x.state === "cancelled");
  return (
    <section className="mt-6">
      <h3 className="mb-2 tw-head text-foreground">{t.waterfallTitle}</h3>
      <ol className="-mx-1.5 flex flex-col">
        {steps.map((x, i) => (
          <li key={x.id}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start gap-2.5 px-1.5 font-normal tw-num"
              onClick={() => onOpen(x.id)}
            >
              <span className="w-6 shrink-0 text-right tw-label text-muted-foreground">{i + 1}</span>
              <Tip clip text={x.model}>
                <span className="w-32 shrink-0 truncate text-left text-muted-foreground">{x.model}</span>
              </Tip>
              <Meter value={x.cost ?? 0} max={max} color="var(--chart-2)" className="min-w-8 flex-1" />
              {/* 两格的宽度按最长的那个词定：英文的「In progress」「Canceled」，Windows 上字大 1px 也放得下 */}
              <span className="w-24 shrink-0 text-right">
                {/* **没有价格就说没有价格，不写 $0**；估算的金额带记号；没有用量的不是「没有价格」 */}
                {x.state === "in_flight" ? (
                  <StatusLabel tone="pending" muted>
                    {t.turnRunning}
                  </StatusLabel>
                ) : (
                  <TurnCostText x={x} />
                )}
              </span>
              {marks && (
                <span className="w-20 shrink-0 text-left">
                  {x.state === "failed" ? (
                    <StatusLabel tone="error">{t.turnFailed}</StatusLabel>
                  ) : x.state === "cancelled" ? (
                    <StatusLabel tone="idle" muted>
                      {t.turnCancelled}
                    </StatusLabel>
                  ) : null}
                </span>
              )}
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TurnCostText({ x }: { x: TurnCost }) {
  const c = turnCost(x, useText(sessionsText));
  return <span className={c.muted ? "text-muted-foreground" : undefined}>{c.text}</span>;
}

/** 取数时的样子：和内容同样的几块，落进来时不跳 */
function SessionSkeleton({ onClose }: { onClose: () => void }) {
  const t = useText(sessionsText);
  return (
    <PanelSkeleton>
      <PanelHeaderSkeleton title={t.title} onClose={onClose} tabs={2} />
      <div className="px-4 pt-4">
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-border">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="border-l border-border px-3 py-2.5 first:border-l-0">
              <Skeleton className="h-2.5 w-10 rounded-sm" />
              <Skeleton className="mt-2 h-3.5 w-14 rounded-sm" />
            </div>
          ))}
        </div>
        <Skeleton className="mt-6 h-3 w-28 rounded-sm" />
        <Skeleton className="mt-3 h-20 w-full rounded-md" />
        <Skeleton className="mt-6 h-3 w-20 rounded-sm" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="mt-3 h-3 w-full rounded-sm" style={{ opacity: 1 - i * 0.12 }} />
        ))}
      </div>
    </PanelSkeleton>
  );
}
