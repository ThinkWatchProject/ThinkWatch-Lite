import { memo, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { size } from "@/format";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Reveal } from "@/ui/motion";
import { StatusLabel } from "@/ui/status-dot";
import type { LiveEnd, RequestDetail, TranscriptPart } from "@/types";
import {
  Args,
  BlockLine,
  Chip,
  Earlier,
  Fold,
  FoldRow,
  LINES,
  Line,
  Names,
  Pill,
  StillRow,
  TextFold,
} from "../Conversation";
import { conversationText } from "../Conversation.i18n";
import { argsPreview, blocksOf, clip, splitRestart, type ToolCall } from "../transcript";
import { contentText } from "./Content.i18n";
import { AnswerReader, readRequest, type ClientDialect } from "./dialect";
import { NotSaved } from "./Payload";
import { requestDrawerText } from "./RequestDrawer.i18n";
import { bodyText, type Body, type Hop } from "./wireModel";

/** 正文（说的话、思考）超过多少先收起，和会话的「对话」一样 */
const PROSE = { chars: 2000, lines: 40 };

/**
 * 「内容 › 解析」：客户端那一边的请求和回答，按对话的样子读出来 —— 和会话的「对话」同一套
 * 画法（`Conversation.tsx`）。
 *
 * - **请求**：系统提示、工具、此前的对话收起，最后一条用户消息（或者工具结果）摊开
 * - **回答**：在跑时边收边显示 —— 正文逐字出现、末尾一个光标，思考和工具调用的参数也实时长出来；
 *   请求结束后是存下的那一份，同一个样子
 *
 * 回答按段增量读（`AnswerReader`），没长的块是同一个对象，只有正在长的那一块重画。
 */
export function Parsed({
  request,
  response,
  dialect,
  d,
  end,
}: {
  request: Hop;
  response: Hop;
  dialect: ClientDialect | null;
  d: RequestDetail;
  /** 实时内容里的 `end`：请求怎么收的场。存下的详情里在 `d.row` */
  end: LiveEnd | null;
}) {
  const t = useText(contentText);
  const req = request.body.kind === "body" ? request.body.body : null;
  const text = req ? bodyText(req) : null;
  const read = useMemo(() => (text !== null && dialect ? readRequest(dialect, text) : null), [text, dialect]);
  // 结果那一行写「Read 的结果」：调用 id → 工具名，在请求里的历史上
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const msg of read?.messages ?? []) for (const p of msg.parts) if (p.kind === "tool_call") m.set(p.id, p.name);
    return m;
  }, [read]);

  return (
    <Names.Provider value={names}>
      <div className="flex flex-col gap-4">
        <section>
          <Head title={t.request}>
            {req && (
              <span className="tw-label tw-num text-muted-foreground">
                {[
                  size(req.bytes),
                  read ? t.messages(read.messages.length) : null,
                  read && read.tools.length > 0 ? t.tools(read.tools.length) : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            )}
          </Head>
          <div className="mt-2">
            <RequestPart hop={request} body={req} read={read} dialect={dialect} at={d.row.at_ms} />
          </div>
        </section>
        <div aria-hidden className="h-px bg-border" />
        <AnswerPart hop={response} dialect={dialect} d={d} end={end} />
      </div>
    </Names.Provider>
  );
}

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex min-h-6 items-center gap-2">
      <h3 className="tw-head text-foreground">{title}</h3>
      {children}
    </div>
  );
}

function RequestPart({
  hop,
  body,
  read,
  dialect,
  at,
}: {
  hop: Hop;
  body: Body | null;
  read: ReturnType<typeof readRequest>;
  dialect: ClientDialect | null;
  at: number;
}) {
  const t = useText(contentText);
  const c = useText(conversationText);
  const split = useMemo(() => (read ? splitRestart(read.messages) : null), [read]);
  const blocks = useMemo(() => (split ? blocksOf(split.latest) : []), [split]);
  // 还没到的（实时内容接上之前的那一会儿）什么都不写：马上就到
  if (!body) return hop.body.kind === "pending" ? null : <NotSaved which="request" at={at} />;
  if (!dialect) return <Pill>{t.unknownFormat}</Pill>;
  if (!read || !split) return <Pill>{body.truncated ? t.requestCut : t.requestUnreadable}</Pill>;
  return (
    <div className={LINES}>
      {read.system !== null && (
        <Line label={c.system}>
          <TextFold title={c.systemPrompt} text={read.system} />
        </Line>
      )}
      {read.tools.length > 0 && (
        <Line label={t.toolsLabel}>
          <Tools names={read.tools} />
        </Line>
      )}
      {split.earlier.length > 0 && <Earlier messages={split.earlier} />}
      {blocks.map((b, i) => (
        <BlockLine key={i} b={b} />
      ))}
    </div>
  );
}

/** 声明的工具：几个，名字连成一行；点开是全部名字 */
function Tools({ names }: { names: readonly string[] }) {
  const t = useText(contentText);
  const list = names.join(", ");
  return (
    <Fold
      head={
        <>
          <span className="shrink-0 text-foreground">{t.tools(names.length)}</span>
          <span className="min-w-0 truncate font-mono tw-label">{list}</span>
        </>
      }
    >
      <p className="rounded-lg border border-border bg-surface px-3 py-2.5 font-mono tw-label leading-relaxed wrap-anywhere">
        {list}
      </p>
    </Fold>
  );
}

/**
 * 一份回答增量地读成几块：每次只读新来的那几段（`chunks` 是就地长的数组）。同一段又发了一遍
 * （换了一个数组）就从头读
 */
function useAnswer(dialect: ClientDialect | null, body: Body | null) {
  const st = useRef<{ reader: AnswerReader; chunks: readonly string[]; dialect: ClientDialect; fed: number } | null>(
    null,
  );
  const n = body?.chunks.length ?? 0;
  const growing = body?.growing ?? false;
  const chunks = body?.chunks ?? null;
  return useMemo(() => {
    if (!dialect || !chunks) return null;
    let s = st.current;
    if (!s || s.chunks !== chunks || s.dialect !== dialect) {
      s = { reader: new AnswerReader(dialect), chunks, dialect, fed: 0 };
      st.current = s;
    }
    // 读过的不再读：StrictMode 下这里跑两遍也只读一次
    while (s.fed < n) s.reader.push(chunks[s.fed++]!);
    return { parts: s.reader.parts(!growing), recognized: s.reader.recognized };
  }, [dialect, chunks, n, growing]);
}

function AnswerPart({
  hop,
  dialect,
  d,
  end,
}: {
  hop: Hop;
  dialect: ClientDialect | null;
  d: RequestDetail;
  end: LiveEnd | null;
}) {
  const t = useText(contentText);
  const c = useText(conversationText);
  const r = useText(requestDrawerText);
  const body = hop.body.kind === "body" ? hop.body.body : null;
  const answer = useAnswer(dialect, body);
  // 回答的报文头到了、正文还没到：已经在收了
  const streaming = body?.growing ?? (hop.body.kind === "pending" && hop.head !== null);
  const parts = answer?.parts ?? [];
  // 空的文字块不画（位置留着，见 `AnswerReader.parts`）
  const shown = parts.some((p) => p.kind !== "text" || p.text !== "");
  const row = d.row;
  // 结局：实时的看 `end`，存下的看记录
  const failed = end ? end.outcome === "failed" : !d.in_flight && row.error !== null && !row.cancelled;
  const cancelled = end ? end.outcome === "cancelled" : !d.in_flight && row.cancelled;
  const aborted = end?.outcome === "aborted";
  const failure = row.error ? coreText(row.error) : null;
  const notes: { key: string; text: string; error?: boolean }[] = [];
  if (failed && failure) notes.push({ key: "failed", text: failure, error: true });
  else if (aborted) notes.push({ key: "aborted", text: r.aborted });
  if (cancelled) notes.push({ key: "cancelled", text: c.responseCancelled });
  if (body?.truncated) notes.push({ key: "cut", text: c.responseTruncated });

  // 在收、还没有一个字：助手那一行只有光标
  const justStarted = (
    <div className={LINES}>
      <Line label={c.assistant}>
        <p className="pt-0.5">
          <Caret />
        </p>
      </Line>
    </div>
  );
  let content: ReactNode;
  if (!body) {
    content =
      hop.body.kind === "pending" ? (
        streaming ? (
          justStarted
        ) : (
          <p className="text-muted-foreground">{t.waiting}</p>
        )
      ) : failed || cancelled || aborted ? null : (
        <NotSaved which="response" at={row.at_ms} />
      );
  } else if (!dialect) {
    content = <Pill>{t.unknownFormat}</Pill>;
  } else if (!shown) {
    content = streaming ? justStarted : failed ? null : <Pill>{answer?.recognized ? t.noAnswer : t.responseUnreadable}</Pill>;
  } else {
    content = (
      <div className={LINES}>
        <Line label={c.assistant}>
          <div className="flex flex-col gap-1">
            {parts.map((p, i) => (
              <AnswerBlock key={i} p={p} live={streaming && i === parts.length - 1} streaming={streaming} />
            ))}
          </div>
        </Line>
      </div>
    );
  }

  return (
    <section>
      <Head title={t.response}>
        {streaming && (
          <StatusLabel tone="pending" className="tw-label font-medium">
            {t.receiving}
          </StatusLabel>
        )}
        {body && (
          <span className="tw-label tw-num text-muted-foreground">
            {[!streaming && !d.in_flight && row.output_tokens != null ? t.outputTokens(row.output_tokens) : null, size(body.bytes)]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </Head>
      {content && <div className="mt-2">{content}</div>}
      {notes.length > 0 && (
        // 有回答的，说明排在回答那一列下面；没有的顶着左边
        <div className={cn("mt-2 flex flex-col items-start gap-1", shown && "pl-[calc(2.75rem+0.75rem)] [&:lang(en)]:pl-[calc(4rem+0.75rem)]")}>
          {notes.map((n) => (
            <Pill key={n.key} tone={n.error ? "error" : "gap"}>
              {n.text}
            </Pill>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * 回答里的一块。`live`：正在长的就是它（最后一块，回答还在收）。**`memo`**：没长的块还是同一个
 * 对象，不重画
 */
const AnswerBlock = memo(function AnswerBlock({
  p,
  live,
  streaming,
}: {
  p: TranscriptPart;
  live: boolean;
  streaming: boolean;
}) {
  switch (p.kind) {
    case "text":
      return p.text === "" && !live ? null : <AnswerText text={p.text} live={live} streaming={streaming} />;
    case "thinking":
      return <AnswerThinking text={p.text} live={live} streaming={streaming} />;
    case "tool_call":
      return <AnswerToolCall p={p} live={live} streaming={streaming} />;
    case "tool_result":
    case "image":
    case "other":
      return (
        <div className="flex flex-wrap gap-1.5 py-0.5">
          <Chip p={p} />
        </div>
      );
  }
});

/** 正文里的一个光标：回答还在长。系统里关了动效就不闪 */
function Caret() {
  return <span aria-hidden className="motion-caret" />;
}

/**
 * 一段长的字切成几块画，**切口只看位置**：字只往后长，前面那几块的字不会再变，`memo` 着不重画，
 * 每一帧只有最后一块换新的字。切口不落在一个字的两半中间（代理对）
 */
const SLICE = 4096;
function slices(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length) {
    let end = Math.min(text.length, at + SLICE);
    if (end < text.length) {
      const c = text.charCodeAt(end - 1);
      if (c >= 0xd800 && c <= 0xdbff) end -= 1;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

const Slice = memo(function Slice({ text }: { text: string }) {
  return <span>{text}</span>;
});

/** 一段在长的字：切成几块（`slices`），末尾跟着光标 */
function Growing({ text, live }: { text: string; live: boolean }) {
  const parts = useMemo(() => slices(text), [text]);
  return (
    <>
      {parts.map((s, i) => (
        <Slice key={i} text={s} />
      ))}
      {live && <Caret />}
    </>
  );
}

/**
 * 回答的正文：原样的空白和换行，不当 Markdown。**收到时就在看的，不收起**：读到一半折回开头
 * 没有道理；之后点开的长回答照常先显示开头
 */
function AnswerText({ text, live, streaming }: { text: string; live: boolean; streaming: boolean }) {
  const c = useText(conversationText);
  const [all, setAll] = useState(streaming);
  // 还在长的不收：读到哪儿算哪儿
  const head = useMemo(() => (streaming ? null : clip(text, PROSE)), [streaming, text]);
  const cut = head !== null && !all;
  return (
    <div>
      <p className="pt-0.5 whitespace-pre-wrap wrap-break-word text-foreground">
        <Growing text={cut ? head : text} live={live} />
        {cut && <span className="text-muted-foreground"> …</span>}
      </p>
      {head !== null && (
        <Button variant="ghost" size="xs" className="mt-0.5 -ml-2 text-muted-foreground" onClick={() => setAll((a) => !a)}>
          {all ? c.collapse : c.showAll}
        </Button>
      )}
    </div>
  );
}

/**
 * 思考。**收到时就在看的是展开的**，字一边到一边长；之后点开的照常收起。只有签名没有正文的，说
 * 上游没给
 */
function AnswerThinking({ text, live, streaming }: { text: string; live: boolean; streaming: boolean }) {
  const c = useText(conversationText);
  const [open, setOpen] = useState(streaming);
  if (text.trim() === "" && !live) {
    return (
      <StillRow>
        <span className="shrink-0 text-foreground">{c.thinking}</span>
        <span className="min-w-0 truncate">{c.thinkingHidden}</span>
      </StillRow>
    );
  }
  return (
    <div>
      <FoldRow open={open} onToggle={() => setOpen((o) => !o)} meta={c.chars(text.length)}>
        <span className="truncate text-foreground">{c.thinking}</span>
      </FoldRow>
      <Reveal show={open}>
        <div className="pt-1 pb-1.5">
          <div className="ml-[5px] border-l-2 border-border pl-3">
            <AnswerText text={text} live={live} streaming={streaming} />
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/**
 * 工具调用：名字和参数的提要一行。**收到时就在看的是展开的**，参数原样一个字一个字长出来；收齐了
 * 排成 JSON
 */
function AnswerToolCall({ p, live, streaming }: { p: ToolCall; live: boolean; streaming: boolean }) {
  const [open, setOpen] = useState(streaming);
  const preview = useMemo(() => argsPreview(p.input), [p.input]);
  return (
    <div>
      <FoldRow open={open} onToggle={() => setOpen((o) => !o)}>
        <span className="shrink-0 font-medium text-foreground">{p.name}</span>
        {preview && <span className="min-w-0 truncate font-mono tw-label">{preview}</span>}
      </FoldRow>
      <Reveal show={open}>
        <div className="pt-1 pb-1.5">{live ? <LiveArgs text={p.input} /> : <Args input={p.input} />}</div>
      </Reveal>
    </div>
  );
}

/** 还在长的参数：原样（半截的 JSON 排不了版），框子自己滚、跟着最后一行 */
function LiveArgs({ text }: { text: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const atEnd = useRef(true);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
      }}
      className={cn(
        "max-h-80 overflow-auto rounded-lg border border-border bg-surface px-3 py-2.5",
        "font-mono tw-label leading-relaxed whitespace-pre-wrap text-foreground wrap-anywhere",
      )}
    >
      <Growing text={text} live />
    </pre>
  );
}

