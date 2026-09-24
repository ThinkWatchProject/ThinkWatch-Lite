import { useEffect, useMemo, useRef, useState } from "react";
import { call } from "@/control";
import { useText } from "@/i18n";
import { appText } from "@/App.i18n";
import { bucketStart } from "@/format";
import { EMPTY_FILTER, facets, filterRows, hasAnyFilter, sortRows } from "@/requestTable";
import type { CoreStatus, RequestRow, SessionDetail, SessionView } from "@/types";
import { useCoreEvent } from "@/useCoreEvent";
import RequestDrawer from "@/RequestDrawer";
import { useNav, useNavParams } from "@/nav";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Toggle } from "@/ui/toggle";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/sheet";
import { EmptyState } from "@/ui/states";
import { Banner } from "@/ui/banner";
import { IconFlow } from "@/ui/icons";
import { notify } from "@/ui/notify";
import { RequestTable } from "./RequestTable";
import { SessionPanel } from "./SessionPanel";
import { groupAt, groupBySession, isAt, lines, step, visible, type Cursor } from "./grouping";
import type { TrafficView } from "./view";

const DAY_MS = 24 * 3_600_000;

/** 有就去掉，没有就加上。展开、收起一个组走它 */
function toggled(s: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(s);
  if (!next.delete(id)) next.add(id);
  return next;
}

/**
 * 流量页：请求表、过滤条、请求和会话的详情抽屉、行内键盘导航。
 *
 * 数据（`rows`、`sessions`）和「怎么看」的状态（`view`）都来自外壳：它们在换页
 * 之后还要在，见 `view.ts`。这一页自己只管打开了哪一条、键盘停在哪一行。
 */
export default function TrafficPage({
  rows: allRows,
  seeded,
  locallyAnswered,
  sessions,
  status,
  view,
}: {
  rows: RequestRow[];
  /** 历史已经读进来了。之前不画空状态：那时「暂无请求」不是真的 */
  seeded: boolean;
  locallyAnswered: number;
  sessions: SessionView[];
  status: CoreStatus | null;
  view: TrafficView;
}) {
  const t = useText(appText);
  const nav = useNav();
  const { filter, setFilter, sortKey, sortDir, toggleSort, grouped, setGrouped, openGroups, setOpenGroups } = view;

  const rows = useMemo(
    () => sortRows(filterRows(allRows, filter), sortKey, sortDir),
    [allRows, filter, sortKey, sortDir],
  );
  const facet = useMemo(() => facets(allRows), [allRows]);
  /*
    **过滤和排序先跑，归组后跑。**反过来的话，筛掉一半请求之后组头上的汇总还是
    整次任务的数字，而用户会以为自己筛错了。组与组之间沿用表头选的那个方向（按组里
    最新的一条比），组内永远按时间正序 —— 见 `grouping.ts`。
  */
  const groups = useMemo(() => {
    if (!grouped) return undefined;
    const gs = groupBySession(rows, sessions);
    const dir = sortDir === "asc" ? 1 : -1;
    return sortKey === "time" ? [...gs].sort((a, b) => (groupAt(a) - groupAt(b)) * dir) : gs;
  }, [grouped, rows, sessions, sortKey, sortDir]);
  /**
   * 「密钥」这一列只在真的分得开的时候才出现：一把密钥时整列是同一个值。按实际
   * 出现过的算；推测出的应用、非本机的来源分得开也算（格子里也写它们）。
   */
  const showClient =
    facet.clients.length > 1 || new Set(allRows.map((r) => r.hint ?? "")).size > 1 || allRows.some((r) => r.peer);

  const searchRef = useRef<HTMLInputElement>(null);
  /** 滚动层。键盘选中一行之后，在它里面找到那一行滚进视野 */
  const listRef = useRef<HTMLDivElement>(null);
  /** 打开的那条请求（右侧抽屉） */
  const [open, setOpen] = useState<number | null>(null);
  /** 右侧开着的那次会话。和 `open`（一条请求）互斥 */
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  /**
   * 键盘选中的那一行：一条请求，或者归组时的一个组头。`null` 表示还没用过键盘 ——
   * 一进页面就高亮第一行，会让人以为那一行有什么特别。记的是哪一行，不是第几行。
   */
  const [cursor, setCursor] = useState<Cursor | null>(null);

  // 深链：带着筛选（外壳已经改好 `view`）、打开某一条、聚焦搜索框
  useNavParams("requests", (p) => {
    if (p.request !== undefined) {
      setOpenSession(null);
      setOpen(p.request);
    }
    if (p.search) requestAnimationFrame(() => searchRef.current?.select());
  });

  /*
    **任务还在进行的话，详情要跟得上。**打开一次会话多半是想看这次的费用，而那时它
    往往还在跑：有请求落地就重读（按事件节流，和会话列表同一个节奏）。
  */
  const [sessionTick, setSessionTick] = useState(0);
  useCoreEvent(["request_finished", "request_failed", "request_cancelled"], () => {
    if (openSession !== null) setSessionTick((n) => n + 1);
  });
  useEffect(() => {
    if (openSession === null) {
      setSessionDetail(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const d = await call("SessionDetail", null, openSession);
        if (alive) setSessionDetail(d);
      } catch (e) {
        notify.error(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [openSession, sessionTick]);

  /**
   * 今天从哪一刻算起。时间那一列今天的记录给到秒，更早的带上日期；那条界线一天
   * 只过一次，定时器就定在下一个零点。跨零点用 `setDate(+1)` 再归零，不加
   * 86400000：夏令时那两天一天不是 24 小时。
   */
  const [today, setToday] = useState(() => bucketStart(Date.now(), DAY_MS));
  useEffect(() => {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    const h = setTimeout(() => setToday(bucketStart(Date.now(), DAY_MS)), Math.max(1_000, next.getTime() - Date.now()));
    return () => clearTimeout(h);
  }, [today]);

  /**
   * 刚出现的那几行。**第一个请求进来时那一行要跳出来** —— 它是「网关真的在工作」
   * 的证明。第一次加载（把历史填进来）不算：那时满屏都在闪，看不出哪一条是新的。
   */
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const seenIds = useRef<Set<number>>(new Set());
  useEffect(() => {
    const now = rows.map((r) => r.id);
    const news = now.filter((id) => !seenIds.current.has(id));
    const first = seenIds.current.size === 0;
    for (const id of now) seenIds.current.add(id);
    if (first || news.length === 0) return;
    setFresh((prev) => new Set([...prev, ...news]));
    const h = setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const id of news) next.delete(id);
        return next;
      });
    }, 1200);
    return () => clearTimeout(h);
  }, [rows]);

  /**
   * 行内的键盘导航。`↑↓` 按屏幕上的顺序走，`Enter` 打开。归组时组头也是一行：
   * `Enter` 打开那次会话，`→` 展开、`←` 收起；在组里的请求上按 `←` 回到组头。
   *
   * 两个边界：在输入框里打字时不接管方向键；抽屉开着时 `↑↓` 也不动（请求和会话的
   * 抽屉都算），那时在看详情而不是挑行。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      const typing =
        el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if (typing) return;
      if (e.key === "Escape") {
        setOpen(null);
        return;
      }
      if (open !== null || openSession !== null) return;
      /*
        **选中的那一行要一直看得见。**只滚刚好够的距离（`nearest`）；让开吸顶的表头、
        不横着滚，靠的是行上的 scroll-margin，见 `RequestTable`。
      */
      const reveal = (c: Cursor) =>
        listRef.current
          ?.querySelector(c.kind === "request" ? `[data-row="${c.id}"]` : `[data-session="${CSS.escape(c.id)}"]`)
          ?.scrollIntoView({ block: "nearest" });
      // 表里从上到下的每一行。按它走，不按 `rows`：归组之后两者不一样，见 `lines`
      const ls = lines(rows, groups, openGroups);
      const here = ls.find((l) => isAt(l, cursor));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const next = step(ls, cursor, e.key === "ArrowDown" ? 1 : -1);
        setCursor(next);
        if (next) reveal(next);
      } else if (
        here?.kind === "session" &&
        ((e.key === "ArrowRight" && !here.open) || (e.key === "ArrowLeft" && here.open))
      ) {
        e.preventDefault();
        const id = here.id;
        setOpenGroups((prev) => toggled(prev, id));
      } else if (e.key === "ArrowLeft" && here?.kind === "request" && here.shown && here.under !== null) {
        e.preventDefault();
        const head: Cursor = { kind: "session", id: here.under };
        setCursor(head);
        reveal(head);
      } else if (e.key === "Enter" && here && visible(here)) {
        e.preventDefault();
        if (here.kind === "request") setOpen(here.id);
        else setOpenSession(here.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, groups, openGroups, cursor, open, openSession, setOpenGroups]);

  const none = allRows.length === 0;
  const addr = status?.gateway_addr ?? null;

  return (
    /*
      **滚的是这一层，边距在里层。**表头是 `sticky top-0`，吸顶的位置从滚动容器的
      内边距以内算起。横着滚的也是这一层：最小窗口、侧栏展开时表比页面宽，表外面
      那层自己横着滚的话，表头就钉在它身上、不再吸顶（见 `Table` 的 `scroll`）。

      所以分成三块：上面的过滤条、下面的脚注钉在左边（`sticky left-0`），表横着滚时
      它们不跟着走；中间那块跟着表变宽（`w-fit`），滚到最右，表的右边距才露得出来。
    */
    <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
      <div className="sticky left-0 px-5 pt-5">
        {/*
          过滤条。**一直在，不是「有数据才出现」**：一个时有时无的工具条，每次都要
          重新找它在哪儿；⌘F 也要一直有地方落。没有请求时除了搜索框都是禁用的。
        */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Input
            variant="sm"
            className="w-64"
            ref={searchRef}
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
            placeholder={t.search}
            spellCheck={false}
          />
          <Toggle
            variant="outline"
            size="sm"
            disabled={none}
            pressed={filter.failedOnly}
            onPressedChange={(v) => setFilter((f) => ({ ...f, failedOnly: v }))}
          >
            {t.failedOnly}
          </Toggle>
          {/* 归组是个视角，不是一个筛子：它不改变哪些行在表里，只改变怎么摆 */}
          <Toggle variant="outline" size="sm" disabled={none} pressed={grouped} onPressedChange={setGrouped}>
            {t.groupBySession}
          </Toggle>
          {/* 从概览点「N 条无法计价」过来时它是按着的。一个筛着却看不见的筛子最糟 */}
          <Toggle
            variant="outline"
            size="sm"
            disabled={none}
            pressed={filter.unpricedOnly}
            onPressedChange={(v) => setFilter((f) => ({ ...f, unpricedOnly: v }))}
          >
            {t.unpricedOnly}
          </Toggle>
          {/* 下拉里只列出现过的：配了三个而只有一个在收流量时，另外两个只会让人以为筛错了 */}
          {facet.clients.length > 1 && (
            <NativeSelect
              size="sm"
              value={filter.client}
              onChange={(e) => setFilter((f) => ({ ...f, client: e.target.value }))}
            >
              <NativeSelectOption value="">{t.allClients}</NativeSelectOption>
              {facet.clients.map((c) => (
                <NativeSelectOption key={c} value={c}>
                  {c}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {facet.providers.length > 1 && (
            <NativeSelect
              size="sm"
              value={filter.provider}
              onChange={(e) => setFilter((f) => ({ ...f, provider: e.target.value }))}
            >
              <NativeSelectOption value="">{t.allUpstreams}</NativeSelectOption>
              {facet.providers.map((c) => (
                <NativeSelectOption key={c} value={c}>
                  {c}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {/* 筛掉了多少要说出来：只写「12 条」不写「共 340 条」，会以为总共就这么多 */}
          {!none && (
            <span className="ml-auto tw-label tw-num text-muted-foreground">
              {hasAnyFilter(filter) ? t.shownOf(rows.length, allRows.length) : t.total(allRows.length)}
            </span>
          )}
          {hasAnyFilter(filter) && (
            <Button variant="link" size="xs" onClick={() => setFilter(EMPTY_FILTER)}>
              {t.clear}
            </Button>
          )}
        </div>

        {/*
          还没有上游 —— 引导，不是拦路。说清三件事：网关已在运行（所以这不是故障）、
          缺的是什么、在哪里配置。最后一件给一个能点的入口。
        */}
        {status?.providers === 0 && (
          <Banner
            layout="inline"
            tone="info"
            className="mb-4"
            title={t.noUpstreams}
            actions={
              <Button size="sm" onClick={() => nav.open("upstreams")}>
                {t.goToUpstreams}
              </Button>
            }
          >
            {t.listening(<code className="rounded bg-surface px-1 py-0.5 font-mono text-foreground">http://{status.gateway_addr}</code>)}
          </Banner>
        )}
      </div>
      <div className="w-fit min-w-full px-5">
        {seeded && rows.length === 0 ? (
          !none ? (
            // 有记录，只是全被筛掉了。这时说「暂无请求记录」是错的
            <EmptyState
              icon={<IconFlow />}
              title={t.noMatchTitle}
              description={t.noMatch(allRows.length)}
              action={
                <Button variant="outline" size="sm" onClick={() => setFilter(EMPTY_FILTER)}>
                  {t.clearFilters}
                </Button>
              }
            />
          ) : (
            // 空状态永远在回答「接下来该做什么」
            <EmptyState
              icon={<IconFlow />}
              title={t.emptyTitle}
              description={
                <>
                  {addr &&
                    t.pointClients(
                      <code className="rounded bg-surface px-1 py-0.5 font-mono text-foreground">http://{addr}</code>,
                    )}
                  {addr && <br />}
                  {t.appearHere}
                  {/* 一次都没有的时候不说这句 —— 「已经本地应答了 0 次」是拿一个零冒充证据 */}
                  {locallyAnswered > 0 && (
                    <>
                      <br />
                      {t.probesAnswered(locallyAnswered)}
                    </>
                  )}
                </>
              }
            />
          )
        ) : (
          <RequestTable
            rows={rows}
            showClient={showClient}
            cursor={cursor}
            fresh={fresh}
            today={today}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            onCursor={setCursor}
            onOpen={(id) => {
              setOpenSession(null);
              setOpen(id);
            }}
            onFilter={setFilter}
            groups={groups}
            openGroups={openGroups}
            selectedSession={openSession}
            onToggleGroup={(id) => setOpenGroups((prev) => toggled(prev, id))}
            onOpenSession={(id) => {
              // 一次只开一样：请求详情和会话详情共用右侧那一栏
              setOpen(null);
              setOpenSession(id);
            }}
          />
        )}
      </div>
      <div className="sticky left-0 px-5 pb-5">
        {locallyAnswered > 0 && rows.length > 0 && (
          <p className="mt-3 tw-body text-muted-foreground">{t.probesElsewhere(locallyAnswered)}</p>
        )}
      </div>

      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}
      {/*
        会话和请求走同一种浮层（右侧抽屉）。比请求那一层宽：叠起来的时候左边露出
        一截，那一截就是「下面还有一层」唯一的说明。
      */}
      {sessionDetail && (
        <Sheet open onOpenChange={(o) => !o && setOpenSession(null)}>
          <SheetContent
            side="right"
            className="flex flex-col overflow-y-auto p-0 data-[side=right]:w-[min(46rem,94vw)] data-[side=right]:sm:max-w-none"
          >
            <SheetHeader className="sr-only">
              <SheetTitle>{t.surfaces.sessions}</SheetTitle>
            </SheetHeader>
            {/* 在会话这一层之上再叠一层请求，不是把它换掉：看完这一轮要退回任务看下一轮 */}
            <SessionPanel d={sessionDetail} onOpenTurn={setOpen} />
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
