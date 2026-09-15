import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRequests } from "./useRequests";
import { useStableState } from "./useStable";
import { ago, bytes, latency, repeated, statusTone } from "./format";
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
import Clients from "./Clients";
import Keys from "./Keys";
import Routes from "./Routes";
import Security from "./Security";
import Guard from "./Guard";
import { Tip, TooltipRoot } from "@/ui/tip";
import {
  IconClient,
  IconDashboard,
  IconFindings,
  IconFlow,
  IconGateway,
  IconGuard,
  IconRoute,
  IconSession,
  IconKey,
  IconServer,
  IconSettings,
  IconSidebar,
} from "./ui/icons";
import { RowMenu } from "@/ui/row-menu";
import Sessions from "./Sessions";
import Dashboard from "./Dashboard";
import RequestDrawer from "./RequestDrawer";
import type { CoreStatus, Overview } from "./types";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";
import { Toggle } from "@/ui/toggle";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import type { LucideIcon } from "lucide-react";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { Toaster } from "@/ui/sonner";
import { toast } from "sonner";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/ui/resizable";
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
} from "@/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";

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
  | "sessions"
  | "dashboard"
  | "security"
  | "guard"
  | "routing"
  | "keys"
  | "upstreams"
  | "config"
  | "settings"
  | "clients";

/** lucide 的图标类型。尺寸走 `size`，颜色走 `currentColor`。 */
type SourceIcon = LucideIcon;
const SOURCES: {
  group: string;
  items: { id: Surface; label: string; icon: SourceIcon }[];
}[] = [
  {
    group: "监控",
    items: [
      // **概览在最上面。**它回答的是「现在什么情况」，而流量和会话回答
      // 的是「刚才那一条发生了什么」—— 前者是打开这个应用的默认意图，
      // 后者是带着问题来的时候才点。
      { id: "dashboard", label: "概览" , icon: IconDashboard },
      { id: "requests", label: "流量" , icon: IconFlow },
      { id: "sessions", label: "会话" , icon: IconSession },
    ],
  },
  {
    // **安全自己一组，不挂在「监控」下面。**
    //
    // 它不是一个看板：三条防线各自有三态、有规则集、有拦截动作，那是
    // 策略，不是观测。塞在监控里的后果不只是归类难看 —— 用户会把它当
    // 成一个只能看的页面，而整个设计前提是他看完证据之后**要
    // 去动那几个开关**。
    //
    // 所以拆成两项：发现（看证据）和防护（配策略）。
    group: "安全",
    items: [
      { id: "security", label: "发现" , icon: IconFindings },
      { id: "guard", label: "防护" , icon: IconGuard },
    ],
  },
  {
    group: "配置",
    items: [
      // 路由原来埋在配置页中段,和「监听与访问」「诊断包」并列 ——
      // 而它是这个产品区别于一个普通代理的核心概念,不该要滚两屏才看见。
      { id: "upstreams", label: "上游" , icon: IconServer },
      { id: "keys", label: "密钥" , icon: IconKey },
      { id: "routing", label: "路由" , icon: IconRoute },
      { id: "config", label: "网关" , icon: IconGateway },
      { id: "clients", label: "客户端" , icon: IconClient },
    ],
  },
  {
    // **应用自己的设置，不是网关的配置。**
    //
    // 开机自启原来挂在「网关」下面，和「上游地址」「监听端口」并列 ——
    // 那是两类完全不同的东西：一个写进系统的登录项，一个写进 config.yaml。
    // 分界线就是这个：改的是这个 macOS 应用，还是改网关的配置文件。
    group: "应用",
    items: [{ id: "settings", label: "设置" , icon: IconSettings }],
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
  if (raw.startsWith("running:")) return { text: "运行中", short: "运行中", tone: "ok" };
  if (raw === "starting") return { text: "启动中", short: "启动中", tone: "warn" };
  if (raw.startsWith("restarting:")) {
    const [, attempt] = raw.split(":");
    return { text: `重启中（第 ${attempt} 次）`, short: "重启中", tone: "warn" };
  }
  // 安全模式必须显眼：这时候网关不转发了，用户所有的 AI 客户端都在瞎。
  if (raw === "safe_mode")
    return { text: "安全模式 · 网关未运行", short: "安全模式", tone: "bad" };
  return { text: "已停止", short: "已停止", tone: "bad" };
}

/** 可排序表头。箭头只出现在当前排序列上 —— 每列都挂一个等于没挂。 */
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
        aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <span className={cn(active && "text-foreground")}>{label}</span>
        <span className="ml-0.5 inline-block w-2 tw-label">
          {active ? (dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </Button>
    </TableHead>
  );
}

export default function App() {
  const { rows: allRows, locallyAnswered, rejected, configVersion, alerts, rotated, clearRotated, clearAlerts } =
    useRequests();
  // 排序与过滤。默认按时间倒序 —— 那是「刚才发生了什么」，也是打开这
  // 一页最常见的意图。
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filter, setFilter] = useState(EMPTY_FILTER);
  const rows = useMemo(
    () => sortRows(filterRows(allRows, filter), sortKey, sortDir),
    [allRows, filter, sortKey, sortDir],
  );
  const facet = useMemo(() => facets(allRows), [allRows]);
  const searchRef = useRef<HTMLInputElement>(null);

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
  const [core, setCore] = useState("stopped");
  /**
   * 托盘按了「退出」，等确认。
   *
   * **退出的代价是所有 AI 客户端立刻失联**，不该由一次手滑造成 ——
   * 所以托盘那一项只是把窗口拉起来问一句，真正的 `exit` 在这里。
   */
  const [askQuit, setAskQuit] = useState(false);
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
  /**
   * 键盘选中的那一行。
   *
   * **`-1` 表示还没用过键盘。**一进页面就高亮第一行，会让用户以为
   * 那一行有什么特别。
   */
  const [cursor, setCursor] = useState(-1);
  const [tab, setTab] = useState<Surface>("dashboard");
  /** Dashboard 每两秒跟着状态轮询一起刷。它查的是库，不是实时流 */
  const [dashTick, setDashTick] = useState(0);
  /**
   * 轮询里要读当前在哪一页，但**不能把 `tab` 加进那个 effect 的依赖**
   * —— 那样每切一次页都会重建计时器，于是切页的瞬间会多打一轮请求。
   * 用 ref 读最新值，依赖数组保持不变。
   */
  const tabRef = useRef<Surface>("dashboard");
  /**
   * 窗口够不够宽拆成两栏。
   *
   * 1100px 拆开之后列表约 620px、检查器 480px —— 两边都还能用。再窄的话
   * 列表会挤到只剩几列，那时浮层反而是对的：牺牲「同时看见」换回可读的
   * 列表宽度。**判据是实测的窗口宽度，不是一个 CSS 断点** —— 这是桌面
   * 应用，窗口是用户随手拖的。
   */
  /**
   * 相对时间要自己走，否则「3s」会一直停在 3s。
   *
   * **10 秒一跳，不是 1 秒。**这一列的精度到「秒」就够了，而每秒重渲染
   * 整张表正是刚修掉的那个毛病 —— 为了让一个数字走起来把它请回来，
   * 是这类计时器最常见的退化方式。
   */
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const h = setInterval(() => setNowTick(Date.now()), 10_000);
    return () => clearInterval(h);
  }, []);
  const [wide, setWide] = useState(() => window.innerWidth >= 1040);
  useEffect(() => {
    const on = () => setWide(window.innerWidth >= 1040);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const split = wide && tab === "requests" && open != null;
  /*
    分栏的宽度记在本地。**v4 的 react-resizable-panels 去掉了
    `autoSaveId`**（那一版自己写 localStorage），所以这里自己接一下 ——
    一共就是读一次、写一次。
  */
  const [splitLayout] = useState<Record<string, number> | undefined>(() => {
    try {
      const raw = window.localStorage.getItem("tw-split");
      const v: unknown = raw ? JSON.parse(raw) : null;
      if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
      const ok = Object.values(v as Record<string, unknown>).every(
        (n) => typeof n === "number",
      );
      return ok ? (v as Record<string, number>) : undefined;
    } catch {
      return undefined;
    }
  });
  const [ov, setOv] = useStableState<Overview | null>(null);
  // 加完第一个上游之后立刻重拉一次。等那两秒的轮询的话，用户刚点完
  // 「保存」还看着「还没有上游」，会以为没生效（和那条一样的理由）。
  const [nudge, setNudge] = useState(0);

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

  useEffect(() => {
    const un = listen("ask-quit", () => setAskQuit(true));
    return () => {
      un.then((f) => f());
    };
  }, []);

  /**
   * 列表的键盘导航。
   *
   * **「用鼠标一行行点太慢」**，而 Requests 是主战场。
   *
   * 两个边界：在输入框里打字时不接管方向键（否则光标动不了）；
   * 抽屉开着时 `↑↓` 也不动，那时用户在看详情而不是挑行。
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
      if (e.metaKey && e.altKey && !e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        setRailOpen((v) => !v);
        return;
      }

      if (e.metaKey && !e.altKey && !e.ctrlKey) {
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
          setTab("config");
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
      if (open !== null) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => {
          const next = e.key === "ArrowDown" ? c + 1 : c - 1;
          // 第一次按方向键从第一行开始，而不是从「上一行」跳到末尾
          if (c < 0) return e.key === "ArrowDown" ? 0 : 0;
          return Math.max(0, Math.min(rows.length - 1, next));
        });
      } else if (e.key === "Enter" && cursor >= 0 && rows[cursor]) {
        e.preventDefault();
        setOpen(rows[cursor].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, rows, cursor, open]);

  // 换页时把抽屉关掉 —— 它是请求页的东西，留在别的页上没有意义，
  // 而那时 Esc 也不接管了（键盘那个 effect 只在请求页挂）
  useEffect(() => {
    if (tab !== "requests") setOpen(null);
  }, [tab]);

  // 列表变短了（超上限丢老的）时把光标收回来 —— 指着一行不存在的
  // 记录，`Enter` 会什么都不发生，而用户不知道为什么
  useEffect(() => {
    setCursor((c) => (c >= rows.length ? rows.length - 1 : c));
  }, [rows.length]);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        // Tauri 的 invoke 用**字符串** reject，不是 Error ——
        // `e instanceof Error` 永远是 false，所以按字符串处理。
        const s = await invoke<CoreStatus>("core_status");
        if (alive) {
          setStatus(s);
        }
      } catch (e) {
        if (alive) toast.error(typeof e === "string" ? e : String(e));
      }
      try {
        const o = await invoke<Overview>("overview");
        if (alive) setOv(o);
      } catch {
        /* 概览拿不到不该盖掉上面那条更有用的错误 */
      }
      // **只在概览页可见时才推 tick。**它唯一的用途是让 Dashboard
      // 重新拉数，而每 2 秒自增一次会让整个 App 重渲染一遍 —— 包括
      // 用户正在看的请求表。别的页开着的时候，这个计数没有消费者。
      if (alive && tabRef.current === "dashboard") setDashTick((t) => t + 1);
      try {
        const c = await invoke<string>("core_state");
        if (alive) setCore(c);
      } catch {
        /* core_state 不该失败；失败了也不该盖掉上面那条更有用的错误 */
      }
    };
    tick();
    const h = setInterval(tick, 2000);
    return () => {
      alive = false;
      clearInterval(h);
    };
    // configVersion 变了就立刻再拉一次 —— 不然用户在编辑器里改完，
    // 界面上最多要等两秒才跟上，而那两秒里他会以为没生效。
  }, [configVersion, nudge]);

  tabRef.current = tab;
  const c = describeCore(core);

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
        源列表。整条都是拖拽区 —— 窗口用的是 Overlay 标题栏(红绿灯浮在
        内容上),没有一条真的标题栏可以抓,不给拖拽区窗口就挪不动。所以
        `data-tauri-drag-region` 要一路传到 `Sidebar` 上。

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
        style={{ background: "var(--chrome-rail)", color: "var(--chrome-text)" }}
        data-tauri-drag-region
      >
        {/* 红绿灯占掉左上角,内容从它下面开始 */}
        <SidebarHeader className="h-[38px] p-0" data-tauri-drag-region />

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
                    // 配置面上出现了新东西 —— 挂个角标,直到他去看过
                    const badge = it.id === "security" ? alerts.length : 0;
                    const Icon = it.icon;
                    return (
                      <SidebarMenuItem key={it.id}>
                        <SidebarMenuButton
                          isActive={on}
                          onClick={() => setTab(it.id)}
                          aria-current={on ? "page" : undefined}
                          tooltip={
                            badge > 0 ? `${it.label} · ${badge} 项新证据` : it.label
                          }
                        >
                          <Icon size={16} />
                          <span className="truncate">{it.label}</span>
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
                            style={{ boxShadow: "0 0 0 2px var(--chrome-rail)" }}
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
        <SidebarFooter className="border-t" style={{ borderColor: "var(--chrome-hair)" }}>
          <Tip
            side="right"
            text={status?.gateway_addr ? `${c.text} · ${status.gateway_addr}` : c.text}
          >
            <div
              className={
                "flex items-center gap-1.5 tw-label " +
                (c.tone === "ok"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : c.tone === "warn"
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400")
              }
            >
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
              {/* 展开时写全,收起时 80px 也放得下「运行中」四个字 */}
              <span className="group-data-[collapsible=icon]:hidden">{c.text}</span>
              <span className="hidden group-data-[collapsible=icon]:inline">
                {c.short}
              </span>
            </div>
          </Tip>
          {status?.gateway_addr && (
            <code
              className="block font-mono tw-label group-data-[collapsible=icon]:hidden"
              style={{ color: "var(--chrome-dim)" }}
            >
              {status.gateway_addr}
            </code>
          )}
        </SidebarFooter>
      </Sidebar>

      {/* 右侧:横幅 + 内容。只有这一列滚动,源列表不跟着滚 */}
      {/*
        分栏时滚动交给两栏各自管，外层不能再滚 —— 否则是两层滚动条，
        而外面那层会把整个分栏一起推走。
      */}
      <div
        className={
          "flex min-w-0 flex-1 flex-col " +
          (split ? "overflow-hidden" : "overflow-y-auto")
        }
      >
        {/*
          标题栏那一条。整条是拖拽区,按钮不是 —— 拖拽区只作用在带那个
          属性的元素上,不带的子元素照常可点。

          **收起源列表的按钮放在这儿,不放在源列表里。**收起之后源列表
          只有 60px 宽,按钮塞进去要么挤掉一个图标位,要么小到点不准;
          而放在内容这一侧,它在两种状态下都在同一个位置。系统应用
          （访达、邮件)也是这么放的。
        */}
        <div
          className="flex h-[38px] shrink-0 items-center px-3"
          data-tauri-drag-region
        >
          {/* `TooltipContent` 的样式里写着 `has-data-[slot=kbd]` —— 这个位置本来就是给键帽留的 */}
          <Tip
            side="bottom"
            text={
              <>
                {railOpen ? "收起源列表" : "展开源列表"}
                <KbdGroup>
                  <Kbd>⌘</Kbd>
                  <Kbd>⌥</Kbd>
                  <Kbd>S</Kbd>
                </KbdGroup>
              </>
            }
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setRailOpen((v) => !v)}
              aria-label={railOpen ? "收起源列表" : "展开源列表"}
              aria-expanded={railOpen}
              style={{ color: "var(--chrome-dim)" }}
            >
              <IconSidebar size={16} />
            </Button>
          </Tip>
        </div>

      {/*
        配置没通过校验。**这条要一直挂着，直到下一次成功换入** ——
        一闪而过的提示等于没提示：用户在编辑器里保存完，眼睛还在编辑器上。

        第一句先说「还在按旧配置转发」，因为那是他最想知道的：会不会断。
      */}
      {rejected && (
        <Alert variant="warning" className="border-b px-5 py-2.5">
          <AlertTitle>配置没能生效，还在按上一份转发。</AlertTitle>
          <AlertDescription>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            {rejected.stage}错误
            {rejected.line != null && `（第 ${rejected.line} 行）`}：{rejected.message}
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
              <span className="font-medium text-foreground">
                {r.provider}
              </span>{" "}
              的 token 端点换发了新凭据，已写回 config.yaml
              <Tip text="编辑器里打开的那份可能要重新加载 —— 它会弹「文件已在磁盘上更改」。">
                <span className="ml-1 underline decoration-dotted underline-offset-2">编辑器要重载</span>
              </Tip>
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0"
              onClick={clearRotated}
            >
              知道了
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
                  {r.provider} 换发了新凭据，但没能写回 config.yaml。当前转发正常。
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-300">
                  {r.detail}
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-300">
                  旧的那个已经在服务端作废了 ——
                  <span className="font-medium">重启之前不处理，这家会一直 401</span>。
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={clearRotated}
              >
                知道了
              </Button>
            </div>
          </div>
        ),
      )}

      {tab === "sessions" ? (
        <Sessions />
      ) : tab === "dashboard" ? (
        <Dashboard tick={dashTick} />
      ) : tab === "clients" ? (
        <Clients
          clientKeys={(ov?.clients ?? []).map((c) => c.name)}
          configVersion={configVersion}
        />
      ) : tab === "security" ? (
        <Security alerts={alerts} onSeen={clearAlerts} />
      ) : tab === "guard" ? (
        ov ? (
          <Guard
            ov={ov}
            configVersion={configVersion}
            onChanged={() => setNudge((n) => n + 1)}
          />
        ) : (
          <p className="p-5 tw-body text-muted-foreground">读取配置中…</p>
        )
      ) : tab === "keys" ? (
        ov ? (
          <Keys
            ov={ov}
            configVersion={configVersion}
            onChanged={() => setNudge((n) => n + 1)}
          />
        ) : (
          <p className="p-5 tw-body text-muted-foreground">读取配置中…</p>
        )
      ) : tab === "routing" ? (
        ov ? (
          <>
            <Routes
              ov={ov}
              configVersion={configVersion}
              onChanged={() => setNudge((n) => n + 1)}
            />
            {/* 试算和策略组还在 Config 里 —— 它俩和文本模式那条路缠着 */}
            <Config
              section="routing"
              ov={ov}
              configVersion={configVersion}
              rejectedLine={rejected?.line ?? null}
              onProviderAdded={() => setNudge((n) => n + 1)}
            />
          </>
        ) : (
          <p className="p-5 tw-body text-muted-foreground">读取配置中…</p>
        )
      ) : tab === "upstreams" || tab === "config" || tab === "settings" ? (
        ov ? (
          <Config
            key={tab}
            section={
              tab === "settings" ? "settings" : tab === "upstreams" ? "upstreams" : "gateway"
            }
            ov={ov}
            configVersion={configVersion}
            rejectedLine={rejected?.line ?? null}
            onProviderAdded={() => setNudge((n) => n + 1)}
          />
        ) : (
          <p className="p-5 tw-body text-muted-foreground">读取配置中…</p>
        )
      ) : (
      <ResizablePanelGroup
        orientation="horizontal"
        defaultLayout={splitLayout}
        onLayoutChanged={(l) => {
          try {
            window.localStorage.setItem("tw-split", JSON.stringify(l));
          } catch {
            // 隐私模式之类。记不住而已，不值得为它中断
          }
        }}
        className={split ? "flex min-h-0 flex-1 overflow-hidden" : "!block"}
      >
      {/*
        **分栏那条线可以拖。**原来是写死的 `w-[min(30rem,45%)]` —— 而
        「列表要多宽、详情要多宽」只有当时在排查的人知道:看路径和错误
        要宽列表,读 payload 要宽详情。抓包类工具的分隔线一律能拖。

        `autoSaveId` 让它记住 —— react-resizable-panels 自己写
        localStorage,不用我们再管一份状态。
      */}
        <ResizablePanel
          id="list"
          defaultSize={62}
          minSize={35}
          className={split ? "min-w-0 overflow-y-auto p-5" : "!flex-none p-5"}
        >
        {/*
          过滤条。**一直在，不是「有数据才出现」** —— 一个时有时无的
          工具条，用户每次都要重新找它在哪儿。没有请求时它是禁用的。
        */}
        {allRows.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              className="w-64"
              ref={searchRef}
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="搜索路径、客户端、上游、错误…  ⌘F"
              spellCheck={false}
            />
            {/* 这是个开关,不是按钮 —— 按下去它要一直保持按下的样子 */}
            <Toggle
              variant="outline"
              size="sm"
              pressed={filter.failedOnly}
              onPressedChange={(v) => setFilter((f) => ({ ...f, failedOnly: v }))}
            >
              只看失败
            </Toggle>
            {/* 下拉里只列**出现过的** —— 配了三家而只有一家在收流量时，
                另外两家出现在这里只会让人以为自己筛错了 */}
            {facet.clients.length > 1 && (
              <NativeSelect
                size="sm"
                value={filter.client}
                onChange={(e) =>
                  setFilter((f) => ({ ...f, client: e.target.value }))
                }
              >
                {/* 原生 option 收空串，所以「全部」不用再借哨兵 */}
                <NativeSelectOption value="">全部客户端</NativeSelectOption>
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
                  setFilter((f) => ({ ...f, provider: e.target.value }))
                }
              >
                {/* 原生 option 收空串，所以「全部」不用再借哨兵 */}
                <NativeSelectOption value="">全部上游</NativeSelectOption>
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
                ? `${rows.length} / ${allRows.length} 条`
                : `${allRows.length} 条`}
            </span>
            {hasAnyFilter(filter) && (
              <Button
                variant="link"
                size="xs"
                onClick={() => setFilter(EMPTY_FILTER)}
              >
                清空
              </Button>
            )}
          </div>
        )}

        {/*
          还没有上游 —— 引导，不是拦路。
          说清三件事：网关已经在跑了（所以这不是故障）、缺的是什么、
          以及去哪儿加。最后一件给一条能点的路，不是一句「请去配置」。
        */}
        {status?.providers === 0 && (
          <div className="mb-4 rounded-lg border border-input bg-neutral-100 p-4 dark:bg-neutral-900">
            <p className="tw-head font-medium">先加一个上游</p>
            <p className="mt-1 tw-body text-muted-foreground">
              网关已经起来了，在{" "}
              <code className="rounded bg-neutral-200 px-1 py-0.5 font-mono dark:bg-neutral-800">
                http://{status.gateway_addr}
              </code>{" "}
              听着，但还没有地方可以转发。加一个上游只要地址和密钥。
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => setTab("config")}
            >
              去配置页加
            </Button>
          </div>
        )}
        {rows.length === 0 ? (
          // 空状态永远在回答「接下来该做什么」。
          <Empty>
          <EmptyHeader>
            <EmptyTitle>还没有请求经过。</EmptyTitle>
            <EmptyDescription>把客户端指到{" "}
              <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
                http://{status?.gateway_addr ?? "127.0.0.1:8788"}
              </code>
              ，用配置里那把 tw- 开头的密钥。
              <br />
              第一个请求进来时，它会出现在这里。</EmptyDescription><EmptyDescription>已经本地应答了 {locallyAnswered} 次客户端探测 —— 客户端连上了，而这些探测一分钱没花。</EmptyDescription>
          </EmptyHeader>
        </Empty>
        ) : (
          <Table className="tw-num">
            {/*
              **表头必须钉住。**这张表滚两屏之后就没有列名了，而并排的
              两列毫秒数，不看列名根本分不出哪个是首字节哪个是总耗时 ——
              那恰恰是排查时唯一要看的区别。
            */}
            <TableHeader className="sticky top-0 z-10 bg-neutral-50 dark:bg-neutral-950">
              <TableRow>
                <Th k="status" label="状态" sort={sortKey} dir={sortDir} on={toggleSort} className="py-1.5" />
                <Th k="time" label="时间" sort={sortKey} dir={sortDir} on={toggleSort} />
                <TableHead>客户端</TableHead>
                <TableHead>上游</TableHead>
                <TableHead>路径</TableHead>
                {/* 首字节和总耗时合成一列 —— 非流式请求两者几乎相同 */}
                <Th k="duration" label="延迟" sort={sortKey} dir={sortDir} on={toggleSort} className="text-right" />
                <Th k="bytes" label="大小" sort={sortKey} dir={sortDir} on={toggleSort} className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <RowMenu
                  key={r.id}
                  items={[
                    { kind: "item", label: "打开详情", onSelect: () => setOpen(r.id) },
                    { kind: "sep" },
                    // **按这一行的值筛，不是打开一个筛选器。**排查时的
                    // 动作是「只看这家」「只看这个客户端」，而手打名字
                    // 会打错，打错的表现是「筛出来空的」。
                    {
                      kind: "item",
                      label: `只看上游 ${r.provider}`,
                      onSelect: () => setFilter((f) => ({ ...f, provider: r.provider })),
                    },
                    {
                      kind: "item",
                      label: `只看客户端 ${r.client}`,
                      onSelect: () => setFilter((f) => ({ ...f, client: r.client })),
                    },
                    { kind: "sep" },
                    {
                      kind: "item",
                      label: "复制请求 ID",
                      onSelect: () => void navigator.clipboard.writeText(String(r.id)),
                    },
                    {
                      kind: "item",
                      label: "复制这一行",
                      onSelect: () =>
                        void navigator.clipboard.writeText(
                          [
                            new Date(r.atMs).toLocaleString(),
                            r.client,
                            r.provider,
                            r.path,
                            r.status ?? r.state,
                            r.durationMs != null ? `${r.durationMs}ms` : "",
                            r.error ?? "",
                          ]
                            .filter(Boolean)
                            .join("\t"),
                        ),
                    },
                  ]}
                >
                <TableRow
                  onClick={() => {
                    setCursor(rows.indexOf(r));
                    setOpen(r.id);
                  }}
                  className={
                    "cursor-pointer border-b border-neutral-100 hover:bg-neutral-50 dark:border-neutral-900 dark:hover:bg-neutral-900 " +
                    (rows[cursor]?.id === r.id
                      ? "bg-neutral-100 dark:bg-neutral-800"
                      : fresh.has(r.id)
                        ? "bg-emerald-50 dark:bg-emerald-950"
                        : "")
                  }
                >
                  {/*
                    状态用色点编码。**25 个灰色 200 排成一列是零信息** ——
                    眼睛要能一眼扫到那个 5xx，而不是逐行读数字。
                  */}
                  <TableCell className="whitespace-nowrap">
                    {(() => {
                      const tone = statusTone(r.status, r.state);
                      const dot =
                        tone === "bad"
                          ? "bg-red-500"
                          : tone === "warn"
                            ? "bg-amber-500"
                            : tone === "pending"
                              ? "bg-amber-400 animate-pulse"
                              : "bg-emerald-500/60";
                      return (
                        <span className="flex items-center gap-1.5">
                          <span className={"inline-block h-1.5 w-1.5 shrink-0 rounded-full " + dot} />
                          <span className={tone === "ok" ? "text-neutral-400" : ""}>
                            {r.state === "in_flight"
                              ? "…"
                              : r.state === "failed"
                                ? "失败"
                                : r.status}
                          </span>
                        </span>
                      );
                    })()}
                  </TableCell>
                  {/* 时间：列表要的是「刚才那条」，绝对时间留给悬停 */}
                  <TableCell className="whitespace-nowrap text-neutral-400">
                    <Tip text={new Date(r.atMs).toLocaleString()}>
                      <span>{ago(r.atMs, nowTick)}</span>
                    </Tip>
                  </TableCell>
                  {/* 和上一行相同就淡化 —— 眼睛要找的是变化的那一行 */}
                  <TableCell className={repeated(rows, i, (x) => x.client) ? "text-neutral-400/50" : ""}>
                    {r.client}
                  </TableCell>
                  <TableCell className={repeated(rows, i, (x) => x.provider) ? "text-neutral-400/50" : ""}>
                    {r.provider}
                    {/* **看不见的安全功能会被用户关掉**，因为他们会怀疑
                        是脱敏搞坏了功能。所以脱敏发生了就要在
                        列表这一层看得见，而不是藏在详情里 */}
                    {r.redacted && r.redacted.length > 0 && (
                      <span
                        className="ml-1 rounded bg-neutral-200 px-1 tw-label text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                        title={
                          "发出去之前换掉了：" +
                          r.redacted.map((x) => `${x.what} ×${x.count}`).join("、") +
                          "\n模型回显时会自动换回来。"
                        }
                      >
                        已脱敏 {r.redacted.reduce((a, x) => a + x.count, 0)}
                      </span>
                    )}
                    {/* 方言互转。**转了就要看得见，丢了字段
                        更要看得见** —— 「扩展思考开了却没生效」这个症状
                        在客户端那头完全无从下手，只有这里知道原因 */}
                    {r.translated && (
                      <span
                        className={
                          "ml-1 rounded px-1 tw-label " +
                          (r.translated.dropped.length > 0
                            ? "bg-amber-500 text-white"
                            : "bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300")
                        }
                        title={
                          `请求从 ${r.translated.from} 方言转成了 ${r.translated.to} 再发出去。` +
                          (r.translated.dropped.length > 0
                            ? `\n\n目标方言里没有对应物、只能丢掉的字段：${r.translated.dropped.join("、")}`
                            : "\n没有字段被丢掉。")
                        }
                      >
                        {r.translated.dropped.length > 0
                          ? `已转换 · 丢了 ${r.translated.dropped.length} 项`
                          : "已转换"}
                      </span>
                    )}
                    {r.flagged?.some((f) => f.high) && (
                      <span
                        className={
                          "ml-1 rounded px-1 tw-label " +
                          (r.flagged.some((f) => f.blocked)
                            ? "bg-red-600 text-white"
                            : "bg-amber-500 text-white")
                        }
                        title={r.flagged
                          .filter((f) => f.high)
                          .map((f) => `${f.tool}：${f.why}\n${f.excerpt}`)
                          .join("\n\n")}
                      >
                        {r.flagged.some((f) => f.blocked) ? "已拦截" : "可疑调用"}
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={
                      "truncate " +
                      (repeated(rows, i, (x) => x.path)
                        ? "text-neutral-400/50"
                        : "text-muted-foreground")
                    }
                  >
                    {r.path}
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
                    {bytes(r.bytes)}
                  </TableCell>
                </TableRow>
                </RowMenu>
              ))}
            </TableBody>
          </Table>
        )}
        {locallyAnswered > 0 && rows.length > 0 && (
          <p className="mt-3 tw-body text-muted-foreground">
            另有 {locallyAnswered} 次客户端探测被本地应答，没有发给任何上游。
          </p>
        )}
        </ResizablePanel>
        {/* 检查器常驻右栏：看详情的时候列表还在，两边能来回对照 */}
        {split && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel id="detail" defaultSize={38} minSize={25} className="min-w-0">
              <RequestDrawer id={open} onClose={() => setOpen(null)} inline />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      )}
      {/* 右侧抽屉。Dashboard 那边早就接了，请求页反而没有 —— 而
          这里才是主战场 */}
      </div>

      {/* 浮层挂在最外层，不跟着右列滚动 */}
      <AlertDialog open={askQuit} onOpenChange={setAskQuit}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>退出 ThinkWatch Lite？</AlertDialogTitle>
            <AlertDialogDescription>
              所有接管过的客户端会立刻失联 —— 它们指着的端口后面就没东西在听了。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="tw-body text-muted-foreground">
            只是想关窗口的话，按 ⌘W 就行，进程会留在菜单栏。
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive"
              onClick={() => void invoke("quit_app")}
            >
              退出
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* 窄窗口回退到浮层 —— 拆两栏会让列表窄到没法看 */}
      {open != null && !split && (
        <RequestDrawer id={open} onClose={() => setOpen(null)} />
      )}
      {/*
        **所有出错都走这里。**在此之前每个页面各自在表单旁边挂一条错误，
        于是同一句「还没读到配置版本」有六份实现，而滚出视野的那几份用户
        根本看不到。吐司统一在右下角，谁触发的都一样。
      */}
      <Toaster position="bottom-right" closeButton />
    </SidebarProvider>
    </TooltipRoot>
  );
}
