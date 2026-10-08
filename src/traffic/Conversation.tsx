import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronRightIcon, ImageIcon } from "lucide-react";
import { call } from "@/control";
import { size, when } from "@/format";
import { useText } from "@/i18n";
import { forget, useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { prettyJson } from "@/prettyJson";
import { BodyText } from "./drawer/Payload";
import type {
  RequestRow,
  Transcript,
  TranscriptMessage,
  TranscriptPart,
  TranscriptRole,
  TranscriptTurn,
  TurnView,
} from "@/types";
import { useNow } from "@/useNow";
import { Button, DISCLOSURE } from "@/ui/button";
import { Reveal } from "@/ui/motion";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, ErrorState } from "@/ui/states";
import { StatusLabel } from "@/ui/status-dot";
import { IconSession } from "@/ui/icons";
import { PanelSkeleton } from "./PanelHeader";
import { sessionsText } from "./Sessions.i18n";
import { conversationText } from "./Conversation.i18n";
import { turnCost } from "./costCell";
import {
  allLost,
  askFrom,
  extendTranscript,
  argsPreview,
  blocksOf,
  clip,
  failureLine,
  idKey,
  items,
  keepTurns,
  missingWhy,
  notesOf,
  outcomeOf,
  quiet,
  requestIdOf,
  splitRestart,
  toolNames,
  unrecorded,
  viewsById,
  visibleParts,
  type Block,
  type Missing,
  type Note,
  type Outcome,
  type ToolCall,
  type ToolResult,
} from "./transcript";

/** 第一次画多少轮，够铺满一屏还有富余；其余的一批一批补上（见 `useProgressive`） */
const FIRST_PAINT = 30;
const CHUNK = 40;

/** 正文（用户、助手说的话，思考，系统提示）超过多少先收起 */
const PROSE = { chars: 2000, lines: 40 };
/** 等宽的那几样（工具参数、工具结果）：框子自己会滚，收的是画进页面的量 */
const MONO = { chars: 12_000, lines: 300 };

/** 保留期限按天算，判断正文为什么不在（`missingWhy`）用的时刻一小时更新一次就够 */
const HOUR_MS = 3_600_000;

/**
 * 左边一列写这一块是谁说的，右边是内容。**列宽固定**：每一轮各自按内容定宽的话，
 * 几十轮读下来左边那一列忽宽忽窄。宽度按语言定（`:lang(en)`）：中文的标签都是两个字，
 * 英文最长的「Assistant」在 Windows 大一号的字下有 54px。
 */
const COLS = "grid-cols-[2.75rem_minmax(0,1fr)] [&:lang(en)]:grid-cols-[4rem_minmax(0,1fr)]";
const LINES = `grid ${COLS} items-start gap-x-3 gap-y-2`;
/** 底色那一块里的（见 `EarlierBlocks`）：左右各有 8px 内边距，左边一列窄 8px，右边的内容和外面对齐 */
const NESTED_COLS = "grid-cols-[2.25rem_minmax(0,1fr)] [&:lang(en)]:grid-cols-[3.5rem_minmax(0,1fr)]";
const NESTED_LINES = `grid ${NESTED_COLS} items-start gap-x-3 gap-y-2`;

/** 结果那一行写「Read 的结果」：调用 id → 工具名（见 `toolNames`） */
const Names = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * 最近看过的几次会话的对话留在缓存里，再早的丢掉。一次长会话的对话就有几 MB，
 * 缓存不会自己清（见 `forget`）。
 */
const KEEP = 3;
const recent: string[] = [];
function remember(key: string) {
  const i = recent.indexOf(key);
  if (i >= 0) recent.splice(i, 1);
  recent.push(key);
  while (recent.length > KEEP) forget(recent.shift()!);
}

/**
 * 取这次会话的对话：手上有一份就只要不会再变的那几轮之后的（`askFrom`），接到后面；
 * 接不上（前面的请求过期被删了）就整段重取。长会话每落一轮不必再把几 MB 传一遍。
 */
async function fetchTranscript(id: string, prev: Transcript | undefined): Promise<Transcript> {
  const from = askFrom(prev, id);
  if (from > 0) {
    const joined = extendTranscript(prev, await call("SessionTranscript", { from_turn: from }, id), from);
    if (joined) return joined;
  }
  return call("SessionTranscript", {}, id);
}

/** 轮次头上的几项，从会话详情里那一轮来（`TurnView`） */
interface Head {
  at: number | null;
  model: string;
  /** 费用那一格写什么，和「每轮费用」同一个写法。`null`：没什么可写的 */
  cost: string | null;
  costMuted: boolean;
  outcome: Outcome;
  /** 失败的那一轮，回答的位置上写的那一句（`failureLine`） */
  failure: string | null;
  /** 点「请求详情」打开哪一条 */
  rid: number | null;
}

/**
 * 会话的「对话」：按对话的样子把这次会话一轮一轮重放出来 —— 用户说了什么、模型想了
 * 什么、调了哪些工具、拿回来什么。
 *
 * **打开这一页才去取**（挂上它的是「对话」标签，见 `SessionPanel`）：一次长会话的对话
 * 有几 MB，只看费用的人用不着。取回来的按会话缓存，切回来立刻有。
 *
 * **会话还在进行时跟着往下走**：会话详情多落一轮（`turns` 变了），就重取一次。这一页
 * 不自己听事件 —— 事件不分会话，别的会话落一轮也重取整段对话不值得。没变的轮次沿用
 * 原来的对象（`keepTurns`），一轮是 `memo` 的，新落的那一轮才画。
 *
 * 轮次头上的时刻、模型、费用、失败与否来自会话详情的那一轮（`turns`，按请求 id 对上）。
 * 还在跑的那几轮库里还没有，对话里也没有，末尾各写一行「进行中」。
 *
 * 正文不在的那几轮，按那一轮的时刻和报文的保留天数（概览里的 `retention`）说是已超过保留
 * 期限，还是未保留（见 `missingWhy`）。
 */
export function Conversation({
  id,
  turns,
  running,
  onOpenTurn,
  onShowSummary,
}: {
  id: string;
  /** 会话详情里落了库的轮次 */
  turns: readonly TurnView[];
  /** 还在跑的那几轮（表里的行）和它们是第几轮 */
  running: readonly { row: RequestRow; n: number }[];
  onOpenTurn: (id: number) => void;
  onShowSummary: () => void;
}) {
  const t = useText(conversationText);
  const s = useText(sessionsText);
  const key = `transcript:${id}`;
  useEffect(() => remember(key), [key]);
  /** 上一次取到的那一份：重取回来的轮次没变就换回它（`keepTurns`） */
  const prev = useRef<Transcript | undefined>(undefined);
  const r = useResource(key, async () => keepTurns(prev.current, await fetchTranscript(id, prev.current)), {
    deps: [turns.length, turns[turns.length - 1]?.id ?? null],
  });
  prev.current = r.data;
  const data = r.data ?? (unrecorded(r.error) ? null : undefined);
  // 报文留几天。和请求详情的「重放」同一份概览；没取到时不说「已超过保留期限」
  const ov = useResource("overview", () => call("Overview", null), { events: ["config_reloaded"] });
  const bodyDays = ov.data?.retention.body_days ?? null;
  const now = useNow(HOUR_MS);
  const views = useMemo(() => viewsById(turns), [turns]);
  const why = useCallback(
    (x: TranscriptTurn) => missingWhy(views.get(idKey(x.id))?.at_ms ?? null, bodyDays, now),
    [views, bodyDays, now],
  );

  const list = useMemo(() => (data ? items(data.turns, why) : []), [data, why]);
  const names = useMemo(() => (data ? toolNames(data.turns) : new Map<string, string>()), [data]);
  const shown = useProgressive(list);

  if (data === undefined) {
    return r.error !== undefined ? (
      <ErrorState title={t.loadFailed} error={r.error} onRetry={() => void r.reload()} retrying={r.loading} />
    ) : (
      <ConversationSkeleton />
    );
  }
  const gone = data !== null ? allLost(data.turns, why) : null;
  if (gone !== null) {
    return (
      <EmptyState
        icon={<IconSession />}
        title={gone === "expired" ? t.allExpiredTitle : t.allUnkeptTitle}
        description={t.allLostHint}
        action={
          <Button size="sm" variant="outline" onClick={onShowSummary}>
            {t.showSummary}
          </Button>
        }
      />
    );
  }
  if (list.length === 0 && running.length === 0) {
    return <EmptyState icon={<IconSession />} title={t.emptyTitle} description={t.emptyHint} />;
  }

  const system = data?.system ?? null;
  const headOf = (turnId: string): Head => {
    const v = views.get(idKey(turnId));
    const cost = v
      ? turnCost(
          {
            cost: v.cost_micros,
            estimated: v.cost_estimated,
            usage: v.input_tokens != null,
            billing: v.billing,
            recorded: true,
          },
          s,
        )
      : null;
    return {
      at: v?.at_ms ?? null,
      model: v?.model ?? "",
      // 「—」不写：头上写一个破折号只是噪音
      cost: cost && cost.text !== "—" ? cost.text : null,
      costMuted: cost?.muted ?? false,
      outcome: outcomeOf(v),
      failure: failureLine(v),
      rid: requestIdOf(turnId, v),
    };
  };
  /** 还没补齐的时候不画末尾在跑的那几轮：它们会先出现在第 30 轮后面，再跳到最后 */
  const complete = shown === list;

  return (
    <Names.Provider value={names}>
      <div className="tw-body">
        {/* 左边不标「系统」：这一行自己写着「系统提示」 */}
        {system !== null && (
          <div className={LINES}>
            <Line>
              <TextFold title={t.systemPrompt} text={system} />
            </Line>
          </div>
        )}
        <ol>
          {shown.map((it, i) => {
            const first = i === 0 && system === null;
            if (it.kind === "lost") {
              return (
                <li key={it.key} className={cn(!first && "mt-4 border-t border-border pt-4")}>
                  <Pill>{it.why === "expired" ? t.expiredRun(it.from, it.to) : t.unkeptRun(it.from, it.to)}</Pill>
                </li>
              );
            }
            return (
              <li
                key={it.turn.id}
                className={cn(!first && (it.turn.restart ? "mt-4" : "mt-4 border-t border-border pt-4"))}
              >
                <Turn turn={it.turn} n={it.n} head={headOf(it.turn.id)} why={why(it.turn)} onOpen={onOpenTurn} />
              </li>
            );
          })}
          {complete &&
            running.map(({ row, n }, i) => (
              <li
                key={`running:${row.id}`}
                className={cn((i > 0 || shown.length > 0 || system !== null) && "mt-4 border-t border-border pt-4")}
              >
                <TurnHeader
                  n={n}
                  head={{
                    at: row.atMs,
                    model: row.model ?? "",
                    cost: null,
                    costMuted: false,
                    outcome: "done",
                    failure: null,
                    rid: row.id,
                  }}
                  running
                  onOpen={onOpenTurn}
                />
                <p className="mt-1 text-muted-foreground">{t.afterEnd}</p>
              </li>
            ))}
        </ol>
      </div>
    </Names.Provider>
  );
}

/**
 * 长的对话一批一批画：先画 `FIRST_PAINT` 轮，之后每一批 `CHUNK` 轮，批与批之间把主线程
 * 让出来。
 *
 * **不用 `useDeferredValue`**（流量表的做法）：它把其余的放在一次后台渲染里，渲染能被
 * 打断，提交却是一次 —— 六百轮一万多个节点一次插进页面，实测一个 190ms 的长任务，那一下
 * 点什么都没反应。分批之后每次提交几十轮。
 */
function useProgressive<T>(list: readonly T[]): readonly T[] {
  const [n, setN] = useState(FIRST_PAINT);
  const more = n < list.length;
  useEffect(() => {
    if (!more) return;
    const h = setTimeout(() => setN((x) => x + CHUNK), 0);
    return () => clearTimeout(h);
  }, [more, n]);
  return more ? list.slice(0, n) : list;
}

/** 两份头一样：轮次只在它们变了的时候重画 */
function sameHead(a: Head, b: Head): boolean {
  return (
    a.at === b.at &&
    a.model === b.model &&
    a.cost === b.cost &&
    a.costMuted === b.costMuted &&
    a.outcome === b.outcome &&
    a.failure === b.failure &&
    a.rid === b.rid
  );
}

/**
 * 一轮：头（第几轮、时刻、模型、费用、请求详情），然后是这一轮新加的输入和回答。
 *
 * 输入里可能先有一条助手消息：上一轮的回答没能完整显示（响应有缺口），客户端在这一轮的
 * 历史里带着它 —— 那是它说过什么的唯一记录，照常画在这一轮的开头。
 *
 * 不生成回答的调用（数 token、压缩上下文，见 `quiet`）只有一行头，写「无对话内容」。
 *
 * 正文不在时说哪一种原因，看 `why`（见 `missingWhy`）。
 *
 * **`memo`，比的是这一轮的对象和头上那几项**：会话在进行时，每落一轮整段对话重取一次，
 * 没变的轮次沿用原来的对象（`keepTurns`），这里就不重画。
 */
const Turn = memo(
  function Turn({
    turn,
    n,
    head,
    why,
    onOpen,
  }: {
    turn: TranscriptTurn;
    n: number;
    head: Head;
    why: Missing;
    onOpen: (id: number) => void;
  }) {
    const t = useText(conversationText);
    const restart = useMemo(() => (turn.restart ? splitRestart(turn.input) : null), [turn]);
    const blocks = useMemo(() => blocksOf(restart ? restart.latest : turn.input), [turn, restart]);
    const output = useMemo(() => visibleParts(turn.output), [turn]);
    const notes = notesOf(turn, head.outcome, why);
    const reply = output.length > 0 || notes.response.length > 0;
    // 失败了的不算：失败的原因要写出来
    if (quiet(turn) && !reply) {
      return (
        <article>
          <TurnHeader n={n} head={head} note={t.noContent} onOpen={onOpen} />
        </article>
      );
    }
    return (
      <article>
        {turn.restart && <RestartRule />}
        <TurnHeader n={n} head={head} onOpen={onOpen} />
        <div className={cn(LINES, "mt-1.5")}>
          {turn.system_changed !== null && (
            <Line>
              <TextFold title={t.systemChanged} text={turn.system_changed} />
            </Line>
          )}
          {notes.request.length > 0 && (
            <Line>
              <Notes notes={notes.request} failure={null} />
            </Line>
          )}
          {restart && restart.earlier.length > 0 && <Earlier messages={restart.earlier} />}
          {blocks.map((b, i) => (
            <BlockLine key={i} b={b} />
          ))}
          {reply && (
            <Line label={t.assistant}>
              {output.length > 0 && <Parts parts={output} />}
              {notes.response.length > 0 && (
                <Notes notes={notes.response} failure={head.failure} className={cn(output.length > 0 && "mt-1.5")} />
              )}
            </Line>
          )}
        </div>
      </article>
    );
  },
  (a, b) => a.turn === b.turn && a.n === b.n && a.why === b.why && a.onOpen === b.onOpen && sameHead(a.head, b.head),
);

/**
 * 一轮的头。还在跑的那一轮（`running`）没有费用，写「进行中」；`note` 是跟在后面的一句
 * 淡的话（没有对话内容的那几轮）。
 */
function TurnHeader({
  n,
  head,
  running = false,
  note,
  onOpen,
}: {
  n: number;
  head: Head;
  running?: boolean;
  note?: string;
  onOpen: (id: number) => void;
}) {
  const t = useText(conversationText);
  const s = useText(sessionsText);
  const rid = head.rid;
  return (
    <header className="flex min-h-7 items-center gap-x-3">
      <h3 className="shrink-0 tw-head text-foreground">{t.turnNo(n)}</h3>
      {head.at !== null && <span className="shrink-0 tw-num text-muted-foreground">{when(head.at)}</span>}
      {head.model && <span className="min-w-0 truncate text-muted-foreground">{head.model}</span>}
      {head.cost !== null && (
        <span className={cn("shrink-0 tw-num", head.costMuted && "text-muted-foreground")}>{head.cost}</span>
      )}
      {running ? (
        <StatusLabel tone="pending" muted className="shrink-0">
          {s.turnRunning}
        </StatusLabel>
      ) : head.outcome === "failed" ? (
        <StatusLabel tone="error" className="shrink-0">
          {s.turnFailed}
        </StatusLabel>
      ) : head.outcome === "cancelled" ? (
        <StatusLabel tone="idle" muted className="shrink-0">
          {s.turnCancelled}
        </StatusLabel>
      ) : null}
      {note && <span className="min-w-0 truncate text-muted-foreground">{note}</span>}
      <span className="flex-1" />
      {rid !== null && (
        <Button
          variant="ghost"
          size="xs"
          className="-mr-2 shrink-0 text-muted-foreground"
          onClick={() => onOpen(rid)}
        >
          {t.openRequest}
        </Button>
      )}
    </header>
  );
}

/**
 * 历史重新开始的那一轮上面那条线。**它就是这一轮和上一轮之间的分隔线**，不再另画一条。
 */
function RestartRule() {
  const t = useText(conversationText);
  return (
    <div role="separator" className="mb-3 flex items-center gap-3 tw-label text-muted-foreground">
      <span aria-hidden className="h-px flex-1 bg-border" />
      <span className="shrink-0">{t.restart}</span>
      <span aria-hidden className="h-px flex-1 bg-border" />
    </div>
  );
}

/** 网格里的一行：左边是谁说的（可以空着），右边是内容 */
function Line({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <>
      {/* 和右边第一行的中线对齐：右边的行（折叠行、一行字）都是 24px 高 */}
      <div className="flex h-6 items-center tw-label font-medium text-muted-foreground">{label}</div>
      <div className="min-w-0">{children}</div>
    </>
  );
}

function roleLabel(role: TranscriptRole, t: (typeof conversationText)["zh"]): string {
  switch (role) {
    case "user":
      return t.user;
    case "assistant":
      return t.assistant;
    case "tool":
      return t.tool;
    case "system":
      return t.system;
  }
}

/** 一块：一个角色说的几段，或者几条工具结果（结果那一行自己写着是谁的，左边不标） */
function BlockLine({ b }: { b: Block }) {
  const t = useText(conversationText);
  return (
    <Line label={b.kind === "said" ? roleLabel(b.role, t) : undefined}>
      <Parts parts={b.parts} />
    </Line>
  );
}

/**
 * 历史重新开始的那一轮带着的、模型上一次开口为止的历史（见 `splitRestart`）。**默认收起**：
 * 前面的轮次里多半已经显示过，整段再铺一遍，这一轮新加的那一点就找不到了。
 *
 * 展开的仍是同样的两列，左边那一列和外面对齐；淡淡的底色说明它是一整段带过来的历史。
 */
function Earlier({ messages }: { messages: readonly TranscriptMessage[] }) {
  const t = useText(conversationText);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Line>
        <FoldRow open={open} onToggle={() => setOpen((o) => !o)}>
          <span className="truncate">{t.earlier(messages.length)}</span>
        </FoldRow>
      </Line>
      {/* 收起时整格不在网格里：空的一行也会多占一道行距 */}
      <Reveal show={open} className="col-span-2 min-w-0">
        <EarlierBlocks messages={messages} />
      </Reveal>
    </>
  );
}

function EarlierBlocks({ messages }: { messages: readonly TranscriptMessage[] }) {
  const blocks = useMemo(() => blocksOf(messages), [messages]);
  return (
    <div className="my-1 rounded-lg bg-foreground/[0.025] px-2 py-2">
      <div className={NESTED_LINES}>
        {blocks.map((b, i) => (
          <BlockLine key={i} b={b} />
        ))}
      </div>
    </div>
  );
}

/** 一块里的几段，上下排。相邻的图片和附件排成一行 */
function Parts({ parts }: { parts: readonly TranscriptPart[] }) {
  const runs: (TranscriptPart | TranscriptPart[])[] = [];
  for (const p of parts) {
    const chip = p.kind === "image" || p.kind === "other";
    const last = runs[runs.length - 1];
    if (chip && Array.isArray(last)) last.push(p);
    else runs.push(chip ? [p] : p);
  }
  return (
    <div className="flex flex-col gap-1">
      {runs.map((x, i) =>
        Array.isArray(x) ? (
          <div key={i} className="flex flex-wrap gap-1.5 py-0.5">
            {x.map((p, j) => (
              <Chip key={j} p={p} />
            ))}
          </div>
        ) : (
          <Part key={i} p={x} />
        ),
      )}
    </div>
  );
}

function Part({ p }: { p: TranscriptPart }) {
  switch (p.kind) {
    case "text":
      return <Prose text={p.text} />;
    case "thinking":
      return <Thinking text={p.text} />;
    case "tool_call":
      return <ToolCallRow p={p} />;
    case "tool_result":
      return <ToolResultRow p={p} />;
    case "image":
    case "other":
      return <Chip p={p} />;
  }
}

/**
 * 说的话：原样的空白和换行，不当 Markdown 解析（模型写的 `**` 和 `#` 就是那几个字符）。
 * 长的先显示开头，「展开全部」看整段。
 */
function Prose({ text, muted = false }: { text: string; muted?: boolean }) {
  const t = useText(conversationText);
  const [all, setAll] = useState(false);
  const head = useMemo(() => clip(text, PROSE), [text]);
  const cut = head !== null && !all;
  return (
    <div>
      {/* 上边 2px：一行字的中线和左边标签的中线对齐（标签那一格 24px 高，字的行高 19.5px） */}
      <p
        className={cn(
          "pt-0.5 whitespace-pre-wrap wrap-break-word",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {cut ? head : text}
        {cut && <span className="text-muted-foreground"> …</span>}
      </p>
      {head !== null && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-0.5 -ml-2 text-muted-foreground"
          onClick={() => setAll((a) => !a)}
        >
          {all ? t.collapse : t.showAll}
        </Button>
      )}
    </div>
  );
}

/**
 * 可以点开的一行：箭头，一行提要，右边一个淡的数。点开的内容在 `Fold` 里。
 * 按钮左右各伸出 6px，悬停的底色比文字宽一圈，文字和上下的正文对齐（同「每轮费用」）。
 */
function FoldRow({
  open,
  onToggle,
  meta,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** 右端那个淡的数（字数） */
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="-mx-1.5">
      <Button
        variant="ghost"
        size="sm"
        aria-expanded={open}
        onClick={onToggle}
        className={cn("h-6 w-full justify-start gap-1.5 px-1.5 font-normal text-muted-foreground", DISCLOSURE)}
      >
        <ChevronRightIcon className={cn("size-3.5 motion-bar", open && "rotate-90")} />
        <span className="flex min-w-0 flex-1 items-baseline gap-2">{children}</span>
        {meta !== undefined && <span className="shrink-0 tw-label tw-num text-muted-foreground">{meta}</span>}
      </Button>
    </div>
  );
}

/** 点不开的一行，和 `FoldRow` 对齐：箭头的位置空着 */
function StillRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-6 min-w-0 items-center gap-1.5 text-muted-foreground">
      <span aria-hidden className="size-3.5 shrink-0" />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">{children}</span>
    </div>
  );
}

function Fold({ head, meta, children }: { head: ReactNode; meta?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <FoldRow open={open} onToggle={() => setOpen((o) => !o)} meta={meta}>
        {head}
      </FoldRow>
      {/* 收起时内容不在页面里：几百轮里每个工具结果都画出来，展开前就够重了 */}
      <Reveal show={open}>
        <div className="pt-1 pb-1.5">{children}</div>
      </Reveal>
    </div>
  );
}

/** 一段要读的长文字（系统提示、思考），收起；点开是左边一道竖线引着的原文 */
function TextFold({ title, text, muted = false }: { title: string; text: string; muted?: boolean }) {
  const t = useText(conversationText);
  return (
    <Fold head={<span className="truncate text-foreground">{title}</span>} meta={t.chars(text.length)}>
      <div className="ml-[5px] border-l-2 border-border pl-3">
        <Prose text={text} muted={muted} />
      </div>
    </Fold>
  );
}

/** 思考，默认收起。只有签名没有正文的，说上游没给 */
function Thinking({ text }: { text: string }) {
  const t = useText(conversationText);
  if (text.trim() === "") {
    return (
      <StillRow>
        <span className="shrink-0 text-foreground">{t.thinking}</span>
        <span className="min-w-0 truncate">{t.thinkingHidden}</span>
      </StillRow>
    );
  }
  return <TextFold title={t.thinking} text={text} muted />;
}

/** 工具调用：名字和参数的提要一行，点开是排好的参数 */
function ToolCallRow({ p }: { p: ToolCall }) {
  const preview = useMemo(() => argsPreview(p.input), [p.input]);
  return (
    <Fold
      head={
        <>
          <span className="shrink-0 font-medium text-foreground">{p.name}</span>
          {preview && <span className="min-w-0 truncate font-mono tw-label">{preview}</span>}
        </>
      }
    >
      <Args input={p.input} />
    </Fold>
  );
}

/** 点开之后才排：Write 的参数里是整个文件 */
function Args({ input }: { input: string }) {
  const pretty = useMemo(() => prettyJson(input, false), [input]);
  return <Mono text={pretty ?? input} json={pretty !== null} />;
}

/** 工具结果的第一行非空的字，收起时那一行的提要 */
function firstLine(text: string): string {
  const m = /\S[^\n]*/.exec(text.slice(0, 1000));
  return m ? m[0].trim() : "";
}

/** 工具结果：谁的结果、出没出错、开头一行，点开是原文 */
function ToolResultRow({ p }: { p: ToolResult }) {
  const t = useText(conversationText);
  const name = useContext(Names).get(p.call_id);
  const label = (
    <span className="shrink-0 text-foreground">
      {name ? t.resultOf(<span className="font-medium">{name}</span>) : t.result}
    </span>
  );
  const error = p.is_error && (
    <StatusLabel tone="error" className="shrink-0 self-center">
      {t.error}
    </StatusLabel>
  );
  if (p.text === "") {
    return (
      <StillRow>
        {label}
        {error}
        <span className="min-w-0 truncate">{t.noOutput}</span>
      </StillRow>
    );
  }
  return (
    <Fold
      head={
        <>
          {label}
          {error}
          <span className="min-w-0 truncate font-mono tw-label">{firstLine(p.text)}</span>
        </>
      }
      meta={t.chars(p.text.length)}
    >
      <Mono text={p.text} json={false} error={p.is_error} />
    </Fold>
  );
}

/**
 * 等宽的一框（工具参数、工具结果），和请求详情「内容」那一页同一个样子：框子最高
 * 320px、自己滚。整个文件那么长的结果先画开头，「展开全部」再画其余。
 */
function Mono({ text, json, error = false }: { text: string; json: boolean; error?: boolean }) {
  const t = useText(conversationText);
  const [all, setAll] = useState(false);
  const head = useMemo(() => clip(text, MONO), [text]);
  const cut = head !== null && !all;
  return (
    <div>
      <BodyText
        text={cut ? head : text}
        json={json}
        more={cut}
        className={cn(
          "max-h-80 rounded-lg border px-3 py-2.5",
          error ? "border-destructive/25 bg-destructive/8" : "border-border bg-surface",
        )}
      />
      {head !== null && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-1 -ml-2 text-muted-foreground"
          onClick={() => setAll((a) => !a)}
        >
          {all ? t.collapse : t.showAll}
        </Button>
      )}
    </div>
  );
}

/** 图片和其他附件：一个小方块写清是什么，不画内容（记录里本来也没有） */
function Chip({ p }: { p: TranscriptPart }) {
  const t = useText(conversationText);
  if (p.kind !== "image" && p.kind !== "other") return null;
  const text =
    p.kind === "image"
      ? [t.image, p.media_type, p.bytes != null ? size(p.bytes) : null].filter(Boolean).join(" · ")
      : p.label;
  return (
    <span
      className={cn(
        "inline-flex h-5 max-w-full min-w-0 items-center gap-1.5 rounded-md border border-border bg-surface px-1.5",
        "tw-label text-muted-foreground",
      )}
    >
      {p.kind === "image" && <ImageIcon aria-hidden className="size-3 shrink-0" />}
      <span className="truncate">{text}</span>
    </span>
  );
}

/** 一小块说明：显示不出来的部分（虚线框），或者失败（红） */
function Pill({ tone = "gap", children }: { tone?: "gap" | "error"; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center rounded-md border px-2 py-0.5 tw-label",
        tone === "error"
          ? "border-destructive/25 bg-destructive/8 text-destructive"
          : "border-dashed border-border text-muted-foreground",
      )}
    >
      <span className="min-w-0 wrap-break-word">{children}</span>
    </span>
  );
}

function noteText(n: Note, failure: string | null, t: (typeof conversationText)["zh"]): string {
  switch (n) {
    case "expired":
      return t.expired;
    case "unkept":
      return t.unkept;
    case "request_expired":
      return t.requestExpired;
    case "request_unkept":
      return t.requestUnkept;
    case "request_truncated":
      return t.requestTruncated;
    case "response_expired":
      return t.responseExpired;
    case "response_unkept":
      return t.responseUnkept;
    case "response_failed":
      // 失败的那一轮会话详情里一定带着原因；万一没有，也不说是过了保留期限
      return failure ?? t.responseUnkept;
    case "response_cancelled":
      return t.responseCancelled;
    case "response_truncated":
      return t.responseTruncated;
    case "response_unreadable":
      return t.responseUnreadable;
  }
}

function Notes({ notes, failure, className }: { notes: readonly Note[]; failure: string | null; className?: string }) {
  const t = useText(conversationText);
  return (
    <div className={cn("flex flex-col items-start gap-1 pt-0.5", className)}>
      {notes.map((n) => (
        <Pill key={n} tone={n === "response_failed" && failure !== null ? "error" : "gap"}>
          {noteText(n, failure, t)}
        </Pill>
      ))}
    </div>
  );
}

/** 取数时的样子：几轮的头和几行，落进来时不跳。和浮层的骨架一样等 150ms 才露出来 */
function ConversationSkeleton() {
  return (
    <PanelSkeleton>
      {Array.from({ length: 3 }, (_, i) => (
        <div key={i} className={cn(i > 0 && "mt-4 border-t border-border pt-4")} style={{ opacity: 1 - i * 0.25 }}>
          <Skeleton className="my-1.5 h-3.5 w-52 rounded-sm" />
          <div className={cn(LINES, "mt-2 gap-y-3")}>
            <Skeleton className="mt-1 h-2.5 w-8 rounded-sm" />
            <Skeleton className="mt-1 h-3 w-4/5 rounded-sm" />
            <span />
            <Skeleton className="mt-1 h-3 w-1/2 rounded-sm" />
            <Skeleton className="mt-1 h-2.5 w-8 rounded-sm" />
            <Skeleton className="mt-1 h-3 w-2/3 rounded-sm" />
          </div>
        </div>
      ))}
    </PanelSkeleton>
  );
}
