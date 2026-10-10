import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { ChevronRightIcon } from "lucide-react";
import { size } from "@/format";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { cn } from "@/lib/utils";
import { prettyJson } from "@/prettyJson";
import { SourceDiff } from "@/plugins/parts";
import { Button } from "@/ui/button";
import { copyText } from "@/ui/notify";
import { Segmented } from "@/ui/segmented";
import { StatusLabel } from "@/ui/status-dot";
import type { BodyView, HeadView } from "@/types";
import { contentText } from "./Content.i18n";
import { BodyText, NotSaved } from "./Payload";
import { requestDrawerText } from "./RequestDrawer.i18n";
import { bodyText, type Body, type Hop, type Side } from "./wireModel";

/** 请求体超过多少字先只排开头，「展开全部」再排其余 */
const FOLD = 2000;
/** 流的回答默认显示最后多少个事件，再早的收起 */
const RECENT_EVENTS = 200;
/** 事件按多少段一块画：前面几块的字不会再变，`memo` 着不重画 */
const BLOCK = 48;

/**
 * 「内容 › 原始报文」：一段报文原样 —— 请求行、头、正文；回答的状态行、头，和流里的每一个事件
 * 往下追加。等宽，和请求详情原来的正文同一个样子（`BodyText`）。
 *
 * **跟随最新**（`follow`）：回答在长时，回答那一框停在最底下；往上翻就停下（`onUserScroll`），
 * 翻回最底下接着跟。
 */
export function Raw({
  side,
  at,
  pending,
  follow,
  onUserScroll,
  plugin,
  picker,
}: {
  side: Side;
  /** 这条请求开始的时刻：正文不在时说是不是过了保留期限 */
  at: number;
  /** 请求还在跑 */
  pending: boolean;
  follow: boolean;
  /** 用户自己滚了回答那一框：`atEnd` 是滚到了最底下 */
  onUserScroll: (atEnd: boolean) => void;
  /** 上游一侧回答那一跳的请求：插件改写过的，能和客户端发来的原样对比 */
  plugin?: { original: BodyView; after: BodyView; sentBy: string | null } | null;
  /** 上游一侧试过不止一跳时，选哪一跳 */
  picker?: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {picker}
      <RequestBox hop={side.request} at={at} pending={pending} plugin={plugin ?? null} />
      <ResponseBox hop={side.response} at={at} pending={pending} follow={follow} onUserScroll={onUserScroll} />
    </div>
  );
}

/** 报文头的几行：请求行（状态行）加粗，头的名字淡一些 */
function HeadLines({ head }: { head: HeadView }) {
  return (
    <div className="break-all whitespace-pre-wrap">
      <div className="font-semibold text-foreground">{head.line}</div>
      {head.headers.map(([k, v], i) => (
        <div key={i}>
          <span className="text-muted-foreground">{k}:</span> {v}
        </div>
      ))}
    </div>
  );
}

/** 一段报文写成纯文本：复制用 */
function plain(head: HeadView | null, body: string | null): string {
  const lines = head ? [head.line, ...head.headers.map(([k, v]) => `${k}: ${v}`)] : [];
  const top = lines.join("\n");
  if (body === null) return top;
  return top ? `${top}\n\n${body}` : body;
}

function CopyAll({ text }: { text: () => string }) {
  const common = useText(commonText);
  return (
    <Button variant="ghost" size="xs" className="ml-auto text-muted-foreground" onClick={() => void copyText(text())}>
      {common.copy}
    </Button>
  );
}

/** 等宽的那一框 */
const BOX = "overflow-auto rounded-lg border border-border bg-surface px-3 py-2.5 font-mono tw-label leading-relaxed";

/** 正文为什么不在：一句淡的话，接在报文头下面 */
function Missing({ hop, at, which, pending }: { hop: Hop; at: number; which: "request" | "response"; pending: boolean }) {
  const t = useText(contentText);
  const r = useText(requestDrawerText);
  const say = (s: string) => <p className="font-sans text-muted-foreground">{s}</p>;
  switch (hop.body.kind) {
    case "body":
      return null;
    case "same":
      return say(t.sameAsClient);
    case "after_plugins":
      return say(t.afterPluginsLater);
    case "not_kept":
      return say(t.attemptNotKept);
    case "pending":
      return which === "response" && pending ? say(hop.head ? r.afterEnd : t.waiting) : null;
    case "not_saved":
      return (
        <div className="font-sans">
          <NotSaved which={which} at={at} />
        </div>
      );
  }
}

function RequestBox({
  hop,
  at,
  pending,
  plugin,
}: {
  hop: Hop;
  at: number;
  pending: boolean;
  plugin: { original: BodyView; after: BodyView; sentBy: string | null } | null;
}) {
  const t = useText(contentText);
  const r = useText(requestDrawerText);
  const body = hop.body.kind === "body" ? hop.body.body : null;
  const text = body ? bodyText(body) : null;
  const truncated = body?.truncated ?? false;
  // 按字和截没截断记：实时的那一份每一帧都是一个新的 `body` 对象，字却没变
  const pretty = useMemo(() => (text !== null ? prettyJson(text, truncated) : null), [text, truncated]);
  const [open, setOpen] = useState(false);
  // 插件改写过的：默认看改了哪里，和原来「内容」那一页一样
  const [view, setView] = useState<"compare" | "after">("compare");
  const diff = useMemo(
    () =>
      plugin && view === "compare"
        ? {
            before: prettyJson(plugin.original.text, plugin.original.truncated) ?? plugin.original.text,
            after: prettyJson(plugin.after.text, plugin.after.truncated) ?? plugin.after.text,
          }
        : null,
    [plugin, view],
  );
  const shown = pretty ?? text ?? "";
  const big = shown.length > FOLD;
  return (
    <section className="flex shrink-0 flex-col gap-2">
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="tw-head text-foreground">{t.request}</h3>
        {body && (
          <span className="tw-label tw-num text-muted-foreground">
            {size(body.bytes)}
            {body.truncated && ` · ${r.truncated}`}
          </span>
        )}
        {plugin && (
          <Segmented<"compare" | "after">
            label={t.request}
            value={view}
            options={[
              { id: "compare", label: r.payloadViews.compare },
              { id: "after", label: r.payloadViews.after },
            ]}
            onChange={setView}
          />
        )}
        {big && !diff && (
          <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setOpen((o) => !o)}>
            {open ? r.collapse : r.showAll}
          </Button>
        )}
        <CopyAll text={() => plain(hop.head, text)} />
      </div>
      {plugin?.sentBy && <p className="-mt-1 tw-label text-muted-foreground">{plugin.sentBy}</p>}
      {diff ? (
        <SourceDiff before={diff.before} after={diff.after} className="max-h-72" />
      ) : (
        <div className={cn(BOX, "max-h-56")}>
          {hop.head ? (
            <HeadLines head={hop.head} />
          ) : (
            pending && <p className="font-sans text-muted-foreground">{t.noHead}</p>
          )}
          {(hop.head || pending) && (body || hop.body.kind !== "pending") && <div aria-hidden className="h-4" />}
          {body ? (
            <BodyText text={open || !big ? shown : shown.slice(0, FOLD)} json={pretty !== null} more={big && !open} />
          ) : (
            <Missing hop={hop} at={at} which="request" pending={pending} />
          )}
        </div>
      )}
    </section>
  );
}

/** 回答的正文是哪一种：整包的 JSON，还是一个一个事件的流 */
function isJson(b: Body): boolean {
  const first = b.chunks[0];
  return first !== undefined && /^\s*[[{]/.test(first);
}

function ResponseBox({
  hop,
  at,
  pending,
  follow,
  onUserScroll,
}: {
  hop: Hop;
  at: number;
  pending: boolean;
  follow: boolean;
  onUserScroll: (atEnd: boolean) => void;
}) {
  const t = useText(contentText);
  const r = useText(requestDrawerText);
  const body = hop.body.kind === "body" ? hop.body.body : null;
  const growing = body?.growing ?? false;
  const json = body ? isJson(body) : false;
  const box = useRef<HTMLDivElement>(null);
  const log = useEvents(body && !json ? body : null);

  // 跟着最新的：每次长了都停到最底下
  useLayoutEffect(() => {
    const el = box.current;
    if (el && follow && growing) el.scrollTop = el.scrollHeight;
  });

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex min-h-6 items-center gap-2">
        <h3 className="tw-head text-foreground">{t.response}</h3>
        {growing && (
          <StatusLabel tone="pending" className="tw-label font-medium">
            {t.receiving}
          </StatusLabel>
        )}
        {body && (
          <span className="tw-label tw-num text-muted-foreground">
            {size(body.bytes)}
            {log && log.total > 0 && ` · ${t.events(log.total)}`}
            {body.truncated && ` · ${r.truncated}`}
          </span>
        )}
        <CopyAll text={() => plain(hop.head, body ? bodyText(body) : null)} />
      </div>
      <div
        ref={box}
        className={cn(BOX, "min-h-32 flex-1")}
        onScroll={(e) => {
          const el = e.currentTarget;
          onUserScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 8);
        }}
      >
        {hop.head ? (
          <HeadLines head={hop.head} />
        ) : !pending || hop.body.kind !== "pending" ? null : (
          <p className="font-sans text-muted-foreground">{t.waiting}</p>
        )}
        {hop.head && (body || hop.body.kind !== "pending") && <div aria-hidden className="h-4" />}
        {body ? (
          json ? (
            <JsonBody body={body} />
          ) : (
            log && <EventLog log={log} scroller={box} />
          )
        ) : (
          (hop.head || hop.body.kind !== "pending") && <Missing hop={hop} at={at} which="response" pending={pending} />
        )}
        {growing && <span aria-hidden className="motion-caret" />}
      </div>
    </section>
  );
}

/** 整包的回答：排好的 JSON，长的先排开头 */
function JsonBody({ body }: { body: Body }) {
  const r = useText(requestDrawerText);
  const text = bodyText(body);
  const pretty = useMemo(() => prettyJson(text, body.truncated), [text, body.truncated]);
  const [open, setOpen] = useState(false);
  const shown = pretty ?? text;
  const big = shown.length > FOLD;
  return (
    <>
      <BodyText text={open || !big ? shown : shown.slice(0, FOLD)} json={pretty !== null} more={big && !open} />
      {big && (
        <Button variant="ghost" size="xs" className="mt-1 -ml-2 font-sans text-muted-foreground" onClick={() => setOpen((o) => !o)}>
          {open ? r.collapse : r.showAll}
        </Button>
      )}
    </>
  );
}

/**
 * 流的回答一段一段（实时的：core 按事件的边界一段一段发，一段是一个或几个事件；存下的：按空行
 * 切开）。每段有几个事件记着，只数新来的那几段
 */
interface Events {
  pieces: readonly string[];
  /** 每段几个事件 */
  counts: number[];
  total: number;
}

function eventsIn(s: string): number {
  let n = 0;
  for (let i = s.indexOf("\n\n"); i >= 0; i = s.indexOf("\n\n", i + 2)) n++;
  return Math.max(1, n);
}

function useEvents(body: Body | null): Events | null {
  const cache = useRef<{ chunks: readonly string[]; pieces: readonly string[]; counts: number[]; total: number } | null>(
    null,
  );
  const n = body?.chunks.length ?? 0;
  const chunks = body?.chunks ?? null;
  const growing = body?.growing ?? false;
  return useMemo(() => {
    if (!chunks) return null;
    let c = cache.current;
    if (!c || c.chunks !== chunks) {
      // 存下的只有一段：按空行切成一个一个事件。实时的就是收到的那几段
      const pieces = !growing && chunks.length === 1 ? chunks[0]!.split(/(?<=\n\n)/) : chunks;
      c = { chunks, pieces, counts: [], total: 0 };
      cache.current = c;
    }
    while (c.counts.length < c.pieces.length) {
      const k = eventsIn(c.pieces[c.counts.length]!);
      c.counts.push(k);
      c.total += k;
    }
    return { pieces: c.pieces, counts: c.counts, total: c.total };
    // `n`：数组就地长了几段
  }, [chunks, n, growing]);
}

/**
 * 流里的事件。**默认只画最后 `RECENT_EVENTS` 个**，前面的收起成一行（几 MB 的流全画出来，每长
 * 一段都要重排一遍）；点开画全部。按 `BLOCK` 段一块画，前面几块不重画
 */
function EventLog({ log, scroller }: { log: Events; scroller: RefObject<HTMLDivElement | null> }) {
  const t = useText(contentText);
  const [all, setAll] = useState(false);
  let from = 0;
  if (!all) {
    let shown = 0;
    let i = log.pieces.length;
    while (i > 0 && shown < RECENT_EVENTS) shown += log.counts[--i]!;
    // 对齐到块的边界：前面那几块的字就不会跟着变
    from = Math.floor(i / BLOCK) * BLOCK;
  }
  let hidden = 0;
  for (let i = 0; i < from; i++) hidden += log.counts[i]!;
  const blocks: { start: number; text: string }[] = [];
  for (let s = from; s < log.pieces.length; s += BLOCK) {
    blocks.push({ start: s, text: log.pieces.slice(s, s + BLOCK).join("") });
  }
  return (
    <>
      {hidden > 0 && (
        <button
          type="button"
          className="-mx-1 mb-1 flex items-center gap-1 rounded px-1 font-sans text-muted-foreground transition-colors duration-(--motion-fast) hover:bg-muted hover:text-foreground"
          onClick={() => {
            // 展开时留在原来看的那一处：前面多出来的高度补到滚动上
            const el = scroller.current;
            const before = el ? el.scrollHeight - el.scrollTop : 0;
            setAll(true);
            requestAnimationFrame(() => {
              if (el) el.scrollTop = el.scrollHeight - before;
            });
          }}
          title={t.showEarlierEvents}
        >
          <ChevronRightIcon className="size-3.5" />
          {t.earlierEvents(hidden)}
        </button>
      )}
      <pre className="break-all whitespace-pre-wrap text-foreground">
        {blocks.map((b) => (
          <EventBlock key={b.start} text={b.text} />
        ))}
      </pre>
    </>
  );
}

/** 一块事件：`event:`、`data:` 这些字段名淡一些，注释行整行淡 */
const EventBlock = memo(function EventBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const nl = i < lines.length - 1 ? "\n" : "";
        if (line.startsWith(":")) {
          return (
            <span key={i} className="text-muted-foreground">
              {line + nl}
            </span>
          );
        }
        const c = line.indexOf(":");
        if (c > 0 && c < 12 && /^[a-z]+$/.test(line.slice(0, c))) {
          return (
            <span key={i}>
              <span className="text-muted-foreground">{line.slice(0, c + 1)}</span>
              {line.slice(c + 1) + nl}
            </span>
          );
        }
        return <span key={i}>{line + nl}</span>;
      })}
    </>
  );
});
