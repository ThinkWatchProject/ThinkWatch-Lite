import { useCallback, useEffect, useRef, useState } from "react";
import { subscribe } from "@/lib/tauriEvent";
import { call } from "@/control";
import { useText } from "@/i18n";
import { cn } from "@/lib/utils";
import { statusTone, when } from "@/format";
import { focusSelf } from "@/ui/dialog-focus";
import { UpstreamLogo } from "@/ui/logos";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/sheet";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { KeyLabel } from "@/KeyLabel";
import { notSentText, probeLabel } from "@/labels";
import { notSent } from "@/requestRouting";
import type { CoreEvent, HistoryRow, RequestDetail } from "@/types";
import { NotSentIcon } from "../cells";
import { PanelHeader, PanelHeaderSkeleton, PanelSkeleton } from "../PanelHeader";
import { stateOf, type DrawerState } from "./parts";
import { Body, RequestBody } from "./Payload";
import { Replay } from "./Replay";
import { requestDrawerText } from "./RequestDrawer.i18n";
import { Routing } from "./Routing";
import { Timeline } from "./Timeline";
import { Usage } from "./Usage";

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
        onOpenAutoFocus={focusSelf}
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
    const un = subscribe<CoreEvent>("core-event", (e) => {
      const ev = e.payload;
      const mine =
        (ev.kind === "request_headers" ||
          ev.kind === "request_first_token" ||
          ev.kind === "request_routed" ||
          ev.kind === "request_priced") &&
        ev.id === id;
      // 事件流丢过事件的话，结局可能就在里面
      if (mine || ev.kind === "events_dropped") void load(() => alive);
    });
    return () => {
      alive = false;
      un();
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
  const sent = notSent(r);
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="flex min-h-0 flex-1 flex-col gap-0">
      <PanelHeader
        // 本地应答的没有模型，路径是辅助请求的类别：标题写类别的名字
        title={r.model || (r.local ? probeLabel(r.path) : t.requestNo(id))}
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
        {/* 没有发往任何上游的（被规则拒绝、选中的上游一个都接不了）上游是空的：写是哪一种，
            图形和流量表那一格一样 */}
        {sent ? (
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <NotSentIcon kind={sent} />
            <span className="truncate">{notSentText(sent)}</span>
          </span>
        ) : (
          (r.local || r.provider) && (
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {!r.local && <UpstreamLogo name={r.provider} className="opacity-70" />}
              <span className="truncate">{r.local ? t.answeredLocally : r.provider}</span>
            </span>
          )
        )}
        <span className="min-w-0 truncate">
          <KeyLabel name={r.client} masked={r.key_masked} />
        </span>
      </PanelHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 pb-6 tw-body">
        <TabsContent value="timeline">
          <Timeline d={d} state={state} />
        </TabsContent>
        <TabsContent value="routing">
          <Routing r={r} plugins={d.plugins} running={running} />
        </TabsContent>
        <TabsContent value="payload">
          <div className="space-y-5">
            <RequestBody d={d} />
            <Body b={d.response_body} title={t.response} which="response" at={r.at_ms} pending={running} />
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
function HeadStatus({ r, state }: { r: HistoryRow; state: DrawerState }) {
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
  state: DrawerState,
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
