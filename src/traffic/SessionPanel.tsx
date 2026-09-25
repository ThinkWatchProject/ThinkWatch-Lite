import { useRef, type ReactNode } from "react";
import { call } from "@/control";
import { useText } from "@/i18n";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/resource";
import { usd, type SessionDetail, type TurnView } from "@/types";
import { Button } from "@/ui/button";
import { UpstreamLogo } from "@/ui/logos";
import { AnimatedNumber } from "@/ui/motion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { StatusDot, StatusLabel } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { PanelHeader, PanelHeaderSkeleton, PanelSkeleton } from "./PanelHeader";
import { SessionCost } from "./SessionCost";
import { sessionsText } from "./Sessions.i18n";
import { dur, tokens, when } from "./format";

/**
 * 一次会话，在右侧浮层里。**点开立刻出来**：先是和内容同样形状的骨架，取到了
 * 落进去；读失败就在浮层里说，带「重试」。原来要等取完才打开，读失败时只弹一个
 * toast，点了组头像是没点中。
 *
 * **任务还在进行的话，详情要跟得上。**打开一次会话多半是想看这次的费用，而那时
 * 它往往还在跑：有请求落地就重读（按事件节流，和会话列表同一个节奏）。数据在
 * 模块里缓存着：再点开同一次会话是立刻出来的。
 *
 * 会话和请求走同一种浮层。比请求那一层宽：叠起来的时候左边露出一截，那一截就是
 * 「下面还有一层」唯一的说明。
 */
export function SessionSheet({
  id,
  onClose,
  onOpenTurn,
}: {
  /** 开着的那次会话。`null` 是关着 */
  id: string | null;
  onClose: () => void;
  /** 点了其中一轮 —— 在这一层之上再叠一层请求详情 */
  onOpenTurn: (id: number) => void;
}) {
  const t = useText(sessionsText);
  const r = useResource(id === null ? null : `session:${id}`, () => call("SessionDetail", null, id ?? ""), {
    events: ["request_finished", "request_failed", "request_cancelled"],
  });
  /** 关上的那一下还要画着刚才那一份：浮层是滑出去的，不是一下没了 */
  const last = useRef<SessionDetail | undefined>(undefined);
  if (r.data) last.current = r.data;
  const d = id === null ? last.current : r.data;

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
        {d ? (
          <SessionPanel d={d} onOpenTurn={onOpenTurn} onClose={onClose} />
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
 * 会话详情：几个总数、每轮的输入、每轮的费用。
 *
 * 瀑布里的一轮就是一条请求（`TurnView.id` 就是请求 id）：从「这次任务第 12 轮
 * 特别贵」走到「那一条请求到底发了什么」，点一下就到。
 */
export function SessionPanel({
  d,
  onOpenTurn,
  onClose,
}: {
  d: SessionDetail;
  onOpenTurn: (id: number) => void;
  onClose: () => void;
}) {
  const t = useText(sessionsText);
  const { session: s, turns } = d;
  // 走过哪几个上游，按第一次出现的先后。一次任务中途换过上游，这里能看出来。
  // 没有发往任何上游的那几轮（被规则拒绝）上游是空的，不算
  const providers = [...new Set(turns.map((x) => x.provider).filter(Boolean))];
  return (
    <>
      {/* 第二行和请求详情同一个顺序：上游、密钥，然后是这次用过的模型 */}
      <PanelHeader title={t.title} meta={t.startedAt(when(s.started_ms))} onClose={onClose}>
        {providers.length > 0 && (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <UpstreamLogo name={providers[0] ?? ""} className="opacity-70" />
            <span className="truncate">{providers.join(" · ")}</span>
          </span>
        )}
        {s.client && <span className="min-w-0 truncate">{s.client}</span>}
        <span className="min-w-0 truncate">{s.models.join(t.modelSep)}</span>
      </PanelHeader>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6">
        <dl className="grid grid-cols-4 overflow-hidden rounded-lg border border-border">
          <Stat label={t.turns} value={<AnimatedNumber value={s.turns} />} />
          <Stat label={t.duration} value={dur(s.ended_ms - s.started_ms)} />
          <Stat label={t.cost} value={<SessionCost s={s} />} />
          <Stat
            label={t.failedTurns}
            value={
              s.errors > 0 ? (
                <span className="inline-flex items-center gap-1.5 text-destructive">
                  <StatusDot tone="error" />
                  <AnimatedNumber value={s.errors} />
                </span>
              ) : (
                <span className="text-muted-foreground">0</span>
              )
            }
          />
        </dl>
        <p className="mt-2 tw-label text-muted-foreground">
          {t.usage(tokens(s.input_tokens), tokens(s.output_tokens), tokens(s.cache_read_tokens))}
        </p>

        <Growth turns={turns} />
        <Waterfall turns={turns} onOpen={onOpenTurn} />
      </div>
    </>
  );
}

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
        <span className="tw-label text-muted-foreground">{t.peak(tokens(peak))}</span>
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
 * 每轮的费用 —— 找出那个 8 万 token 的文件读取。一轮一行，点开是那一条请求。
 *
 * 行尾「失败」「已取消」那一格只在有这样的轮次时才占位：一次顺利的任务，金额
 * 贴着右边，不留一截空白。
 */
function Waterfall({ turns, onOpen }: { turns: TurnView[]; onOpen: (id: number) => void }) {
  const t = useText(sessionsText);
  const max = Math.max(1, ...turns.map((x) => x.cost_micros ?? 0));
  const marks = turns.some((x) => x.error || x.cancelled);
  return (
    <section className="mt-6">
      <h3 className="mb-2 tw-head text-foreground">{t.waterfallTitle}</h3>
      <ol className="-mx-1.5 flex flex-col">
        {turns.map((x, i) => (
          <li key={x.id}>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-full justify-start gap-2.5 px-1.5 font-normal tw-num"
              onClick={() => onOpen(x.id)}
            >
              <span className="w-6 shrink-0 text-right tw-label text-muted-foreground">{i + 1}</span>
              <span className="w-32 shrink-0 truncate text-left text-muted-foreground">{x.model}</span>
              <span className="relative h-1.5 min-w-8 flex-1 overflow-hidden rounded-full bg-foreground/[0.06]">
                <span
                  className="motion-bar absolute inset-y-0 left-0 rounded-full bg-chart-2"
                  style={{ width: `${((x.cost_micros ?? 0) / max) * 100}%` }}
                />
              </span>
              <span className="w-20 shrink-0 text-right">
                {/* **没有价格就说没有价格，不写 $0**；估算的金额带记号 */}
                {x.cost_micros == null ? (
                  <span className="text-muted-foreground">{t.unpriced}</span>
                ) : (
                  (x.cost_estimated ? "~" : "") + usd(x.cost_micros)
                )}
              </span>
              {marks && (
                <span className="w-14 shrink-0 text-left">
                  {x.error ? (
                    <StatusLabel tone="error">{t.turnFailed}</StatusLabel>
                  ) : x.cancelled ? (
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

/** 取数时的样子：和内容同样的几块，落进来时不跳 */
function SessionSkeleton({ onClose }: { onClose: () => void }) {
  const t = useText(sessionsText);
  return (
    <PanelSkeleton>
      <PanelHeaderSkeleton title={t.title} onClose={onClose} />
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
