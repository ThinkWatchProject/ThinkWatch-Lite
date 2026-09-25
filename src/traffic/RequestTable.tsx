import { Fragment, memo, useDeferredValue, type ReactNode } from "react";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { cn } from "@/lib/utils";
import { latency, money, statusTone, tokens, when } from "@/format";
import { translatedText } from "@/labels";
import { ruleName } from "@/security/labels";
import { promptTokens, type Filter, type SortDir, type SortKey } from "@/requestTable";
import type { RequestRow } from "@/types";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { UpstreamLogo } from "@/ui/logos";
import { RowMenu, RowMenuButton, type MenuItems } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import { StatusDot, type StatusTone } from "@/ui/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { copyText, DIM, Lines, MENU_REVEAL, ROW, RowKeyCell } from "./cells";
import { sortWithin, type Cursor, type Group } from "./grouping";
import { SessionRow } from "./SessionRow";
import { trafficText } from "./Traffic.i18n";

/**
 * 第一帧先画多少行。**其余的在后台补齐**（`useDeferredValue`）：一进这一页就要
 * 把两千行一次画完的话，切页要卡上一下，淡入的动画也被卡掉了。先画的这些够铺满
 * 一屏还有富余，补齐的那一下发生在视野外。
 */
const FIRST_PAINT = 60;

/**
 * 流量页那张请求表。
 *
 * 平铺和按会话归组是同一张表的两个形态（`groups` 给了就是归组）。行是 `memo`
 * 的：键盘挪一格只重画离开和到达的两行，一条请求落地只重画那一行。这要求行对象
 * 不被原地修改 —— `useRequests` 改一行之前先换成新对象，见那边的 `touches`。
 */
export function RequestTable({
  rows,
  groups,
  openGroups,
  selectedSession,
  onToggleGroup,
  onOpenSession,
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
  rows: RequestRow[];
  /** 给了就是归组形态。不给就是平表 */
  groups?: Group[];
  /** 展开着的那几个会话 */
  openGroups: ReadonlySet<string>;
  /** 右侧开着的那次会话 */
  selectedSession: string | null;
  onToggleGroup: (id: string) => void;
  onOpenSession: (id: string) => void;
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
  const shownRows = useDeferredValue(rows, rows.slice(0, FIRST_PAINT));
  const shownGroups = useDeferredValue(groups, groups?.slice(0, FIRST_PAINT));
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
        两列毫秒数，不看列名根本分不出哪个是首字节哪个是总耗时 ——
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
          <Th k="status" label={t.status} sort={sortKey} dir={sortDir} on={onSort} className="py-1.5" />
          <Th k="time" label={t.time} sort={sortKey} dir={sortDir} on={onSort} />
          {/* 只有一把密钥时这一列每行都一样 —— 那是零信息 */}
          {showClient && <TableHead>{t.client}</TableHead>}
          <TableHead>{t.model}</TableHead>
          <TableHead>{t.upstream}</TableHead>
          {/* 首字节和总耗时合成一列 —— 非流式请求两者几乎相同 */}
          <Th k="duration" label={t.latency} sort={sortKey} dir={sortDir} on={onSort} className="text-right" />
          <Th k="tokens" label={t.tokens} sort={sortKey} dir={sortDir} on={onSort} className="text-right" />
          <Th k="cost" label={t.cost} sort={sortKey} dir={sortDir} on={onSort} className="text-right" />
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
        /*
          **`RequestRows` 自己就是 `<tbody>`，这里不能再套一层。**
          套了的话 DOM 里是两个 tbody，外面那个空的 —— 而表头
          会按那个空的算列宽，于是表头和表体的列完全对不上。
        */
        <RequestRows
          rows={shownRows}
          groups={shownGroups}
          openGroups={openGroups}
          showClient={showClient}
          hints={hints}
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
}: {
  k: SortKey;
  label: string;
  sort: SortKey;
  dir: SortDir;
  on: (k: SortKey) => void;
  className?: string;
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
    </TableHead>
  );
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
 * 键盘按 `lines`（grouping.ts）给出的顺序走，那是照着这里的摆法写的：这里
 * 改了怎么摆，那边要跟着改。
 */
function RequestRows({
  rows,
  groups,
  openGroups,
  showClient,
  hints,
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
}: {
  rows: RequestRow[];
  groups?: Group[];
  openGroups: ReadonlySet<string>;
  showClient: boolean;
  hints: boolean;
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
}) {
  const atRow = cursor?.kind === "request" ? cursor.id : null;
  const atHead = cursor?.kind === "session" ? cursor.id : null;
  /**
   * 一条请求一行。**「上一行」是屏幕上的上一行，不是数组里的前一个**：归组之后
   * 上一行可能是组头，也可能是另一个会话的最后一条 —— 拿下标去原数组里回看会把
   * 相邻的两组连起来，而那几列（密钥、模型、上游）正是靠「和上一行相同就压暗」
   * 来减噪的。
   */
  const one = (r: RequestRow, prev: RequestRow | undefined, inGroup: "open" | null) => (
    <Row
      key={r.id}
      r={r}
      sameClient={prev !== undefined && clientKey(prev) === clientKey(r)}
      sameModel={prev !== undefined && (prev.model ?? "") === (r.model ?? "")}
      sameProvider={prev !== undefined && prev.provider === r.provider}
      showClient={showClient}
      hints={hints}
      today={today}
      selected={atRow === r.id}
      fresh={fresh.has(r.id)}
      inGroup={inGroup}
      onOpen={onOpen}
      onCursor={onCursor}
      onFilter={onFilter}
    />
  );

  if (!groups) {
    return <TableBody>{rows.map((r, i) => one(r, rows[i - 1], null))}</TableBody>;
  }

  return (
    <TableBody>
      {groups.map((g) => {
        // 无主的请求没有组头 —— 把它们凑成一组等于声称它们属于同一次任务
        if (g.id === null) {
          const r = g.rows[0];
          return r ? one(r, undefined, null) : null;
        }
        const id = g.id;
        const open = openGroups.has(id);
        const inside = open ? sortWithin(g) : [];
        return (
          <Fragment key={id}>
            <SessionRow
              g={g}
              open={open}
              showClient={showClient}
              hints={hints}
              // 右边开着的那次会话，或者键盘停在这个组头上
              selected={selectedSession === id || atHead === id}
              fresh={freshGroups.has(id)}
              onToggle={onToggleGroup}
              onOpen={onOpenSession}
              onCursor={onCursor}
            />
            {inside.map((r, i) => one(r, inside[i - 1], "open"))}
          </Fragment>
        );
      })}
    </TableBody>
  );
}

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

/**
 * 一条请求，一行。`memo`：属性不变就不重画，见 `RequestTable` 的注释。
 */
const Row = memo(function Row({
  r,
  sameClient,
  sameModel,
  sameProvider,
  showClient,
  hints,
  today,
  selected,
  fresh,
  inGroup,
  onOpen,
  onCursor,
  onFilter,
}: {
  r: RequestRow;
  sameClient: boolean;
  sameModel: boolean;
  sameProvider: boolean;
  showClient: boolean;
  hints: boolean;
  today: number;
  selected: boolean;
  fresh: boolean;
  /** 在一个展开了的组里：往里缩一格，它属于上面那个组头；展开时淡入 */
  inGroup: "open" | null;
  onOpen: (id: number) => void;
  onCursor: (c: Cursor) => void;
  onFilter: (f: (prev: Filter) => Filter) => void;
}) {
  const t = useText(trafficText);
  const copy = copyText;
  // 右键和行尾的「…」共用这一份
  const items: MenuItems = [
    { kind: "item", label: t.openDetails, onSelect: () => onOpen(r.id) },
    { kind: "sep" },
    // **按这一行的值筛，不是打开一个筛选器。**排查时的动作是「这一个上游的」
    // 「这一把密钥的」，而手打名字会打错，打错的表现是「筛出来空的」
    // 没有发往任何上游的那几行上游是空的，没有可筛的
    ...(r.provider
      ? ([
          { kind: "item", label: t.onlyUpstream(r.provider), onSelect: () => onFilter((f) => ({ ...f, provider: r.provider })) },
        ] as const)
      : []),
    ...(showClient
      ? ([
          { kind: "item", label: t.onlyClient(r.client), onSelect: () => onFilter((f) => ({ ...f, client: r.client })) },
        ] as const)
      : []),
    { kind: "sep" },
    { kind: "item", label: t.copyId, onSelect: () => void copy(String(r.id)) },
    {
      kind: "item",
      label: t.copyRow,
      onSelect: () =>
        void copy(
          [
            new Date(r.atMs).toLocaleString(),
            r.client,
            r.model ?? "",
            r.provider,
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
  ];
  return (
    <RowMenu items={items}>
      <TableRow
        data-row={r.id}
        data-state={selected ? "selected" : undefined}
        aria-selected={selected}
        onClick={() => {
          // 点一行和键盘选中一行是同一件事：之后的方向键从这一行接着走
          onCursor({ kind: "request", id: r.id });
          onOpen(r.id);
        }}
        className={cn(
          ROW,
          fresh ? "motion-row-in" : inGroup === "open" && "motion-fade",
          inGroup && "[&>td:first-child]:pl-7",
        )}
      >
        {/*
          状态用色点编码。**25 个灰色 200 排成一列是零信息** ——
          眼睛要能一眼扫到那个 5xx，而不是逐行读数字。
        */}
        <TableCell>
          <StatusCell r={r} />
        </TableCell>
        {/*
          时间用绝对值。**相对时间在这一列会塌掉** —— 打开应用
          看昨天那次时，整列全是「1d」，而这一列的用途就是把
          某一行对上号。完整的日期和时间留给悬停。
        */}
        <TableCell className="text-muted-foreground">
          <Tip text={new Date(r.atMs).toLocaleString()}>
            <span>{when(r.atMs, today)}</span>
          </Tip>
        </TableCell>
        {showClient && (
          <TableCell className={cn(sameClient && DIM)}>
            <RowKeyCell r={r} hints={hints} />
          </TableCell>
        )}
        {/*
          模型。**这一列决定了这次多贵、多慢** —— 同一个客户端
          连着发的两次请求，差别往往只在这里。
        */}
        <TableCell className={cn(sameModel && DIM)}>
          {/* 截断要套在里面一层：`max-width` 加在 td 上会被表格
              自己的列宽算法吃掉，长名字照样把这一列撑开 */}
          <div className="max-w-[13rem] truncate" title={r.model}>
            {r.model ?? "—"}
          </div>
        </TableCell>
        <TableCell className={cn("whitespace-normal", sameProvider && DIM)}>
          <UpstreamCell r={r} />
        </TableCell>
        {/*
          数字右对齐。左对齐时 253ms 和 1486ms 的个位对不齐，
          扫一列找最慢的那条要逐行读 —— 而这一列存在的意义就是
          扫出极值。
        */}
        <TableCell className="text-right">
          {/* 在跑的那一条只有首字节：写成「1966→…」，别让它看起来像已经结束的总耗时 */}
          {r.state === "in_flight" && r.ttfbMs != null ? (
            <span className="text-muted-foreground">{r.ttfbMs}→…</span>
          ) : (
            latency(r.ttfbMs, r.durationMs)
          )}
        </TableCell>
        <TableCell className="text-right text-muted-foreground">
          <TokensCell r={r} />
        </TableCell>
        <TableCell className="text-right">
          <CostCell r={r} />
        </TableCell>
        {/*
          **点「…」不能连带打开这一行。**按钮上的点击会冒泡到行上，行一收到
          就去开详情，菜单和抽屉会一起出来。只在悬停、选中、菜单开着时出现：
          两千行各带一个常亮的「…」，整列就是一道噪点。Tab 也只停在选中的那一
          行的「…」上（方向键挑行，Tab 进到它的菜单）。
        */}
        <TableCell className="w-6 px-0! py-0 text-center" onClick={(e) => e.stopPropagation()}>
          <span className={MENU_REVEAL}>
            <RowMenuButton items={items} label={t.rowActions(r.id)} tabIndex={selected ? 0 : -1} />
          </span>
        </TableCell>
      </TableRow>
    </RowMenu>
  );
});

function StatusCell({ r }: { r: RequestRow }) {
  const t = useText(trafficText);
  const tone = TONE[statusTone(r.status, r.state)];
  return (
    <span className="flex items-center gap-1.5">
      {/* 成功的点压淡一点：一整列都是它，它不是要找的那个 */}
      <StatusDot tone={tone} className={tone === "ok" ? "opacity-70" : undefined} />
      <span className={tone === "error" || tone === "warn" ? undefined : "text-muted-foreground"}>
        {r.state === "in_flight"
          ? // 响应头到了就有状态码，流还在往下走；点在跳，说的是请求尚未结束
            (r.status ?? "…")
          : r.state === "failed"
            ? t.failed
            : r.state === "cancelled"
              ? t.cancelled
              : r.status}
      </span>
    </span>
  );
}

/**
 * 上游那一格：标志、名字，和这次请求上发生过的事（脱敏、格式转换、可疑调用）。
 *
 * **徽标宁可折到第二行，也不能把表撑宽。**格子一律不换行的话，一行同时带
 * 「已脱敏」和「已转换 · 丢弃 n 项」，这一格就有 240px，默认窗口下表比容器
 * 宽出 40px —— 被挤出视野的是最后一列费用，而那是这张表里最要紧的一列。
 * 其余各列都不换行，表格变窄时只有这一列收得动。只在徽标之间折，徽标自身
 * 不断开：窄了是这一行变高，不是哪一列看不见。
 */
function UpstreamCell({ r }: { r: RequestRow }) {
  const t = useText(trafficText);
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      {/* 本地应答的那一句（英文两个词）可以在词间折行：它不是一个名字，别让它定这一列的最小宽度 */}
      <span className={cn("flex items-center gap-1.5", !r.local && "whitespace-nowrap")}>
        {r.local || !r.provider ? (
          <span aria-hidden className="size-4 shrink-0" />
        ) : (
          <UpstreamLogo name={r.provider} className="opacity-70" />
        )}
        {/* 被规则拒绝、选中的上游一个都接不了的请求没有发往任何上游：上游是空的 */}
        {r.provider ? <span>{r.provider}</span> : <span className="text-muted-foreground">—</span>}
      </span>
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
    <Tip text={<span className="whitespace-pre-line">{tip}</span>}>
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
 */
function TokensCell({ r }: { r: RequestRow }) {
  const t = useText(trafficText);
  const prompt = promptTokens(r);
  const text = tokens(prompt, r.outputTokens);
  if (prompt === undefined || r.outputTokens === undefined) return <>{text}</>;
  const n = (v: number | undefined) => (v ?? 0).toLocaleString();
  return (
    <Tip
      text={
        <Lines
          lines={[
            t.promptTip(n(prompt)),
            t.promptParts(n(r.inputTokens), n(r.cacheReadTokens), n(r.cacheWriteTokens)),
            t.outputTip(n(r.outputTokens)),
          ]}
        />
      }
    >
      <span>{text}</span>
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
      text={
        r.state === "cancelled" ? t.estimatedCancelled : r.state === "failed" ? t.estimatedFailed : t.estimatedBorrowed
      }
    >
      <span className="underline decoration-dotted underline-offset-2">{money(r.costMicros, true)}</span>
    </Tip>
  );
}
