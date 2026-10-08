import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FunnelXIcon, TextSearchIcon } from "lucide-react";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { errorText } from "@/i18n/core.i18n";
import { when } from "@/format";
import { EMPTY_FILTER, facets, hasAnyFilter, sortRows } from "@/requestTable";
import type { CoreStatus, RequestRow, SessionView } from "@/types";
import RequestDrawer from "@/RequestDrawer";
import { useNav, useNavParams } from "@/nav";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { IconCopy, IconFlow } from "@/ui/icons";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { usePending } from "@/ui/notify";
import { PageHeader } from "@/ui/page";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { Spinner } from "@/ui/spinner";
import { EmptyState, ErrorState } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { Toggle } from "@/ui/toggle";
import { useStartOf } from "@/useNow";
import { LIST_LIMIT } from "@/useRequests";
import { useArrivals } from "./arrivals";
import { copyText } from "./cells";
import { groupAt, groupBySession, isAt, lines, step, visible, type Cursor, type Group } from "./grouping";
import { mergeFound, useHistorySearch, type HistorySearch } from "./historySearch";
import { RequestTable, type RequestTableHandle } from "./RequestTable";
import { SessionSheet } from "./SessionPanel";
import { TrafficSummary } from "./TrafficSummary";
import { trafficText } from "./Traffic.i18n";
import type { TrafficView } from "./view";
import { OpenRowHint } from "@/guide/PageHints";

const DAY_MS = 24 * 3_600_000;

/** 焦点落在这些控件上时，`Enter` 和空格归控件自己（见键盘导航的注释） */
const CONTROLS =
  "button, a[href], [role=button], [role=radio], [role=tab], [role=menuitem], [role=option], [role=checkbox], [role=switch], [role=combobox]";
/** 自己用方向键的控件：菜单、列表、标签、滑块、对话框。焦点在里面时方向键归它们 */
const ARROW_WIDGETS = "[role=menu], [role=listbox], [role=tablist], [role=slider], [role=dialog]";

/** 有就去掉，没有就加上。展开、收起一个组走它 */
function toggled(s: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(s);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** 网关地址，写在句子里的那种样子 */
function Addr({ children }: { children: ReactNode }) {
  return <code className="rounded bg-surface px-1 py-0.5 font-mono text-foreground">{children}</code>;
}

/**
 * 流量页：页头（在不在跑、多少条、几条失败、近 30 分钟的节奏）、过滤条、请求表，
 * 请求和会话的详情浮层，行内键盘导航。
 *
 * 数据（`rows`、`sessions`）和「怎么看」的状态（`view`）都来自外壳：它们在换页
 * 之后还要在，见 `view.ts`。这一页自己只管打开了哪一条、键盘停在哪一行。
 */
export default function TrafficPage({
  rows: allRows,
  seeded,
  seedError,
  onRetry,
  locallyAnswered,
  sessions,
  status,
  view,
}: {
  rows: RequestRow[];
  /** 历史读过了（成没成都算）。之前不画空状态：那时「暂无请求」不是真的 */
  seeded: boolean;
  /** 读历史失败的原因。读成了就是 `undefined` */
  seedError: unknown;
  /** 再读一遍历史 */
  onRetry: () => Promise<void>;
  locallyAnswered: number;
  sessions: SessionView[];
  status: CoreStatus | null;
  view: TrafficView;
}) {
  const t = useText(trafficText);
  const common = useText(commonText);
  const nav = useNav();
  const { filter, setFilter, sortKey, sortDir, toggleSort, grouped, setGrouped, openGroups, setOpenGroups } = view;
  const [retrying, retry] = usePending();

  /*
    **筛选伸到整份记录里。**读进来的只有最近两千条：列表装满了、或者要按内容找时，
    同样的条件交给 core 在库里找，找到的并进来（见 `historySearch.ts`）。没有请求时
    库里也没有，不去问。
  */
  const search = useHistorySearch(
    filter,
    allRows,
    allRows.length >= LIST_LIMIT,
    seeded && seedError === undefined && allRows.length > 0,
  );
  const found = search.found;
  const rows = useMemo(
    () => sortRows(mergeFound(allRows, filter, found), sortKey, sortDir),
    [allRows, filter, found, sortKey, sortDir],
  );
  /** 库里那一页还没回来，表里一条都还没有：画骨架，不说「没有符合条件的」 */
  const searching = search.mode !== "off" && (found === null || (found.busy && found.stopped === null));
  const facet = useMemo(() => facets(allRows), [allRows]);
  /** 上一次归出来的组：没变的组沿用原来的对象，组头就不重画（见 `groupBySession`） */
  const lastGroups = useRef<Group[]>([]);
  /*
    **过滤和排序先跑，归组后跑。**反过来的话，筛掉一半请求之后组头上的汇总还是
    整次任务的数字，而用户会以为自己筛错了。组与组之间沿用表头选的那个方向（按组里
    最新的一条比），组内永远按时间正序 —— 见 `grouping.ts`。
  */
  const groups = useMemo(() => {
    if (!grouped) return undefined;
    const gs = groupBySession(rows, sessions, lastGroups.current);
    lastGroups.current = gs;
    const dir = sortDir === "asc" ? 1 : -1;
    return sortKey === "time" ? [...gs].sort((a, b) => (groupAt(a) - groupAt(b)) * dir) : gs;
  }, [grouped, rows, sessions, sortKey, sortDir]);
  /** 全集：读进来的，加上库里找到的（它们可能来自别的密钥、别的应用） */
  const universe = useMemo(() => (found ? [...allRows, ...found.rows, ...found.kept] : allRows), [allRows, found]);
  /**
   * 「密钥」这一列只在真的分得开的时候才出现：一把密钥时整列是同一个值。按实际
   * 出现过的算；推测出的应用、非本机的来源分得开也算（格子里也写它们）。
   */
  const showClient =
    new Set(universe.flatMap((r) => (r.client ? [r.client] : []))).size > 1 ||
    new Set(universe.map((r) => r.hint ?? "")).size > 1 ||
    universe.some((r) => r.peer);
  /** 有哪一行带着推测出的应用。按全集算：筛选一变，密钥那一格的缩进不该跟着跳 */
  const hints = useMemo(() => universe.some((r) => r.hint), [universe]);

  /*
    刚到的请求和刚出现的会话，滑进来。**按全集算**，见 `useArrivals`。
  */
  const ids = useMemo(() => allRows.map((r) => r.id), [allRows]);
  const sessionIds = useMemo(() => [...new Set(allRows.flatMap((r) => (r.session ? [r.session] : [])))], [allRows]);
  const fresh = useArrivals(ids, seeded);
  const freshGroups = useArrivals(sessionIds, seeded);

  const searchRef = useRef<HTMLInputElement>(null);
  /** 滚动层。表格看它滚到了哪、画哪一段 */
  const listRef = useRef<HTMLDivElement>(null);
  /** 表格。键盘选中一行之后叫它把那一行滚进视野 */
  const tableRef = useRef<RequestTableHandle>(null);
  /** 打开的那条请求（右侧浮层） */
  const [open, setOpen] = useState<number | null>(null);
  /** 右侧开着的那次会话。请求可以叠在它上面，见 `SessionSheet` */
  const [openSession, setOpenSession] = useState<string | null>(null);
  /** 那次会话在表里的行（不看筛选）：库里的详情还没有的那几轮从这里补 */
  const openSessionRows = useMemo(
    () => (openSession === null ? [] : allRows.filter((r) => r.session === openSession)),
    [allRows, openSession],
  );
  /**
   * 键盘选中的那一行：一条请求，或者归组时的一个组头。`null` 表示还没用过键盘 ——
   * 一进页面就高亮第一行，会让人以为那一行有什么特别。记的是哪一行，不是第几行。
   */
  const [cursor, setCursor] = useState<Cursor | null>(null);

  /*
    **交给表格的几个回调要稳定。**表格的行是 `memo` 的（见 `RequestTable`），每次
    重画都换一个新函数的话，一条请求落地就是画着的每一行一起重画。
    一次只开一样：请求详情和会话详情共用右侧那一栏。
  */
  const openRequest = useCallback((id: number) => {
    setOpenSession(null);
    setOpen(id);
  }, []);
  const openSessionPanel = useCallback((id: string) => {
    setOpen(null);
    setOpenSession(id);
  }, []);
  const toggleGroup = useCallback((id: string) => setOpenGroups((prev) => toggled(prev, id)), [setOpenGroups]);

  // 深链：带着筛选（外壳已经改好 `view`）、打开某一条、聚焦搜索框
  useNavParams("requests", (p) => {
    if (p.request !== undefined) {
      setOpenSession(null);
      setOpen(p.request);
    }
    if (p.search) requestAnimationFrame(() => searchRef.current?.select());
  });

  /**
   * 今天从哪一刻算起。时间那一列今天的记录给到秒，更早的带上日期；那条界线一天
   * 只过一次，到了零点、钟跳了（睡醒、改时钟、换时区）时才换。
   */
  const today = useStartOf(DAY_MS);

  /**
   * 行内的键盘导航。`↑↓` 按屏幕上的顺序走，`Enter` 或空格打开（空格和访达里的
   * 快速查看同一个手势）。归组时组头也是一行：`Enter` 打开那次会话，`→` 展开、
   * `←` 收起；在组里的请求上按 `←` 回到组头。
   *
   * 三个边界：在输入框里打字时不接管；焦点在控件上时，那个控件自己要用的键不接管
   * —— 按钮上的 `Enter`、空格（行尾的「…」按回车要弹出菜单，不是打开这一行），
   * 菜单、标签里的方向键；浮层开着时 `↑↓` 也不动（请求和会话的都算），那时在看
   * 详情而不是挑行。
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
      const activate = e.key === "Enter" || e.key === " ";
      if (el instanceof Element && el.closest(activate ? CONTROLS : ARROW_WIDGETS)) return;
      if (open !== null || openSession !== null) return;
      // **选中的那一行要一直看得见**：表格只画看得见的那一段，那一行可能还没画出来，交给它滚
      const reveal = (c: Cursor) => tableRef.current?.reveal(c);
      // 表里从上到下的每一行。按它走，不按 `rows`：归组之后两者不一样，见 `lines`
      const ls = lines(rows, groups, openGroups);
      const here = ls.find((l) => isAt(l, cursor));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        // 焦点在某一行的「…」上（Tab 进去的）：挑别的行时放掉它，不然焦点框留在旧的那一行
        if (el instanceof HTMLElement && el !== document.body && listRef.current?.querySelector("tbody")?.contains(el))
          el.blur();
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
      } else if (activate && here && visible(here)) {
        // 空格的默认动作是把页面往下翻一屏：选中了一行时它的意思是「打开」
        e.preventDefault();
        if (here.kind === "request") setOpen(here.id);
        else setOpenSession(here.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, groups, openGroups, cursor, open, openSession, setOpenGroups]);

  const none = allRows.length === 0;
  const filtered = hasAnyFilter(filter);
  const addr = status?.gateway_addr ?? null;
  /** 读历史失败、事件流上也还没有任何一条：整块说失败，给重试 */
  const failedEmpty = seedError !== undefined && none;

  return (
    /*
      **滚的是这一层，边距在里层。**表头是 `sticky top-0`，吸顶的位置从滚动容器的
      内边距以内算起。横着滚的也是这一层：最小窗口、侧栏展开时表比页面宽，表外面
      那层自己横着滚的话，表头就钉在它身上、不再吸顶（见 `Table` 的 `scroll`）。

      所以分成三块：上面的页头和过滤条、下面的脚注钉在左边（`sticky left-0`），表横
      着滚时它们不跟着走；中间那块跟着表变宽（`w-fit`），滚到最右，表的右边距才露得
      出来。这一页不套 `Page`：`Page` 的宽度和边距是给整页一起滚的页面的，这里三块
      各自带 `px-5`，底部留白和 `Page` 一样是 32px。
    */
    <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
      <div className="sticky left-0 px-5">
        <PageHeader
          actions={
            /*
              **归组是个视角，不是一个筛子**：它不改变哪些行在表里，只改变怎么摆。所以
              不和筛选放在一起，放在页头右边，两个里选一个：逐条看请求，或者看会话（收起
              来就是会话列表，展开是那次任务的每一轮）。
            */
            <Segmented
              label={t.viewLabel}
              value={grouped ? "sessions" : "requests"}
              options={[
                { id: "requests", label: t.viewRequests },
                { id: "sessions", label: t.viewSessions },
              ]}
              onChange={(v) => setGrouped(v === "sessions")}
              disabled={none}
            />
          }
          summary={
            // 历史读完之前，「0 条请求」不是真的；读失败时也说不出一共几条
            !seeded ? (
              <Skeleton className="my-[3px] h-3.5 w-72 rounded-sm" />
            ) : failedEmpty ? undefined : (
              <TrafficSummary
                rows={allRows}
                failedOnly={filter.failedOnly}
                onFailedOnly={(v) => setFilter((f) => ({ ...f, failedOnly: v }))}
              />
            )
          }
        />
        {/*
          过滤条。**一直在，不是「有数据才出现」**：一个时有时无的工具条，每次都要
          重新找它在哪儿；⌘F 也要一直有地方落。没有请求时除了搜索框都是禁用的。
        */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/*
            **「搜索内容」是框里的一个图标开关，不和筛选并排**：它改的是怎么搜，不是筛掉
            哪些（编辑器搜索框里「区分大小写」那一类开关也在框里，也是图标）。写成字的话，
            英文的「Content」在 Windows 上把占位文字挤掉一截，并排放则默认窗口宽度下过滤
            条右端的条数和「清空」要折到第二行。内容只有 core 读得到，按下之后搜索词交给它
            在请求和回答里找；没有搜索词时它什么也不做
          */}
          <InputGroup className="h-7 w-[17.25rem] rounded-[min(var(--radius-md),10px)]">
            <InputGroupInput
              className="h-full py-0.5"
              ref={searchRef}
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder={t.search}
              spellCheck={false}
            />
            <InputGroupAddon align="inline-end">
              <Tip text={t.searchContentTip}>
                <Toggle
                  size="sm"
                  aria-label={t.searchContent}
                  className="size-5 min-w-0 rounded-[5px] p-0 text-muted-foreground aria-pressed:bg-foreground/10 aria-pressed:text-foreground data-[state=on]:bg-foreground/10"
                  disabled={none}
                  pressed={filter.content}
                  onPressedChange={(v) => setFilter((f) => ({ ...f, content: v }))}
                >
                  <TextSearchIcon />
                </Toggle>
              </Tip>
            </InputGroupAddon>
          </InputGroup>
          <Toggle
            variant="outline"
            size="sm"
            disabled={none}
            pressed={filter.failedOnly}
            onPressedChange={(v) => setFilter((f) => ({ ...f, failedOnly: v }))}
          >
            {t.failedOnly}
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
          {/*
            模型只在筛着的时候出现（从概览点一个模型进来）：平时按模型找用搜索框就够，
            再常驻一个下拉，默认窗口宽度下过滤条就折成两行。筛着的模型可能还没出现在
            已读到的行里 —— 照样列出来，筛子不能藏着。
          */}
          {filter.model !== "" && (
            <NativeSelect
              size="sm"
              value={filter.model}
              onChange={(e) => setFilter((f) => ({ ...f, model: e.target.value }))}
            >
              <NativeSelectOption value="">{t.allModels}</NativeSelectOption>
              {(facet.models.includes(filter.model) ? facet.models : [filter.model, ...facet.models]).map((m) => (
                <NativeSelectOption key={m} value={m}>
                  {m}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {/*
            筛掉了多少要说出来：只写「12 条」不写「共 340 条」，会以为总共就这么多。
            没筛的时候不写 —— 页头已经说了一共几条。
          */}
          {filtered && !none && (
            <span className="ml-auto flex items-center gap-1 motion-fade">
              <span className="tw-label tw-num text-muted-foreground">
                {/* 在库里找过就说不出「一共几条」了：只说找到几条，搜到了哪儿写在表下面 */}
                {found ? t.found(rows.length) : t.shownOf(rows.length, allRows.length)}
              </span>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFilter(EMPTY_FILTER)}>
                {t.clear}
              </Button>
            </span>
          )}
        </div>

        {/*
          还没有上游 —— 引导，不是拦路。说清三件事：网关已在运行（所以这不是故障）、
          缺的是什么、在哪里配置。最后一件给一个能点的入口。
        */}
        <Banner
          show={status?.providers === 0}
          layout="inline"
          tone="info"
          className="mb-3"
          title={t.noUpstreams}
          actions={
            <Button size="sm" variant="outline" onClick={() => nav.open("upstreams")}>
              {t.goToUpstreams}
            </Button>
          }
        >
          {addr && t.listening(<Addr>http://{addr}</Addr>)}
        </Banner>
        {/* 读历史失败了，但事件流上已经来了几条：照常画表，说清这不是全部 */}
        <Banner
          show={seedError !== undefined && !none}
          layout="inline"
          tone="warning"
          className="mb-3"
          title={t.historyPartial}
          actions={
            <Button size="sm" variant="outline" pending={retrying} onClick={() => void retry(onRetry)}>
              {common.retry}
            </Button>
          }
        />
        {/* 有请求了：说一句点开能看到什么 */}
        <OpenRowHint when={allRows.length > 0} className="mb-3" />
      </div>
      <div className="w-fit min-w-full px-5">
        {failedEmpty ? (
          <ErrorState title={t.historyFailed} error={seedError} onRetry={() => void retry(onRetry)} retrying={retrying} />
        ) : seeded && rows.length === 0 && !searching ? (
          !none ? (
            // 有记录，只是全被筛掉了。这时说「暂无请求记录」是错的
            <EmptyState
              icon={<FunnelXIcon />}
              title={t.noMatchTitle}
              description={
                found ? (
                  <>
                    {found.error !== undefined
                      ? t.searchFailed(errorText(found.error))
                      : t.noMatchSearched(found.next ? when(found.next.at_ms, today) : null)}
                    {found.mode === "content" && found.stopped !== null && (
                      <>
                        <br />
                        {found.bodiesSinceMs !== null ? t.bodiesSince(found.bodiesSinceMs) : t.noBodies}
                      </>
                    )}
                  </>
                ) : (
                  t.noMatch(allRows.length)
                )
              }
              action={
                <>
                  {found && (found.error !== undefined || found.next) && (
                    <Button variant="outline" size="sm" pending={found.busy} onClick={search.more}>
                      {found.error !== undefined ? common.retry : t.searchMore}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setFilter(EMPTY_FILTER)}>
                    {t.clearFilters}
                  </Button>
                </>
              }
            />
          ) : (
            // 空状态永远在回答「接下来该做什么」
            <EmptyState
              icon={<Listening />}
              title={t.emptyTitle}
              description={
                <>
                  {addr && t.pointClients(<Addr>http://{addr}</Addr>)}
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
              action={
                <>
                  {addr && (
                    <Button size="sm" variant="outline" onClick={() => void copyText(`http://${addr}`, t.addressCopied)}>
                      <IconCopy />
                      {t.copyAddress}
                    </Button>
                  )}
                  <Button size="sm" onClick={() => nav.open("clients")}>
                    {t.goToClients}
                  </Button>
                </>
              }
            />
          )
        ) : (
          <RequestTable
            ref={tableRef}
            scroller={listRef}
            rows={rows}
            hits={found?.hits}
            showClient={showClient}
            hints={hints}
            cursor={cursor}
            fresh={fresh}
            freshGroups={freshGroups}
            today={today}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
            onCursor={setCursor}
            onOpen={openRequest}
            onFilter={setFilter}
            groups={groups}
            openGroups={openGroups}
            selectedSession={openSession}
            onToggleGroup={toggleGroup}
            onOpenSession={openSessionPanel}
          />
        )}
      </div>
      <div className="sticky left-0 px-5 pb-8">
        {rows.length > 0 && <SearchStatus search={search} today={today} />}
        {locallyAnswered > 0 && rows.length > 0 && (
          <p className="mt-3 tw-label text-muted-foreground">{t.probesElsewhere(locallyAnswered)}</p>
        )}
      </div>

      <RequestDrawer id={open} onClose={() => setOpen(null)} />
      {/* 在会话这一层之上再叠一层请求，不是把它换掉：看完这一轮要退回任务看下一轮 */}
      <SessionSheet
        id={openSession}
        rows={openSessionRows}
        onClose={() => setOpenSession(null)}
        onOpenTurn={setOpen}
      />
    </div>
  );
}

/**
 * 表下面那一行：在整份记录里搜到了哪一刻、还能不能往前接着找；按内容找时再说一句
 * 报文留到哪一天 —— 比那更早的请求只按记录对，搜不到内容不等于内容里没有。
 */
function SearchStatus({ search, today }: { search: HistorySearch; today: number }) {
  const t = useText(trafficText);
  const common = useText(commonText);
  const f = search.found;
  if (search.mode === "off") return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 tw-label text-muted-foreground motion-fade">
      {f === null || f.stopped === null ? (
        f?.error !== undefined ? (
          <SearchFailed error={f.error} onRetry={search.more} retry={common.retry} />
        ) : (
          <span className="flex items-center gap-1.5">
            <Spinner className="size-3.5" />
            {search.mode === "content" ? t.searchingContent : t.searchingOlder}
          </span>
        )
      ) : f.error !== undefined ? (
        <SearchFailed error={f.error} onRetry={search.more} retry={common.retry} />
      ) : f.next ? (
        <span className="flex items-center gap-2">
          <span className="tw-num">{t.searchedTo(when(f.next.at_ms, today))}</span>
          <Button variant="outline" size="sm" pending={f.busy} onClick={search.more}>
            {t.searchMore}
          </Button>
        </span>
      ) : (
        <span>{t.searchedAll}</span>
      )}
      {f && f.mode === "content" && f.stopped !== null && (
        <span>{f.bodiesSinceMs !== null ? t.bodiesSince(f.bodiesSinceMs) : t.noBodies}</span>
      )}
    </div>
  );
}

function SearchFailed({ error, onRetry, retry }: { error: unknown; onRetry: () => void; retry: string }) {
  const t = useText(trafficText);
  return (
    <span className="flex items-center gap-2">
      <span className="text-destructive">{t.searchFailed(errorText(error))}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {retry}
      </Button>
    </span>
  );
}

/**
 * 空状态的图：一列记录，角上一个在跳的点 —— 网关开着、在等第一条请求。
 * 图标位是 40px 的方块、图标 18px 居中，点要落在方块的右上角，所以往外挪 11px。
 */
function Listening() {
  return (
    <span className="relative flex">
      <IconFlow />
      <StatusDot tone="ok" pulse className="absolute -top-[13px] -right-[13px]" />
    </span>
  );
}
