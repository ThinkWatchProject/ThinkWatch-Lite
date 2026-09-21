import { Fragment } from "react";
import { useText } from "@/i18n";
import { appText } from "@/App.i18n";
import { coreText } from "@/i18n/core.i18n";
import { cn } from "@/lib/utils";
import { latency, money, statusTone, tokens, when } from "@/format";
import { Tip } from "@/ui/tip";
import { translatedText } from "@/labels";
import { ruleName } from "@/security/labels";
import { Button } from "@/ui/button";
import { RowMenu } from "@/ui/row-menu";
import { Skeleton } from "@/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import type { RequestRow } from "@/types";
import type { Filter, SortDir, SortKey } from "@/requestTable";
import { sortWithin, type Group } from "./grouping";
import { SessionRow } from "./SessionRow";

/**
 * 流量页那张请求表。
 *
 * **从 `App.tsx` 里搬出来的，一行都没改。**搬的理由是接下来要加一个
 * 按会话归组的形态，而两种形态得共用同一套行渲染 —— 一段嵌在一千九百
 * 行文件里、缩进二十二格的 JSX，没法被第二个地方用。
 */
export function RequestTable({
  rows,
  groups,
  openGroups,
  selectedSession,
  onToggleGroup,
  onOpenSession,
  showClient,
  cursor,
  fresh,
  today,
  sortKey,
  sortDir,
  onSort,
  onCursor,
  onOpen,
  onFilter,
}: {
  rows: RequestRow[];
  /** 给了就是归组形态。不给就是今天那张平表 */
  groups?: Group[];
  /** 展开着的那几个会话 */
  openGroups: Set<string>;
  /** 右侧分栏里开着的那次会话 */
  selectedSession: string | null;
  onToggleGroup: (id: string) => void;
  onOpenSession: (id: string) => void;
  showClient: boolean;
  /** 键盘选中的那一行在 `rows` 里的下标 */
  cursor: number;
  /** 刚到的那几行，短暂高亮 */
  fresh: Set<number>;
  /** 「今天」是哪一天。**按日取整传进来**，否则每次重画都可能跨过零点 */
  today: number;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  onCursor: (i: number) => void;
  onOpen: (id: number) => void;
  onFilter: (f: (prev: Filter) => Filter) => void;
}) {
  const t = useText(appText);
  return (
              <Table className="tw-num">
                {/*
      **表头必须钉住。**这张表滚两屏之后就没有列名了，而并排的
      两列毫秒数，不看列名根本分不出哪个是首字节哪个是总耗时 ——
      那恰恰是排查时唯一要看的区别。
    */}
                <TableHeader className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-950">
                  <TableRow>
                    <Th
                      k="status"
                      label={t.status}
                      sort={sortKey}
                      dir={sortDir}
                      on={onSort}
                      className="py-1.5"
                    />
                    <Th
                      k="time"
                      label={t.time}
                      sort={sortKey}
                      dir={sortDir}
                      on={onSort}
                    />
                    {/* 只有一个客户端时这一列每行都一样 —— 那是零信息 */}
                    {showClient && <TableHead>{t.client}</TableHead>}
                    <TableHead>{t.model}</TableHead>
                    <TableHead>{t.upstream}</TableHead>
                    {/* 首字节和总耗时合成一列 —— 非流式请求两者几乎相同 */}
                    <Th
                      k="duration"
                      label={t.latency}
                      sort={sortKey}
                      dir={sortDir}
                      on={onSort}
                      className="text-right"
                    />
                    <Th
                      k="tokens"
                      label={t.tokens}
                      sort={sortKey}
                      dir={sortDir}
                      on={onSort}
                      className="text-right"
                    />
                    <Th
                      k="cost"
                      label={t.cost}
                      sort={sortKey}
                      dir={sortDir}
                      on={onSort}
                      className="text-right"
                    />
                  </TableRow>
                </TableHeader>
                {/*
      走到这里还是空的，只可能是历史没读完 —— 「读完了，确实一条
      都没有」在上面那一支里已经处理掉了。**事件流先到的行不能被
      骨架盖住**：那时数据已经在手上了。
    */}
                {rows.length === 0 ? (
                  <BodySkeleton
                    widths={[
                      "w-10",
                      "w-16",
                      ...(showClient ? ["w-14"] : []),
                      "w-32",
                      "w-16",
                      "w-16 ml-auto",
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
                    rows={rows}
                    groups={groups}
                    openGroups={openGroups}
                    showClient={showClient}
                    today={today}
                    cursor={cursor}
                    fresh={fresh}
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
    <TableHead className={className}>
      <Button
        variant="ghost"
        size="xs"
        className="-mx-1 px-1"
        onClick={() => on(k)}
        aria-sort={
          active ? (dir === "asc" ? "ascending" : "descending") : "none"
        }
      >
        <span className={cn(active && "text-foreground")}>{label}</span>
        <span className="ml-0.5 inline-block w-2 tw-label">
          {active ? (dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </Button>
    </TableHead>
  );
}

/**
 * 表身的骨架。
 *
 * **开窗时这一页要先去库里读两百条记录。**读完之前画「暂无请求记录」，
 * 是在说一件当时还不知道真假的事 —— 而且记录一到，版面会先塌一次再弹
 * 回来。骨架把行的位置占住，内容落在原地。
 *
 * 六行：够说明这里将要出现一张表，又不至于在真的没有记录时留下一屏假
 * 内容 —— 那种情况下接上的是空状态，不是骨架。
 */
function BodySkeleton({ widths }: { widths: string[] }) {
  return (
    <TableBody>
      {Array.from({ length: 6 }, (_, row) => (
        <TableRow
          key={row}
          className="border-b border-neutral-100 dark:border-neutral-900"
        >
          {widths.map((w, col) => (
            <TableCell key={col}>
              <Skeleton className={cn("h-3", w)} />
            </TableCell>
          ))}
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
 */
function RequestRows({
  rows,
  groups,
  openGroups,
  showClient,
  today,
  cursor,
  fresh,
  selectedSession,
  onOpen,
  onCursor,
  onFilter,
  onToggleGroup,
  onOpenSession,
}: {
  rows: RequestRow[];
  /** 给了就是归组形态 */
  groups?: Group[];
  openGroups: Set<string>;
  showClient: boolean;
  today: number;
  cursor: number;
  fresh: Set<number>;
  selectedSession: string | null;
  onOpen: (id: number) => void;
  onCursor: (i: number) => void;
  onFilter: (f: (prev: Filter) => Filter) => void;
  onToggleGroup: (id: string) => void;
  onOpenSession: (id: string) => void;
}) {
  const at = rows[cursor]?.id;
  const one = (r: RequestRow, prev: RequestRow | undefined, indent: boolean) => (
    <Row
      key={r.id}
      r={r}
      prev={prev}
      showClient={showClient}
      today={today}
      selected={at === r.id}
      fresh={fresh.has(r.id)}
      indent={indent}
      onOpen={onOpen}
      onSelect={() => onCursor(rows.indexOf(r))}
      onFilter={onFilter}
    />
  );

  if (!groups) {
    return <TableBody>{rows.map((r, i) => one(r, rows[i - 1], false))}</TableBody>;
  }

  return (
    <TableBody>
      {groups.map((g) => {
        // 无主的请求没有组头 —— 把它们凑成一组等于声称它们属于同一次任务
        if (g.id === null) {
          const r = g.rows[0];
          return r ? one(r, undefined, false) : null;
        }
        const open = openGroups.has(g.id);
        const inside = sortWithin(g);
        return (
          <Fragment key={g.id}>
            <SessionRow
              g={g}
              open={open}
              showClient={showClient}
              selected={selectedSession === g.id}
              onToggle={() => onToggleGroup(g.id!)}
              onOpen={() => onOpenSession(g.id!)}
            />
            {open && inside.map((r, i) => one(r, inside[i - 1], true))}
          </Fragment>
        );
      })}
    </TableBody>
  );
}

/**
 * 一条请求，一行。
 *
 * **`prev` 是上一行，不是下标。**归组之后「上一行」可能是组头，也可能
 * 是另一个会话的最后一条 —— 拿下标去原数组里回看会把相邻的两组连起来，
 * 而那几列（客户端、模型、上游）正是靠「和上一行相同就压暗」来减噪的。
 */
function Row({
  r,
  prev,
  showClient,
  today,
  selected,
  fresh,
  indent,
  onOpen,
  onSelect,
  onFilter,
}: {
  r: RequestRow;
  prev: RequestRow | undefined;
  showClient: boolean;
  today: number;
  selected: boolean;
  fresh: boolean;
  /** 组里的行往里缩一格 —— 它属于上面那个组头 */
  indent: boolean;
  onOpen: (id: number) => void;
  onSelect: () => void;
  onFilter: (f: (prev: Filter) => Filter) => void;
}) {
  const t = useText(appText);
  const same = (get: (x: RequestRow) => string) =>
    prev !== undefined && get(prev) === get(r);
  return (
                <RowMenu
                  key={r.id}
                  items={[
                    {
                      kind: "item",
                      label: t.openDetails,
                      onSelect: () => onOpen(r.id),
                    },
                    { kind: "sep" },
                    // **按这一行的值筛，不是打开一个筛选器。**排查时的
                    // 动作是「只看这家」「只看这个客户端」，而手打名字
                    // 会打错，打错的表现是「筛出来空的」。
                    {
                      kind: "item",
                      label: t.onlyUpstream(r.provider),
                      onSelect: () =>
                        onFilter((f) => ({
                          ...f,
                          provider: r.provider,
                        })),
                    },
                    ...(showClient
                      ? ([
                          {
                            kind: "item",
                            label: t.onlyClient(r.client),
                            onSelect: () =>
                              onFilter((f) => ({
                                ...f,
                                client: r.client,
                              })),
                          },
                        ] as const)
                      : []),
                    { kind: "sep" },
                    {
                      kind: "item",
                      label: t.copyId,
                      onSelect: () =>
                        void navigator.clipboard.writeText(
                          String(r.id),
                        ),
                    },
                    {
                      kind: "item",
                      label: t.copyRow,
                      onSelect: () =>
                        void navigator.clipboard.writeText(
                          [
                            new Date(r.atMs).toLocaleString(),
                            r.client,
                            r.model ?? "",
                            r.provider,
                            r.path,
                            r.status ?? r.state,
                            r.durationMs != null
                              ? `${r.durationMs}ms`
                              : "",
                            tokens(r.inputTokens, r.outputTokens),
                            money(r.costMicros, r.costEstimated),
                            coreText(r.error),
                          ]
                            .filter(Boolean)
                            .join("\t"),
                        ),
                    },
                  ]}
                >
                  <TableRow
                    onClick={() => {
                      onSelect();
                      onOpen(r.id);
                    }}
                    className={
                      "cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 " +
                      (selected
                        ? "bg-neutral-100 dark:bg-neutral-800"
                        : fresh
                          ? "bg-emerald-50 dark:bg-emerald-950"
                          : "") +
                      (indent ? " [&>td:first-child]:pl-7" : "")
                    }
                  >
                    {/*
      状态用色点编码。**25 个灰色 200 排成一列是零信息** ——
      眼睛要能一眼扫到那个 5xx，而不是逐行读数字。
    */}
                    <TableCell className="whitespace-nowrap">
                      {(() => {
                        const tone = statusTone(
                          r.status,
                          r.state,
                        );
                        const dot =
                          tone === "bad"
                            ? "bg-red-500"
                            : tone === "warn"
                              ? "bg-amber-500"
                              : tone === "pending"
                                ? "bg-amber-400 animate-pulse"
                                : tone === "muted"
                                  ? "bg-neutral-400"
                                  : "bg-emerald-500/60";
                        return (
                          <span className="flex items-center gap-1.5">
                            <span
                              className={
                                "inline-block h-1.5 w-1.5 shrink-0 rounded-full " +
                                dot
                              }
                            />
                            <span
                              className={
                                tone === "ok" || tone === "muted"
                                  ? "text-neutral-400"
                                  : ""
                              }
                            >
                              {r.state === "in_flight"
                                ? "…"
                                : r.state === "failed"
                                  ? t.failed
                                  : r.state === "cancelled"
                                    ? t.cancelled
                                    : r.status}
                            </span>
                          </span>
                        );
                      })()}
                    </TableCell>
                    {/*
      时间用绝对值。**相对时间在这一列会塌掉** —— 打开应用
      看昨天那次时，整列全是「1d」，而这一列的用途就是把
      某一行对上号。相对时间留给悬停。
    */}
                    <TableCell className="whitespace-nowrap text-neutral-400">
                      <Tip
                        text={new Date(r.atMs).toLocaleString()}
                      >
                        <span>{when(r.atMs, today)}</span>
                      </Tip>
                    </TableCell>
                    {/* 和上一行相同就淡化 —— 眼睛要找的是变化的那一行 */}
                    {showClient && (
                      <TableCell
                        className={
                          same((x) => x.client)
                            ? "text-neutral-400/50"
                            : ""
                        }
                      >
                        {r.client}
                      </TableCell>
                    )}
                    {/*
      模型。**这一列决定了这次多贵、多慢** —— 同一个客户端
      连着发的两次请求，差别往往只在这里。
    */}
                    <TableCell
                      className={
                        same((x) => x.model ?? "")
                          ? "text-neutral-400/50"
                          : ""
                      }
                    >
                      {/* 截断要套在里面一层：`max-width` 加在 td 上会被表格
          自己的列宽算法吃掉，长名字照样把这一列撑开 */}
                      <div
                        className="max-w-[13rem] truncate"
                        title={r.model}
                      >
                        {r.model ?? "—"}
                      </div>
                    </TableCell>
                    <TableCell
                      className={
                        same((x) => x.provider)
                          ? "text-neutral-400/50"
                          : ""
                      }
                    >
                      {/*
        **徽标宁可折到第二行，也不能把表撑宽。**格子一律不换行
        的话，一行同时带「已脱敏」和「已转换 · 丢弃 n 项」，
        这一格就有 240px，默认窗口下表比容器宽出 40px —— 被挤
        出视野的是最后一列费用，而那是这张表里最要紧的一列。
        其余各列都不换行，表格变窄时只有这一列收得动。只在
        徽标之间折，徽标自身不断开：窄了是这一行变高，不是
        哪一列看不见。
      */}
                      <div className="flex flex-wrap items-baseline gap-x-1 gap-y-0.5">
                        <span>{r.provider}</span>
                        {/* **看不见的安全功能会被用户关掉**，因为他们会怀疑
            是脱敏搞坏了功能。所以脱敏发生了就要在
            列表这一层看得见，而不是藏在详情里 */}
                        {r.secrets && r.secrets.items.length > 0 && (
                          <span
                            className={
                              "rounded px-1 tw-label " +
                              // 换掉了是灰的；原样发出去的要看得出来
                              (r.secrets.replaced
                                ? "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                                : "bg-amber-500 text-white")
                            }
                            title={(r.secrets.replaced ? t.redactedTip : t.secretsTip)(
                              r.secrets.items.map(
                                (x) =>
                                  `${ruleName("redact", x.rule, x.custom)} ×${x.count}`,
                              ),
                            )}
                          >
                            {(r.secrets.replaced ? t.redacted : t.withSecrets)(
                              r.secrets.items.reduce((a, x) => a + x.count, 0),
                            )}
                          </span>
                        )}
                        {/* 格式转换。**转了就要看得见，丢了字段
            更要看得见** —— 「扩展思考开了却没生效」这个症状
            在客户端那头完全无从下手，只有这里知道原因 */}
                        {r.translated && (
                          <span
                            className={
                              "rounded px-1 tw-label " +
                              (r.translated.dropped.length > 0
                                ? "bg-amber-500 text-white"
                                : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300")
                            }
                            title={
                              t.sentConverted(
                                translatedText(r.translated),
                              ) +
                              (r.translated.dropped.length > 0
                                ? t.droppedFields(
                                    r.translated.dropped,
                                  )
                                : t.noneDropped)
                            }
                          >
                            {r.translated.dropped.length > 0
                              ? t.convertedDropped(
                                  r.translated.dropped.length,
                                )
                              : t.converted}
                          </span>
                        )}
                        {r.flagged && r.flagged.length > 0 && (
                          <span
                            className={
                              "rounded px-1 tw-label " +
                              (r.flagged.some((f) => f.blocked)
                                ? "bg-red-600 text-white"
                                : "bg-amber-500 text-white")
                            }
                            title={r.flagged
                              .map((f) =>
                                t.flaggedTip(
                                  f.tool,
                                  ruleName("inspect_tools", f.rule, f.custom),
                                  f.excerpt,
                                ),
                              )
                              .join("\n\n")}
                          >
                            {r.flagged.some((f) => f.blocked)
                              ? t.blocked
                              : t.suspicious}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    {/*
      数字右对齐。左对齐时 253ms 和 1486ms 的个位对不齐，
      扫一列找最慢的那条要逐行读 —— 而这一列存在的意义就是
      扫出极值。
    */}
                    <TableCell className="whitespace-nowrap text-right">
                      {latency(r.ttfbMs, r.durationMs)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right text-neutral-400">
                      {tokens(r.inputTokens, r.outputTokens)}
                    </TableCell>
                    {/*
      **估算值必须带记号。**猜出来的金额和账单上的数字在
      列表里长得一模一样，而它们不是一回事。
    */}
                    <TableCell className="whitespace-nowrap text-right">
                      {r.costEstimated ? (
                        // 估算的理由要说对：取消和中断的那些，是输出只数到了断开
                        // 那一刻；别的估算来自价目表 —— 这个模型的单价是从其他
                        // 平台借来的
                        <Tip
                          text={
                            r.state === "cancelled"
                              ? t.estimatedCancelled
                              : r.state === "failed"
                                ? t.estimatedFailed
                                : t.estimatedBorrowed
                          }
                        >
                          <span className="underline decoration-dotted underline-offset-2">
                            {money(r.costMicros, true)}
                          </span>
                        </Tip>
                      ) : (
                        <span
                          className={
                            r.costMicros == null
                              ? "text-neutral-400"
                              : ""
                          }
                        >
                          {money(r.costMicros, false)}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                </RowMenu>
  );
}
