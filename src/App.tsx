import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FileCodeIcon, HistoryIcon, RotateCwIcon, SearchIcon } from "lucide-react";
import { call } from "@/control";
import { useRequests } from "./useRequests";
import { useStableState } from "./useStable";
import { EMPTY_FILTER } from "./requestTable";
import Config from "./Config";
import { ConfigFileDialog, VersionHistoryDialog } from "./ConfigDialogs";
import UpstreamsPage from "./upstreams/UpstreamsPage";
import ClientsPage from "./clients/ClientsPage";
import KeysPage from "./keys/KeysPage";
import { useBusyKeys } from "./keys/live";
import RoutingPage from "./routing/RoutingPage";
import SecurityPage, { type LogFocus } from "./security/SecurityPage";
import McpPage from "./mcp/McpPage";
import TrafficPage from "./traffic/TrafficPage";
import { useTrafficView } from "./traffic/view";
import { useSessions } from "./traffic/useSessions";
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
  IconSidebar,
} from "./ui/icons";
import { isMac, isMod, modKey } from "@/platform";
import Dashboard from "./Dashboard";
import type { CoreStatus, Overview } from "./types";
import { stageLabel } from "./labels";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { appText } from "./App.i18n";
import { Button } from "@/ui/button";
import type { LucideIcon } from "lucide-react";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { Toaster } from "@/ui/sonner";
import { coreText, errorText } from "@/i18n/core.i18n";
import { trouble } from "./launch/trouble";
import { LaunchScreen } from "./launch/LaunchScreen";
import { warm } from "./launch/warm";
import { ConnectionProvider, useConnections } from "./connection/ConnectionProvider";
import { Switcher } from "./connection/Switcher";
import { Unlinked } from "./connection/Unlinked";
import { currentProfile } from "./connection/api";
import { connText } from "./connection/connection.i18n";
import { NavContext, SURFACES, type Nav, type NavDelivery, type NavParams, type Surface } from "./nav";
import { Banner } from "@/ui/banner";
import { Reveal } from "@/ui/motion";
import { Page, PageHeader, PageTitleContext } from "@/ui/page";
import { ErrorState, TableSkeleton } from "@/ui/states";
import { resetResources } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { CommandPalette, type Command } from "./CommandPalette";
import { paletteText } from "./CommandPalette.i18n";
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

/**
 * 主窗口的几个面。
 *
 * **源列表，不是标签栏。**原生客户端用左侧源列表：它能分组、能挂角标，加一项
 * 不会把别的挤窄。分组的判据是打开频率：上面那组每天看，越往下越是配一次就不动的。
 * 顺序和 `SURFACES` 一致，⌘1…⌘9 按它数。
 */
const SOURCES: { group: string; items: { id: Surface; icon: LucideIcon }[] }[] = [
  {
    // 概览回答「现在什么情况」，是打开这个应用的默认意图；流量回答「刚才那一条
    // 发生了什么」。会话不是第三项，是流量的第二种粒度（归组）
    group: "monitor",
    items: [
      { id: "dashboard", icon: IconDashboard },
      { id: "requests", icon: IconFlow },
    ],
  },
  {
    // 谁在用这个网关、拿什么连进来：客户端和密钥是同一件事的两面，挨着放
    group: "access",
    items: [
      { id: "clients", icon: IconClient },
      { id: "keys", icon: IconKey },
    ],
  },
  {
    // 网关的配置。安全和 MCP 也在这一组：它们是要去动的开关和规则，不是看板
    group: "config",
    items: [
      { id: "upstreams", icon: IconServer },
      { id: "routing", icon: IconRoute },
      { id: "security", icon: IconGuard },
      { id: "mcp", icon: IconMcp },
    ],
  },
  {
    // 应用自己的设置，不是网关的配置
    group: "app",
    items: [{ id: "settings", icon: IconSettings }],
  },
];

const ICONS = Object.fromEntries(SOURCES.flatMap((g) => g.items.map((it) => [it.id, it.icon]))) as Record<
  Surface,
  LucideIcon
>;

/**
 * core 的状态说成人话。
 *
 * `short` 是给收起的源列表用的 —— 那里只有 80px。**不是截断，是另写一句**：截断
 * 出来的「安全模式 · 网关未…」比四个字更难读。
 */
function describeCore(raw: string): {
  text: string;
  short: string;
  tone: "ok" | "warn" | "bad";
} {
  const t = textOf(appText);
  if (raw.startsWith("running:")) return { text: t.running, short: t.running, tone: "ok" };
  if (raw === "starting") return { text: t.starting, short: t.starting, tone: "warn" };
  if (raw.startsWith("restarting:")) {
    const [, attempt] = raw.split(":");
    return { text: t.restarting(`${attempt}`), short: t.restartingShort, tone: "warn" };
  }
  // 安全模式必须显眼：这时候网关不转发了，所有 AI 客户端都停着
  if (raw === "safe_mode") return { text: t.safeMode, short: t.safeModeShort, tone: "bad" };
  // 程序运行不了。原因在启动画面上说（见 launch/trouble.ts）
  if (raw.startsWith("failed:")) return { text: t.cannotStart, short: t.cannotStart, tone: "bad" };
  return { text: t.stopped, short: t.stopped, tone: "bad" };
}

/**
 * 标成拖拽区，**只在 macOS 上**。那里窗口用的是 Overlay 标题栏（红绿灯浮在内容上），
 * 没有一条真的标题栏可以抓。Windows 和 Linux 用系统标题栏，再把内容标成拖拽区的话，
 * 点一下侧栏空白就会把窗口拖走。
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
    if (seen.current.id !== null) {
      seen.current.n += 1;
      // 各页的取数缓存（`useResource`）属于原来那个 core
      resetResources();
    }
    seen.current.id = view.current;
  }
  return <Shell key={seen.current.n} first={seen.current.n === 0} />;
}

function Shell({ first }: { first: boolean }) {
  const t = useText(appText);
  const ct = useText(connText);
  const pt = useText(paletteText);
  const common = useText(commonText);
  const conn = useConnections();
  const profile = conn.view ? currentProfile(conn.view) : undefined;
  /** 连着的是远程 core */
  const remote = profile !== undefined && !profile.local;
  const link = conn.view?.link ?? null;
  /**
   * 守护状态。**先当它在起**：第一次读到之前画「已停止」的话，启动画面会先
   * 闪一下「core 未运行」
   */
  const [core, setCore] = useState("starting");
  /**
   * 这次开窗连上过控制面吗。
   *
   * **取数的都等它。**连上之前去取，拿回来的只有一句「连不上」。它也决定断线时的
   * 样子：连上过就保留页面、顶上挂一条横幅 —— 清空比留着旧值加一句说明更糟。
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
  const sessions = useSessions(linked);
  /** 此刻有请求在跑的密钥：密钥页、客户端页上那一格的「请求中」 */
  const busyKeys = useBusyKeys(allRows);
  const traffic = useTrafficView();
  const { setFilter, setGrouped } = traffic;

  const [status, setStatus] = useStableState<CoreStatus | null>(null);
  /**
   * 启动画面还在。**只在冷启动、这次开窗第一次交接之前**，见 `LaunchScreen`。
   * 热启动没有这一面，窗口藏到交接那一刻才出现（见 `warm`）
   */
  const [launching, setLaunching] = useState(!warm && first);
  /** 启动画面等够了：不再等，交出主界面 */
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setGaveUp(true), LAUNCH_CAP_MS);
    return () => clearTimeout(h);
  }, []);
  const lasting =
    link?.kind === "down" && (link.error.kind === "wrong_key" || link.error.kind === "version_mismatch");
  /** 概览那一页的第一份数据到了。启动画面等它，交接时数字已经是对的 */
  const [landed, setLanded] = useState(false);
  /** 连上之后首屏迟迟取不齐：不再等，交给那一页自己的骨架 */
  const [waited, setWaited] = useState(false);
  /** 菜单栏里点了「全部提醒…」几次。每点一次，工具栏上的提醒就打开一次 */
  const [noticesAsked, setNoticesAsked] = useState(0);
  const [tab, setTab] = useState<Surface>("dashboard");
  /** 送到某一页的深链参数，见 `nav.tsx` */
  const [delivery, setDelivery] = useState<NavDelivery | null>(null);
  const deliveries = useRef(0);
  /**
   * 从概览的安全计数点进日志时带的区间。**离开安全页就清掉** —— 过一阵再回来，
   * 不该又被拨回当时那一段时间。
   */
  const [securityFocus, setSecurityFocus] = useState<LogFocus | null>(null);
  useEffect(() => {
    if (tab !== "security") setSecurityFocus(null);
  }, [tab]);

  /**
   * 打开一页。**所有换页都走这里**（源列表、⌘ 快捷键、深链、通知）：流量页的筛选
   * 由外壳持有，这里直接改；其余参数交给目标页自己读（`useNavParams`）。
   */
  const open = useCallback(
    <S extends Surface>(s: S, params?: NavParams[S]) => {
      if (s === "requests" && params) {
        const p = params as NavParams["requests"];
        if (p.filter) setFilter({ ...EMPTY_FILTER, ...p.filter });
        if (p.grouped !== undefined) setGrouped(p.grouped);
      }
      if (s === "security") setSecurityFocus((params as NavParams["security"])?.focus ?? null);
      setTab(s);
      deliveries.current += 1;
      setDelivery({ surface: s, params, seq: deliveries.current });
    },
    [setFilter, setGrouped],
  );
  const nav = useMemo<Nav>(() => ({ surface: tab, open }), [tab, open]);
  const navValue = useMemo(() => ({ nav, delivery }), [nav, delivery]);

  /*
    页头的标题在不在视野里（见 `PageTitleContext`）。`null`：这一页没有页头，工具栏
    一直写页名；`true`：页头的大标题看得见，工具栏不重复；`false`：滚出去了，工具栏
    淡入小标题。
  */
  const [headerSeen, setHeaderSeen] = useState<boolean | null>(null);
  const reportHeader = useCallback((v: boolean | null) => setHeaderSeen(v), []);

  // ⌘R 和配置改动之后立刻重读一次。等下一次事件的话，刚点完「保存」还看着旧值
  const [nudge, setNudge] = useState(0);
  /**
   * 概览页什么时候重新拉数。**不是定时轮询**：跟着对账走，`settled` 每涨一次说明库里
   * 确实多了东西（见 useRequests）；`nudge` 是手动刷新。都没动的时候一次请求都不发。
   */
  const dashTick = settled + nudge;
  const [ov, setOv] = useStableState<Overview | null>(null);
  /** 概览最近一次读失败的原因。还没读到过概览时，配置那几页拿它画「读取失败」 */
  const [ovError, setOvError] = useState<unknown>(null);
  /** 配置文件对话框。`focus`：打开时选中的名字 */
  const [configFile, setConfigFile] = useState<{ focus: string | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [palette, setPalette] = useState(false);

  /**
   * 源列表收起还是展开。**记住用户的选择**；读取放在初始化里而不是 effect 里，否则
   * 第一帧会先按默认宽度画一次再跳。
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

  /** 切换连接的入口。**用 ref**：落页那个 effect 只挂一次，而连接列表是后来才读到的 */
  const switchTo = useRef(conn.switchTo);
  switchTo.current = conn.switchTo;
  const openRef = useRef(open);
  openRef.current = open;

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
      const [page, id] = view.split(":");
      // `switch:<id>`：菜单栏里选了一条远程连接。试连和确认在这里做，和侧栏同一条路
      if (page === "switch" && id) {
        switchTo.current(id);
        return;
      }
      if (!(SURFACES as readonly string[]).includes(page ?? "")) return;
      // `requests:42`：打开流量页并展开那一条（菜单栏里点了一个进行中的请求）
      if (page === "requests" && id) openRef.current("requests", { request: Number(id) });
      else openRef.current(page as Surface);
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
      void un.then((f) => f());
      window.removeEventListener("tw-open-view", local);
    };
  }, []);

  /**
   * 全局快捷键。**在「正在输入」判断之前处理** —— ⌘F 的全部意义就是从任何地方跳到
   * 搜索框，在输入框里按它该重选。行内的方向键导航在流量页里（`TrafficPage`）。
   *
   * · ⌘K 命令面板 · ⌘1…⌘9 按源列表的顺序换页 · ⌘F 流量搜索 · ⌘, 设置 · ⌘R 刷新
   * · ⌘⌥S 收起/展开源列表（访达、邮件、备忘录都是这个键；判 `code` 不判 `key`：
   *   ⌥ 会把 s 变成 ß）。**只在 macOS 上有**：Windows 上 Ctrl+Alt 常是 AltGr，
   *   Linux 上 Ctrl+Alt 加字母常被桌面拿去。那两边用 Ctrl+B（`SidebarProvider` 在听）。
   *
   * Windows 上是 Ctrl 加同一个键；`preventDefault` 在那边更要紧：WebView2 自己会把
   * Ctrl+F 当成页内查找、Ctrl+R 当成刷新页面。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMac && e.metaKey && e.altKey && !e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        setRailOpen((v) => !v);
        return;
      }
      if (!isMod(e) || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k" && !e.shiftKey) {
        e.preventDefault();
        setPalette((v) => !v);
        return;
      }
      if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
        const s = SURFACES[Number(e.key) - 1];
        if (!s) return;
        e.preventDefault();
        if (linked || s === "settings") open(s);
        return;
      }
      if (k === "f") {
        e.preventDefault();
        if (linked) open("requests", { search: true });
        return;
      }
      if (k === ",") {
        e.preventDefault();
        open("settings");
        return;
      }
      if (k === "r") {
        e.preventDefault();
        setNudge((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linked, open]);

  /**
   * 守护状态。**推过来的，不是问出来的。**先挂监听再读一次当前值，顺序不能反：
   * 事件只报变化，两者之间发生的那一次转换会丢。
   */
  useEffect(() => {
    let alive = true;
    const un = listen<string>("core-state", (e) => {
      if (!alive) return;
      setCore(e.payload);
      // 又起来了：之前读状态失败的次数和原因作废，这一回重新数
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
   * 状态与配置概览。**只在真的有理由重读的时候重读**：配置换了一份（`reloads`）、
   * 上游熔断或恢复（`health`）、模型清单开始或结束获取（`models`）、监听地址换了
   * （`listening`）、守护状态变了、上游的现状变了（`upstreamState`）、用户刚改完东西
   * （`nudge`）。**一串触发只读一次**（`COALESCE_MS`）。
   */
  useEffect(() => {
    // 头一次连上之前，core 不在跑就不去读：读回来的只有一句「连不上」
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
          **读不到不弹提示。**启动画面（还没连上时）和顶上那条横幅（连上过之后）已经
          在说 core 怎么了。次数和原因记下来交给它们；到上限就停手 —— 再试下去就是
          轮询了，守护状态一变这个 effect 会重跑。
        */
        if (!alive) return;
        n += 1;
        setTries(n);
        setLinkError(errorText(e));
        if (n <= MAX_TRIES) {
          timer = setTimeout(() => void read(), Math.min(1600, 200 * 2 ** Math.min(n - 1, 3)));
        }
        return;
      }
      try {
        const o = await call("Overview", null);
        if (alive) {
          setOv(o);
          setOvError(null);
        }
      } catch (e) {
        /*
          概览拿不到不影响状态那一半 —— 连上了就是连上了。**原因要留着**：还没读到过概览
          时，配置那几页只能画骨架，读失败了要换成「读取失败」和重试，而不是一直转着
        */
        if (alive) setOvError(e);
      }
    };
    // 头一次连上之前不攒：启动画面（热启动时是还藏着的窗口）正等着这一读
    const kick = setTimeout(() => void read(), linkedRef.current ? COALESCE_MS : 0);
    return () => {
      alive = false;
      clearTimeout(kick);
      if (timer) clearTimeout(timer);
    };
  }, [reloads, nudge, health, models, listening, upstreamState, core, setStatus, setOv]);

  const c = describeCore(core);
  /** 连上过、又断了。**只在这时候挂那条横幅**。连着远程时断线另有一条（见下面） */
  const lost = linked && tries > 0 && !remote ? trouble(core, tries) : null;
  /**
   * 连着远程、连上过、现在断了。**不换成「未连接」整页**：已有的内容留着、置为只读，
   * 顶上一条横幅。连上后按现有的对账机制补齐。
   */
  const remoteLost = remote && linked && link !== null && link.kind !== "connected";
  const remoteAttempt =
    link?.kind === "down" ? link.attempt : link?.kind === "connecting" ? link.attempt : 0;

  useEffect(() => {
    if (!linked) return;
    const h = setTimeout(() => setWaited(true), 2_500);
    return () => clearTimeout(h);
  }, [linked]);
  /*
    **首屏的数据取好了再交接。**启动画面下面主界面已经挂上了，交接时概览（和落地页
    那一页的数据）已经在了，数字不会在眼前从零跳成实际值。取不齐就不等了（`waited`）。
  */
  const handover = (linked && ((ov !== null && (tab !== "dashboard" || landed)) || waited)) || gaveUp || lasting;

  // 热启动：交接的那一刻就是窗口出现的那一刻。Rust 那边也有保底，这里只管早到
  useEffect(() => {
    if (warm && handover) void invoke("reveal_main_window").catch(() => {});
  }, [handover]);

  const changed = useCallback(() => setNudge((n) => n + 1), []);
  const openConfigFile = useCallback((focus: string | null) => setConfigFile({ focus }), []);
  const go = useCallback((to: string) => open(to as Surface), [open]);

  /** ⌘K 里的条目：各页，加几个全局动作 */
  const commands = useMemo<Command[]>(() => {
    const zh = appText.zh.surfaces;
    const en = appText.en.surfaces;
    const pages: Command[] = SURFACES.map((s, i) => {
      const Icon = ICONS[s];
      return {
        id: s,
        group: "pages",
        label: t.surfaces[s],
        keywords: `${zh[s]} ${en[s]}`,
        icon: <Icon />,
        shortcut: [modKey, `${i + 1}`],
        disabled: !linked && s !== "settings",
        run: () => open(s),
      };
    });
    const actions: Command[] = [
      {
        id: "config-file",
        group: "actions",
        label: t.configFile,
        keywords: "config.yaml",
        icon: <FileCodeIcon />,
        disabled: !linked,
        run: () => setConfigFile({ focus: null }),
      },
      {
        id: "version-history",
        group: "actions",
        label: t.versionHistory,
        icon: <HistoryIcon />,
        disabled: !linked,
        run: () => setHistoryOpen(true),
      },
      {
        id: "refresh",
        group: "actions",
        label: pt.refresh,
        icon: <RotateCwIcon />,
        shortcut: [modKey, "R"],
        run: () => setNudge((n) => n + 1),
      },
      {
        id: "rail",
        group: "actions",
        label: railOpen ? t.collapseRail : t.expandRail,
        icon: <IconSidebar />,
        shortcut: isMac ? ["⌘", "⌥", "S"] : ["Ctrl", "B"],
        run: () => setRailOpen((v) => !v),
      },
    ];
    return [...pages, ...actions];
  }, [t, pt, linked, open, railOpen]);

  /** 还没取到概览时的占位：页头照常，内容是表格骨架；读失败了是「读取失败」和重试 */
  const skeleton = (
    <Page>
      <PageHeader title={t.surfaces[tab]} />
      {ovError !== null ? (
        <ErrorState error={ovError} onRetry={() => setNudge((n) => n + 1)} />
      ) : (
        <TableSkeleton rows={6} cols={4} />
      )}
    </Page>
  );

  return (
    <TooltipRoot>
      <NavContext.Provider value={navValue}>
        <PageTitleContext.Provider value={reportHeader}>
          <SidebarProvider
            open={railOpen}
            onOpenChange={setRailOpen}
            className="h-screen min-h-0 text-foreground"
            style={
              {
                // 覆盖掉 shadcn 的 16rem / 3rem。展开 196px：这里只放一列短词。收起 80px
                // 是红绿灯定的：最右那颗的右边缘在约 71pt，窄于这个数右边框就从灯上穿过去
                "--sidebar-width": "196px",
                "--sidebar-width-icon": "80px",
                "--sidebar": "var(--chrome-rail)",
                "--sidebar-border": "var(--chrome-hair)",
              } as React.CSSProperties
            }
          >
            {/*
              源列表。**在 macOS 上整条都是拖拽区**，是半透的系统材质（`data-vibrant`，
              见 index.css）；别的平台是实色。可以收起：收起之后只剩图标，名字进悬浮说明。
            */}
            <Sidebar
              collapsible="icon"
              className="border-r border-sidebar-border"
              style={{ color: "var(--chrome-text)" }}
              {...drag}
            >
              {/* 红绿灯占掉左上角，内容从它下面开始。Windows、Linux 上是系统标题栏，没有这一块 */}
              {isMac && <SidebarHeader className="h-[38px] p-0" {...drag} />}

              <SidebarContent className={cn("gap-0", !isMac && "pt-2")}>
                {SOURCES.map((g, gi) => (
                  <SidebarGroup key={g.group} className="px-2.5 py-0">
                    {/* 没有分组标题，只有细分隔线：四个标题会吃掉列表约三分之一的高度 */}
                    {gi > 0 && <SidebarSeparator className="mx-1.5 my-2.5 opacity-70" />}
                    <SidebarGroupContent>
                      <SidebarMenu className="gap-px">
                        {g.items.map((it) => {
                          const on = tab === it.id;
                          // 客户端配置里出现了新东西：挂个角标，直到去看过
                          const badge = it.id === "mcp" ? alerts.length : 0;
                          const Icon = it.icon;
                          const label = t.surfaces[it.id];
                          // 没连上时需要 core 数据的几页置灰；设置始终可用，连接管理在那里
                          const off = !linked && it.id !== "settings";
                          return (
                            <SidebarMenuItem key={it.id}>
                              <SidebarMenuButton
                                disabled={off}
                                isActive={on}
                                onClick={() => open(it.id)}
                                aria-current={on ? "page" : undefined}
                                tooltip={badge > 0 ? t.newFindings(label, badge) : label}
                                className={cn(
                                  "h-7 gap-2.5 px-2 text-(--chrome-text) transition-colors duration-(--motion-fast)",
                                  "hover:bg-(--chrome-hover) hover:text-(--chrome-strong) active:bg-(--chrome-selected)",
                                  "data-active:bg-(--chrome-selected) data-active:text-(--chrome-strong) data-active:font-medium",
                                  "[&>svg]:opacity-65 data-active:[&>svg]:opacity-100 hover:[&>svg]:opacity-100",
                                  off && "opacity-45",
                                )}
                              >
                                <Icon size={16} />
                                <span className="truncate">{label}</span>
                              </SidebarMenuButton>
                              {badge > 0 && (
                                <SidebarMenuBadge className="h-4 min-w-4 rounded-full bg-destructive px-1 leading-none text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white">
                                  {badge}
                                </SidebarMenuBadge>
                              )}
                              {/* 收起时数字塞不下，只留一个点：它回答的是「那边有没有新东西」 */}
                              {badge > 0 && (
                                <span className="pointer-events-none absolute top-[7px] right-[7px] hidden size-[7px] rounded-full bg-destructive ring-2 ring-(--chrome-ground) group-data-[collapsible=icon]:block" />
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
                状态钉在源列表底部。**它要一直看得见** —— core 挂了是这个应用唯一「什么都
                不工作」的状态。连接名在状态点和网关地址上面，点开是连接列表（`Switcher`）
              */}
              <SidebarFooter className="border-t px-3.5 py-2.5" style={{ borderColor: "var(--chrome-hair)" }}>
                <Switcher
                  local={{
                    text: c.text,
                    short: c.short,
                    tone: c.tone,
                    addr: status?.gateway_addr ?? null,
                    tip: (
                      <>
                        {status?.gateway_addr ? `${c.text} · ${status.gateway_addr}` : c.text}
                        {/* 监听设置没换成：上面的地址是还在服务的旧地址，原因写在这里 */}
                        {status?.listen_error && <div>{t.listenStale(coreText(status.listen_error))}</div>}
                      </>
                    ),
                  }}
                />
              </SidebarFooter>
            </Sidebar>

            {/* 右侧：工具栏、横幅、内容。**这一列铺实色**：macOS 上窗口底是透明的 */}
            <div className="flex min-w-0 flex-1 flex-col bg-background">
              {/*
                工具栏。整条是拖拽区，按钮不是。**在滚动容器外面**，钉住不动。收起源列表的
                按钮放在这儿：收起之后源列表只有 80px，放不下；在内容这一侧两种状态下都在
                同一个位置（访达、邮件也这么放）。
              */}
              <div
                className="flex h-[38px] shrink-0 items-center gap-1.5 border-b border-sidebar-border px-3"
                {...drag}
              >
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
                    **不要给它 `aria-expanded`。**`ghost` 变体里有一条 `aria-expanded:bg-muted`，
                    挂上之后源列表展开时这个按钮常驻一块底色，比悬停还深：看起来是反的。
                  */}
                  <SidebarTrigger
                    aria-label={railOpen ? t.collapseRail : t.expandRail}
                    style={{ color: "var(--chrome-dim)" }}
                  />
                </Tip>

                {/*
                  当前在哪一页。**页头里有大标题时这里不重复**；页头滚出视野（或者这一页
                  还没有页头）时淡入。见 `PageTitleContext`。
                */}
                <span
                  className={cn(
                    "truncate tw-head transition-opacity duration-(--motion-base) ease-(--motion-ease)",
                    headerSeen === true ? "opacity-0" : "opacity-100",
                  )}
                  style={{ color: "var(--chrome-text)" }}
                  aria-hidden={headerSeen === true}
                  {...drag}
                >
                  {t.surfaces[tab]}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  {/*
                    配置页共用的两个入口。**文件只有一份**，各页的表单是它的几种视图 ——
                    所以入口放在工具栏，而不是每页各放一套。
                  */}
                  {linked && CONFIG_PAGES.has(tab) && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setConfigFile({ focus: null })}>
                        {t.configFile}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                        {t.versionHistory}
                      </Button>
                    </>
                  )}
                  <Tip
                    side="bottom"
                    text={
                      <>
                        {pt.title}
                        <KbdGroup>
                          <Kbd>{modKey}</Kbd>
                          <Kbd>K</Kbd>
                        </KbdGroup>
                      </>
                    }
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={pt.title}
                      onClick={() => setPalette(true)}
                      style={{ color: "var(--chrome-dim)" }}
                    >
                      <SearchIcon />
                    </Button>
                  </Tip>
                  {/* 提醒在每一页都在：它说的事不属于任何一页 */}
                  <Notices onNavigate={go} asked={noticesAsked} />
                </div>
              </div>

              {/* 工具栏之下这一层。**滚动不在这儿**：每一页在自己的容器里滚 */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {/*
                  配置没通过校验。**一直挂着，直到下一次成功换入** —— 一闪而过的提示等于
                  没提示。第一句先说「还在按旧配置转发」：那是最想知道的，会不会断。
                */}
                <Banner show={rejected !== null} tone="warning" title={t.rejectedTitle}>
                  {rejected && (
                    <>
                      <p>
                        {t.rejectedAt(stageLabel(rejected.stage), rejected.line)}
                        {coreText(rejected.message)}
                      </p>
                      {rejected.excerpt && (
                        <pre className="mt-1.5 overflow-x-auto rounded-md bg-warning/10 px-2 py-1 font-mono tw-label">
                          {rejected.line}│ {rejected.excerpt}
                        </pre>
                      )}
                    </>
                  )}
                </Banner>

                {/*
                  token 端点换发了新的 refresh token。**两种完全不同的话，长得也要不一样**：
                  写回成功只是告知（编辑器会弹「文件已更改」，该知道是谁改的）；写回失败是
                  必须处理的问题：重启之前不解决，该上游就不可用了。
                */}
                {rotated.map((r) => (
                  <Reveal key={r.provider} show>
                    {r.persisted ? (
                      <Banner
                        tone="info"
                        actions={
                          <Button variant="ghost" size="xs" onClick={clearRotated}>
                            {common.close}
                          </Button>
                        }
                      >
                        {t.rotatedSaved(<span className="font-medium">{r.provider}</span>)}
                        <Tip text={t.reloadTip}>
                          <span className="ml-1 text-muted-foreground underline decoration-dotted underline-offset-2">
                            {t.reload}
                          </span>
                        </Tip>
                      </Banner>
                    ) : (
                      <Banner
                        tone="error"
                        title={t.rotatedUnsaved(r.provider)}
                        actions={
                          <Button variant="ghost" size="sm" onClick={clearRotated}>
                            {common.close}
                          </Button>
                        }
                      >
                        <p>{coreText(r.detail)}</p>
                        <p className="mt-0.5">{t.oldRevoked((s) => <span className="font-medium">{s}</span>)}</p>
                      </Banner>
                    )}
                  </Reveal>
                ))}

                {/*
                  断线。**不是 toast，也不清空页面**：数字留着，旁边写着它们为什么不动了。
                  连着远程时是另一条（内容置为只读），见 `remoteLost`。
                */}
                <Banner
                  show={remoteLost && profile !== undefined}
                  tone="warning"
                  role="status"
                  actions={
                    <Button
                      variant="outline"
                      size="sm"
                      pending={link?.kind === "connecting"}
                      onClick={() => void invoke("retry_connection").catch(() => {})}
                    >
                      {ct.retryNow}
                    </Button>
                  }
                >
                  {profile && ct.lostBanner(profile.name, remoteAttempt)}
                </Banner>

                <Banner
                  show={lost !== null}
                  tone="warning"
                  title={lost && t.staleData(lost.what)}
                  actions={
                    lost?.retry && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void invoke("restart_core").catch(() => setNudge((n) => n + 1))}
                      >
                        {t.restart}
                      </Button>
                    )
                  }
                >
                  {lost?.next}
                </Banner>

                {/*
                  断线时整块只读：`fieldset disabled` 让里面的按钮、输入框、下拉一起失效，
                  读、滚动、悬停说明照旧。设置页不整页只读：连接管理在那里，断线时正要来
                  这里（换密钥、切回本机）；那一页里改服务器配置的几节自己只读，见 `Config`
                */}
                <fieldset
                  disabled={remoteLost && tab !== "settings"}
                  className={cn(
                    "m-0 flex min-h-0 min-w-0 flex-1 flex-col border-0 p-0 transition-opacity",
                    remoteLost && tab !== "settings" && "opacity-60",
                  )}
                >
                  {/*
                    每一页自己的滚动层，换页时淡入并上移 4px（`motion-page`）。流量页在
                    自己那一层里横竖都滚（表头靠它吸顶），这一层不能再滚。
                  */}
                  <div
                    key={linked ? tab : `unlinked-${tab}`}
                    className={cn(
                      "flex min-h-0 flex-1 flex-col motion-page",
                      tab === "requests" && linked ? "overflow-hidden" : "overflow-y-auto",
                    )}
                  >
                    {/*
                      **还没连上时这里什么都不画**：整窗盖着启动画面。连上之后各页在它下面
                      挂上、开始取数，交接时数据已经在了（见 `handover`）。**控制面一答应就
                      交接** —— 哪怕网关还没起来（安全模式下配置、回滚都能用）。
                    */}
                    {!linked ? (
                      launching ? null : tab === "settings" ? (
                        <Config ov={null} status={null} onChanged={changed} />
                      ) : (
                        <Unlinked core={core} />
                      )
                    ) : tab === "dashboard" ? (
                      <Dashboard
                        tick={dashTick}
                        ov={ov}
                        onLanded={() => setLanded(true)}
                        onShowSecurity={(range) =>
                          // 实时档的计数按 24 小时算（见 `windowStart`），日志也按 24 小时看
                          open("security", {
                            focus: { range: range.live ? presetRange("1d") : range, at: Date.now() },
                          })
                        }
                        // 归组态下「哪些模型没定价」看不出来：那是一行一行的问题
                        onShowUnpriced={() => open("requests", { grouped: false, filter: { unpricedOnly: true } })}
                      />
                    ) : tab === "clients" ? (
                      <ClientsPage busy={busyKeys} />
                    ) : tab === "mcp" ? (
                      <McpPage alerts={alerts} onSeen={clearAlerts} />
                    ) : tab === "security" ? (
                      ov ? (
                        <SecurityPage
                          configVersion={ov.config_version}
                          tick={dashTick}
                          focus={securityFocus}
                          onChanged={changed}
                        />
                      ) : (
                        skeleton
                      )
                    ) : tab === "keys" ? (
                      ov ? (
                        <KeysPage ov={ov} busy={busyKeys} onChanged={changed} onOpenConfigFile={openConfigFile} />
                      ) : (
                        skeleton
                      )
                    ) : tab === "routing" ? (
                      ov ? (
                        <RoutingPage ov={ov} onChanged={changed} onOpenConfigFile={openConfigFile} />
                      ) : (
                        skeleton
                      )
                    ) : tab === "upstreams" ? (
                      ov ? (
                        <UpstreamsPage ov={ov} onChanged={changed} onOpenConfigFile={openConfigFile} onNavigate={go} />
                      ) : (
                        skeleton
                      )
                    ) : tab === "settings" ? (
                      <Config ov={ov} status={status} coreReadOnly={remoteLost} onChanged={changed} />
                    ) : (
                      <TrafficPage
                        rows={allRows}
                        seeded={seeded}
                        locallyAnswered={locallyAnswered}
                        sessions={sessions}
                        status={status}
                        view={traffic}
                      />
                    )}
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
                  open(surfaceOf(section));
                }}
              />
            )}
            {historyOpen && <VersionHistoryDialog reloads={reloads} onClose={() => setHistoryOpen(false)} />}
            <CommandPalette open={palette} onOpenChange={setPalette} commands={commands} />
            {/*
              **所有出错都走这里**（`notify`）。吐司统一在右下角，谁触发的都一样；状态类的
              事走横幅，不走吐司。
            */}
            <Toaster position="bottom-right" closeButton />
          </SidebarProvider>
        </PageTitleContext.Provider>
      </NavContext.Provider>
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
