import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import { listen } from "@tauri-apps/api/event";
import { useRequests } from "./useRequests";
import { useStableState } from "./useStable";
import { bucketStart } from "./format";
import {
  EMPTY_FILTER,
  facets,
  filterRows,
  hasAnyFilter,
  sortRows,
  type SortDir,
  type SortKey,
} from "./requestTable";
import Config from "./Config";
import { ConfigFileDialog, VersionHistoryDialog } from "./ConfigDialogs";
import UpstreamsPage from "./upstreams/UpstreamsPage";
import ClientsPage from "./clients/ClientsPage";
import KeysPage from "./keys/KeysPage";
import RoutingPage from "./routing/RoutingPage";
import SecurityPage, { type LogFocus } from "./security/SecurityPage";
import McpPage from "./mcp/McpPage";
import { presetRange } from "@/ui/range";
import { Notices } from "./Notices";
import { Tip, TooltipRoot } from "@/ui/tip";
import {
  IconClient,
  IconDashboard,
  IconFlow,
  IconGuard,
  IconKey,
  IconMcp,
  IconRoute,
  IconServer,
  IconSettings,
} from "./ui/icons";
import { isMac, isMod } from "@/platform";
import { RequestTable } from "./traffic/RequestTable";
import { SessionPanel } from "./traffic/SessionPanel";
import { useSessions } from "./traffic/useSessions";
import { useCoreEvent } from "./useCoreEvent";
import {
  groupAt,
  groupBySession,
  isAt,
  lines,
  step,
  visible,
  type Cursor,
} from "./traffic/grouping";
import Dashboard from "./Dashboard";
import RequestDrawer from "./RequestDrawer";
import type { CoreStatus, Overview, SessionDetail } from "./types";
import { stageLabel } from "./labels";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { appText } from "./App.i18n";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Toggle } from "@/ui/toggle";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import type { LucideIcon } from "lucide-react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/ui/empty";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/ui/sheet";
import { Toaster } from "@/ui/sonner";
import { toast } from "sonner";
import { coreText, errorText } from "@/i18n/core.i18n";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { trouble } from "./launch/trouble";
import { LaunchScreen } from "./launch/LaunchScreen";
import { warm } from "./launch/warm";
import { ConnectionProvider, useConnections } from "./connection/ConnectionProvider";
import { Switcher } from "./connection/Switcher";
import { Unlinked } from "./connection/Unlinked";
import { currentProfile } from "./connection/api";
import { connText } from "./connection/connection.i18n";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from "@/ui/sidebar";

const DAY_MS = 24 * 3_600_000;

/**
 * 连控制面最多退避重试几次。
 *
 * **到了上限就停手**，不再往下试 —— 再试下去就成了轮询。守护状态一变
 * （启动中 → 运行中、进了重启、进了安全模式）那个 effect 会重跑，那才
 * 是它该被叫醒的时机。
 */
const MAX_TRIES = 8;

/** 概览的几个重读理由挨着到时，等这么久再读：一串只读一次 */
const COALESCE_MS = 100;

/**
 * 启动画面最多等多久。**过了就照常打开窗口**，内容区显示「未连接」那一页、后台接着
 * 重连 —— 而不是一直转圈。界面外壳不该依赖 core 连没连上：连接管理在设置里，那一页
 * 这时必须能用
 */
const LAUNCH_CAP_MS = 8_000;

/** core 的状态字符串来自 Rust 侧的 CoreState，见 supervisor/mod.rs。 */
/**
 * 主窗口的几个面。
 *
 * **源列表,不是标签栏。**原来是 6 个平铺标签挤在标题栏里 —— 那是 Web
 * 后台的 IA:每个标签一个页面、页面之间平级、越加越挤。原生客户端用
 * 左侧源列表:它能分组,能挂角标,加一项不会把别的挤窄。
 *
 * 分成两组,判据是**打开频率**:上面那组是每天看的,下面那组是配一次
 * 就不动的。混在一起的话,一个月用一次的「卸载」和每天看的「流量」
 * 在导航上一样重。
 */
type Surface =
  | "requests"
  | "dashboard"
  | "security"
  | "routing"
  | "keys"
  | "upstreams"
  | "settings"
  | "clients"
  | "mcp";

/** 编辑 config.yaml 的几页。工具栏上的「配置文件」「版本历史」只在这几页出现 */
const CONFIG_PAGES = new Set<Surface>(["upstreams", "keys", "routing", "security"]);

/** 配置文件里的一段由哪一页管理 */
function surfaceOf(section: string | null): Surface {
  switch (section) {
    case "providers":
    case "proxies":
    case "pricing":
      return "upstreams";
    case "clients":
      return "keys";
    case "routes":
    case "groups":
    case "default_route":
      return "routing";
    case "security":
      return "security";
    default:
      // 监听、日志保留在设置页；辅助请求在路由页，但它没有自己的段名
      return "settings";
  }
}

/** 有就去掉，没有就加上。展开、收起一个组走它 */
function toggled(s: Set<string>, id: string): Set<string> {
  const next = new Set(s);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** lucide 的图标类型。尺寸走 `size`，颜色走 `currentColor`。 */
type SourceIcon = LucideIcon;
const SOURCES: {
  group: string;
  items: { id: Surface; icon: SourceIcon }[];
}[] = [
  {
    group: "monitor",
    items: [
      // **概览在最上面。**它回答的是「现在什么情况」，而流量和会话回答
      // 的是「刚才那一条发生了什么」—— 前者是打开这个应用的默认意图，
      // 后者是带着问题来的时候才点。
      { id: "dashboard", icon: IconDashboard },
      // **会话不是第三项，是「流量」的第二种粒度。**同一批数据，一个
      // 按请求看，一个按一次对话看 —— 分成两个导航项时，用户得先决定
      // 「我要看的是请求还是会话」，而他想知道的其实是「刚才发生了什么」
      { id: "requests", icon: IconFlow },
    ],
  },
  {
    // **谁在用这个网关，拿什么连进来。**客户端和密钥是同一件事的两面：
    // 接管一个客户端就为它生成一把密钥，而密钥页上的每一把也都说得出
    // 是给哪个客户端的。两者挨着，从一边到另一边不用跨过配置那一组。
    group: "access",
    items: [
      { id: "clients", icon: IconClient },
      { id: "keys", icon: IconKey },
    ],
  },
  {
    group: "config",
    items: [
      // 路由原来埋在配置页中段,和「监听与访问」「诊断包」并列 ——
      // 而它是这个产品区别于一个普通代理的核心概念,不该要滚两屏才看见。
      { id: "upstreams", icon: IconServer },
      { id: "routing", icon: IconRoute },
      // **安全和上游、路由同组，不挂在「监控」下面。**它不是一个看板：两项
      // 防护各有三档、有规则、有拦截动作，那是配置，不是观测 —— 塞在监控里，
      // 用户会把它当成一个只能看的页面，而整个设计前提是他看完日志之后要去动
      // 那几个开关。日志和开关仍在同一页
      { id: "security", icon: IconGuard },
      // **MCP 和上游、路由同组**：它管的是客户端能调用哪些工具，和上游、路由
      // 一样是配一次就不常动的东西
      { id: "mcp", icon: IconMcp },
    ],
  },
  {
    // **应用自己的设置，不是网关的配置。**
    //
    // 开机自启原来挂在「网关」下面，和「上游地址」「监听端口」并列 ——
    // 那是两类完全不同的东西：一个写进系统的登录项，一个写进 config.yaml。
    // 分界线就是这个：改的是这个 macOS 应用，还是改网关的配置文件。
    group: "app",
    items: [{ id: "settings", icon: IconSettings }],
  },
];

/**
 * core 的状态说成人话。
 *
 * `short` 是给收起的源列表用的 —— 那里只有 80px，「重启中（第 3 次）」
 * 和「安全模式 · 网关未运行」都放不下。**不是截断，是另写一句**：截断
 * 出来的「安全模式 · 网关未…」比四个字更难读，而第几次重试在那个宽度上
 * 本来就是悬停才看的细节。
 */
function describeCore(raw: string): {
  text: string;
  short: string;
  tone: "ok" | "warn" | "bad";
} {
  const t = textOf(appText);
  if (raw.startsWith("running:"))
    return { text: t.running, short: t.running, tone: "ok" };
  if (raw === "starting")
    return { text: t.starting, short: t.starting, tone: "warn" };
  if (raw.startsWith("restarting:")) {
    const [, attempt] = raw.split(":");
    return {
      text: t.restarting(`${attempt}`),
      short: t.restartingShort,
      tone: "warn",
    };
  }
  // 安全模式必须显眼：这时候网关不转发了，用户所有的 AI 客户端都在瞎。
  if (raw === "safe_mode")
    return { text: t.safeMode, short: t.safeModeShort, tone: "bad" };
  // 程序运行不了。原因在启动画面上说（见 launch/trouble.ts）
  if (raw.startsWith("failed:")) return { text: t.cannotStart, short: t.cannotStart, tone: "bad" };
  return { text: t.stopped, short: t.stopped, tone: "bad" };
}

/** 可排序表头。箭头只出现在当前排序列上 —— 每列都挂一个等于没挂。 */
/**
 * 标成拖拽区，**只在 macOS 上**。
 *
 * 那里窗口用的是 Overlay 标题栏（红绿灯浮在内容上），没有一条真的标题栏可以
 * 抓，不给拖拽区窗口就挪不动。
 *
 * Windows 和 Linux 用系统标题栏（决策 10），本来就抓得住。再把内容标成拖拽区的话，
 * 点一下侧栏空白就会把窗口拖走 —— 在那个平台上这是意外行为，不是便利。
 */
const drag = isMac ? { "data-tauri-drag-region": true } : {};

/**
 * 主窗口。
 *
 * **换了连接，主界面整个重挂。**流量、会话、概览、各页的缓存都属于原来那个 core ——
 * 两边的请求编号还会重叠 —— 一样样去清，漏一处就是把一台机器的数据安在另一台头上。
 * 连接的对话框挂在重挂的那一层外面（`ConnectionProvider`），切换那一下不跟着消失。
 */
export default function App() {
  return (
    <ConnectionProvider>
      <PerConnection />
    </ConnectionProvider>
  );
}

function PerConnection() {
  const { view } = useConnections();
  // 第一次读到的那个连接不算「换了」：那是启动时本来就要连的
  const seen = useRef<{ id: string | null; n: number }>({ id: null, n: 0 });
  if (view && seen.current.id !== view.current) {
    if (seen.current.id !== null) seen.current.n += 1;
    seen.current.id = view.current;
  }
  return <Shell key={seen.current.n} first={seen.current.n === 0} />;
}

function Shell({ first }: { first: boolean }) {
  const t = useText(appText);
  const ct = useText(connText);
  const conn = useConnections();
  const profile = conn.view ? currentProfile(conn.view) : undefined;
  /** 连着的是远程 core */
  const remote = profile !== undefined && !profile.local;
  const link = conn.view?.link ?? null;
  const common = useText(commonText);
  /**
   * 守护状态。**先当它在起**：第一次读到之前画「已停止」的话，启动画面会先
   * 闪一下「core 未运行」
   */
  const [core, setCore] = useState("starting");
  /**
   * 这次开窗连上过控制面吗。
   *
   * **取数的都等它。**连上之前去取，拿回来的只有一句「连不上」；而它们挂在
   * App 顶层，一开窗就会去取。它也决定断线时的样子：连上过就保留页面、顶上
   * 挂一条带子 —— 用户本来在看数据，清空比留着旧值加一句说明更糟。
   */
  const [linked, setLinked] = useState(false);
  /** `linked` 的同一个值，给只在变化时才该重跑的 effect 读 */
  const linkedRef = useRef(false);
  /** 连了第几次了。只用来在界面上说清楚，不参与重试逻辑 */
  const [tries, setTries] = useState(0);
  /** 最近一次读状态失败的原因。启动画面上连着失败时说出来 */
  const [linkError, setLinkError] = useState<string | null>(null);
  const {
    rows: allRows,
    seeded,
    settled,
    health,
    models,
    listening,
    locallyAnswered,
    rejected,
    reloads,
    alerts,
    rotated,
    clearRotated,
    clearAlerts,
    upstreamState,
  } = useRequests(linked);
  // 排序与过滤。默认按时间倒序 —— 那是「刚才发生了什么」，也是打开这
  // 一页最常见的意图。
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState(EMPTY_FILTER);
  /*
    **按会话归组。**请求和会话本来就是同一批记录的两个粒度 —— 原来它们
    是两个标签，各有各的表、各有各的详情范式，而两者之间没有门。

    开关记下来：这是「我习惯怎么看流量」，不是一次性的动作。
  */
  const [grouped, setGrouped] = useState(() => {
    try {
      return window.localStorage.getItem("tw-grouped") === "on";
    } catch {
      // 隐私模式之类。记不住而已
      return false;
    }
  });
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  /** 右侧分栏里开着的那次会话。和 `open`（一条请求）互斥 */
  const [openSession, setOpenSession] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const sessions = useSessions(linked);
  const rows = useMemo(
    () => sortRows(filterRows(allRows, filter), sortKey, sortDir),
    [allRows, filter, sortKey, sortDir],
  );
  const facet = useMemo(() => facets(allRows), [allRows]);
  /*
    **过滤和排序先跑，归组后跑。**反过来的话，筛掉一半请求之后组头上的
    汇总还是整次任务的数字，而用户会以为自己筛错了。

    组与组之间沿用表头选的那个方向（按组里最新的一条比），组内永远
    按时间正序 —— 见 `grouping.ts`。
  */
  const groups = useMemo(() => {
    if (!grouped) return undefined;
    const gs = groupBySession(rows, sessions);
    const dir = sortDir === "asc" ? 1 : -1;
    return sortKey === "time"
      ? [...gs].sort((a, b) => (groupAt(a) - groupAt(b)) * dir)
      : gs;
  }, [grouped, rows, sessions, sortKey, sortDir]);
  /**
   * 「密钥」这一列只在真的分得开的时候才出现。
   *
   * 目标用户「一个 key 就够」，那时整列二十五行是同一个值 —— 占着宽度
   * 却零信息，而那点宽度给模型名用正好。**按实际出现过的算，不按配置里
   * 有几个算**：配了两个而只有一个在发请求时，这一列同样是常量。
   *
   * 格子里除了密钥还写推测出的应用和非本机的来源，所以**这两样分得开也
   * 算**：一把密钥几个应用共用、或者局域网里另一台机器也在用，这一列就
   * 有话可说。
   */
  const showClient =
    facet.clients.length > 1 ||
    new Set(allRows.map((r) => r.hint ?? "")).size > 1 ||
    allRows.some((r) => r.peer);
  const searchRef = useRef<HTMLInputElement>(null);
  /*
    **任务还在进行的话，详情要跟得上。**打开一次会话多半是想看这次花了多少，而
    那时它往往还在跑：有请求落地就重读（按事件节流，和会话列表同一个节奏）。
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
        toast.error(errorText(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [openSession, sessionTick]);
  useEffect(() => {
    try {
      window.localStorage.setItem("tw-grouped", grouped ? "on" : "off");
    } catch {
      // 记不住而已，不值得为它中断
    }
  }, [grouped]);

  /**
   * 点表头排序。
   *
   * 同一列再点一次翻方向；换一列时**从最有用的那个方向开始** —— 按耗时
   * 排序的人要找的是慢的那几条，默认给升序等于让他再点一次。时间列反过来，
   * 默认是新的在前。
   */
  function toggleSort(k: SortKey) {
    if (k === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(k);
      setSortDir(k === "time" ? "desc" : "desc");
    }
  }
  const [status, setStatus] = useStableState<CoreStatus | null>(null);
  /**
   * 启动画面还在。**只在冷启动、这次开窗第一次交接之前**，见 `LaunchScreen`。
   * 热启动没有这一面，窗口藏到交接那一刻才出现（见 `warm`）
   */
  const [launching, setLaunching] = useState(!warm && first);
  /** 启动画面等够了（或者远程说了一个等多久都不会好的原因）：不再等，交出主界面 */
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setGaveUp(true), LAUNCH_CAP_MS);
    return () => clearTimeout(h);
  }, []);
  const lasting =
    link?.kind === "down" &&
    (link.error.kind === "wrong_key" ||
      link.error.kind === "version_mismatch" ||
      link.error.kind === "not_yet_available");
  /** 概览那一页的第一份数据到了。启动画面等它，交接时数字已经是对的 */
  const [landed, setLanded] = useState(false);
  /** 连上之后首屏迟迟取不齐：不再等，交给那一页自己的骨架 */
  const [waited, setWaited] = useState(false);
  /**
   * 刚出现的那几行。
   *
   * **第一个请求进来时那一行要跳出来** —— 它是「它真的在工作」的证明，
   * 而这类工具最难的一关正是让用户相信流量真的经过我们了。
   */
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const seenIds = useRef<Set<number>>(new Set());
  /** 打开的那条请求（右侧抽屉） */
  const [open, setOpen] = useState<number | null>(null);
  /** 菜单栏里点了「全部提醒…」几次。每点一次，工具栏上的提醒就打开一次 */
  const [noticesAsked, setNoticesAsked] = useState(0);
  /**
   * 键盘选中的那一行：一条请求，或者归组时的一个组头。
   *
   * **`null` 表示还没用过键盘。**一进页面就高亮第一行，会让用户以为
   * 那一行有什么特别。
   *
   * **记的是哪一行，不是第几行。**新请求从顶上进来、换了排序、展开收起一个
   * 组，行的位置都会变；记下标的话，高亮会跳到别的行上去。
   */
  const [cursor, setCursor] = useState<Cursor | null>(null);
  /** 流量页的滚动层。键盘选中一行之后，在它里面找到那一行滚进视野 */
  const listRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Surface>("dashboard");
  /** 从客户端页点了某把密钥：密钥页打开时定位到那一行 */
  const [focusKey, setFocusKey] = useState<string | null>(null);
  /**
   * 窗口够不够宽拆成两栏。
   *
   * 1100px 拆开之后列表约 620px、检查器 480px —— 两边都还能用。再窄的话
   * 列表会挤到只剩几列，那时浮层反而是对的：牺牲「同时看见」换回可读的
   * 列表宽度。**判据是实测的窗口宽度，不是一个 CSS 断点** —— 这是桌面
   * 应用，窗口是用户随手拖的。
   */
  /**
   * 今天从哪一刻算起。
   *
   * 时间那一列只有一处跟「现在」有关：今天的记录给到秒，更早的带上
   * 日期。**那条界线一天只过一次**，所以定时器就定在下一个零点 ——
   * 原来是每十秒问一遍现在几点，而每问一遍就把整张表重画一遍。
   *
   * 跨零点用 `setDate(+1)` 再归零，不是加 86400000：夏令时那两天
   * 一天不是 24 小时，加毫秒会错开一个钟头。
   */
  const [today, setToday] = useState(() => bucketStart(Date.now(), DAY_MS));
  useEffect(() => {
    const next = new Date(today);
    next.setDate(next.getDate() + 1);
    next.setHours(0, 0, 0, 0);
    const h = setTimeout(
      () => setToday(bucketStart(Date.now(), DAY_MS)),
      Math.max(1_000, next.getTime() - Date.now()),
    );
    return () => clearTimeout(h);
  }, [today]);
  /*
    **详情一律走浮层，不再拆栏。**

    拆栏把这张表挤窄，而八列里最先塌的是模型和上游那两列 —— 排查时
    要对着看的恰恰是它们。何况一次只看一条请求，剩下那半屏的表在这
    时候没人读。
  */
  const [ov, setOv] = useStableState<Overview | null>(null);
  // 加完第一个上游之后立刻重拉一次。等那两秒的轮询的话，用户刚点完
  // 「保存」还看着「还没有上游」，会以为没生效（和那条一样的理由）。
  const [nudge, setNudge] = useState(0);
  /** 配置文件对话框。`focus`：打开时选中的名字 */
  const [configFile, setConfigFile] = useState<{ focus: string | null } | null>(
    null,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  /**
   * 从概览的安全计数点进日志时带的区间。**离开安全页就清掉** —— 过一阵再
   * 回来，不该又被拨回当时那一段时间。
   */
  const [securityFocus, setSecurityFocus] = useState<LogFocus | null>(null);
  useEffect(() => {
    if (tab !== "security") setSecurityFocus(null);
  }, [tab]);

  /**
   * 概览页什么时候重新拉数。
   *
   * **不是定时轮询。**它原来跟着那个两秒一次的状态轮询走，而概览查的是
   * 库 —— 库只在请求落地之后才变。没有流量的时候，那两秒一次做的全是
   * 无用功：同一份数据重新序列化、重新渲染、图表重新动画一遍，而屏幕上
   * 什么都没变。**看起来就是价格一直在闪。**
   *
   * 现在跟着对账走：`settled` 每涨一次，说明库里确实多了东西（见
   * useRequests，它由事件流触发、2.5 秒节流）。`nudge` 是手动刷新。
   * 都没动的时候，这一页一次请求都不发。
   */
  const dashTick = settled + nudge;

  /**
   * 源列表收起还是展开。
   *
   * **记住用户的选择。**这是一个开着不关的应用——每次启动都把它展开
   * 回来，等于每次都要重按一遍。读取放在初始化里而不是 effect 里，
   * 否则第一帧会先按默认宽度画一次再跳。
   */
  const [railOpen, setRailOpen] = useState(() => {
    try {
      return window.localStorage.getItem("rail") !== "collapsed";
    } catch {
      // 隐私窗口、禁用站点数据都会在这里抛
      return true;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("rail", railOpen ? "open" : "collapsed");
    } catch {
      // 记不住只是下次要重按一遍，不值得打断任何事
    }
  }, [railOpen]);

  useEffect(() => {
    const now = rows.map((r) => r.id);
    const news = now.filter((id) => !seenIds.current.has(id));
    // 第一次加载（开窗时把历史填进来）不算「刚出现」—— 那时满屏都在
    // 闪，反而看不出哪一条是新的
    const first = seenIds.current.size === 0;
    for (const id of now) seenIds.current.add(id);
    if (first || news.length === 0) return;
    setFresh((prev) => new Set([...prev, ...news]));
    const t = setTimeout(() => {
      setFresh((prev) => {
        const next = new Set(prev);
        for (const id of news) next.delete(id);
        return next;
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [rows]);

  /*
    点了系统通知、或者菜单栏里的一行：落到能处理那件事的那一页。**窗口可能是为
    这一下新建的** —— 那时事件已经错过了，所以挂上时先去取一次；已经开着的窗口
    收事件。两条路都会把 Rust 那边存的清掉，下次开窗不会又跳过去。
  */
  useEffect(() => {
    const go = (view: string | null) => {
      if (!view) return;
      // `notices`：打开工具栏上的提醒（菜单栏里的「全部提醒…」）
      if (view === "notices") {
        setNoticesAsked((n) => n + 1);
        return;
      }
      // `requests:42`：打开流量页并展开那一条（菜单栏里点了一个进行中的请求）
      const [page, id] = view.split(":");
      // `switch:<id>`：菜单栏里选了一条远程连接。试连和确认在这里做，和侧栏同一条路
      if (page === "switch" && id) {
        switchTo.current(id);
        return;
      }
      setTab(page as Surface);
      if (page === "requests" && id) setOpen(Number(id));
    };
    void invoke<string | null>("take_pending_view")
      .then(go)
      .catch(() => {});
    const un = listen<string>("open-view", (e) => {
      go(e.payload);
      void invoke("take_pending_view").catch(() => {});
    });
    // 连接那一层（切换器里的「管理连接…」）要落页时发的
    const local = (e: Event) => go((e as CustomEvent<string>).detail);
    window.addEventListener("tw-open-view", local);
    return () => {
      un.then((f) => f());
      window.removeEventListener("tw-open-view", local);
    };
  }, []);

  /** 切换连接的入口。**用 ref**：落页那个 effect 只挂一次，而连接列表是后来才读到的 */
  const switchTo = useRef(conn.switchTo);
  switchTo.current = conn.switchTo;

  /**
   * 列表的键盘导航。
   *
   * **「用鼠标一行行点太慢」**，而 Requests 是主战场。
   *
   * `↑↓` 按屏幕上的顺序一行一行走，`Enter` 打开。归组时组头也是一行：`Enter`
   * 打开那次会话，`→` 展开、`←` 收起；在组里的请求上按 `←` 回到组头 —— 和访达
   * 列表视图里的三角一样。
   *
   * 两个边界：在输入框里打字时不接管方向键（否则光标动不了）；
   * 抽屉开着时 `↑↓` 也不动，那时用户在看详情而不是挑行。请求和会话的
   * 抽屉都算：选中的行会滚进视野，漏掉一个，背后的列表就跟着光标滚走了。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘ 系列**在 typing 判断和「只在请求页」之前**处理 —— ⌘F 的全部
      // 意义就是从任何地方跳到搜索框：在别的页上按它该切过去，在输入框
      // 里按它该重选。加上这两个前提就等于把它变成「已经在搜索框里的时
      // 候才有用」。 —— ⌘F 的全部意义就是从任何
      // 地方跳到搜索框，而「正在输入」恰恰是它最该生效的场景之一。
      // ⌘⌥S 收起/展开源列表 —— 访达、邮件、备忘录都是这个键。
      // 判 `code` 不判 `key`：macOS 上 ⌥ 会把 s 变成 ß。
      //
      // **只在 macOS 上有。**Windows 上 Ctrl+Alt 在不少键盘布局里就是 AltGr，
      // 按它是在打字；Linux 上 Ctrl+Alt 加字母常被桌面拿去做全局快捷键。
      // 那两边收起源列表用 Ctrl+B（和 VS Code 收侧栏一样），而
      // 那一个 `SidebarProvider` 已经在听了 —— 它听的是 Ctrl/⌘+B。
      if (isMac && e.metaKey && e.altKey && !e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        setRailOpen((v) => !v);
        return;
      }

      // ⌘F / ⌘, / ⌘R，Windows 上是 Ctrl 加同一个键。`preventDefault` 在 Windows
      // 上更要紧：WebView2 自己会把 Ctrl+F 当成页内查找、Ctrl+R 当成刷新页面
      if (isMod(e) && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === "f") {
          e.preventDefault();
          setTab("requests");
          // 切页是异步的，聚焦要等它挂上
          requestAnimationFrame(() => searchRef.current?.select());
          return;
        }
        if (k === ",") {
          e.preventDefault();
          setTab("settings");
          return;
        }
        if (k === "r") {
          e.preventDefault();
          setNudge((n) => n + 1);
          return;
        }
      }

      // 以下是请求页专属的行内导航
      if (tab !== "requests") return;
      const t = e.target as HTMLElement | null;
      const typing =
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable);
      if (typing) return;
      if (e.key === "Escape") {
        setOpen(null);
        return;
      }
      if (open !== null || openSession !== null) return;
      /*
        **选中的那一行要一直看得见。**方向键自带的滚动上面拦掉了，不补的话
        按过可视区的下沿，高亮就跑到屏幕外面去了。只滚刚好够的距离
        （`nearest`）；让开吸顶的表头、不横着滚，靠的是行上的 scroll-margin，
        见 `RequestTable`。光标到了头、没动，也照样滚：用滚轮翻走之后，按一下
        方向键就回到选中的那一行。
      */
      const reveal = (c: Cursor) =>
        listRef.current
          ?.querySelector(
            c.kind === "request"
              ? `[data-row="${c.id}"]`
              : `[data-session="${CSS.escape(c.id)}"]`,
          )
          ?.scrollIntoView({ block: "nearest" });
      // 表里从上到下的每一行。**按它走，不按 `rows`**：归组之后两者不一样，见 `lines`
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
      } else if (
        e.key === "ArrowLeft" &&
        here?.kind === "request" &&
        here.shown &&
        here.under !== null
      ) {
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
  }, [tab, rows, groups, openGroups, cursor, open, openSession]);

  // 换页时把抽屉关掉 —— 它是请求页的东西，留在别的页上没有意义，
  // 而那时 Esc 也不接管了（键盘那个 effect 只在请求页挂）
  useEffect(() => {
    if (tab !== "requests") setOpen(null);
  }, [tab]);

  /**
   * 守护状态。**推过来的，不是问出来的。**
   *
   * 「core 起来没、是不是在重启、有没有进安全模式」一天变不了几次，
   * 而这三个答案原来是每两秒问一遍的。
   *
   * **先挂监听再读一次当前值**，顺序不能反：事件只报变化，而两者之间
   * 发生的那一次转换会丢 —— 表现是启动瞬间界面卡在「已停止」，直到
   * 下一次转换才跟上。
   */
  useEffect(() => {
    let alive = true;
    const un = listen<string>("core-state", (e) => {
      if (!alive) return;
      setCore(e.payload);
      // 又起来了：之前读状态失败的次数和原因作废，这一回重新数。不清的话，
      // 上一回的「读不到」会在它刚起来、还没来得及读的那一下冒出来
      if (e.payload.startsWith("running:")) {
        setTries(0);
        setLinkError(null);
      }
    });
    void un
      .then(() => invoke<string>("core_state"))
      .then((c) => {
        if (alive) setCore(c);
      })
      .catch(() => {
        /* core 还没起来。它起来的那一刻会推一条过来 */
      });
    return () => {
      alive = false;
      void un.then((f) => f());
    };
  }, []);

  /**
   * 状态与配置概览。**只在真的有理由重读的时候重读。**
   *
   * 原来这一段是每两秒一轮的轮询：两次 IPC 往返，而绝大多数轮得到的是
   * 一模一样的答案。它变化的时机是数得清的，而每一个现在都有事件：
   *
   * · 配置换了一份（`reloads` 跟着 `config_reloaded` 走）
   * · 某家上游熔断了或恢复了（`health`，core 现在会报）
   * · 某家上游的模型清单开始获取或获取完了（`models`）
   * · 网关换了监听地址，或者没换成（`listening`）—— 配置换进去之后监听器
   *   才开始换，只跟着配置版本重读，读到的是换之前的地址
   * · 守护状态变了 —— 重启之后监听地址和 pid 都可能不一样
   * · 上游的现状变了（`upstreamState`）：凭据被拒或恢复、代理不通或恢复、要
   *   重新登录；事件流丢过事件也算
   * · 用户自己刚改完东西（`nudge`）
   *
   * **一串触发只读一次。**启动时每个上游会连着来两条模型事件，每条都立刻重读
   * 的话，读到的是同一份概览；隔一小会儿再读，这一串就只剩最后一次。
   */
  useEffect(() => {
    // 头一次连上之前，core 不在跑就不去读：读回来的只有一句「连不上」，而启动
    // 画面已经在说 core 怎么了。连上过之后照读 —— 断线那条带子要靠它数次数
    if (!linkedRef.current && !core.startsWith("running:")) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let n = 0;
    const read = async () => {
      try {
        const s = await invoke<CoreStatus>("core_status");
        if (!alive) return;
        setStatus(s);
        setLinked(true);
        linkedRef.current = true;
        setTries(0);
        setLinkError(null);
      } catch (e) {
        /*
          **读不到不弹提示。**那句话只会是「core 未在运行」，而启动画面（还没
          连上时）和顶上那条带子（连上过之后）已经在说 core 怎么了 —— 再弹一条
          就是同一件事说两遍。守护要等控制面答应了才报「运行中」，所以这里还
          失败，多半是 core 刚好又停了，或者两边的协议对不上：次数和原因记下来，
          交给它们去说。
        */
        if (!alive) return;
        n += 1;
        setTries(n);
        setLinkError(errorText(e));
        if (n <= MAX_TRIES) {
          timer = setTimeout(
            () => void read(),
            Math.min(1600, 200 * 2 ** Math.min(n - 1, 3)),
          );
        }
        // 到上限就停手，**不再重试** —— 再试下去就是轮询了。守护状态
        // 一变这个 effect 会重跑，那才是它该被叫醒的时机。
        return;
      }
      try {
        const o = await call("Overview", null);
        if (alive) setOv(o);
      } catch {
        /* 概览拿不到不影响状态那一半 —— 连上了就是连上了 */
      }
    };
    // 头一次连上之前不攒：那时还没有一串触发可合并，而启动画面（热启动时是
    // 还藏着的窗口）正等着这一读
    const kick = setTimeout(() => void read(), linkedRef.current ? COALESCE_MS : 0);
    return () => {
      alive = false;
      clearTimeout(kick);
      if (timer) clearTimeout(timer);
    };
  }, [reloads, nudge, health, models, listening, upstreamState, core, setStatus, setOv]);

  const c = describeCore(core);
  /** 连上过、又断了。**只在这时候挂那条带子**。连着远程时断线另有一条（见下面） */
  const lost = linked && tries > 0 && !remote ? trouble(core, tries) : null;
  /**
   * 连着远程、连上过、现在断了（设计稿 ⑥ 右）。**不换成「未连接」整页**：已有的内容
   * 留着、置为只读，顶上一条横幅。连上后按现有的对账机制补齐（`core-state` 回到
   * `running:` 时各处自己对账）
   */
  const remoteLost = remote && linked && link !== null && link.kind !== "connected";
  const remoteAttempt = link?.kind === "down" ? link.attempt : link?.kind === "connecting" ? link.attempt : 0;

  useEffect(() => {
    if (!linked) return;
    const h = setTimeout(() => setWaited(true), 2_500);
    return () => clearTimeout(h);
  }, [linked]);
  /*
    **首屏的数据取好了再交接。**启动画面下面主界面已经挂上了，它取数的这一会儿
    被盖着；交接时概览（和落地页那一页的数据）已经在了，数字不会在眼前从零
    跳成实际值。取不齐就不等了（`waited`），那一页有自己的骨架。
  */
  const handover =
    (linked && ((ov !== null && (tab !== "dashboard" || landed)) || waited)) ||
    gaveUp ||
    lasting;

  // 热启动：交接的那一刻就是窗口出现的那一刻。Rust 那边也有保底，这里只管早到
  useEffect(() => {
    if (warm && handover) void invoke("reveal_main_window").catch(() => {});
  }, [handover]);

  // **不再有独立的初始化页面。**原来这里有两道全屏门禁：零上游时是
  // 一个填表向导，填完是一个「等第一个请求」的页面。两道都拆了。
  //
  // 理由是那堵墙立错了地方 —— 还没配上游的时候，网关已经在跑了，端口、
  // 网关密钥、客户端检测、配置文件在哪儿，这些全都该看得见。把人挡在
  // 外面等于说「你还没资格看」，而他要找的恰恰是「该去哪儿配」。
  //
  // 现在：主界面照常进，零上游时首页挂一条引导指向配置页，表单长在
  // 配置页「上游」那一节里（空状态永远在回答「接下来做什么」）。
  // 「它真的在工作了」那一下也没丢：第一个请求进来时那一行会绿一下，
  // 而请求页的空状态一直在说客户端该怎么指过来。

  return (
    <TooltipRoot>
      <SidebarProvider
        open={railOpen}
        onOpenChange={setRailOpen}
        className="h-screen min-h-0 text-foreground"
        style={
          {
            background: "var(--chrome-ground)",
            // 覆盖掉 shadcn 的 16rem / 3rem，理由见下面那段注释
            "--sidebar-width": "196px",
            "--sidebar-width-icon": "80px",
            "--sidebar": "var(--chrome-rail)",
            "--sidebar-border": "var(--chrome-hair)",
          } as React.CSSProperties
        }
      >
        {/*
        源列表。**在 macOS 上**整条都是拖拽区 —— 那里窗口用的是 Overlay
        标题栏(红绿灯浮在内容上),没有一条真的标题栏可以抓,不给拖拽区
        窗口就挪不动。所以那个属性要一路传到 `Sidebar` 上,见 `drag`。

        **可以收起。**收起之后只剩图标,内容区多出 116px —— 对一个开着
        不关、一直在看图表的应用,这是唯一真正改善主界面的方向。名字进
        悬浮说明,所以收起来不是把信息丢掉,是把它推迟到需要的时候。

        **两个宽度都是覆盖掉 shadcn 默认值的,而且各有各的理由。**
        展开 196px(默认 256px 是给网页后台的,这里只放一列短词);收起
        80px(默认 48px) —— 这个数不是审美选的,是红绿灯定的:标题栏是
        Overlay,三颗灯浮在内容上,最右那颗绿灯的右边缘落在约 71pt 处,
        侧栏窄于这个数,右边框就会从绿灯身上穿过去。80 给了它 9pt 余量。
        **改窄之前先量一遍那三颗灯。**

        开合状态仍然自己管(localStorage),没用 `SidebarProvider` 默认的
        cookie —— 这是个本地应用,没有服务端要读它。
      */}
        <Sidebar
          collapsible="icon"
          /* 线用源列表自己那支（带一点冷调），不是内容区的通用 --border */
          className="border-r border-sidebar-border"
          style={{
            background: "var(--chrome-rail)",
            color: "var(--chrome-text)",
          }}
          {...drag}
        >
          {/*
          红绿灯占掉左上角,内容从它下面开始。

          **Windows 上没有这一块。**那里是系统标题栏,三颗灯不在内容里,
          这 38px 就成了顶上一条白占的空条 —— 留着不是「差不多」,是多出
          一条谁也解释不了的留白。
        */}
          {isMac && <SidebarHeader className="h-[38px] p-0" {...drag} />}

          <SidebarContent>
            {SOURCES.map((g, gi) => (
              <SidebarGroup key={g.group} className="py-0">
                {/*
                **没有分组标题,只有细分隔线。**四个标题原本吃掉列表约三分
                之一的高度,而它们说的事情分隔线也说得出:这两项和上面那两
                项不一样。代价是分组的**名字**没了 —— 认下这笔,换来整列读
                起来是一个对象,而不是四个小区块。
              */}
                {gi > 0 && <SidebarSeparator className="my-[11px]" />}
                <SidebarGroupContent>
                  <SidebarMenu>
                    {g.items.map((it) => {
                      const on = tab === it.id;
                      // 客户端配置里出现了新东西 —— 挂个角标,直到他去看过
                      const badge = it.id === "mcp" ? alerts.length : 0;
                      const Icon = it.icon;
                      const label = t.surfaces[it.id];
                      // 没连上时需要 core 数据的几页置灰；设置始终可用，连接管理在那里
                      const off = !linked && it.id !== "settings";
                      return (
                        <SidebarMenuItem key={it.id}>
                          <SidebarMenuButton
                            disabled={off}
                            className={off ? "opacity-45" : undefined}
                            isActive={on}
                            onClick={() => setTab(it.id)}
                            aria-current={on ? "page" : undefined}
                            tooltip={
                              badge > 0 ? t.newFindings(label, badge) : label
                            }
                          >
                            <Icon size={16} />
                            <span className="truncate">{label}</span>
                          </SidebarMenuButton>
                          {badge > 0 && (
                            <SidebarMenuBadge className="bg-red-500 text-white group-data-[collapsible=icon]:hidden">
                              {badge}
                            </SidebarMenuBadge>
                          )}
                          {/*
                          收起时数字塞不下,只留一个点 —— 它要回答的是
                          「那边有没有新东西」,几条可以点进去再看。
                        */}
                          {badge > 0 && (
                            <span
                              className="pointer-events-none absolute right-[7px] top-[7px] hidden h-[7px] w-[7px] rounded-full bg-red-500 group-data-[collapsible=icon]:block"
                              style={{
                                boxShadow: "0 0 0 2px var(--chrome-rail)",
                              }}
                            />
                          )}
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </SidebarContent>

          {/*
          状态钉在源列表底部,不在标题栏。
          **它要一直看得见** —— core 挂了是这个应用唯一「什么都不工作」
          的状态,而标题栏那一行会被内容顶掉。
        */}
          <SidebarFooter
            className="border-t"
            style={{ borderColor: "var(--chrome-hair)" }}
          >
            {/*
              连接名在状态点和网关地址上面，点开是连接列表（见 `Switcher`）。连本机时
              状态和地址照旧来自守护；连远程时来自连接那一层
            */}
            <Switcher
              local={{
                text: c.text,
                short: c.short,
                tone: c.tone,
                addr: status?.gateway_addr ?? null,
                tip: (
                  <>
                    {status?.gateway_addr
                      ? `${c.text} · ${status.gateway_addr}`
                      : c.text}
                    {/* 监听设置没换成：上面的地址是还在服务的旧地址，原因写在这里 */}
                    {status?.listen_error && (
                      <div>{t.listenStale(coreText(status.listen_error))}</div>
                    )}
                  </>
                ),
              }}
            />
          </SidebarFooter>
        </Sidebar>

        {/* 右侧:横幅 + 内容。只有这一列滚动,源列表不跟着滚 */}
        {/*
        分栏时滚动交给两栏各自管，外层不能再滚 —— 否则是两层滚动条，
        而外面那层会把整个分栏一起推走。
      */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/*
          工具栏。整条是拖拽区,按钮不是 —— 拖拽区只作用在带那个属性的
          元素上,不带的子元素照常可点。

          **它在滚动容器外面。**之前它是滚动区的第一个子元素,于是往下
          翻表格时整条跟着卷走了 —— 而这上面放的是「我在哪一页」和收起
          源列表的开关,两样都是任何时候都该在的。现在滚的是它下面那层。

          **收起源列表的按钮放在这儿,不放在源列表里。**收起之后源列表
          只有 80px 宽,按钮塞进去要么挤掉一个图标位,要么小到点不准;
          而放在内容这一侧,它在两种状态下都在同一个位置。系统应用
          （访达、邮件)也是这么放的。
        */}
          <div
            className="flex h-[38px] shrink-0 items-center gap-2 border-b border-sidebar-border px-3"
            {...drag}
          >
            {/* `TooltipContent` 的样式里写着 `has-data-[slot=kbd]` —— 这个位置本来就是给键帽留的 */}
            <Tip
              side="bottom"
              text={
                <>
                  {railOpen ? t.collapseRail : t.expandRail}
                  {isMac ? (
                    <KbdGroup>
                      <Kbd>⌘</Kbd>
                      <Kbd>⌥</Kbd>
                      <Kbd>S</Kbd>
                    </KbdGroup>
                  ) : (
                    <KbdGroup>
                      <Kbd>Ctrl</Kbd>
                      <Kbd>B</Kbd>
                    </KbdGroup>
                  )}
                </>
              }
            >
              {/*
              **不要给它 `aria-expanded`。**`ghost` 变体里有一条
              `aria-expanded:bg-muted` —— 那是给「下拉菜单正开着」用的。
              挂上去之后,源列表展开时这个按钮常驻一块底色,而悬停是
              `hover:bg-muted/50`,只有一半浓度:**看起来是反的**,碰上去
              反而比不碰暗。`SidebarTrigger` 不设这个属性。
            */}
              <SidebarTrigger
                aria-label={railOpen ? t.collapseRail : t.expandRail}
                style={{ color: "var(--chrome-dim)" }}
              />
            </Tip>

            {/*
            当前在哪一页。**收起源列表之后这是唯一的答案** —— 那时候
            列表里只剩图标,「我在哪」只能靠认图形。展开时它和列表里的
            高亮互相印证。

            用 `tw-head` 不是 `tw-title`:它是位置指示,不是页面大标题,
            抢戏就变成两个标题打架。
          */}
            <span
              className="truncate tw-head"
              style={{ color: "var(--chrome-text)" }}
              {...drag}
            >
              {t.surfaces[tab]}
            </span>
            {/*
            配置页共用的两个入口。**文件只有一份**，各页的表单是它的几种视图 ——
            所以入口放在工具栏，而不是每页各放一套。
          */}
            <div className="ml-auto flex items-center gap-1">
              {linked && CONFIG_PAGES.has(tab) && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfigFile({ focus: null })}
                  >
                    {t.configFile}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setHistoryOpen(true)}
                  >
                    {t.versionHistory}
                  </Button>
                </>
              )}
              {/* 提醒在每一页都在：它说的事不属于任何一页 */}
              <Notices onNavigate={(v) => setTab(v as Surface)} asked={noticesAsked} />
            </div>
          </div>

          {/*
          只有这一层滚。工具栏在它上面，钉住不动。
          分栏时滚动交给两栏各自管，这一层就不能再滚 —— 否则是两层
          滚动条，而外面那层会把整个分栏一起推走。
        */}
          {/*
          工具栏之下这一层。**滚动不在这儿** —— 请求页在自己那一层里
          横竖都滚，其余页面各自在自己的容器里滚。
          在这儿再加一层滚动就是两层滚动条。
        */}
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/*
        配置没通过校验。**这条要一直挂着，直到下一次成功换入** ——
        一闪而过的提示等于没提示：用户在编辑器里保存完，眼睛还在编辑器上。

        第一句先说「还在按旧配置转发」，因为那是他最想知道的：会不会断。
      */}
            {rejected && (
              <Alert variant="warning" className="border-b px-5 py-2.5">
                <AlertTitle>{t.rejectedTitle}</AlertTitle>
                <AlertDescription>
                  <p className="mt-1 text-amber-800 dark:text-amber-300">
                    {t.rejectedAt(stageLabel(rejected.stage), rejected.line)}
                    {coreText(rejected.message)}
                  </p>
                  {rejected.excerpt && (
                    <pre className="mt-1.5 overflow-x-auto rounded bg-amber-100 px-2 py-1 font-mono tw-label text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                      {rejected.line}│ {rejected.excerpt}
                    </pre>
                  )}
                </AlertDescription>
              </Alert>
            )}

            {/*
        token 端点换发了新的 refresh token。

        **两种完全不同的话，长得也要不一样。**写回成功只是告知 ——
        用户的配置文件被我们改了，他的编辑器会弹「文件已更改」，那时
        他该知道是谁干的；写回失败是个必须处理的问题：重启之前不解决，
        那家上游就废了。
      */}
            {rotated.map((r) =>
              r.persisted ? (
                <div
                  key={r.provider}
                  className="flex items-start justify-between gap-4 border-b border-border bg-neutral-50 px-5 py-2 tw-body dark:bg-neutral-900"
                >
                  <p className="text-muted-foreground">
                    {t.rotatedSaved(
                      <span className="font-medium text-foreground">
                        {r.provider}
                      </span>,
                    )}
                    <Tip text={t.reloadTip}>
                      <span className="ml-1 underline decoration-dotted underline-offset-2">
                        {t.reload}
                      </span>
                    </Tip>
                  </p>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    onClick={clearRotated}
                  >
                    {common.close}
                  </Button>
                </div>
              ) : (
                <div
                  key={r.provider}
                  className="border-b border-amber-300 bg-amber-50 px-5 py-2.5 tw-body dark:border-amber-800 dark:bg-amber-950"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="font-medium text-amber-900 dark:text-amber-200">
                        {t.rotatedUnsaved(r.provider)}
                      </p>
                      <p className="mt-1 text-amber-800 dark:text-amber-300">
                        {coreText(r.detail)}
                      </p>
                      <p className="mt-1 text-amber-800 dark:text-amber-300">
                        {t.oldRevoked((s) => (
                          <span className="font-medium">{s}</span>
                        ))}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      onClick={clearRotated}
                    >
                      {common.close}
                    </Button>
                  </div>
                </div>
              ),
            )}

            {/*
        断线重连。**不是 toast，也不清空页面。**

        用户本来在看数据，清空之后连「刚才是什么样」都没了；而 toast
        会飘走，飘走之后界面上一点痕迹都不留 —— 于是那些凝固的数字看
        起来还是新鲜的。一条常驻的带子两件事都解决：数字留着，旁边写着
        它们为什么不动了。
      */}
            {/* 连着远程时断线：一条横幅，内容留着、只读（设计稿 ⑥ 右） */}
            {remoteLost && profile && (
              <div
                role="status"
                className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-5 py-2 tw-body dark:border-amber-800 dark:bg-amber-950"
              >
                <span className="text-amber-900 dark:text-amber-200">
                  {ct.lostBanner(profile.name, remoteAttempt)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto shrink-0"
                  disabled={link?.kind === "connecting"}
                  onClick={() => void invoke("retry_connection").catch(() => {})}
                >
                  {ct.retryNow}
                </Button>
              </div>
            )}

            {linked && tries > 0 && lost && (
              <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-5 py-2 tw-body dark:border-amber-800 dark:bg-amber-950">
                <span className="font-medium text-amber-900 dark:text-amber-200">
                  {t.staleData(lost.what)}
                </span>
                <span className="text-amber-800 dark:text-amber-300">
                  {lost.next}
                </span>
                {lost.retry && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-auto shrink-0"
                    onClick={() =>
                      void invoke("restart_core").catch(() =>
                        setNudge((n) => n + 1),
                      )
                    }
                  >
                    {t.restart}
                  </Button>
                )}
              </div>
            )}

            {/*
        **每一面自己滚。**工具栏钉在上面不动,这一层只负责给出高度;
        真正滚的是下面这个容器（请求页是它自己的那一层，见下面）。
      */}
            {/*
              断线时整块只读：`fieldset disabled` 让里面的按钮、输入框、下拉一起失效，
              读、滚动、悬停说明照旧 —— 用户要看的是断开前的样子，改不了的东西就不该
              让人点下去再报错
            */}
            <fieldset
              disabled={remoteLost}
              className={
                "m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0 " +
                (remoteLost ? "opacity-60" : "")
              }
            >
            <div
              className={
                "flex min-h-0 flex-1 flex-col " +
                // 请求页自己那一层横竖都滚（表头靠它吸顶），这一层不能再滚
                (tab === "requests"
                  ? "overflow-hidden"
                  : "overflow-y-auto")
              }
            >
              {/*
        **还没连上时这里什么都不画**：整窗盖着启动画面。连上之后各页在它下面
        挂上、开始取数，交接时数据已经在了（见 `handover`）。

        和「不再有独立初始化页面」那条决定不冲突：那两道门挡的是配置
        状态（还没配上游），而门后面的东西是存在、可用的；这一道挡的是
        连接状态。**控制面一答应就交接** —— 哪怕网关还没起来（安全模式下
        配置、回滚、还原接管都能用，那时绝不能再挡）。
      */}
              {!linked ? (
                // 启动画面还盖着时不画；交出来之后（等够了 8 秒）是「未连接」那一页。
                // 设置页照常可用：连接管理在那里
                launching ? null : tab === "settings" ? (
                  <Config ov={null} status={null} onChanged={() => setNudge((n) => n + 1)} />
                ) : (
                  <Unlinked core={core} />
                )
              ) : tab === "dashboard" ? (
                <Dashboard
                  tick={dashTick}
                  ov={ov}
                  onLanded={() => setLanded(true)}
                  onShowSecurity={(range) => {
                    // 实时档的计数按 24 小时算（见 `windowStart`），日志也按 24 小时看
                    setSecurityFocus({
                      range: range.live ? presetRange("1d") : range,
                      at: Date.now(),
                    });
                    setTab("security");
                  }}
                  onShowUnpriced={() => {
                    // 归组态下「哪些模型没定价」看不出来 —— 那是一行一行
                    // 的问题，不是一次任务的问题
                    setGrouped(false);
                    setFilter({ ...EMPTY_FILTER, unpricedOnly: true });
                    setTab("requests");
                  }}
                />
              ) : tab === "clients" ? (
                <ClientsPage
                  onOpenKey={(name) => {
                    setFocusKey(name);
                    setTab("keys");
                  }}
                  onShowTraffic={(key) => {
                    // 流量表的「客户端」一列就是密钥名
                    setFilter({ ...EMPTY_FILTER, client: key });
                    setTab("requests");
                  }}
                />
              ) : tab === "mcp" ? (
                <McpPage alerts={alerts} onSeen={clearAlerts} />
              ) : tab === "security" ? (
                ov ? (
                  <SecurityPage
                    configVersion={ov.config_version}
                    tick={dashTick}
                    focus={securityFocus}
                    onChanged={() => setNudge((n) => n + 1)}
                  />
                ) : (
                  <p className="p-5 tw-body text-muted-foreground">
                    {t.loadingConfig}
                  </p>
                )
              ) : tab === "keys" ? (
                ov ? (
                  <KeysPage
                    ov={ov}
                    focus={focusKey}
                    onFocused={() => setFocusKey(null)}
                    onChanged={() => setNudge((n) => n + 1)}
                    onOpenConfigFile={(focus) => setConfigFile({ focus })}
                    onNavigate={(to) => setTab(to as Surface)}
                  />
                ) : (
                  <p className="p-5 tw-body text-muted-foreground">
                    {t.loadingConfig}
                  </p>
                )
              ) : tab === "routing" ? (
                ov ? (
                  <RoutingPage
                    ov={ov}
                    onChanged={() => setNudge((n) => n + 1)}
                    onOpenConfigFile={(focus) => setConfigFile({ focus })}
                    onNavigate={(to) => setTab(to as Surface)}
                  />
                ) : (
                  <p className="p-5 tw-body text-muted-foreground">
                    {t.loadingConfig}
                  </p>
                )
              ) : tab === "upstreams" ? (
                ov ? (
                  <UpstreamsPage
                    ov={ov}
                    onChanged={() => setNudge((n) => n + 1)}
                    onOpenConfigFile={(focus) => setConfigFile({ focus })}
                    onNavigate={(to) => setTab(to as Surface)}
                  />
                ) : (
                  <p className="p-5 tw-body text-muted-foreground">
                    {t.loadingConfig}
                  </p>
                )
              ) : tab === "settings" ? (
                <Config
                  ov={ov}
                  status={status}
                  onChanged={() => setNudge((n) => n + 1)}
                />
              ) : (
                <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
                  {/*
                    详情走**浮层**，不拆栏。

                    拆栏的代价是这张表被挤窄：八列里最先塌的是模型和
                    上游那两列，而排查时要对着看的恰恰是它们。而且一次
                    只看一条请求，剩下那半屏的表在这时候是没人读的。
                  */}
                  {/*
                    **滚的是外层，边距在里层**，和别的页一样。表头是
                    `sticky top-0`，吸顶的位置从滚动容器的内边距以内算起
                    —— 把上边距加在滚动容器上，往下翻时表头停在离顶
                    20px 处，行从它上面那条缝里漏出来。

                    **横着滚的也是这一层。**最小窗口、侧栏展开时，表有
                    808px，页面只有 584px。表外面那层自己横着滚的话，
                    表头就钉在它身上、不再吸顶（见 `Table` 的 `scroll`）。

                    所以分成三块。上面的过滤条、下面的脚注钉在左边
                    （`sticky left-0`），表横着滚时它们不跟着走。它们
                    必须直接挂在这一层下面：宽度才是看得见的那么宽，
                    钉得住的范围也才是整个能滚的宽度。中间那块跟着表
                    变宽（`w-fit`），滚到最右，表的右边距才露得出来。
                  */}
                  <div className="sticky left-0 px-5 pt-5">
                    {/*
          过滤条。**一直在，不是「有数据才出现」** —— 一个时有时无的
          工具条，用户每次都要重新找它在哪儿。没有请求时它是禁用的。
        */}
                    {allRows.length > 0 && (
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        {/* 和旁边的开关、下拉一样高：它们都是 sm 档 */}
                        <Input
                          variant="sm"
                          className="w-64"
                          ref={searchRef}
                          value={filter.q}
                          onChange={(e) =>
                            setFilter((f) => ({ ...f, q: e.target.value }))
                          }
                          placeholder={t.search}
                          spellCheck={false}
                        />
                        {/* 这是个开关,不是按钮 —— 按下去它要一直保持按下的样子 */}
                        <Toggle
                          variant="outline"
                          size="sm"
                          pressed={filter.failedOnly}
                          onPressedChange={(v) =>
                            setFilter((f) => ({ ...f, failedOnly: v }))
                          }
                        >
                          {t.failedOnly}
                        </Toggle>
                        {/*
                          **归组是个视角，不是一个筛子** —— 它不改变
                          哪些行在表里，只改变它们怎么摆。所以和过滤器
                          并排，但中间隔开一点。
                        */}
                        <Toggle
                          variant="outline"
                          size="sm"
                          pressed={grouped}
                          onPressedChange={setGrouped}
                        >
                          {t.groupBySession}
                        </Toggle>
                        {/*
                          从概览点「N 条无法计价」过来时它是按着的。
                          **一个筛着却看不见的筛子最糟** —— 用户会以为
                          自己的请求丢了。
                        */}
                        <Toggle
                          variant="outline"
                          size="sm"
                          pressed={filter.unpricedOnly}
                          onPressedChange={(v) =>
                            setFilter((f) => ({ ...f, unpricedOnly: v }))
                          }
                        >
                          {t.unpricedOnly}
                        </Toggle>
                        {/* 下拉里只列**出现过的** —— 配了三家而只有一家在收流量时，
                另外两家出现在这里只会让人以为自己筛错了 */}
                        {facet.clients.length > 1 && (
                          <NativeSelect
                            size="sm"
                            value={filter.client}
                            onChange={(e) =>
                              setFilter((f) => ({
                                ...f,
                                client: e.target.value,
                              }))
                            }
                          >
                            {/* 原生 option 收空串，所以「全部」不用再借哨兵 */}
                            <NativeSelectOption value="">
                              {t.allClients}
                            </NativeSelectOption>
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
                            onChange={(e) =>
                              setFilter((f) => ({
                                ...f,
                                provider: e.target.value,
                              }))
                            }
                          >
                            {/* 原生 option 收空串，所以「全部」不用再借哨兵 */}
                            <NativeSelectOption value="">
                              {t.allUpstreams}
                            </NativeSelectOption>
                            {facet.providers.map((c) => (
                              <NativeSelectOption key={c} value={c}>
                                {c}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )}
                        {/*
              **筛掉了多少要说出来。**只显示「12 条」而不说「共 340 条」
              的话，用户会以为总共就这么多 —— 这是过滤器最常见的骗人方式。
            */}
                        <span className="ml-auto tw-label text-muted-foreground">
                          {hasAnyFilter(filter)
                            ? t.shownOf(rows.length, allRows.length)
                            : t.total(allRows.length)}
                        </span>
                        {hasAnyFilter(filter) && (
                          <Button
                            variant="link"
                            size="xs"
                            onClick={() => setFilter(EMPTY_FILTER)}
                          >
                            {t.clear}
                          </Button>
                        )}
                      </div>
                    )}

                    {/*
          还没有上游 —— 引导，不是拦路。
          说清三件事：网关已在运行（所以这不是故障）、缺的是什么、
          以及在哪里配置。最后一件给一个能点的入口。
        */}
                    {status?.providers === 0 && (
                      <div className="mb-4 rounded-lg border border-input bg-neutral-100 p-4 dark:bg-neutral-900">
                        <p className="tw-head font-medium">{t.noUpstreams}</p>
                        <p className="mt-1 tw-body text-muted-foreground">
                          {t.listening(
                            <code className="rounded bg-neutral-200 px-1 py-0.5 font-mono dark:bg-neutral-800">
                              http://{status.gateway_addr}
                            </code>,
                          )}
                        </p>
                        <Button
                          size="sm"
                          className="mt-3"
                          onClick={() => setTab("upstreams")}
                        >
                          {t.goToUpstreams}
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="w-fit min-w-full px-5">
                    {seeded && rows.length === 0 ? (
                      allRows.length > 0 ? (
                        /*
              有记录，只是全被筛掉了。**这时候说「暂无请求记录」是错的**
              —— 用户会以为网关断了，而实际上清掉条件就看得见。
            */
                        <Empty>
                          <EmptyHeader>
                            <EmptyTitle>{t.noMatchTitle}</EmptyTitle>
                            <EmptyDescription>
                              {t.noMatch(allRows.length)}
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setFilter(EMPTY_FILTER)}
                            >
                              {t.clearFilters}
                            </Button>
                          </EmptyContent>
                        </Empty>
                      ) : (
                        // 空状态永远在回答「接下来该做什么」。
                        <Empty>
                          <EmptyHeader>
                            <EmptyTitle>{t.emptyTitle}</EmptyTitle>
                            <EmptyDescription>
                              {t.pointClients(
                                <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
                                  http://
                                  {status?.gateway_addr ?? "127.0.0.1:8788"}
                                </code>,
                              )}
                              <br />
                              {t.appearHere}
                            </EmptyDescription>
                            {/* 一次都没有的时候不说这句 —— 「已经本地应答了 0 次」是在
                    拿一个零冒充证据 */}
                            {locallyAnswered > 0 && (
                              <EmptyDescription>
                                {t.probesAnswered(locallyAnswered)}
                              </EmptyDescription>
                            )}
                          </EmptyHeader>
                        </Empty>
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
                        onToggleGroup={(id) =>
                          setOpenGroups((prev) => toggled(prev, id))
                        }
                        onOpenSession={(id) => {
                          // 一次只开一样：请求详情和会话详情共用那一栏
                          setOpen(null);
                          setOpenSession(id);
                        }}
                      />
                    )}
                  </div>
                  <div className="sticky left-0 px-5 pb-5">
                    {locallyAnswered > 0 && rows.length > 0 && (
                      <p className="mt-3 tw-body text-muted-foreground">
                        {t.probesElsewhere(locallyAnswered)}
                      </p>
                    )}
                  </div>
                </div>
              )}
              {/* 右侧抽屉。Dashboard 那边早就接了，请求页反而没有 —— 而
          这里才是主战场 */}
            </div>
            </fieldset>
          </div>
        </div>

        {/* 浮层挂在最外层，不跟着右列滚动 */}
        {configFile && (
          <ConfigFileDialog
            reloads={reloads}
            focus={configFile.focus}
            rejectedLine={rejected?.line ?? null}
            onClose={() => setConfigFile(null)}
            onJump={(section) => {
              setConfigFile(null);
              setTab(surfaceOf(section));
            }}
          />
        )}
        {historyOpen && (
          <VersionHistoryDialog
            reloads={reloads}
            onClose={() => setHistoryOpen(false)}
          />
        )}
        {/* 窄窗口回退到浮层 —— 拆两栏会让列表窄到没法看 */}
        {open != null && (
          <RequestDrawer id={open} onClose={() => setOpen(null)} />
        )}
        {/*
          会话也要有这条窄窗口的退路。**少了它，窄窗口下点组头是没反应的**
          —— 而「没反应」和「坏了」在用户眼里没有区别。
        */}
        {sessionDetail && (
          /*
            会话和请求走**同一种浮层**（右侧抽屉），不是一个居中对话框
            加一个抽屉 —— 同一页上两套范式，学会一个不会用另一个。
          */
          <Sheet
            open
            onOpenChange={(o) => !o && setOpenSession(null)}
          >
            <SheetContent
              side="right"
              /*
                **比它上面那一层宽。**叠起来的时候左边露出一截，那一截
                就是「下面还有一层」这件事唯一的说明；等宽的话看起来
                就是原地换了内容。
              */
              className="flex flex-col overflow-y-auto p-0 data-[side=right]:w-[min(46rem,94vw)] data-[side=right]:sm:max-w-none"
            >
              <SheetHeader className="sr-only">
                <SheetTitle>{t.surfaces.sessions}</SheetTitle>
              </SheetHeader>
              <SessionPanel
                d={sessionDetail}
                /*
                  **在会话这一层之上再叠一层，不是把它换掉。**
                  一轮是那次任务里的一条请求 —— 看完这一条要退回任务
                  继续看下一轮，而换掉的话每看一轮都得从表里重新点开
                  那次会话。
                */
                onOpenTurn={setOpen}
              />
            </SheetContent>
          </Sheet>
        )}
        {/*
        **所有出错都走这里。**在此之前每个页面各自在表单旁边挂一条错误，
        于是同一句「还没读到配置版本」有六份实现，而滚出视野的那几份用户
        根本看不到。吐司统一在右下角，谁触发的都一样。
      */}
        <Toaster position="bottom-right" closeButton />
      </SidebarProvider>
      {launching && (
        <LaunchScreen
          remote={remote && profile ? profile.name : null}
          state={core}
          linked={linked}
          tries={tries}
          linkError={linkError}
          ready={handover}
          onGone={() => setLaunching(false)}
        />
      )}
    </TooltipRoot>
  );
}


