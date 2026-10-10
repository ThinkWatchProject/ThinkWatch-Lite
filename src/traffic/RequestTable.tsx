import {
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { textOf, useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { cn } from "@/lib/utils";
import { latency, money, ms, statusTone, tokens, traffic, when } from "@/format";
import { failureKind, notSentText, translatedText } from "@/labels";
import { ruleName } from "@/security/labels";
import { notSent } from "@/requestRouting";
import { promptTokens, upstreamText, type Filter, type SortDir, type SortKey } from "@/requestTable";
import type { ContentHit, RequestRow } from "@/types";
import { AliasMark } from "@/aliases/AliasMark";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { UpstreamLogo } from "@/ui/logos";
import type { MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { StatusDot, type StatusTone } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { copyText } from "@/ui/notify";
import { DIM, Elapsed, Lines, NotSentIcon, ROW, RowKeyCell } from "./cells";
import type { Cursor, Group } from "./grouping";
import { rowMark, type ViaConfig } from "./modelVia";
import { SessionRow, SessionSizerCell, sessionItems, sessionWidths } from "./SessionRow";
import { sessionsText } from "./Sessions.i18n";
import { RowActions, TableMenus, type MenuTarget } from "./TableMenus";
import { abortRequest, abortable } from "./abort";
import { abortText } from "./abort.i18n";
import { trafficText } from "./Traffic.i18n";
import { useViaConfig } from "./useModelVia";
import {
  capped,
  indexAt,
  itemsOf,
  NAME_PX,
  offsetsOf,
  textWidth,
  widest,
  type Col,
  type Item,
  type Widths,
} from "./virtual";

type Text = (typeof trafficText)["zh"];

/** 表头的高：排序钮 24px，加「状态」那一格的 `py-1.5`。行上的 `scroll-mt-9` 让出的就是它 */
const HEAD_PX = 36;
/** 看得见的那一段上下各多画多高：滚过这一截里的大半才重画一次 */
const OVERSCAN_PX = 480;
/** 画着的那一段离看得见的边不到这么多时，重新取一段 */
const MARGIN_PX = 160;
/** 第一次量到之前，一行按多高算：一行字的请求行、组头，和片段多出来的那一行 */
const GUESS = { request: 32.5, session: 32.5, hit: 20 };
/** 每一列在表头垫几格最宽的（见 `Sizer`） */
const SIZER_K = 3;
/**
 * 浏览器自己会不会稳住滚动位置（`overflow-anchor`）：上面的行换了高度，看着的那一行
 * 不跟着跳。Chromium（Windows 的 WebView2）会；WebKit 不会，那里自己补（见 `Body`）。
 */
const NATIVE_ANCHOR = typeof CSS !== "undefined" && CSS.supports("overflow-anchor", "auto");

/** 键盘选中一行之后，流量页叫它把那一行滚进视野 */
export type RequestTableHandle = { reveal: (c: Cursor) => void };

/**
 * 流量页那张请求表。
 *
 * 平铺和按会话归组是同一张表的两个形态（`groups` 给了就是归组）。
 *
 * **只画看得见的那一段**，上下各多画一截，其余的用两行等高的空行垫着（见 `Body`）。
 * 列宽靠表头里垫着的每一列最宽的那几格撑住，不随滚动跳（见 `Sizer`）。
 *
 * 行是 `memo` 的：键盘挪一格只重画离开和到达的两行，一条请求落地只重画那一行；在跑的
 * 请求每秒走一格的已跑时长不经过渲染（见 `Elapsed`）。这要求行对象不被原地修改 ——
 * `useRequests` 改一行之前先换成新对象，见那边的 `touches`。
 *
 * `scroller` 是外面那层滚动层（流量页自己滚）：画哪一段看它滚到了哪。
 */
export function RequestTable({
  ref,
  scroller,
  rows,
  hits,
  groups,
  openGroups,
  selectedSession,
  onToggleGroup,
  onOpenSession,
  onAbortSession,
  showClient,
  hints,
  cursor,
  fresh,
  freshGroups,
  today,
  sortKey,
  sortDir,
  onSort,
  onCursor,
  onOpen,
  onFilter,
}: {
  ref?: Ref<RequestTableHandle>;
  scroller: RefObject<HTMLElement | null>;
  rows: RequestRow[];
  /** 按内容搜到的那些各自对上了哪一段：那一行下面跟一行片段 */
  hits?: ReadonlyMap<number, ContentHit>;
  /** 给了就是归组形态。不给就是平表 */
  groups?: Group[];
  /** 展开着的那几个会话 */
  openGroups: ReadonlySet<string>;
  /** 右侧开着的那次会话 */
  selectedSession: string | null;
  onToggleGroup: (id: string) => void;
  onOpenSession: (id: string) => void;
  /** 中止一次会话里在跑的请求：交给页面弹确认 */
  onAbortSession: (id: string) => void;
  showClient: boolean;
  /** 有哪一行带着推测出的应用：有的话密钥那一格给标志留出位置，名字才对得齐 */
  hints: boolean;
  /** 键盘选中的那一行：一条请求，或者一个组头 */
  cursor: Cursor | null;
  /** 刚到的那几行，滑进来 */
  fresh: ReadonlySet<number>;
  /** 刚出现的会话 */
  freshGroups: ReadonlySet<string>;
  /** 「今天」是哪一天。**按日取整传进来**，否则每次重画都可能跨过零点 */
  today: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  onCursor: (c: Cursor) => void;
  onOpen: (id: number) => void;
  onFilter: (f: (prev: Filter) => Filter) => void;
}) {
  const t = useText(trafficText);
  const ts = useText(sessionsText);
  // 上游那一格的「别名」「指定」要对着现在的别名表和路由看：表头取一次，传给每一行
  const via = useViaConfig();
  const items = useMemo(() => itemsOf(rows, groups, openGroups), [rows, groups, openGroups]);
  const sizers = useSizers(items, t, ts, today, via);
  const sizer = (col: Col) => <Sizer col={col} items={sizers[col]} hints={hints} via={via} today={today} />;
  return (
    <Table
      /*
        表体的每一行都可能被键盘选中、`scrollIntoView` 进视野（见流量页的键盘
        导航）：请求行，和归组时的组头。

        **上边让出吸顶的表头**，不然往上翻时这一行停在表头底下。36px
        是表头的高：排序钮 24px，加「状态」那一格的 `py-1.5`。

        **左右各放出一整屏宽，横向就不会滚。**窗口窄、表横着滚的时候，
        一行横跨整张表，总有一截在视野外，`nearest` 会为它横着滚：
        Chromium 把表推开 20px，左右边距没了；WebKit 从最右一下跳回最左。
        只放出外面那块的 `px-5` 在 WebKit 里不够 —— 它把滚动宽度向上
        取整，滚到最右时行边差零点几像素够不着可视区的右沿。

        **格子左右各 6px，比别的表紧一档。**这张表九列，默认窗口下每一列省下 4px，
        英文界面的费用那一列才留在视野里；行尾「…」那一格自己是 0。
      */
      className="tw-num [&_tbody_tr]:scroll-mt-9 [&_tbody_tr]:scroll-mx-[100vw] [&_td]:px-1.5 [&_th]:px-1.5"
      scroll={false}
    >
      {/*
        **表头必须钉住。**这张表滚两屏之后就没有列名了，而并排的
        两列毫秒数，不看列名根本分不出哪个是首 token 哪个是总耗时 ——
        那恰恰是排查时唯一要看的区别。

        钉在页面的滚动层上，所以上面的 `scroll={false}` 不能去掉：表外
        那层一旦能横着滚，表头就钉在它身上，不会吸顶。底色要和窗口底
        同色，吸顶之后行从它下面滚过，差一档灰就是一条色带。

        **底线画在格子里，不用行的边框。**表格是合并边框，那条边框归
        表格画，表头钉住之后它留在原处跟着行滚走，表头和第一行之间就
        没有线了。格子内侧的阴影跟着格子走。
      */}
      <TableHeader className="sticky top-0 z-10 bg-background [&_th]:shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-b-0">
        <TableRow className="hover:bg-transparent">
          <Th k="status" label={t.status} sort={sortKey} dir={sortDir} on={onSort} className="py-1.5">
            {sizer("status")}
          </Th>
          <Th k="time" label={t.time} sort={sortKey} dir={sortDir} on={onSort}>
            {sizer("time")}
          </Th>
          {/* 只有一把密钥时这一列每行都一样 —— 那是零信息 */}
          {showClient && (
            <TableHead>
              {t.client}
              {sizer("client")}
            </TableHead>
          )}
          <TableHead>
            {t.model}
            {sizer("model")}
          </TableHead>
          <TableHead>
            {t.upstream}
            {sizer("upstream")}
          </TableHead>
          {/* 首 token 和总耗时合成一列，生成速度在它的悬停里 —— 非流式请求没有首 token */}
          <Th k="duration" label={t.latency} sort={sortKey} dir={sortDir} on={onSort} className="text-right">
            {sizer("latency")}
          </Th>
          <Th k="tokens" label={t.tokens} sort={sortKey} dir={sortDir} on={onSort} className="text-right">
            {sizer("tokens")}
          </Th>
          <Th k="cost" label={t.cost} sort={sortKey} dir={sortDir} on={onSort} className="text-right">
            {sizer("cost")}
          </Th>
          {/* 行尾的「…」：和右键是同一份菜单 */}
          <TableHead className="w-6 px-0!" />
        </TableRow>
      </TableHeader>
      {/*
        走到这里还是空的，只可能是历史没读完 —— 「读完了，确实一条
        都没有」在流量页那一层已经处理掉了。**事件流先到的行不能被
        骨架盖住**：那时数据已经在手上了。
      */}
      {rows.length === 0 ? (
        <BodySkeleton
          widths={[
            "w-10",
            "w-14",
            ...(showClient ? ["w-20"] : []),
            "w-28",
            "w-20",
            "w-20 ml-auto",
            "w-14 ml-auto",
            "w-12 ml-auto",
          ]}
        />
      ) : (
        <Body
          handle={ref}
          scroller={scroller}
          items={items}
          rows={rows}
          groups={groups}
          hits={hits}
          openGroups={openGroups}
          showClient={showClient}
          hints={hints}
          via={via}
          today={today}
          cursor={cursor}
          fresh={fresh}
          freshGroups={freshGroups}
          selectedSession={selectedSession}
          onOpen={onOpen}
          onCursor={onCursor}
          onFilter={onFilter}
          onToggleGroup={onToggleGroup}
          onOpenSession={onOpenSession}
          onAbortSession={onAbortSession}
        />
      )}
    </Table>
  );
}

function Th({
  k,
  label,
  sort,
  dir,
  on,
  className = "",
  children,
}: {
  k: SortKey;
  label: string;
  sort: SortKey;
  dir: SortDir;
  on: (k: SortKey) => void;
  className?: string;
  /** 量列宽的那一块（`Sizer`） */
  children?: ReactNode;
}) {
  const active = sort === k;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Button variant="ghost" size="xs" className="-mx-1 px-1 font-medium" onClick={() => on(k)}>
        <span className={cn(active && "text-foreground")}>{label}</span>
        <span aria-hidden className="ml-0.5 inline-block w-2 tw-label">
          {active ? (dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </Button>
      {children}
    </TableHead>
  );
}

/**
 * 表头里垫的一块：这一列最宽的那几格，原样画出来，看不见、零高、点不到。
 *
 * **为什么要垫。**表格按内容定列宽，而只画一段的表只有画出来的那几十行在算：往下一滚，
 * 进来一个长一点的模型名，整张表的列就往右一跳。表头一直都在，垫在它里面的格子一直
 * 参与列宽 —— 每一列最宽的那几格都在，列宽就和整张表都画出来时一样，滚到哪都不动。
 *
 * 哪几格最宽是按字数估的（`useSizers`），每列取前三名，估差一点也落在里面；画的是和
 * 行里一样的那一格（同一个组件），量出来的宽度就是真的。组头的字是中粗，请求行是常规；
 * 组里的请求行第一格往里缩了 22px（`pl-7`），这里照样缩。上游那一格会折行，量它最窄
 * 能收到多窄时也要能折。名字类的几格自己封了顶（`NAME_PX`），垫在这里也一样：一个
 * 长名字撑开的最多是上限那么宽。
 */
function Sizer({
  col,
  items,
  hints,
  via,
  today,
}: {
  col: Col;
  items: Item[];
  hints: boolean;
  via: ViaConfig | null;
  today: number;
}) {
  if (items.length === 0) return null;
  return (
    <div aria-hidden inert className="invisible h-0 overflow-hidden">
      {items.map((it) =>
        it.kind === "session" ? (
          <div key={it.key} className="font-medium">
            <SessionSizerCell col={col} g={it.g} hints={hints} />
          </div>
        ) : (
          <div
            key={it.key}
            className={cn(
              "font-normal",
              col === "upstream" && "whitespace-normal",
              col === "status" && it.inGroup !== null && "pl-[22px]",
            )}
          >
            {requestCell(col, it.r, { hints, via, today })}
          </div>
        ),
      )}
    </div>
  );
}

const COLS: Col[] = ["status", "time", "client", "model", "upstream", "latency", "tokens", "cost"];

/**
 * 每一列垫哪几项：按 `requestWidths` / `sessionWidths` 估出的宽度取前几名。上游那一列
 * 两样都要：最宽的（一行写下时）和最窄能收到最宽的（窗口窄、它折行时）。
 *
 * 估宽按行对象记下（行对象不被原地修改，见 `RequestTable`）：来一条请求只估那一条。
 * 换了语言、过了零点、换了别名表时整份重估。
 */
function useSizers(items: Item[], t: Text, ts: (typeof sessionsText)["zh"], today: number, via: ViaConfig | null) {
  const cache = useMemo(() => {
    void [t, ts, today, via];
    return new WeakMap<object, Widths>();
  }, [t, ts, today, via]);
  return useMemo(() => {
    const w = (it: Item): Widths => {
      const obj = it.kind === "request" ? it.r : it.g;
      let x = cache.get(obj);
      if (!x) {
        x = it.kind === "request" ? requestWidths(it.r, t, today, via) : sessionWidths(it.g, ts);
        cache.set(obj, x);
      }
      return x;
    };
    // 组里的请求行第一格往里缩了 22px，按三个字宽算
    const width = (col: Col | "upstreamMin") => (i: number) => {
      const it = items[i]!;
      return w(it)[col] + (col === "status" && it.kind === "request" && it.inGroup !== null ? 3 : 0);
    };
    const pick = (col: Col | "upstreamMin") => widest(items.length, SIZER_K, width(col));
    const out = {} as Record<Col, Item[]>;
    for (const col of COLS) {
      const idx = col === "upstream" ? [...new Set([...pick("upstream"), ...pick("upstreamMin")])] : pick(col);
      out[col] = idx.map((i) => items[i]!);
    }
    return out;
  }, [items, cache, t, ts, today, via]);
}

/**
 * 请求行各列大约多宽：和 `requestCell` 写的是同样的字；图标、徽标的边距按一两个字宽算。
 * 名字按画出来的宽度封顶（`capped`，上限见 `NAME_PX`）
 */
function requestWidths(r: RequestRow, t: Text, today: number, via: ViaConfig | null): Widths {
  const sent = notSent(r);
  const mark = rowMark(r, via);
  const phrase = r.local || sent;
  const text = sent ? notSentText(sent) : r.local || r.provider ? upstreamText(r) : "—";
  // 上游的名字和标志一起封顶；本地应答、没有发往上游的那一句是说明，不截断
  const name = (phrase ? textWidth(text) : capped(textWidth(text), NAME_PX.upstream, 22)) + 3;
  // 那一句可以在词间折行（见 `UpstreamCell`）：最窄是最长的那个词
  const nameMin = phrase ? Math.max(...text.split(/\s+/).map(textWidth)) + 3 : name;
  const badges = [
    ...(mark ? [textWidth(t.pinned) + 1] : []),
    ...(r.secrets && r.secrets.items.length > 0
      ? [textWidth((r.secrets.replaced ? t.redacted : t.withSecrets)(r.secrets.items.reduce((a, x) => a + x.count, 0))) + 2]
      : []),
    ...(r.stripped && r.stripped.length > 0 ? [textWidth(t.stripped) + 2] : []),
    ...(r.translated
      ? [textWidth(r.translated.dropped.length > 0 ? t.convertedDropped(r.translated.dropped.length) : t.converted) + 2]
      : []),
    ...(r.flagged && r.flagged.length > 0 ? [textWidth(r.flagged.some((f) => f.blocked) ? t.blocked : t.suspicious) + 2] : []),
    ...(r.pluginChanged ? [textWidth(t.pluginChanged) + 2] : []),
  ];
  return {
    status: 2 + textWidth(statusText(r, t)),
    time: textWidth(when(r.atMs, today)),
    // 来源的记号在同一个限宽的块里（见 `KeyCell`）
    client: capped(textWidth(r.client), NAME_PX.client, r.peer ? 18 : 0) + (r.peer ? 3 : 0),
    model: capped(textWidth(r.model ?? "—"), NAME_PX.model),
    upstream: badges.reduce((a, b) => a + b + 1, name),
    upstreamMin: Math.max(nameMin, ...badges),
    // 在跑的：首 token 加上一个时钟（「0:42」）
    latency: r.state === "in_flight" ? (r.ttftMs != null ? String(r.ttftMs).length + 1 : 0) + 4 : textWidth(latency(r.ttftMs, r.durationMs)),
    tokens: textWidth(tokens(promptTokens(r), r.outputTokens)),
    cost: textWidth(money(r.costMicros, r.costEstimated)),
  };
}

/**
 * 表身的骨架。
 *
 * **开窗时这一页要先去库里读两千条记录。**读完之前画「暂无请求记录」，
 * 是在说一件当时还不知道真假的事 —— 而且记录一到，版面会先塌一次再弹
 * 回来。骨架把行的位置占住，内容落在原地。
 *
 * **行高和真的行一样。**骨架条只有 12px 高，格子里只放它的话一行矮 8px，
 * 记录一到整张表往下一抻。每格垫一个看不见、零宽的字，行框就和一行字一样高。
 *
 * 八行，越往下越淡：够说明这里将要出现一张表，又不至于在真的没有记录时
 * 留下一屏假内容 —— 那种情况下接上的是空状态，不是骨架。
 */
function BodySkeleton({ widths }: { widths: string[] }) {
  return (
    <TableBody aria-busy="true">
      {Array.from({ length: 8 }, (_, row) => (
        <TableRow key={row} className="border-b border-border/60 hover:bg-transparent" style={{ opacity: 1 - row * 0.09 }}>
          {widths.map((w, col) => (
            <TableCell key={col}>
              <div className="flex items-center">
                <span aria-hidden className="invisible w-0 overflow-hidden">
                  0
                </span>
                <Skeleton className={cn("h-3 rounded-sm", w)} />
              </div>
            </TableCell>
          ))}
          <TableCell />
        </TableRow>
      ))}
    </TableBody>
  );
}

/** 一行在表里的标识：和 `itemsOf` 给的 `key` 一样。片段行、垫着的空行不是一项 */
function keyOf(tr: Element): string | null {
  const d = (tr as HTMLElement).dataset;
  if (d.row) return `r${d.row}`;
  if (d.session !== undefined) return `s${d.session}`;
  return null;
}

/**
 * 表体。**平铺和归组是同一张表的两个形态，不是两张表。**
 *
 * 归组打开时，每个会话出一行组头，展开之后它的请求跟在下面；认不出
 * 会话的那些没有组头，直接就是一行请求 —— 见 `groupBySession`。
 *
 * 过滤和排序在两个形态下都照常生效：它们作用在进到这里之前的 `rows`
 * 上，归组只是把同一批行重新摆一遍。**组与组之间沿用表头的排序，组内
 * 永远按时间正序** —— 一次任务的第 1 轮到第 47 轮是有顺序的。
 *
 * 键盘按 `lines`（grouping.ts）给出的顺序走，那是照着 `itemsOf` 的摆法写的：这里
 * 改了怎么摆，那边要跟着改。
 *
 * **只画看得见的那一段。**画哪一段记的是一个高度范围（`region`，表体里从上往下量），
 * 每一项多高量过就用量到的（`sizes`），没量过的按 `GUESS` 算；范围外的用上下两行空行
 * 垫出同样的高度，滚动条的长短、位置和整张表都画出来时一样。滚动时只在画着的那一段
 * 快要露底时才重新取一段，取的时候当场画（`flushSync`），快速滚动也不露出空白。
 *
 * 往上滚时，上面新画出来的行要是和估的不一样高，下面看着的那一行会跟着跳一下：
 * Chromium 自己会补（`overflow-anchor`），WebKit 不会，这里按差多少把滚动位置挪回去。
 */
function Body({
  handle,
  scroller,
  items,
  rows,
  groups,
  hits,
  openGroups,
  showClient,
  hints,
  via,
  today,
  cursor,
  fresh,
  freshGroups,
  selectedSession,
  onOpen,
  onCursor,
  onFilter,
  onToggleGroup,
  onOpenSession,
  onAbortSession,
}: {
  handle?: Ref<RequestTableHandle>;
  scroller: RefObject<HTMLElement | null>;
  items: Item[];
  rows: RequestRow[];
  groups?: Group[];
  hits?: ReadonlyMap<number, ContentHit>;
  openGroups: ReadonlySet<string>;
  showClient: boolean;
  hints: boolean;
  via: ViaConfig | null;
  today: number;
  cursor: Cursor | null;
  fresh: ReadonlySet<number>;
  freshGroups: ReadonlySet<string>;
  selectedSession: string | null;
  onOpen: (id: number) => void;
  onCursor: (c: Cursor) => void;
  onFilter: (f: (prev: Filter) => Filter) => void;
  onToggleGroup: (id: string) => void;
  onOpenSession: (id: string) => void;
  /** 中止一次会话里在跑的请求：交给页面弹确认 */
  onAbortSession: (id: string) => void;
}) {
  const t = useText(trafficText);
  const ts = useText(sessionsText);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  /** 量过的每一项的高度，按 `key` 记 */
  const sizes = useRef(new Map<string, number>());
  /** 还没量过的按多高算。每一种第一次量到时换成量到的 */
  const guess = useRef({ ...GUESS, learned: new Set<keyof typeof GUESS>() });
  /** 量到的高度变了：重算每一项的位置 */
  const [measured, setMeasured] = useState(0);
  const [region, setRegion] = useState({ top: 0, bottom: 1200 + OVERSCAN_PX });

  const estimate = useCallback(
    (it: Item) => {
      const g = guess.current;
      return it.kind === "session" ? g.session : g.request + (hits?.has(it.r.id) ? g.hit : 0);
    },
    [hits],
  );
  const offsets = useMemo(() => {
    void measured;
    return offsetsOf(items.length, (i) => sizes.current.get(items[i]!.key) ?? estimate(items[i]!));
  }, [items, estimate, measured]);
  const start = indexAt(offsets, region.top);
  const end = items.length === 0 ? 0 : indexAt(offsets, region.bottom) + 1;

  // 事件里要读的最新一版：滚动、量高度、键盘都在渲染之外
  const live = useRef({ items, offsets, start, end, estimate });
  useLayoutEffect(() => {
    live.current = { items, offsets, start, end, estimate };
  });

  /** 看得见的那一段，在表体里从上往下量 */
  const view = useCallback(() => {
    const s = scroller.current;
    const b = bodyRef.current;
    if (!s || !b) return null;
    const top = s.getBoundingClientRect().top - b.getBoundingClientRect().top;
    return { top, bottom: top + s.clientHeight };
  }, [scroller]);

  /** 画着的那一段还罩得住看得见的那一段（上下各留一截）吗？罩不住就重新取一段 */
  const check = useCallback(
    (now: boolean) => {
      const v = view();
      if (!v) return;
      const { items, offsets, start, end } = live.current;
      const covered =
        (start === 0 || offsets[start]! <= v.top - MARGIN_PX) &&
        (end >= items.length || offsets[end]! >= v.bottom + MARGIN_PX);
      if (covered) return;
      const next = { top: v.top - OVERSCAN_PX, bottom: v.bottom + OVERSCAN_PX };
      if (now) flushSync(() => setRegion(next));
      else setRegion(next);
    },
    [view],
  );

  /*
    每画完一次：量一遍画出来的每一项，再看画着的那一段够不够。

    一项的高是它和下一项上沿的差（片段行算在它上面那一项里），最后一项量到下面垫着的
    空行、或者表体的底。合并边框的表里行的矩形和边框怎么分说不清，按上沿相减不会错。
  */
  useLayoutEffect(() => {
    const body = bodyRef.current;
    const s = scroller.current;
    // 没在显示（窗口藏起来时某些引擎量出来全是 0）：不量，量到的 0 会把位置全算错
    if (!body || !s || s.clientHeight === 0) return;
    const { items, start } = live.current;
    const viewTop = s.getBoundingClientRect().top;
    const byKey = new Map<string, Item>();
    for (let i = start; i < live.current.end; i++) byKey.set(items[i]!.key, items[i]!);
    const found: { it: Item; top: number; h: number }[] = [];
    let open: { it: Item; top: number } | null = null;
    const close = (top: number) => {
      if (open) found.push({ ...open, h: top - open.top });
      open = null;
    };
    for (const tr of body.children) {
      const k = keyOf(tr);
      if (k === null && (tr as HTMLElement).dataset.spacer === undefined) continue;
      const top = tr.getBoundingClientRect().top;
      close(top);
      const it = k === null ? undefined : byKey.get(k);
      if (it) open = { it, top };
    }
    close(body.getBoundingClientRect().bottom);

    const g = guess.current;
    const kindOf = (it: Item) => (it.kind === "session" ? "session" : hits?.has(it.r.id) ? "hit" : "request");
    let changed = false;
    /*
      WebKit 不会自己稳住滚动位置：上面没画出来的那些按估的高垫着，估的一变、或者新画出来
      的和估的不一样高，看着的那一行就跟着跳。差多少，把滚动位置挪多少。
    */
    let shift = 0;
    for (const { it, top, h } of found) {
      const old = sizes.current.get(it.key);
      if (old !== undefined && Math.abs(old - h) < 0.5) continue;
      if (old === undefined && !NATIVE_ANCHOR && top + h <= viewTop) shift += h - live.current.estimate(it);
      sizes.current.set(it.key, h);
      changed = true;
    }
    /*
      第一次量到某一种（攒够三个）：取中位数 —— 多数行是一行字，折了行的更高，表里第一行
      和最后一行各差半个、一个像素的边框。
    */
    for (const kind of ["request", "session", "hit"] as const) {
      if (g.learned.has(kind) || (kind === "hit" && !g.learned.has("request"))) continue;
      const hs = found.flatMap(({ it, h }) => (kindOf(it) === kind ? [kind === "hit" ? h - g.request : h] : []));
      if (hs.length < 3) continue;
      const was = g[kind];
      g[kind] = hs.sort((a, b) => a - b)[hs.length >> 1]!;
      g.learned.add(kind);
      changed = true;
      if (!NATIVE_ANCHOR)
        for (let i = 0; i < start; i++) {
          const it = items[i]!;
          if (!sizes.current.has(it.key) && kindOf(it) === kind) shift += g[kind] - was;
        }
    }
    // 不在表里的项不再留着：攒到比表里多出一倍时清一次
    if (sizes.current.size > 2 * items.length + 200) {
      const keep = new Set(items.map((it) => it.key));
      for (const k of sizes.current.keys()) if (!keep.has(k)) sizes.current.delete(k);
    }
    if (shift !== 0) s.scrollTop += shift;
    if (changed) setMeasured((n) => n + 1);
    else check(false);
  });

  useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const onScroll = () => check(true);
    s.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => check(false));
    ro.observe(s);
    return () => {
      s.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [scroller, check]);

  useImperativeHandle(
    handle,
    () => ({
      /*
        **选中的那一行要一直看得见。**只滚刚好够的距离（`nearest`）；让开吸顶的表头、
        不横着滚，靠的是行上的 scroll-margin，见 `RequestTable`。

        那一行可能还没画出来（滚到别处去了，再按方向键）：先按算出来的位置滚到它刚好
        露出来，当场画出那一段，再交给 `scrollIntoView` 按真的位置收尾。
      */
      reveal(c) {
        const body = bodyRef.current;
        const s = scroller.current;
        if (!body || !s) return;
        const sel = c.kind === "request" ? `[data-row="${c.id}"]` : `[data-session="${CSS.escape(c.id)}"]`;
        let el = body.querySelector(sel);
        if (!el) {
          const { items, offsets } = live.current;
          const i = items.findIndex((it) => it.key === (c.kind === "request" ? `r${c.id}` : `s${c.id}`));
          const v = view();
          // 折起来的组里的那一条不在表里，和原来一样不滚
          if (i < 0 || !v) return;
          if (offsets[i]! - HEAD_PX < v.top) s.scrollTop += offsets[i]! - HEAD_PX - v.top;
          else s.scrollTop += offsets[i + 1]! - v.bottom;
          const w = view();
          if (w) flushSync(() => setRegion({ top: w.top - OVERSCAN_PX, bottom: w.bottom + OVERSCAN_PX }));
          el = body.querySelector(sel);
        }
        el?.scrollIntoView({ block: "nearest" });
      },
    }),
    [scroller, view],
  );

  /*
    右键和行尾「…」的条目。整张表共用一份菜单（`TableMenus`），打开时按点中的那一行填。
    那一行已经不在表里了（被筛掉、被挤出上限）就不开。
  */
  const itemsFor = (m: MenuTarget): MenuItems | null => {
    if (m.kind === "request") {
      const r = rows.find((x) => x.id === m.id);
      return r ? requestItems(r, t, showClient, onOpen, onFilter) : null;
    }
    const g = groups?.find((x) => x.id === m.id);
    if (!g) return null;
    return sessionItems(m.id, openGroups.has(m.id), ts, {
      openIt: () => {
        onCursor({ kind: "session", id: m.id });
        onOpenSession(m.id);
      },
      toggle: () => onToggleGroup(m.id),
      // 组里还有在跑、能中止的请求才给
      abort: g.rows.some(abortable) ? () => onAbortSession(m.id) : undefined,
    });
  };

  const opened = useJustOpened(openGroups);
  const atRow = cursor?.kind === "request" ? cursor.id : null;
  const atHead = cursor?.kind === "session" ? cursor.id : null;
  const cols = showClient ? 9 : 8;
  const above = offsets[start] ?? 0;
  const below = (offsets[items.length] ?? 0) - (offsets[end] ?? 0);
  return (
    <TableMenus itemsFor={itemsFor}>
      {/*
        **`Body` 自己就是 `<tbody>`，外面不能再套一层。**套了的话 DOM 里是两个 tbody，
        外面那个空的 —— 而表头会按那个空的算列宽，于是表头和表体的列完全对不上。
      */}
      <TableBody ref={bodyRef}>
        {above > 0 && <Spacer height={above} cols={cols} />}
        {items.slice(start, end).map((it) =>
          it.kind === "request" ? (
            /*
              **「上一行」是屏幕上的上一行，不是数组里的前一个**：归组之后上一行可能是
              组头，也可能是另一个会话的最后一条 —— 拿下标去原数组里回看会把相邻的两组
              连起来，而那几列（密钥、模型、上游）正是靠「和上一行相同就压暗」来减噪的。
            */
            <Row
              key={it.key}
              r={it.r}
              hit={hits?.get(it.r.id)}
              sameClient={it.prev !== undefined && clientKey(it.prev) === clientKey(it.r)}
              sameModel={it.prev !== undefined && (it.prev.model ?? "") === (it.r.model ?? "")}
              sameProvider={it.prev !== undefined && upstreamText(it.prev) === upstreamText(it.r)}
              showClient={showClient}
              hints={hints}
              via={via}
              today={today}
              selected={atRow === it.r.id}
              fresh={fresh.has(it.r.id)}
              inGroup={it.inGroup !== null}
              fading={it.inGroup !== null && opened.has(it.inGroup)}
              onOpen={onOpen}
              onCursor={onCursor}
            />
          ) : (
            <SessionRow
              key={it.key}
              g={it.g}
              open={it.open}
              showClient={showClient}
              hints={hints}
              // 右边开着的那次会话，或者键盘停在这个组头上
              selected={selectedSession === it.g.id || atHead === it.g.id}
              fresh={it.g.id !== null && freshGroups.has(it.g.id)}
              onToggle={onToggleGroup}
              onOpen={onOpenSession}
              onCursor={onCursor}
            />
          ),
        )}
        {below > 0 && <Spacer height={below} cols={cols} />}
      </TableBody>
    </TableMenus>
  );
}

/**
 * 没画出来的那些行占的高度。不当滚动的锚点（`overflow-anchor: none`）：Chromium 稳住
 * 滚动位置时要盯着一行真的行，盯着它的话，换一段画它一变高，看着的行反而跳了。
 */
function Spacer({ height, cols }: { height: number; cols: number }) {
  return (
    <tr aria-hidden data-spacer="" className="border-b border-border/60 [overflow-anchor:none]" style={{ height }}>
      <td colSpan={cols} className="p-0" />
    </tr>
  );
}

/** 「刚展开」算多久：和 `motion-fade` 一样长，多留一点 */
const OPENED_MS = 300;

/**
 * 刚展开的那几个组。**组里的行只在展开的那一下淡入**：之后滚进视野的行是重新画出来的，
 * 不是刚出现的，再淡一次就是一路滚一路闪。
 *
 * 在渲染时比上一次的展开集合：放到 effect 里的话，展开后的第一帧行已经画出来了，下一帧
 * 才挂上淡入，等于先闪一下再淡入。
 */
function useJustOpened(open: ReadonlySet<string>): ReadonlySet<string> {
  const last = useRef(open);
  const fresh = useRef<{ ids: ReadonlySet<string>; at: number }>({ ids: new Set(), at: 0 });
  if (last.current !== open) {
    const prev = last.current;
    fresh.current = { ids: new Set([...open].filter((id) => !prev.has(id))), at: Date.now() };
    last.current = open;
  }
  return Date.now() - fresh.current.at < OPENED_MS ? fresh.current.ids : NONE;
}
const NONE: ReadonlySet<string> = new Set();

/** 密钥那一格比的是这几样：密钥、推测的应用、来源 */
const clientKey = (x: RequestRow) => `${x.client}|${x.keyMasked ?? ""}|${x.hint ?? ""}|${x.peer ?? ""}`;

/** `statusTone`（format.ts）的五种说法，映到状态点的五种语气 */
const TONE: Record<ReturnType<typeof statusTone>, StatusTone> = {
  pending: "pending",
  bad: "error",
  warn: "warn",
  muted: "idle",
  ok: "ok",
};

/** 一条请求的菜单条目：右键和行尾的「…」共用这一份 */
function requestItems(
  r: RequestRow,
  t: Text,
  showClient: boolean,
  onOpen: (id: number) => void,
  onFilter: (f: (prev: Filter) => Filter) => void,
): MenuItems {
  return [
    { kind: "item", label: t.openDetails, onSelect: () => onOpen(r.id) },
    { kind: "sep" },
    // **按这一行的值筛，不是打开一个筛选器。**排查时的动作是「这一个上游的」
    // 「这一把密钥的」，而手打名字会打错，打错的表现是「筛出来空的」
    // 没有发往任何上游的那几行上游是空的，没有可筛的
    ...(r.provider
      ? ([
          {
            kind: "item",
            label: t.onlyUpstream(r.provider),
            name: r.provider,
            onSelect: () => onFilter((f) => ({ ...f, provider: r.provider })),
          },
        ] as const)
      : []),
    ...(showClient
      ? ([
          {
            kind: "item",
            label: t.onlyClient(r.client),
            name: r.client,
            onSelect: () => onFilter((f) => ({ ...f, client: r.client })),
          },
        ] as const)
      : []),
    { kind: "sep" },
    { kind: "item", label: t.copyId, onSelect: () => void copyText(String(r.id)) },
    {
      kind: "item",
      label: t.copyRow,
      onSelect: () =>
        void copyText(
          [
            new Date(r.atMs).toLocaleString(),
            r.client,
            r.model ?? "",
            upstreamText(r),
            r.path,
            r.status ?? r.state,
            r.durationMs != null ? `${r.durationMs}ms` : "",
            tokens(promptTokens(r), r.outputTokens),
            money(r.costMicros, r.costEstimated),
            coreText(r.error),
          ]
            .filter(Boolean)
            .join("\t"),
        ),
    },
    // 还在跑的才能中止。跑在 WebSocket 连接上的跟着连接走，不单独中止（见 `abortable`）
    ...(abortable(r)
      ? ([
          { kind: "sep" },
          { kind: "item", label: textOf(abortText).abortRequest, danger: true, onSelect: () => void abortRequest(r.id) },
        ] as const)
      : []),
  ];
}

/** 一行的一格里画什么。行自己和表头量列宽的那一块（`Sizer`）都用它 */
function requestCell(col: Col, r: RequestRow, c: { hints: boolean; via: ViaConfig | null; today: number }): ReactNode {
  switch (col) {
    case "status":
      return <StatusCell r={r} />;
    case "time":
      return (
        <Tip lazy text={new Date(r.atMs).toLocaleString()}>
          <span>{when(r.atMs, c.today)}</span>
        </Tip>
      );
    case "client":
      return <RowKeyCell r={r} hints={c.hints} />;
    case "model":
      return (
        // 截断要套在里面一层：`max-width` 加在 td 上会被表格自己的列宽算法吃掉，长名字照样把这一列撑开
        <Tip clip text={r.model}>
          <div className="truncate" style={{ maxWidth: NAME_PX.model }}>
            {r.model ?? "—"}
          </div>
        </Tip>
      );
    case "upstream":
      return <UpstreamCell r={r} via={c.via} />;
    case "latency":
      return r.state === "in_flight" ? <Running r={r} /> : <LatencyCell r={r} />;
    case "tokens":
      return <TokensCell r={r} />;
    case "cost":
      return <CostCell r={r} />;
  }
}

/**
 * 一条请求，一行。`memo`：属性不变就不重画，见 `RequestTable` 的注释。
 */
const Row = memo(function Row({
  r,
  hit,
  sameClient,
  sameModel,
  sameProvider,
  showClient,
  hints,
  via,
  today,
  selected,
  fresh,
  inGroup,
  fading,
  onOpen,
  onCursor,
}: {
  r: RequestRow;
  /** 按内容搜到的：对上的那一段，在这一行下面另起一行 */
  hit?: ContentHit;
  sameClient: boolean;
  sameModel: boolean;
  sameProvider: boolean;
  showClient: boolean;
  hints: boolean;
  /** 对「别名」「指定」用的配置（见 `modelVia.ts`）。换了一版配置每一行重画一次 */
  via: ViaConfig | null;
  today: number;
  selected: boolean;
  fresh: boolean;
  /** 在一个展开了的组里：往里缩一格，它属于上面那个组头 */
  inGroup: boolean;
  /** 它的组刚展开：淡入（见 `useJustOpened`） */
  fading: boolean;
  onOpen: (id: number) => void;
  onCursor: (c: Cursor) => void;
}) {
  const t = useText(trafficText);
  const c = { hints, via, today };
  // 点一行和键盘选中一行是同一件事：之后的方向键从这一行接着走
  const activate = () => {
    onCursor({ kind: "request", id: r.id });
    onOpen(r.id);
  };
  const row = (
    <TableRow
      data-row={r.id}
      data-state={selected ? "selected" : undefined}
      aria-selected={selected}
      onClick={activate}
      className={cn(
        ROW,
        fresh ? "motion-row-in" : fading && "motion-fade",
        inGroup && "[&>td:first-child]:pl-7",
        // 下面跟着片段那一行：分隔线画在片段下面，悬停到片段上时这一行也亮
        hit && "border-b-0 [&:has(+tr:hover)]:bg-foreground/[0.035]",
      )}
    >
      {/*
        状态用色点编码。**25 个灰色 200 排成一列是零信息** ——
        眼睛要能一眼扫到那个 5xx，而不是逐行读数字。
      */}
      <TableCell>{requestCell("status", r, c)}</TableCell>
      {/*
        时间用绝对值。**相对时间在这一列会塌掉** —— 打开应用
        看昨天那次时，整列全是「1d」，而这一列的用途就是把
        某一行对上号。完整的日期和时间留给悬停。
      */}
      <TableCell className="text-muted-foreground">{requestCell("time", r, c)}</TableCell>
      {showClient && <TableCell className={cn(sameClient && DIM)}>{requestCell("client", r, c)}</TableCell>}
      {/*
        模型。**这一列决定了这次多贵、多慢** —— 同一个客户端
        连着发的两次请求，差别往往只在这里。
      */}
      <TableCell className={cn(sameModel && DIM)}>{requestCell("model", r, c)}</TableCell>
      <TableCell className={cn("whitespace-normal", sameProvider && DIM)}>{requestCell("upstream", r, c)}</TableCell>
      {/*
        数字右对齐。左对齐时 253ms 和 1486ms 的个位对不齐，
        扫一列找最慢的那条要逐行读 —— 而这一列存在的意义就是
        扫出极值。
      */}
      <TableCell className="text-right">{requestCell("latency", r, c)}</TableCell>
      <TableCell className="text-right text-muted-foreground">{requestCell("tokens", r, c)}</TableCell>
      <TableCell className="text-right">{requestCell("cost", r, c)}</TableCell>
      {/*
        **点「…」不能连带打开这一行。**按钮上的点击会冒泡到行上，行一收到
        就去开详情，菜单和抽屉会一起出来。只在悬停、选中、菜单开着时出现：
        两千行各带一个常亮的「…」，整列就是一道噪点。
      */}
      <TableCell className="w-6 px-0! py-0 text-center" onClick={(e) => e.stopPropagation()}>
        <RowActions target={{ kind: "request", id: r.id }} label={t.rowActions(r.id)} selected={selected} />
      </TableCell>
    </TableRow>
  );
  if (!hit) return row;
  /*
    **片段另起一行，跨过状态以外的各列。**放进哪一格里都太窄（模型一格最宽 13rem），
    而这一段话正是按内容搜索的人要看的。它不是表里的一行请求：没有 `data-row`，键盘
    不停在它上面；点它、右键它和点上面那一行一样。字可以选（行上的字不能选：整张表体
    是右键菜单的触发器）。
  */
  return (
    <>
      {row}
      <TableRow
        data-hit={r.id}
        data-state={selected ? "selected" : undefined}
        onClick={activate}
        className={cn(
          ROW,
          "select-text [tr:hover+&]:bg-foreground/[0.035]",
          fresh ? "motion-row-in" : fading && "motion-fade",
        )}
      >
        <TableCell className="pt-0" />
        <TableCell colSpan={showClient ? 8 : 7} className="pt-0 pb-2">
          <HitText hit={hit} />
        </TableCell>
      </TableRow>
    </>
  );
});

/**
 * 按内容对上的那一段：前面一个词说是请求里的还是回答里的，对上的字标出来。
 *
 * **不撑宽表格。**片段有一百来个字，表格按内容定列宽，放开写会把各列都撑开；里面
 * 一层零宽、`min-w-full` 的块，宽度只跟着格子走，放不下的截掉（core 给的片段前后
 * 已经带着「…」）。
 */
function HitText({ hit }: { hit: ContentHit }) {
  const t = useText(trafficText);
  return (
    <div className="w-0 min-w-full truncate text-muted-foreground" title={hit.before + hit.matched + hit.after}>
      <span className="mr-2 text-foreground/70">{hit.side === "request" ? t.hitRequest : t.hitAnswer}</span>
      {hit.before}
      <mark className="rounded-[3px] bg-foreground/10 text-foreground">{hit.matched}</mark>
      {hit.after}
    </div>
  );
}

/**
 * 在跑的那一条的延迟：第一个 token 到了就先写它，后面是已经跑了多久，每秒走一格
 * （`1180→0:42`）。灰的，而且写成时钟的样子 —— 别让它看起来像已经结束的总耗时；
 * 结局一到换成「首 token→总耗时」。
 *
 * 秒针只改这一格里的字（`Elapsed`），行和表都不重画。
 */
function Running({ r }: { r: RequestRow }) {
  return (
    <span className="text-muted-foreground">
      {r.ttftMs != null && `${r.ttftMs}→`}
      <Elapsed at={r.atMs} />
    </span>
  );
}

/**
 * 跑完的那一条的延迟：首 token→总耗时。
 *
 * **生成速度在悬停里，不另占一列。**默认窗口下这张表已经放满了，再加一列，英文
 * 界面里最右边的费用就出了视野。悬停写全四个数：首 token、总耗时、生成用时、生成
 * 速度（core 算好的，没有就不写那一行）。非流式的没有首 token，只写总耗时、没有悬停。
 */
function LatencyCell({ r }: { r: RequestRow }) {
  const t = useText(trafficText);
  const text = latency(r.ttftMs, r.durationMs);
  if (r.ttftMs == null || r.durationMs == null) return <>{text}</>;
  return (
    <Tip
      lazy
      text={
        <Lines
          lines={t.latencyTip(
            ms(r.ttftMs),
            ms(r.durationMs),
            ms(Math.max(0, r.durationMs - r.ttftMs)),
            r.tokensPerSec != null ? r.tokensPerSec.toLocaleString() : null,
          )}
        />
      }
    >
      <span className="underline decoration-dotted underline-offset-2">{text}</span>
    </Tip>
  );
}

/** 状态那一格的字：在跑的写状态码（响应头到了才有），失败、取消写成字 */
function statusText(r: RequestRow, t: Text): string {
  if (r.state === "in_flight") return r.status != null ? String(r.status) : "…";
  if (r.state === "failed") return failureKind(r.error) === "aborted" ? t.aborted : t.failed;
  if (r.state === "cancelled") return t.cancelled;
  return r.status != null ? String(r.status) : "";
}

function StatusCell({ r }: { r: RequestRow }) {
  const t = useText(trafficText);
  // 手动中止的不是故障：和取消一样是灰的
  const tone =
    r.state === "failed" && failureKind(r.error) === "aborted" ? "idle" : TONE[statusTone(r.status, r.state)];
  return (
    <span className="flex items-center gap-1.5">
      {/* 成功的点压淡一点：一整列都是它，它不是要找的那个 */}
      <StatusDot tone={tone} className={tone === "ok" ? "opacity-70" : undefined} />
      {/* 在跑的：响应头到了就有状态码，流还在往下走；点在跳，说的是请求尚未结束 */}
      <span className={tone === "error" || tone === "warn" ? undefined : "text-muted-foreground"}>{statusText(r, t)}</span>
    </span>
  );
}

/**
 * 上游那一格：标志、名字，和这次请求上发生过的事（脱敏、删除、格式转换、可疑调用）。
 *
 * **徽标宁可折到第二行，也不能把表撑宽。**格子一律不换行的话，一行同时带
 * 「已脱敏」和「已转换 · 丢弃 n 项」，这一格就有 240px，默认窗口下表比容器
 * 宽出 40px —— 被挤出视野的是最后一列费用，而那是这张表里最要紧的一列。
 * 其余各列都不换行，表格变窄时只有这一列收得动。只在徽标之间折，徽标自身
 * 不断开：窄了是这一行变高，不是哪一列看不见。
 */
function UpstreamCell({ r, via }: { r: RequestRow; via: ViaConfig | null }) {
  const t = useText(trafficText);
  const sent = notSent(r);
  const mark = rowMark(r, via);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {/*
        本地应答的那一句（英文两个词）可以在词间折行：它不是一个名字，别让它定这一列的最小宽度。
        上游的名字不折行，**连同标志封顶**（`NAME_PX`）：再长的截断，悬停看全
      */}
      <span
        className={cn("flex items-center gap-1.5", !r.local && !sent && "whitespace-nowrap")}
        style={r.local || sent ? undefined : { maxWidth: NAME_PX.upstream }}
      >
        {/* 被规则拒绝、选中的上游一个都接不了的请求没有发往任何上游：上游是空的，
            这一格说是哪一种，图形和路由图上的拒绝一致。和本地应答一样是一句话、不是
            名字，可以在词间折行 */}
        {sent ? (
          <>
            <NotSentIcon kind={sent} />
            <span>{notSentText(sent)}</span>
          </>
        ) : (
          <>
            {r.local || !r.provider ? (
              <span aria-hidden className="size-4 shrink-0" />
            ) : (
              <UpstreamLogo name={r.provider} className="opacity-70" />
            )}
            {r.local ? (
              <span>{upstreamText(r)}</span>
            ) : r.provider ? (
              <Tip clip text={r.provider}>
                <span className="min-w-0 truncate">{r.provider}</span>
              </Tip>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </>
        )}
      </span>
      {/* 发出的模型名不是客户端写的那个（或者是规则指定的）：模型那一列照旧写客户端的名称，
          这里说一声，发出的名称在悬停和详情的路由页里 */}
      {mark && (
        <Tip
          lazy
          text={
            mark.via === "alias"
              ? t.aliasTip(r.model ?? "", r.provider, mark.sent)
              : t.pinnedTip(mark.rule, r.provider, mark.sent)
          }
        >
          <AliasMark>{mark.via === "pinned" ? t.pinned : undefined}</AliasMark>
        </Tip>
      )}
      {/* **看不见的安全功能会被用户关掉**，因为他们会怀疑是脱敏搞坏了功能。
          所以脱敏发生了就要在列表这一层看得见，而不是藏在详情里 */}
      {r.secrets && r.secrets.items.length > 0 && (
        <Mark
          // 换掉了是灰的；原样发出去的要看得出来
          variant={r.secrets.replaced ? "secondary" : "warning"}
          tip={(r.secrets.replaced ? t.redactedTip : t.secretsTip)(
            r.secrets.items.map((x) => `${ruleName("redact", x.rule, x.custom)} ×${x.count}`),
          )}
        >
          {(r.secrets.replaced ? t.redacted : t.withSecrets)(r.secrets.items.reduce((a, x) => a + x.count, 0))}
        </Mark>
      )}
      {/* 内容过滤删掉过命中的文字：和脱敏一样，改了请求就要在列表这一层看得见。灰的 ——
          防护在起作用，请求照常发出 */}
      {r.stripped && r.stripped.length > 0 && (
        <Mark variant="secondary" tip={t.strippedTip(r.stripped.map((x) => ruleName("content", x.rule, x.custom)))}>
          {t.stripped}
        </Mark>
      )}
      {/* 格式转换。**转了就要看得见，丢了字段更要看得见** —— 「扩展思考开了却
          没生效」这个症状在客户端那头完全无从下手，只有这里知道原因 */}
      {r.translated && (
        <Mark
          variant={r.translated.dropped.length > 0 ? "warning" : "secondary"}
          tip={
            t.sentConverted(translatedText(r.translated)) +
            (r.translated.dropped.length > 0 ? t.droppedFields(r.translated.dropped) : t.noneDropped)
          }
        >
          {r.translated.dropped.length > 0 ? t.convertedDropped(r.translated.dropped.length) : t.converted}
        </Mark>
      )}
      {r.flagged && r.flagged.length > 0 && (
        <Mark
          variant={r.flagged.some((f) => f.blocked) ? "destructive" : "warning"}
          tip={r.flagged
            .map((f) => t.flaggedTip(f.tool, ruleName("inspect_tools", f.rule, f.custom), f.excerpt))
            .join("\n\n")}
        >
          {r.flagged.some((f) => f.blocked) ? t.blocked : t.suspicious}
        </Mark>
      )}
      {/* 插件改写过的。**改动要看得见**：改写前后在请求详情里对比 */}
      {r.pluginChanged && (
        <Mark variant="secondary" tip={t.pluginChangedTip}>
          {t.pluginChanged}
        </Mark>
      )}
    </div>
  );
}

/** 上游那一格里的一枚徽标。比通用的 `Badge` 矮一档：一行只有 32px */
function Mark({
  variant,
  tip,
  children,
}: {
  variant: "secondary" | "warning" | "destructive";
  tip: string;
  children: ReactNode;
}) {
  return (
    <Tip lazy text={<span className="whitespace-pre-line">{tip}</span>}>
      <Badge variant={variant} className="h-[18px] rounded-[5px] px-1.5 font-normal">
        {children}
      </Badge>
    </Tip>
  );
}

/**
 * token：输入合计 → 输出。
 *
 * **输入合计含缓存读写。**core 的「输入」只是新输入，和缓存读取、缓存写入三者不
 * 重叠；只写新输入的话，一轮带着五万 token 上下文的 Claude Code 请求在这里是「1.2k」
 * —— 而这一列要回答的正是「上下文有多大」。三样各是多少写在悬停里。
 *
 * **流量也在悬停里，不另占一列**（和生成速度在延迟那一格的悬停里同一个理由）：这一条
 * 上传、下载各多少。token 是模型读写的量，流量是线上传的量，放在一起看得出上下文大小
 * 和带宽是不是一回事。
 */
function TokensCell({ r }: { r: RequestRow }) {
  const t = useText(trafficText);
  const prompt = promptTokens(r);
  const text = tokens(prompt, r.outputTokens);
  if (prompt === undefined || r.outputTokens === undefined) return <>{text}</>;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString();
  return (
    <Tip
      lazy
      text={
        <Lines
          lines={[
            t.promptTip(n(prompt)),
            t.promptParts(n(r.inputTokens), n(r.cacheReadTokens), n(r.cacheWriteTokens)),
            t.outputTip(n(r.outputTokens)),
            // 本地应答的、没发给上游的没有流量
            ...(r.sentBytes != null ? [t.uploadTip(traffic(r.sentBytes))] : []),
            ...(r.receivedBytes != null ? [t.downloadTip(traffic(r.receivedBytes))] : []),
          ]}
        />
      }
    >
      {/* 虚线只在指着时出现：延迟那一列已经整列带着虚线，两列挨着都带就太花了 */}
      <span className="decoration-dotted underline-offset-2 hover:underline">{text}</span>
    </Tip>
  );
}

/**
 * 费用。**估算值必须带记号**：猜出来的金额和账单上的数字在列表里长得一模一样，
 * 而它们不是一回事。没有金额写「—」，不写 $0。
 */
function CostCell({ r }: { r: RequestRow }) {
  const t = useText(trafficText);
  if (!r.costEstimated) {
    return <span className={r.costMicros == null ? "text-muted-foreground" : undefined}>{money(r.costMicros, false)}</span>;
  }
  // 估算的理由要说对：取消和中断的那些，是输出只数到了断开时；别的估算来自
  // 价目表 —— 这个模型的单价是从其他平台借来的
  return (
    <Tip
      lazy
      text={
        r.state === "cancelled" ? t.estimatedCancelled : r.state === "failed" ? t.estimatedFailed : t.estimatedBorrowed
      }
    >
      <span className="underline decoration-dotted underline-offset-2">{money(r.costMicros, true)}</span>
    </Tip>
  );
}
