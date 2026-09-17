import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRequests } from "./useRequests";
import { useStableState } from "./useStable";
import { bucketStart, latency, money, repeated, statusTone, tokens, when } from "./format";
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
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Kbd, KbdGroup } from "@/ui/kbd";
import { Toaster } from "@/ui/sonner";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Split } from "@/ui/split";
import Connect, { trouble } from "./Connect";
import { Skeleton } from "@/ui/skeleton";
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

const DAY_MS = 24 * 3_600_000;

/**
 * 连控制面最多退避重试几次。
 *
 * **到了上限就停手**，不再往下试 —— 再试下去就成了轮询。守护状态一变
 * （启动中 → 运行中、进了重启、进了安全模式）那个 effect 会重跑，那才
 * 是它该被叫醒的时机。
 */
const MAX_TRIES = 8;

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

/** 编辑 config.yaml 的几页。工具栏上的「配置文件」「版本历史」只在这几页出现 */
const CONFIG_PAGES = new Set<Surface>(["upstreams", "keys", "routing", "config"]);

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
      return "guard";
    default:
      return "config";
  }
}

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
        <TableRow key={row} className="border-b border-neutral-100 dark:border-neutral-900">
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

export default function App() {
  const {
    rows: allRows,
    seeded,
    settled,
    health,
    locallyAnswered,
    rejected,
    configVersion,
    alerts,
    rotated,
    clearRotated,
    clearAlerts,
  } = useRequests();
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
  /**
   * 客户端这一列只在真的分得开的时候才出现。
   *
   * 目标用户「一个 key 就够」，那时整列二十五行是同一个值 —— 占着宽度
   * 却零信息，而那点宽度给模型名用正好。**按实际出现过的算，不按配置里
   * 有几个算**：配了两个而只有一个在发请求时，这一列同样是常量。
   */
  const showClient = facet.clients.length > 1;
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
   * 这次会话连上过控制面吗。
   *
   * **决定的是「整窗初始化面」还是「保留页面 + 顶部状态带」。**冷启动
   * 时后面确实没东西可看；而断线重连时用户本来在看数据，把它清空比留着
   * 一个旧值更糟 —— 旧值加一句「已断开」至少还回答得了「刚才是什么样」。
   */
  const [linked, setLinked] = useState(false);
  /** 连了第几次了。只用来在界面上说清楚，不参与重试逻辑 */
  const [tries, setTries] = useState(0);
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
  /** 配置文件对话框。`focus`：打开时选中的名字 */
  const [configFile, setConfigFile] = useState<{ focus: string | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

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
      if (alive) setCore(e.payload);
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
   * · 配置换了一份（`configVersion` 跟着 `config_reloaded` 走）
   * · 某家上游熔断了或恢复了（`health`，core 现在会报）
   * · 守护状态变了 —— 重启之后监听地址和 pid 都可能不一样
   * · 用户自己刚改完东西（`nudge`）
   */
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let n = 0;
    const read = async () => {
      try {
        const s = await invoke<CoreStatus>("core_status");
        if (!alive) return;
        setStatus(s);
        setLinked(true);
        setTries(0);
      } catch {
        /*
          **连不上不是错误，是启动过程中的一段。**在此之前这里弹一条
          toast，而它说的是 `Connection refused (os error 61)` —— 那是
          给写代码的人看的，用户从中得不到任何该做什么的信息。而且这个
          effect 跟着守护状态重跑（已停止 → 启动中 → 运行中），于是同样
          的话会堆三条。

          真正要处理的是一个很具体的窗口期：**core 进程起来了，控制面
          socket 还没 bind**。退避重试几次就过去了，界面上说第几次。
        */
        if (!alive) return;
        n += 1;
        setTries(n);
        if (n <= MAX_TRIES) {
          timer = setTimeout(() => void read(), Math.min(1600, 200 * 2 ** Math.min(n - 1, 3)));
        }
        // 到上限就停手，**不再重试** —— 再试下去就是轮询了。守护状态
        // 一变这个 effect 会重跑，那才是它该被叫醒的时机。
        return;
      }
      try {
        const o = await invoke<Overview>("overview");
        if (alive) setOv(o);
      } catch {
        /* 概览拿不到不影响状态那一半 —— 连上了就是连上了 */
      }
    };
    void read();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [configVersion, nudge, health, core, setStatus, setOv]);

  const c = describeCore(core);
  /** 连上过、又断了。**只在这时候挂那条带子** */
  const lost = linked && tries > 0 ? trouble(core, tries) : null;

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
                            badge > 0 ? `${it.label} · ${badge} 项新发现` : it.label
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
            {/*
              **不要给它 `aria-expanded`。**`ghost` 变体里有一条
              `aria-expanded:bg-muted` —— 那是给「下拉菜单正开着」用的。
              挂上去之后,源列表展开时这个按钮常驻一块底色,而悬停是
              `hover:bg-muted/50`,只有一半浓度:**看起来是反的**,碰上去
              反而比不碰暗。`SidebarTrigger` 不设这个属性。
            */}
            <SidebarTrigger
              aria-label={railOpen ? "收起源列表" : "展开源列表"}
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
            data-tauri-drag-region
          >
            {SOURCES.flatMap((g) => g.items).find((i) => i.id === tab)?.label}
          </span>
          {/*
            配置页共用的两个入口。**文件只有一份**，各页的表单是它的几种视图 ——
            所以入口放在工具栏，而不是每页各放一套。
          */}
          {linked && CONFIG_PAGES.has(tab) && (
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" onClick={() => setConfigFile({ focus: null })}>
                配置文件
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
                版本历史
              </Button>
            </div>
          )}
        </div>

        {/*
          只有这一层滚。工具栏在它上面，钉住不动。
          分栏时滚动交给两栏各自管，这一层就不能再滚 —— 否则是两层
          滚动条，而外面那层会把整个分栏一起推走。
        */}
        {/*
          工具栏之下这一层。**滚动不在这儿** —— 请求页交给 `Split`
          （分栏时两栏各滚各的），其余页面各自在自己的容器里滚。
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
          <AlertTitle>配置校验未通过，仍在使用上一版本</AlertTitle>
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
              的 token 端点已换发新凭据，并已写回 config.yaml。
              <Tip text="如果编辑器中打开了 config.yaml，编辑器可能提示「文件已在磁盘上更改」，需重新加载。">
                <span className="ml-1 underline decoration-dotted underline-offset-2">编辑器需重新加载</span>
              </Tip>
            </p>
            <Button
              variant="ghost"
              size="xs"
              className="shrink-0"
              onClick={clearRotated}
            >
              关闭
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
                  {r.provider} 已换发新凭据，但未能写回 config.yaml。当前转发正常。
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-300">
                  {r.detail}
                </p>
                <p className="mt-1 text-amber-800 dark:text-amber-300">
                  原凭据已在服务端失效。
                  <span className="font-medium">重启前如未处理，该上游的请求将持续返回 401</span>。
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={clearRotated}
              >
                关闭
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
      {linked && tries > 0 && lost && (
        <div className="flex items-center gap-3 border-b border-amber-300 bg-amber-50 px-5 py-2 tw-body dark:border-amber-800 dark:bg-amber-950">
          <span className="font-medium text-amber-900 dark:text-amber-200">
            {lost.what} · 以下数据截至连接断开时
          </span>
          <span className="text-amber-800 dark:text-amber-300">{lost.next}</span>
          {lost.retry && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto shrink-0"
              onClick={() => void invoke("restart_core").catch(() => setNudge((n) => n + 1))}
            >
              重新启动
            </Button>
          )}
        </div>
      )}

      {/*
        **每一面自己滚。**工具栏钉在上面不动,这一层只负责给出高度;
        真正滚的是下面这个容器（请求页是 `Split` 里的两栏各滚各的）。
      */}
      <div
        className={
          "flex min-h-0 flex-1 flex-col " +
          // 请求页的滚动在 `Split` 里（分栏时两栏各滚各的），这一层不能再滚
          (tab === "requests" ? "overflow-hidden" : "overflow-y-auto")
        }
      >
      {/*
        **这次会话还没连上过控制面 —— 整窗让给初始化面。**
        每一页的数据都来自那条 socket，连不上的时候后面确实没东西。

        和「不再有独立初始化页面」那条决定不冲突：那两道门挡的是配置
        状态（还没配上游），而门后面的东西是存在、可用的；这一道挡的是
        连接状态。**控制面一答应就立刻让开** —— 哪怕网关还没起来（安全
        模式下配置、回滚、还原接管都能用，那时绝不能再挡）。
      */}
      {!linked ? (
        <Connect state={core} tries={tries} />
      ) : tab === "sessions" ? (
        <Sessions />
      ) : tab === "dashboard" ? (
        <Dashboard tick={dashTick} ov={ov} />
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
              onOpenConfigFile={(focus) => setConfigFile({ focus })}
            />
          </>
        ) : (
          <p className="p-5 tw-body text-muted-foreground">读取配置中…</p>
        )
      ) : tab === "upstreams" ? (
        ov ? (
          <UpstreamsPage
            ov={ov}
            configVersion={configVersion}
            onChanged={() => setNudge((n) => n + 1)}
            onOpenConfigFile={(focus) => setConfigFile({ focus })}
            onNavigate={(to) => setTab(to as Surface)}
          />
        ) : (
          <p className="p-5 tw-body text-muted-foreground">读取配置中…</p>
        )
      ) : tab === "config" || tab === "settings" ? (
        ov ? (
          <Config
            key={tab}
            section={tab === "settings" ? "settings" : "gateway"}
            ov={ov}
            configVersion={configVersion}
            onOpenConfigFile={(focus) => setConfigFile({ focus })}
          />
        ) : (
          <p className="p-5 tw-body text-muted-foreground">读取配置中…</p>
        )
      ) : (
      <Split
        split={split}
        layout={splitLayout}
        onLayout={(l) => {
          try {
            window.localStorage.setItem("tw-split", JSON.stringify(l));
          } catch {
            // 隐私模式之类。记不住而已，不值得为它中断
          }
        }}
        detail={
          split && open != null ? (
            <RequestDrawer id={open} onClose={() => setOpen(null)} inline />
          ) : null
        }
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
              仅显示失败
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
          说清三件事：网关已在运行（所以这不是故障）、缺的是什么、
          以及在哪里配置。最后一件给一个能点的入口。
        */}
        {status?.providers === 0 && (
          <div className="mb-4 rounded-lg border border-input bg-neutral-100 p-4 dark:bg-neutral-900">
            <p className="tw-head font-medium">尚未配置上游</p>
            <p className="mt-1 tw-body text-muted-foreground">
              网关正在{" "}
              <code className="rounded bg-neutral-200 px-1 py-0.5 font-mono dark:bg-neutral-800">
                http://{status.gateway_addr}
              </code>{" "}
              监听。配置上游后，请求才能转发。
            </p>
            <Button size="sm" className="mt-3" onClick={() => setTab("upstreams")}>
              前往上游
            </Button>
          </div>
        )}
        {seeded && rows.length === 0 ? (
          allRows.length > 0 ? (
            /*
              有记录，只是全被筛掉了。**这时候说「暂无请求记录」是错的**
              —— 用户会以为网关断了，而实际上清掉条件就看得见。
            */
            <Empty>
              <EmptyHeader>
                <EmptyTitle>没有符合条件的请求</EmptyTitle>
                <EmptyDescription>
                  共 {allRows.length} 条记录，当前筛选条件下没有匹配项。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="outline" size="sm" onClick={() => setFilter(EMPTY_FILTER)}>
                  清除筛选条件
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            // 空状态永远在回答「接下来该做什么」。
            <Empty>
              <EmptyHeader>
                <EmptyTitle>暂无请求记录</EmptyTitle>
                <EmptyDescription>
                  将客户端的端点设为{" "}
                  <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
                    http://{status?.gateway_addr ?? "127.0.0.1:8788"}
                  </code>
                  ，并使用以 tw- 开头的客户端密钥。
                  <br />
                  收到请求后，请求记录将显示在此处。
                </EmptyDescription>
                {/* 一次都没有的时候不说这句 —— 「已经本地应答了 0 次」是在
                    拿一个零冒充证据 */}
                {locallyAnswered > 0 && (
                  <EmptyDescription>
                    已本地应答 {locallyAnswered} 次客户端探测。客户端已连接网关，这些探测未产生费用。
                  </EmptyDescription>
                )}
              </EmptyHeader>
            </Empty>
          )
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
                {/* 只有一个客户端时这一列每行都一样 —— 那是零信息 */}
                {showClient && <TableHead>客户端</TableHead>}
                <TableHead>模型</TableHead>
                <TableHead>上游</TableHead>
                {/* 首字节和总耗时合成一列 —— 非流式请求两者几乎相同 */}
                <Th k="duration" label="延迟" sort={sortKey} dir={sortDir} on={toggleSort} className="text-right" />
                <Th k="tokens" label="token" sort={sortKey} dir={sortDir} on={toggleSort} className="text-right" />
                <Th k="cost" label="费用" sort={sortKey} dir={sortDir} on={toggleSort} className="text-right" />
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
                      label: `仅显示上游 ${r.provider}`,
                      onSelect: () => setFilter((f) => ({ ...f, provider: r.provider })),
                    },
                    ...(showClient
                      ? ([
                          {
                            kind: "item",
                            label: `仅显示客户端 ${r.client}`,
                            onSelect: () => setFilter((f) => ({ ...f, client: r.client })),
                          },
                        ] as const)
                      : []),
                    { kind: "sep" },
                    {
                      kind: "item",
                      label: "复制请求 ID",
                      onSelect: () => void navigator.clipboard.writeText(String(r.id)),
                    },
                    {
                      kind: "item",
                      label: "复制此行",
                      onSelect: () =>
                        void navigator.clipboard.writeText(
                          [
                            new Date(r.atMs).toLocaleString(),
                            r.client,
                            r.model ?? "",
                            r.provider,
                            r.path,
                            r.status ?? r.state,
                            r.durationMs != null ? `${r.durationMs}ms` : "",
                            tokens(r.inputTokens, r.outputTokens),
                            money(r.costMicros, r.costEstimated),
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
                              : tone === "muted"
                                ? "bg-neutral-400"
                                : "bg-emerald-500/60";
                      return (
                        <span className="flex items-center gap-1.5">
                          <span className={"inline-block h-1.5 w-1.5 shrink-0 rounded-full " + dot} />
                          <span className={tone === "ok" || tone === "muted" ? "text-neutral-400" : ""}>
                            {r.state === "in_flight"
                              ? "…"
                              : r.state === "failed"
                                ? "失败"
                                : r.state === "cancelled"
                                  ? "已取消"
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
                    <Tip text={new Date(r.atMs).toLocaleString()}>
                      <span>{when(r.atMs, today)}</span>
                    </Tip>
                  </TableCell>
                  {/* 和上一行相同就淡化 —— 眼睛要找的是变化的那一行 */}
                  {showClient && (
                    <TableCell className={repeated(rows, i, (x) => x.client) ? "text-neutral-400/50" : ""}>
                      {r.client}
                    </TableCell>
                  )}
                  {/*
                    模型。**这一列决定了这次多贵、多慢** —— 同一个客户端
                    连着发的两次请求，差别往往只在这里。
                  */}
                  <TableCell
                    className={repeated(rows, i, (x) => x.model ?? "") ? "text-neutral-400/50" : ""}
                  >
                    {/* 截断要套在里面一层：`max-width` 加在 td 上会被表格
                        自己的列宽算法吃掉，长名字照样把这一列撑开 */}
                    <div className="max-w-[13rem] truncate" title={r.model}>
                      {r.model ?? "—"}
                    </div>
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
                          "发送前已替换：" +
                          r.redacted.map((x) => `${x.what} ×${x.count}`).join("、") +
                          "\n模型回显的内容将自动还原。"
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
                          `请求已从 ${r.translated.from} 协议转换为 ${r.translated.to} 协议后发送。` +
                          (r.translated.dropped.length > 0
                            ? `\n\n目标协议不支持、已丢弃的字段：${r.translated.dropped.join("、")}`
                            : "\n未丢弃任何字段。")
                        }
                      >
                        {r.translated.dropped.length > 0
                          ? `已转换 · 丢弃 ${r.translated.dropped.length} 项`
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
                            ? "客户端在响应结束前断开，输出用量计至断开时，实际费用可能更高。"
                            : r.state === "failed"
                              ? "响应在结束前中断，输出用量计至中断时，实际费用可能更高。"
                              : "价目表中没有此上游的单价，该金额按同一模型在其他平台的单价估算。"
                        }
                      >
                        <span className="underline decoration-dotted underline-offset-2">
                          {money(r.costMicros, true)}
                        </span>
                      </Tip>
                    ) : (
                      <span className={r.costMicros == null ? "text-neutral-400" : ""}>
                        {money(r.costMicros, false)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
                </RowMenu>
              ))}
            </TableBody>
            )}
          </Table>
        )}
        {locallyAnswered > 0 && rows.length > 0 && (
          <p className="mt-3 tw-body text-muted-foreground">
            另有 {locallyAnswered} 次客户端探测由网关本地应答，未发送到上游。
          </p>
        )}
      </Split>
      )}
      {/* 右侧抽屉。Dashboard 那边早就接了，请求页反而没有 —— 而
          这里才是主战场 */}
        </div>
        </div>
      </div>

      {/* 浮层挂在最外层，不跟着右列滚动 */}
      <AlertDialog open={askQuit} onOpenChange={setAskQuit}>
        <AlertDialogContent className="sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>退出 ThinkWatch Lite</AlertDialogTitle>
            <AlertDialogDescription>
              退出后网关将停止监听，所有已接管的客户端将立即无法连接。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="tw-body text-muted-foreground">
            仅关闭窗口请按 ⌘W，进程将保留在菜单栏。
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
      {configFile && (
        <ConfigFileDialog
          configVersion={configVersion}
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
        <VersionHistoryDialog configVersion={configVersion} onClose={() => setHistoryOpen(false)} />
      )}
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
