import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { call } from "@/control";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { statusTone, tokens as tokenPair, when } from "@/format";
import { Button } from "@/ui/button";
import { Collapsible, CollapsibleTrigger } from "@/ui/collapsible";
import { UpstreamLogo } from "@/ui/logos";
import { AnimatedNumber } from "@/ui/motion";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { notify } from "@/ui/notify";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Tip } from "@/ui/tip";
import { PanelHeader, PanelHeaderSkeleton, PanelSkeleton } from "@/traffic/PanelHeader";
import { KeyLabel } from "./KeyLabel";
import { appLabel, attemptText, formatLabel, quoteText, targetLabel } from "./labels";
import { prettyJson } from "./prettyJson";
import { requestDrawerText } from "./RequestDrawer.i18n";
import { ActionBadge, EventDetail, ruleName, whereOf } from "./security/labels";
import {
  usd,
  type BodyView,
  type CoreEvent,
  type HistoryRow,
  type ReplayQuote,
  type ReplayResult,
  type RequestDetail,
} from "./types";
import { priceSourceDetail } from "./upstreams/labels";

type Tab = "timeline" | "routing" | "payload" | "usage" | "replay";

/**
 * 一条请求的详情，在右侧浮层里。流量表、概览、安全日志点开的都是它。
 *
 * **`id` 为 `null` 时是关着的。**一直挂着、用 `id` 开关的话，关上时浮层是滑出去的
 * （那一下还画着刚才那一条）；调用方按条件挂（`{open && <RequestDrawer …/>}`）也
 * 照样能用，只是关的时候直接消失。
 */
export default function RequestDrawer({ id, onClose }: { id: number | null; onClose: () => void }) {
  const t = useText(requestDrawerText);
  /** 关上的那一下还要画着刚才那一条 */
  const last = useRef<number | null>(id);
  if (id !== null) last.current = id;
  const shown = id ?? last.current;

  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        /*
          **宽度要带 `data-[side=right]:` 前缀。**组件自己那条
          `data-[side=right]:w-3/4 sm:max-w-sm` 是属性选择器，普通的
          `w-[…]` 压不过它。
        */
        className="flex flex-col gap-0 p-0 data-[side=right]:w-[min(38rem,90vw)] data-[side=right]:sm:max-w-none"
        /*
          **打开时别把焦点放在关闭按钮上。**Radix 默认聚焦第一个可聚焦元素，也就是
          那个 ×，于是一打开就有个高亮方框套在「关闭」上 —— 看起来像是在提示你关掉
          它。改成聚焦面板本身：焦点仍然在陷阱里（Tab 走不出去、Esc 照样关），只是
          不落在某个按钮上。
        */
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {/* 标题在 `PanelHeader` 里，这里只是读屏软件要的那一句 */}
        <SheetHeader className="sr-only">
          <SheetTitle>{t.title}</SheetTitle>
        </SheetHeader>
        {shown !== null && <Detail key={shown} id={shown} onClose={onClose} />}
      </SheetContent>
    </Sheet>
  );
}

/** 这一条现在是什么结局。和流量表那一格同一套说法 */
function stateOf(d: RequestDetail): "in_flight" | "done" | "failed" | "cancelled" {
  if (d.in_flight) return "in_flight";
  if (d.row.error) return "failed";
  if (d.row.cancelled) return "cancelled";
  return "done";
}

const TONE: Record<ReturnType<typeof statusTone>, StatusTone> = {
  pending: "pending",
  bad: "error",
  warn: "warn",
  muted: "idle",
  ok: "ok",
};

/** 取一条请求、跟着还在跑的那条往下走，按取没取到画骨架、失败或内容 */
function Detail({ id, onClose }: { id: number; onClose: () => void }) {
  const t = useText(requestDrawerText);
  const [d, setD] = useState<RequestDetail | null>(null);
  const [error, setError] = useState<unknown>(undefined);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("timeline");

  const load = useCallback(
    async (alive: () => boolean) => {
      setLoading(true);
      try {
        const x = await call("RequestDetail", null, id);
        if (!alive()) return;
        setD(x);
        setError(undefined);
      } catch (e) {
        // 已经画着一份的话（在跑的那条跟着取），留着它，不换成失败
        if (alive()) setError(e);
      } finally {
        if (alive()) setLoading(false);
      }
    },
    [id],
  );
  useEffect(() => {
    let alive = true;
    void load(() => alive);
    return () => {
      alive = false;
    };
  }, [load]);

  /*
    **还在跑的请求，跟着它往下走。**点开的往往正是那个跑了很久的请求：响应头
    到了有状态码，路由走完有尝试链，计价事件到了就是落库的那一刻 —— 那条事件
    和写库在同一把锁里，这时再取，拿到的一定是完整的一份。
  */
  const running = d?.in_flight === true;
  useEffect(() => {
    if (!running) return;
    let alive = true;
    const un = listen<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      const mine =
        (ev.kind === "request_headers" || ev.kind === "request_routed" || ev.kind === "request_priced") &&
        ev.id === id;
      // 事件流丢过事件的话，结局可能就在里面
      if (mine || ev.kind === "events_dropped") void load(() => alive);
    });
    return () => {
      alive = false;
      void un.then((f) => f());
    };
  }, [running, id, load]);

  if (!d) {
    // 重试的时候留在这里，按钮转着 —— 换回骨架的话，看起来像是点了没反应
    if (error !== undefined) {
      return (
        <>
          <PanelHeader title={t.requestNo(id)} onClose={onClose} />
          <ErrorState
            title={t.loadFailed}
            error={error}
            onRetry={() => void load(() => true)}
            retrying={loading}
          />
        </>
      );
    }
    return <DetailSkeleton onClose={onClose} />;
  }

  const r = d.row;
  const state = stateOf(d);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col gap-0">
      <PanelHeader
        title={r.model || t.requestNo(id)}
        meta={when(r.at_ms)}
        onClose={onClose}
        tabs={
          // 换成 Tabs 之后左右方向键能在标签间走
          <TabsList variant="line">
            <TabsTrigger value="timeline">{t.tabTimeline}</TabsTrigger>
            <TabsTrigger value="routing">{t.tabRouting}</TabsTrigger>
            <TabsTrigger value="payload">{t.tabPayload}</TabsTrigger>
            <TabsTrigger value="usage">{t.tabUsage}</TabsTrigger>
            <TabsTrigger value="replay">{t.tabReplay}</TabsTrigger>
          </TabsList>
        }
      >
        <HeadStatus r={r} state={state} />
        <span className="inline-flex min-w-0 items-center gap-1.5">
          {!r.local && <UpstreamLogo name={r.provider} className="opacity-70" />}
          <span className="truncate">{r.local ? t.answeredLocally : r.provider}</span>
        </span>
        <span className="min-w-0 truncate">
          <KeyLabel name={r.client} masked={r.key_masked} />
        </span>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6 tw-body">
        <TabsContent value="timeline">
          <Timeline d={d} state={state} />
        </TabsContent>
        <TabsContent value="routing">
          <Routing r={r} running={running} />
        </TabsContent>
        <TabsContent value="payload">
          <div className="space-y-5">
            <Body b={d.request_body} title={t.request} />
            <Body b={d.response_body} title={t.response} pending={running} />
          </div>
        </TabsContent>
        <TabsContent value="usage">
          <Usage r={r} running={running} />
        </TabsContent>
        <TabsContent value="replay">
          {/* 重放要和原来那一次的结果并排比，而它还没有结果 */}
          {running ? (
            <p className="text-muted-foreground">{t.replayPending}</p>
          ) : (
            <Replay id={id} originalProvider={r.provider} />
          )}
        </TabsContent>
      </div>
    </Tabs>
  );
}

/**
 * 头上的状态：点加一句。**正常的那几种字是灰的，只有点带颜色** —— 一个绿色的
 * 「200」在每一条上都一样，它不是要看的东西；失败和 4xx 才整句上色。
 */
function HeadStatus({ r, state }: { r: HistoryRow; state: ReturnType<typeof stateOf> }) {
  const t = useText(requestDrawerText);
  const tone = TONE[statusTone(r.status ?? undefined, state)];
  return (
    <StatusLabel tone={tone} muted={tone === "ok" || tone === "idle" || tone === "pending"}>
      {statusText(r, state, t)}
    </StatusLabel>
  );
}

/** 状态那一项的字：状态码，或者失败、已取消、进行中 */
function statusText(
  r: HistoryRow,
  state: ReturnType<typeof stateOf>,
  t: (typeof requestDrawerText)["zh"],
): string {
  if (state === "in_flight") return r.status != null ? `${r.status} · ${t.inProgress}` : t.inProgress;
  if (state === "failed") return r.status != null ? `${r.status} · ${t.failed}` : t.failed;
  if (state === "cancelled") return t.cancelledShort;
  return r.status != null ? String(r.status) : "—";
}

/** 取数时的样子：和内容同样的几块（头、标签、几行），落进来时不跳 */
function DetailSkeleton({ onClose }: { onClose: () => void }) {
  return (
    <PanelSkeleton>
      <PanelHeaderSkeleton onClose={onClose} tabs={5} />
      <div className="px-4 pt-4">
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-border">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="border-l border-border px-3 py-2.5 first:border-l-0">
              <Skeleton className="h-2.5 w-10 rounded-sm" />
              <Skeleton className="mt-2 h-3.5 w-14 rounded-sm" />
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-3">
          {Array.from({ length: 7 }, (_, i) => (
            <div key={i} className="flex gap-3" style={{ opacity: 1 - i * 0.1 }}>
              <Skeleton className="h-3 w-14 rounded-sm" />
              <Skeleton className={cn("h-3 rounded-sm", ["w-40", "w-28", "w-52", "w-36", "w-44", "w-24", "w-32"][i])} />
            </div>
          ))}
        </div>
      </div>
    </PanelSkeleton>
  );
}

/**
 * 几行「标签：值」。**标签那一列按最长的那个词定宽**（两列的网格），不写死宽度：
 * 英文的「Uncached input」「Matched rule」比中文宽出一截，写死的宽度要么放不下、
 * 要么在中文里空出一大块。
 */
function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-4 gap-y-1.5", className)}>
      {children}
    </dl>
  );
}

/** 一行。`swatch`：标签前的色块，和图里那一段同色 */
function Row({ label, value, swatch }: { label: string; value: ReactNode; swatch?: string }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {swatch && <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", swatch)} />}
        {label}
      </dt>
      <dd className="min-w-0 break-all">{value}</dd>
    </>
  );
}

/** 四个数一排，和会话详情顶上那一排同一个样子 */
function Stat({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="min-w-0 border-l border-border px-3 py-2.5 first:border-l-0">
      <dt className="truncate tw-label text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate tw-num tw-head", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

/** 毫秒，千分位。和表格那一列一样写 `ms` */
const ms = (n: number) => `${Math.round(n).toLocaleString()}ms`;

/**
 * 时间线：首字节、总耗时、token、费用四个数，一条「等首字节 / 生成」的比例条，
 * 下面是这一条的身份和经过（上游、密钥、路径、转换、防护、状态、字节）。
 *
 * **TTFT 放在最显眼的位置。**对 AI 来说它才是体感的一切 —— 一眼看出慢在网络还是
 * 慢在模型。比例条回答的是同一件事：灰的那段是在等，蓝的那段是在生成。
 */
function Timeline({ d, state }: { d: RequestDetail; state: ReturnType<typeof stateOf> }) {
  const t = useText(requestDrawerText);
  const r = d.row;
  const running = state === "in_flight";
  const prompt =
    r.input_tokens != null ? r.input_tokens + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0) : undefined;
  const gen = r.duration_ms != null && r.ttfb_ms != null ? r.duration_ms - r.ttfb_ms : null;
  return (
    <div>
      <dl className="grid grid-cols-4 overflow-hidden rounded-lg border border-border">
        <Stat label={t.ttfb} value={r.ttfb_ms != null ? <AnimatedNumber value={r.ttfb_ms} format={ms} /> : "—"} muted={r.ttfb_ms == null} />
        <Stat
          label={t.totalTime}
          value={r.duration_ms != null ? <AnimatedNumber value={r.duration_ms} format={ms} /> : running ? t.inProgress : "—"}
          muted={r.duration_ms == null}
        />
        <Stat label={t.tokens} value={tokenPair(prompt, r.output_tokens ?? undefined)} muted={prompt == null} />
        <Stat label={t.cost} value={<CostText r={r} running={running} short />} muted={r.cost_micros == null} />
      </dl>
      {r.duration_ms != null && r.ttfb_ms != null && r.duration_ms > 0 && gen !== null && (
        <TimingBar ttfb={r.ttfb_ms} gen={Math.max(0, gen)} />
      )}

      <Rows className="mt-4">
        <Row label={t.generationTime} value={gen !== null ? ms(gen) : running ? t.inProgress : "—"} />
        <Row label={t.upstream} value={r.local ? t.answeredLocally : r.provider} />
        {/* 密钥是身份；应用是按请求头推测的，能伪造；来源是这条连接对面的
            地址，只有非本机来的才有 */}
        <Row label={t.client} value={<KeyLabel name={r.client} masked={r.key_masked} />} />
        {r.client_hint && (
          <Row
            label={t.app}
            value={
              <>
                {appLabel(r.client_hint)}
                <span className="text-muted-foreground">{t.guessed}</span>
              </>
            }
          />
        )}
        {r.peer && <Row label={t.peer} value={<span className="font-mono">{r.peer}</span>} />}
        <Row label={t.path} value={<span className="font-mono">{r.path}</span>} />
        {/* **转了就要看得见，丢了字段更要看得见** —— 「扩展思考开了却没
            生效」在客户端那头无从查起 */}
        {r.translated && (
          <>
            <Row
              label={t.conversion}
              value={
                // 格式名整体换行，不从单词中间断开
                <>
                  <span className="whitespace-nowrap">{formatLabel(r.translated.from)}</span>
                  {" → "}
                  <span className="whitespace-nowrap">{formatLabel(r.translated.to)}</span>
                </>
              }
            />
            {r.translated.dropped.length > 0 && (
              <Row
                label={t.dropped}
                value={
                  <span className="text-warning">
                    {/* 一个字段整体换行，不从路径中间断开 */}
                    {r.translated.dropped.map((f, i) => (
                      <span key={f}>
                        {i > 0 && t.listSep}
                        <span className="font-mono whitespace-nowrap">{f}</span>
                      </span>
                    ))}
                    <Tip text={t.droppedTip}>
                      <span className="ml-1 whitespace-nowrap underline decoration-dotted underline-offset-2">
                        {t.details}
                      </span>
                    </Tip>
                  </span>
                }
              />
            )}
          </>
        )}
        {/* 这次请求在各项防护上的全部命中：哪条规则、什么值、做了什么 */}
        {r.security && r.security.length > 0 && (
          <Row
            label={t.security}
            value={
              <span className="flex flex-col gap-1">
                {r.security.map((e) => (
                  <span key={e.id} className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span>{ruleName(e.guard, e.rule, e.custom)}</span>
                    {whereOf(e) && <span className="text-muted-foreground">· {whereOf(e)}</span>}
                    <span className="tw-label text-muted-foreground">
                      <EventDetail e={e} />
                    </span>
                    <ActionBadge action={e.action} />
                  </span>
                ))}
              </span>
            }
          />
        )}
        <Row
          label={t.status}
          value={
            r.error ? (
              <span className="text-destructive">{coreText(r.error)}</span>
            ) : r.cancelled ? (
              // 不是失败，不标红：上游没有出错，是客户端先断开了
              <span>
                {r.status ?? "—"} · {t.cancelled}
              </span>
            ) : running ? (
              // 响应头到了就有状态码，流还在往下走
              r.status != null ? `${r.status} · ${t.inProgress}` : t.inProgress
            ) : (
              (r.status ?? "—")
            )
          }
        />
        <Row label={t.bytes} value={r.bytes?.toLocaleString() ?? "—"} />
      </Rows>
    </div>
  );
}

/**
 * 首字节和生成的比例。**只画两段，不画刻度**：数字在上面那一排里，这里只要一眼看出
 * 时间花在哪一头。生成那段不到 1% 时也留 2px，免得看起来像没有生成。
 */
function TimingBar({ ttfb, gen }: { ttfb: number; gen: number }) {
  const t = useText(requestDrawerText);
  const total = Math.max(1, ttfb + gen);
  return (
    <div className="mt-3">
      <div
        role="img"
        aria-label={t.timingLabel(ms(ttfb), ms(gen))}
        className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
      >
        <span className="motion-bar rounded-l-full bg-chart-3" style={{ width: `${(ttfb / total) * 100}%` }} />
        <span className="motion-bar min-w-0.5 flex-1 rounded-r-full bg-chart-1" />
      </div>
      <div className="mt-1.5 flex items-center gap-4 tw-label text-muted-foreground">
        <Swatch className="bg-chart-3">{t.waiting}</Swatch>
        <Swatch className="bg-chart-1">{t.generating}</Swatch>
      </div>
    </div>
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
 * 费用那一项。**「没有价格」「不计费」「估算」各说各的**，和 0 不是一回事。
 * `short`：放在数字那一排里，只写数和记号，理由留给「用量」那一页。
 */
function CostText({ r, running, short }: { r: HistoryRow; running: boolean; short?: boolean }) {
  const t = useText(requestDrawerText);
  if (running) return <>{short ? "—" : t.usagePending}</>;
  if (r.billing === "free") {
    return <span className="text-muted-foreground">{short ? t.free : `${usd(0)} · ${t.free}`}</span>;
  }
  // 「没有价格」和「费用为 0」是两件事
  if (r.cost_micros == null) return <span className="text-muted-foreground">{short ? "—" : t.unpriced}</span>;
  if (!r.cost_estimated) return <>{usd(r.cost_micros)}</>;
  const why = r.cancelled ? t.estimatedCancelled : r.error ? t.estimatedInterrupted : t.estimated;
  if (short) {
    return (
      <Tip text={why}>
        <span className="underline decoration-dotted underline-offset-2">~{usd(r.cost_micros)}</span>
      </Tip>
    );
  }
  return (
    <span className="text-warning">
      ~{usd(r.cost_micros)} · {why}
    </span>
  );
}

/** 路由：命中的规则、经过的策略组、尝试链 */
function Routing({ r, running }: { r: HistoryRow; running: boolean }) {
  const t = useText(requestDrawerText);
  if (!r.routing) {
    return running ? (
      // 还没走完：尝试链在那一跳有了结果之后才有
      <p className="text-muted-foreground">{t.routingPending}</p>
    ) : (
      <p className="text-muted-foreground">
        {t.noRouting}
        <Tip text={t.noRoutingTip}>
          <span className="ml-1 underline decoration-dotted underline-offset-2">{t.possibleCauses}</span>
        </Tip>
      </p>
    );
  }
  const attempts = r.routing.attempts;
  return (
    <div className="space-y-4">
      {/* **「命中第 4 条」远不如「命中『带缓存的必须走官方』」有用** */}
      <Rows>
        <Row label={t.matchedRule} value={r.routing.rule} />
        {r.routing.group && <Row label={t.viaGroup} value={targetLabel(r.routing.group)} />}
      </Rows>
      <section>
        <h3 className="mb-2 tw-head text-foreground">{t.attempts}</h3>
        <ol className="overflow-hidden rounded-lg border border-border">
          {attempts.map((a, i) => {
            const outcome = attemptText(a);
            return (
              <li
                key={`${a.provider}-${i}`}
                className="flex items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
              >
                <span className="w-4 shrink-0 tw-num text-muted-foreground">{i + 1}</span>
                <span className="flex min-w-0 items-center gap-1.5 font-medium">
                  <UpstreamLogo name={a.provider} className="opacity-70" />
                  <span className="truncate">{a.provider}</span>
                </span>
                {/* **失败的原因要留着** —— 一条说「试过 A → B → C」的链和一条还说清
                    每一跳为什么失败的链，排查价值差得远 */}
                <StatusLabel tone={outcome.ok ? "ok" : "warn"} muted={outcome.ok} className="min-w-0 flex-1">
                  {outcome.text}
                </StatusLabel>
                <span className="shrink-0 tw-num text-muted-foreground">{ms(a.ms)}</span>
              </li>
            );
          })}
        </ol>
        {attempts.length > 1 && (
          // **用户能看见故障转移在替他工作，这是信任的来源**。一个静默切换过的请求和
          // 一次就成的请求，在他眼里应该是不同的
          <p className="mt-2 text-muted-foreground">{t.failover(attempts.length - 1)}</p>
        )}
      </section>
    </div>
  );
}

/**
 * 用量：几种 token、费用、价格来源。**没有用量、没有价格、估算，各说各的。**
 *
 * 三种输入各带一个色块，和概览的缓存构成条、会话详情的每轮输入同一套颜色。
 */
function Usage({ r, running }: { r: HistoryRow; running: boolean }) {
  const t = useText(requestDrawerText);
  if (running) {
    // 用量在结局里才到，费用在落库时才算
    return <p className="text-muted-foreground">{t.usagePending}</p>;
  }
  if (r.input_tokens == null) {
    return (
      <p className="text-muted-foreground">
        {r.cancelled ? (
          // 这时候不能说「上游没有报用量」—— 它还没来得及报，客户端就走了
          t.cancelledBeforeUsage
        ) : r.error ? (
          // 失败的请求没有用量，**不是上游吞掉了它** —— 请求没走到那一步
          t.failedBeforeUsage
        ) : (
          // **没有 usage 不是「用了 0」**
          <>
            {t.noUsage}
            <Tip text={t.noUsageTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">{t.details}</span>
            </Tip>
          </>
        )}
      </p>
    );
  }
  const read = r.cache_read_tokens ?? 0;
  const write = r.cache_write_tokens ?? 0;
  const prompt = r.input_tokens + read + write;
  return (
    <div className="space-y-4">
      {prompt > 0 && (
        <div
          role="img"
          aria-label={t.inputMix(read.toLocaleString(), r.input_tokens.toLocaleString(), write.toLocaleString())}
          className="flex h-1.5 gap-0.5 overflow-hidden rounded-full"
        >
          {read > 0 && <span className="motion-bar bg-cache-hit" style={{ width: `${(read / prompt) * 100}%` }} />}
          {r.input_tokens > 0 && (
            <span className="motion-bar bg-cache-plain" style={{ width: `${(r.input_tokens / prompt) * 100}%` }} />
          )}
          {write > 0 && <span className="motion-bar bg-cache-write" style={{ width: `${(write / prompt) * 100}%` }} />}
        </div>
      )}
      <Rows className="tw-num">
        <Row label={t.cacheReads} swatch="bg-cache-hit" value={read.toLocaleString()} />
        <Row label={t.input} swatch="bg-cache-plain" value={r.input_tokens.toLocaleString()} />
        <Row label={t.cacheWrites} swatch="bg-cache-write" value={write.toLocaleString()} />
        <Row label={t.output} value={(r.output_tokens ?? 0).toLocaleString()} />
        {/* 费用另起一段：上面是用了多少，这里是按什么价钱算出多少 */}
        <div aria-hidden className="col-span-2 my-1.5 border-t border-border" />
        <Row label={t.cost} value={<CostText r={r} running={false} />} />
        {r.price_source && <Row label={t.priceSource} value={priceSourceDetail(r.price_source)} />}
      </Rows>
    </div>
  );
}

/**
 * 一段 body。
 *
 * **长的默认折叠。**Claude Code 的 system prompt 有几千 token，展开会淹没一切 ——
 * 而点开这个浮层是为了看**这一次**发生了什么。
 */
function Body({
  b,
  title,
  pending = false,
}: {
  b: BodyView | null;
  title: string;
  /** 请求还在跑：没有它是因为还没到，不是过了保留期 */
  pending?: boolean;
}) {
  const t = useText(requestDrawerText);
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => (b ? prettyJson(b.text, b.truncated) : null), [b]);
  if (!b) {
    return (
      <section>
        <h3 className="tw-head text-foreground">{title}</h3>
        {pending ? (
          <p className="mt-1 text-muted-foreground">{t.afterEnd}</p>
        ) : (
          <p className="mt-1 text-muted-foreground">
            {t.notSaved}
            <Tip text={t.notSavedTip}>
              <span className="ml-1 underline decoration-dotted underline-offset-2">{t.details}</span>
            </Tip>
          </p>
        )}
      </section>
    );
  }
  // 折不折按原文算：排版加进来的空白不算内容
  const big = b.text.length > 2000;
  const text = pretty ?? b.text;
  const shown = open || !big ? text : text.slice(0, 2000);
  /*
    **`Collapsible` 而不是 `Accordion`。**请求和响应两段是各自独立的，要能同时展开
    对着看；Accordion 是「一组里只开一个」，那正好是这里不想要的行为。
  */
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex items-center gap-2">
        <h3 className="tw-head text-foreground">{title}</h3>
        <span className="tw-label tw-num text-muted-foreground">
          {t.size(b.original_len)}
          {/* **截断了要说出来。**不说的话用户会以为请求本身就这么长 */}
          {b.truncated && ` · ${t.truncated}`}
        </span>
        {big && (
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground">
              {open ? t.collapse : t.showAll}
            </Button>
          </CollapsibleTrigger>
        )}
      </div>
      <BodyText
        text={shown}
        json={pretty != null}
        more={big && !open}
        className="mt-2 max-h-80 rounded-lg border border-border bg-surface px-3 py-2.5"
      />
    </Collapsible>
  );
}

/**
 * 一段等宽的 body 正文。JSON 在 `prettyJson` 里排好，这里管折行。
 *
 * **折行对齐到本行的缩进。**长字符串（system prompt、工具说明）一折行就回到最左边，
 * 缩进表达的层级就被冲散了。所以一行一个块，用 padding 加负的 text-indent 做悬挂
 * 缩进 —— 行首的空格还是文字，复制出去缩进不丢。
 *
 * **JSON 按词折，原文见字就断。**SSE 那种 `data: {…}` 按词折会在冒号后面断开，
 * 第一行只剩一个 `data:`。
 */
function BodyText({
  text,
  json,
  more = false,
  className,
}: {
  text: string;
  json: boolean;
  /** 折叠着，后面还有 */
  more?: boolean;
  className?: string;
}) {
  const lines = useMemo(() => text.split("\n"), [text]);
  return (
    <pre
      className={cn(
        "overflow-auto font-mono tw-label leading-relaxed whitespace-pre-wrap text-foreground",
        json ? "wrap-anywhere" : "break-all",
        className,
      )}
    >
      {lines.map((line, i) => {
        const indent = Math.max(0, line.search(/[^ ]/));
        return (
          <span
            key={i}
            className="block"
            style={indent ? { paddingLeft: `${indent}ch`, textIndent: `-${indent}ch` } : undefined}
          >
            {i < lines.length - 1 ? line + "\n" : line}
          </span>
        );
      })}
      {more && <span className="block text-muted-foreground">…</span>}
    </pre>
  );
}

/**
 * 把这条请求原样发给另一个上游。
 *
 * 用途只有一个，但它是这个工具最常被需要的那一个：**这条请求走中转慢或者失败了，
 * 同样一条发给官方会怎么样？**手工复现一个 Claude Code 的请求几乎不可能 —— 那是
 * 几十 KB 的 system prompt 加一堆工具定义，而任何一处不同都会让对比失去意义。
 * 记录里正好有原样的那一份。
 *
 * **它会产生费用**，所以和测速一样是三步：选上游 → 看报价 → 点确认。中间那一步不能
 * 省 —— 发出之前必须显示预估的费用，而不是发了才知道。
 */
function Replay({ id, originalProvider }: { id: number; originalProvider: string }) {
  const t = useText(requestDrawerText);
  // 上游列表。取不到就在这里说、给「重试」—— 原来只弹一个 toast，下拉框就一直灰着
  const ov = useResource("overview", () => call("Overview", null), { events: ["config_reloaded"] });
  const names = ov.data?.providers.map((p) => p.name) ?? [];
  /** 选中的那个。没动过就是默认的那个：**和原来那次不同的**上游 —— 重放的价值在对比 */
  const [picked, setPicked] = useState<string | null>(null);
  const provider =
    picked !== null && names.includes(picked)
      ? picked
      : (names.find((n) => n !== originalProvider) ?? names[0] ?? "");
  const [quote, setQuote] = useState<ReplayQuote | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  /** 哪一步在等：报价，还是发送 */
  const [busy, setBusy] = useState<"quote" | "run" | null>(null);
  // 重放的响应体只留开头两万字，截了也不说；截断的 parse 不了，就原样显示
  const pretty = useMemo(() => (result ? prettyJson(result.body, false) : null), [result]);

  async function ask() {
    setBusy("quote");
    setResult(null);
    try {
      setQuote(await call("ReplayQuote", { id, provider }));
    } catch (e) {
      notify.error(e);
      setQuote(null);
    } finally {
      setBusy(null);
    }
  }

  async function go() {
    setBusy("run");
    try {
      setResult(await call("ReplayRun", { id, provider }));
      setQuote(null);
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground">
        {t.replayIntro((x) => <span className="font-medium text-foreground">{x}</span>)}
        <Tip text={t.asIsTip}>
          <span className="ml-1 underline decoration-dotted underline-offset-2">{t.asIs}</span>
        </Tip>
      </p>
      {ov.error !== undefined && !ov.data ? (
        <ErrorState
          compact
          title={t.upstreamsFailed}
          error={ov.error}
          onRetry={() => void ov.reload()}
          retrying={ov.loading}
        />
      ) : (
        <div className="flex items-center gap-2">
          <NativeSelect
            size="sm"
            value={provider}
            disabled={!ov.data}
            onChange={(e) => {
              setPicked(e.target.value);
              setQuote(null);
            }}
          >
            {names.map((n) => (
              <NativeSelectOption key={n} value={n}>
                {n}
                {n === originalProvider ? t.originalUpstream : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            size="sm"
            pending={busy === "quote"}
            disabled={busy !== null || !provider}
            onClick={() => void ask()}
          >
            {t.estimateCost}
          </Button>
        </div>
      )}

      {quote && (
        <div className="space-y-1 rounded-lg border border-border px-3 py-2.5 motion-fade">
          {/* **发出之前必须显示预估的费用**，而不是发了才知道 */}
          <p>{t.quote(<span className="font-medium">{quote.provider}</span>, quote.body_bytes, quote.input_tokens)}</p>
          <p className="font-medium tw-num">{quoteText(quote)}</p>
          {quote.will_redact && <p className="text-muted-foreground">{t.willRedact}</p>}
          <p className="tw-label text-muted-foreground">{t.pricingDate(quote.pricing_date)}</p>
          <div className="pt-2">
            <Button size="sm" pending={busy === "run"} disabled={busy !== null} onClick={() => void go()}>
              {t.confirmSend}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="rounded-lg border border-border px-3 pt-1 pb-3 motion-fade">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead />
                <TableHead className="text-right">{t.originalColumn(result.original.provider)}</TableHead>
                <TableHead className="text-right">{t.replayColumn(result.provider)}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tw-num">
              <Cmp label={t.status} a={result.original.status} b={result.status} />
              <Cmp label={t.ttfb} a={result.original.ttfb_ms} b={result.ttfb_ms} unit="ms" />
              <Cmp label={t.duration} a={result.original.duration_ms} b={result.duration_ms} unit="ms" />
              <Cmp label={t.bytes} a={result.original.bytes} b={result.bytes} />
            </TableBody>
          </Table>
          <BodyText
            text={pretty ?? result.body}
            json={pretty != null}
            className="mt-3 max-h-64 rounded-lg border border-border bg-surface px-3 py-2.5"
          />
        </div>
      )}
    </div>
  );
}

function Cmp({ label, a, b, unit = "" }: { label: string; a: number | null | undefined; b: number; unit?: string }) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell className="text-muted-foreground">{label}</TableCell>
      {/* **原来那次可能没有这个数**（失败的请求没有耗时）。写「—」而不是 0 */}
      <TableCell className="text-right">{a == null ? "—" : `${a.toLocaleString()}${unit}`}</TableCell>
      <TableCell className="text-right font-medium">
        {b.toLocaleString()}
        {unit}
      </TableCell>
    </TableRow>
  );
}
