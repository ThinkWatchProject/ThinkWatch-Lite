import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useRequests } from "./useRequests";
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
import Security from "./Security";
import Guard from "./Guard";
import { Dialog, DialogButton } from "./ui/Dialog";
import { TooltipRoot } from "./ui/Tooltip";
import { RowMenu } from "./ui/ContextMenu";
import Sessions from "./Sessions";
import Dashboard from "./Dashboard";
import RequestDrawer from "./RequestDrawer";
import type { CoreStatus, Overview } from "./types";

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
  | "config"
  | "clients";

const SOURCES: { group: string; items: { id: Surface; label: string }[] }[] = [
  {
    group: "监控",
    items: [
      { id: "requests", label: "流量" },
      { id: "sessions", label: "会话" },
      { id: "dashboard", label: "概览" },
    ],
  },
  {
    // **安全自己一组，不挂在「监控」下面。**
    //
    // 它不是一个看板：三条防线各自有三态、有规则集、有拦截动作，那是
    // 策略，不是观测。塞在监控里的后果不只是归类难看 —— 用户会把它当
    // 成一个只能看的页面，而 §5.0 的整个设计前提是他看完证据之后**要
    // 去动那几个开关**。
    //
    // 所以拆成两项：发现（看证据）和防护（配策略）。
    group: "安全",
    items: [
      { id: "security", label: "发现" },
      { id: "guard", label: "防护" },
    ],
  },
  {
    group: "配置",
    items: [
      // 路由原来埋在配置页中段,和「监听与访问」「诊断包」并列 ——
      // 而它是这个产品区别于一个普通代理的核心概念,不该要滚两屏才看见。
      { id: "routing", label: "路由" },
      { id: "config", label: "网关" },
      { id: "clients", label: "客户端" },
    ],
  },
];

function describeCore(raw: string): { text: string; tone: "ok" | "warn" | "bad" } {
  if (raw.startsWith("running:")) return { text: "运行中", tone: "ok" };
  if (raw === "starting") return { text: "启动中", tone: "warn" };
  if (raw.startsWith("restarting:")) {
    const [, attempt] = raw.split(":");
    return { text: `重启中（第 ${attempt} 次）`, tone: "warn" };
  }
  // 安全模式必须显眼：这时候网关不转发了，用户所有的 AI 客户端都在瞎。
  if (raw === "safe_mode") return { text: "安全模式 · 网关未运行", tone: "bad" };
  return { text: "已停止", tone: "bad" };
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
    <th className={"font-medium " + className}>
      <button
        onClick={() => on(k)}
        className={
          "-mx-1 rounded px-1 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 " +
          (active ? "text-neutral-900 dark:text-neutral-100" : "")
        }
      >
        {label}
        <span className="ml-0.5 inline-block w-2 tw-label">
          {active ? (dir === "asc" ? "↑" : "↓") : ""}
        </span>
      </button>
    </th>
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
  const [status, setStatus] = useState<CoreStatus | null>(null);
  const [core, setCore] = useState("stopped");
  const [error, setError] = useState<string | null>(null);
  /**
   * 托盘按了「退出」，等确认（§7.5）。
   *
   * **退出的代价是所有 AI 客户端立刻失联**，不该由一次手滑造成 ——
   * 所以托盘那一项只是把窗口拉起来问一句，真正的 `exit` 在这里。
   */
  const [askQuit, setAskQuit] = useState(false);
  /**
   * 刚出现的那几行（§7.13）。
   *
   * **第一个请求进来时那一行要跳出来** —— 它是「它真的在工作」的证明，
   * 而这类工具最难的一关正是让用户相信流量真的经过我们了。
   */
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const seenIds = useRef<Set<number>>(new Set());
  /** 打开的那条请求（§7.8 的右侧抽屉） */
  const [open, setOpen] = useState<number | null>(null);
  /**
   * 键盘选中的那一行（§7.14）。
   *
   * **`-1` 表示还没用过键盘。**一进页面就高亮第一行，会让用户以为
   * 那一行有什么特别。
   */
  const [cursor, setCursor] = useState(-1);
  const [tab, setTab] = useState<Surface>("requests");
  /** Dashboard 每两秒跟着状态轮询一起刷。它查的是库，不是实时流 */
  const [dashTick, setDashTick] = useState(0);
  const [ov, setOv] = useState<Overview | null>(null);
  // 加完第一个上游之后立刻重拉一次。等那两秒的轮询的话，用户刚点完
  // 「保存」还看着「还没有上游」，会以为没生效（和 §3.8 那条一样的理由）。
  const [nudge, setNudge] = useState(0);

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
   * 列表的键盘导航（§7.14）。
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
        // Tauri 的 invoke 用**字符串** reject，不是 Error（§9.7）——
        // `e instanceof Error` 永远是 false，所以按字符串处理。
        const s = await invoke<CoreStatus>("core_status");
        if (alive) {
          setStatus(s);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(typeof e === "string" ? e : String(e));
      }
      try {
        const o = await invoke<Overview>("overview");
        if (alive) setOv(o);
      } catch {
        /* 概览拿不到不该盖掉上面那条更有用的错误 */
      }
      if (alive) setDashTick((t) => t + 1);
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
    // 界面上最多要等两秒才跟上，而那两秒里他会以为没生效（§3.8）。
  }, [configVersion, nudge]);

  const c = describeCore(core);

  // **不再有独立的初始化页面。**原来这里有两道全屏门禁：零上游时是
  // 一个填表向导，填完是一个「等第一个请求」的页面。两道都拆了。
  //
  // 理由是那堵墙立错了地方 —— 还没配上游的时候，网关已经在跑了，端口、
  // 网关密钥、客户端检测、配置文件在哪儿，这些全都该看得见。把人挡在
  // 外面等于说「你还没资格看」，而他要找的恰恰是「该去哪儿配」。
  //
  // 现在：主界面照常进，零上游时首页挂一条引导指向配置页，表单长在
  // 配置页「上游」那一节里（§7.13 的空状态永远在回答「接下来做什么」）。
  // 「它真的在工作了」那一下也没丢：第一个请求进来时那一行会绿一下，
  // 而请求页的空状态一直在说客户端该怎么指过来。

  return (
    <TooltipRoot>
    <div className="flex h-screen bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
      {/*
        源列表。整条都是拖拽区 —— 窗口用的是 Overlay 标题栏(红绿灯浮在
        内容上),没有一条真的标题栏可以抓,不给拖拽区窗口就挪不动。
      */}
      <aside
        className="flex w-[172px] shrink-0 flex-col border-r border-neutral-200 bg-neutral-100/60 dark:border-neutral-800 dark:bg-neutral-900/40"
        data-tauri-drag-region
      >
        {/* 红绿灯占掉左上角,内容从它下面开始 */}
        <div className="h-[38px] shrink-0" data-tauri-drag-region />

        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {SOURCES.map((g) => (
            <div key={g.group} className="mb-4">
              <div className="px-2 pb-1 tw-label font-medium text-neutral-500">
                {g.group}
              </div>
              {g.items.map((it) => (
                <button
                  key={it.id}
                  onClick={() => setTab(it.id)}
                  className={
                    "flex w-full items-center gap-2 rounded-md px-2 py-[5px] text-left tw-body " +
                    (tab === it.id
                      ? "bg-neutral-900/10 font-medium dark:bg-neutral-100/10"
                      : "text-neutral-600 hover:bg-neutral-900/5 dark:text-neutral-400 dark:hover:bg-neutral-100/5")
                  }
                >
                  {it.label}
                  {/* 配置面上出现了新东西 —— 挂个角标,直到他去看过(§5.3) */}
                  {it.id === "security" && alerts.length > 0 && (
                    <span className="ml-auto rounded-full bg-red-600 px-1.5 tw-label leading-[15px] text-white">
                      {alerts.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/*
          状态钉在源列表底部,不在标题栏。
          **它要一直看得见** —— core 挂了是这个应用唯一「什么都不工作」
          的状态,而标题栏那一行会被内容顶掉。
        */}
        <div className="border-t border-neutral-200 px-3 py-2 dark:border-neutral-800">
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
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
            {c.text}
          </div>
          {status?.gateway_addr && (
            <code className="mt-0.5 block font-mono tw-label text-neutral-500">
              {status.gateway_addr}
            </code>
          )}
        </div>
      </aside>

      {/* 右侧:横幅 + 内容。只有这一列滚动,源列表不跟着滚 */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <div className="h-[38px] shrink-0" data-tauri-drag-region />
      {error && (
        <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </div>
      )}

      {/*
        配置没通过校验。**这条要一直挂着，直到下一次成功换入**（§3.8）——
        一闪而过的提示等于没提示：用户在编辑器里保存完，眼睛还在编辑器上。

        第一句先说「还在按旧配置转发」，因为那是他最想知道的：会不会断。
      */}
      {rejected && (
        <div className="border-b border-amber-300 bg-amber-50 px-5 py-2.5 tw-body dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            配置没能生效，还在按上一份转发。
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            {rejected.stage}错误
            {rejected.line != null && `（第 ${rejected.line} 行）`}：{rejected.message}
          </p>
          {rejected.excerpt && (
            <pre className="mt-1.5 overflow-x-auto rounded bg-amber-100 px-2 py-1 font-mono tw-label text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
              {rejected.line}│ {rejected.excerpt}
            </pre>
          )}
        </div>
      )}

      {/*
        token 端点换发了新的 refresh token（§3.6）。

        **两种完全不同的话，长得也要不一样。**写回成功只是告知 ——
        用户的配置文件被我们改了，他的编辑器会弹「文件已更改」，那时
        他该知道是谁干的；写回失败是个必须处理的问题：重启之前不解决，
        那家上游就废了。
      */}
      {rotated.map((r) =>
        r.persisted ? (
          <div
            key={r.provider}
            className="flex items-start justify-between gap-4 border-b border-neutral-200 bg-neutral-50 px-5 py-2 tw-body dark:border-neutral-800 dark:bg-neutral-900"
          >
            <p className="text-neutral-600 dark:text-neutral-400">
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                {r.provider}
              </span>{" "}
              的 token 端点换发了新凭据，已经帮你写回 config.yaml —— 编辑器里那份可能要重新加载。
            </p>
            <button
              onClick={clearRotated}
              className="shrink-0 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            >
              知道了
            </button>
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
              <button
                onClick={clearRotated}
                className="shrink-0 rounded border border-amber-300 px-2 py-1 text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-200 dark:hover:bg-amber-900/40"
              >
                知道了
              </button>
            </div>
          </div>
        ),
      )}

      {tab === "sessions" ? (
        <Sessions />
      ) : tab === "dashboard" ? (
        <Dashboard tick={dashTick} />
      ) : tab === "clients" ? (
        <Clients />
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
          <p className="p-5 tw-body text-neutral-500">读取配置中…</p>
        )
      ) : tab === "routing" || tab === "config" ? (
        ov ? (
          <Config
            key={tab}
            section={tab === "routing" ? "routing" : "gateway"}
            ov={ov}
            configVersion={configVersion}
            rejectedLine={rejected?.line ?? null}
            onProviderAdded={() => setNudge((n) => n + 1)}
          />
        ) : (
          <p className="p-5 tw-body text-neutral-500">读取配置中…</p>
        )
      ) : (
      <main className="p-5">
        {/*
          过滤条。**一直在，不是「有数据才出现」** —— 一个时有时无的
          工具条，用户每次都要重新找它在哪儿。没有请求时它是禁用的。
        */}
        {allRows.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input
              ref={searchRef}
              value={filter.q}
              onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
              placeholder="搜索路径、客户端、上游、错误…  ⌘F"
              spellCheck={false}
              className="w-64 rounded-md border border-neutral-300 bg-transparent px-2 py-1 tw-body outline-none focus:border-neutral-500 dark:border-neutral-700"
            />
            <button
              onClick={() => setFilter((f) => ({ ...f, failedOnly: !f.failedOnly }))}
              className={
                "rounded-md px-2 py-1 tw-body " +
                (filter.failedOnly
                  ? "bg-red-600 text-white"
                  : "border border-neutral-300 text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800")
              }
            >
              只看失败
            </button>
            {/* 下拉里只列**出现过的** —— 配了三家而只有一家在收流量时，
                另外两家出现在这里只会让人以为自己筛错了 */}
            {facet.clients.length > 1 && (
              <select
                value={filter.client}
                onChange={(e) => setFilter((f) => ({ ...f, client: e.target.value }))}
                className="rounded-md border border-neutral-300 bg-transparent px-1.5 py-1 tw-body dark:border-neutral-700"
              >
                <option value="">全部客户端</option>
                {facet.clients.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {facet.providers.length > 1 && (
              <select
                value={filter.provider}
                onChange={(e) => setFilter((f) => ({ ...f, provider: e.target.value }))}
                className="rounded-md border border-neutral-300 bg-transparent px-1.5 py-1 tw-body dark:border-neutral-700"
              >
                <option value="">全部上游</option>
                {facet.providers.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            )}
            {/*
              **筛掉了多少要说出来。**只显示「12 条」而不说「共 340 条」
              的话，用户会以为总共就这么多 —— 这是过滤器最常见的骗人方式。
            */}
            <span className="ml-auto tw-label text-neutral-500">
              {hasAnyFilter(filter)
                ? `${rows.length} / ${allRows.length} 条`
                : `${allRows.length} 条`}
            </span>
            {hasAnyFilter(filter) && (
              <button
                onClick={() => setFilter(EMPTY_FILTER)}
                className="tw-label text-neutral-500 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
              >
                清空
              </button>
            )}
          </div>
        )}

        {/*
          还没有上游 —— 引导，不是拦路（§7.13）。
          说清三件事：网关已经在跑了（所以这不是故障）、缺的是什么、
          以及去哪儿加。最后一件给一条能点的路，不是一句「请去配置」。
        */}
        {status?.providers === 0 && (
          <div className="mb-4 rounded-lg border border-neutral-300 bg-neutral-100 p-4 dark:border-neutral-700 dark:bg-neutral-900">
            <p className="tw-head font-medium">先加一个上游</p>
            <p className="mt-1 tw-body text-neutral-600 dark:text-neutral-400">
              网关已经起来了，在{" "}
              <code className="rounded bg-neutral-200 px-1 py-0.5 font-mono dark:bg-neutral-800">
                http://{status.gateway_addr}
              </code>{" "}
              听着 —— 只是还没有地方可以转发。加一个上游，填地址和密钥就行。
            </p>
            <button
              onClick={() => setTab("config")}
              className="mt-3 rounded bg-neutral-900 px-3 py-1.5 tw-body text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              去配置页加
            </button>
          </div>
        )}
        {rows.length === 0 ? (
          // 空状态永远在回答「接下来该做什么」（§7.13）。
          <div className="rounded-lg border border-dashed border-neutral-300 p-10 text-center dark:border-neutral-700">
            <p className="tw-head text-neutral-600 dark:text-neutral-400">
              还没有请求经过。
            </p>
            <p className="mt-2 tw-body text-neutral-500">
              把客户端指到{" "}
              <code className="rounded bg-neutral-200 px-1 py-0.5 dark:bg-neutral-800">
                http://{status?.gateway_addr ?? "127.0.0.1:8788"}
              </code>
              ，用配置里那把 tw- 开头的密钥。
              <br />
              第一个请求进来时，它会出现在这里。
            </p>
            {locallyAnswered > 0 && (
              // **这句话信息量很大**：客户端已经连上了，只是还没发过真实
              // 请求。没有它，用户会以为整条链路都不通（§4.8）。
              <p className="mt-3 tw-body text-emerald-700 dark:text-emerald-300">
                已经本地应答了 {locallyAnswered} 次客户端探测 —— 客户端连上了，而这些探测一分钱没花。
              </p>
            )}
            {/*
              **空状态永远在回答「接下来该做什么」**（§7.13）。原来只说
              了「把客户端指过来」，而没给他一条走过去的路 —— 那句话对
              一个不想自己改 settings.json 的人等于没说。
            */}
            <button
              onClick={() => setTab("clients")}
              className="mt-4 rounded border border-neutral-300 px-3 py-1.5 tw-body hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >
              写入客户端配置
            </button>
          </div>
        ) : (
          <table className="w-full text-left tw-body tw-num">
            <thead className="text-neutral-500">
              <tr className="border-b border-neutral-200 dark:border-neutral-800">
                <Th k="status" label="状态" sort={sortKey} dir={sortDir} on={toggleSort} className="py-2" />
                <th className="font-medium">客户端</th>
                <th className="font-medium">上游</th>
                <th className="font-medium">路径</th>
                <Th k="ttfb" label="首字节" sort={sortKey} dir={sortDir} on={toggleSort} />
                <Th k="duration" label="耗时" sort={sortKey} dir={sortDir} on={toggleSort} />
                <Th k="bytes" label="字节" sort={sortKey} dir={sortDir} on={toggleSort} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
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
                <tr
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
                  <td className="py-1.5">
                    {r.state === "in_flight" ? (
                      <span className="text-amber-600 dark:text-amber-400">进行中</span>
                    ) : r.state === "failed" ? (
                      <span className="text-red-600 dark:text-red-400" title={r.error}>
                        失败
                      </span>
                    ) : (
                      <span className="text-neutral-500">{r.status}</span>
                    )}
                  </td>
                  <td>{r.client}</td>
                  <td>
                    {r.provider}
                    {/* **看不见的安全功能会被用户关掉**，因为他们会怀疑
                        是脱敏搞坏了功能（§5.1）。所以脱敏发生了就要在
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
                    {/* 方言互转（§4.1.2）。**转了就要看得见，丢了字段
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
                  </td>
                  <td className="text-neutral-500">{r.path}</td>
                  <td>{r.ttfbMs != null ? `${r.ttfbMs}ms` : "—"}</td>
                  <td>{r.durationMs != null ? `${r.durationMs}ms` : "—"}</td>
                  <td>{r.bytes != null ? r.bytes : "—"}</td>
                </tr>
                </RowMenu>
              ))}
            </tbody>
          </table>
        )}
        {locallyAnswered > 0 && rows.length > 0 && (
          <p className="mt-3 tw-body text-neutral-500">
            另有 {locallyAnswered} 次客户端探测被本地应答，没有发给任何上游。
          </p>
        )}
      </main>
      )}
      {/* §7.8 的右侧抽屉。Dashboard 那边早就接了，请求页反而没有 —— 而
          这里才是主战场 */}
      </div>

      {/* 浮层挂在最外层，不跟着右列滚动 */}
      <Dialog
        open={askQuit}
        onOpenChange={setAskQuit}
        danger
        width="max-w-sm"
        title="退出 ThinkWatch Lite？"
        description={
          <>
            <p>
              所有接管过的客户端会立刻失联 —— 它们指着的那个端口后面就没有东西在听了。
            </p>
            <p className="mt-1.5 text-neutral-500">
              只是想关窗口的话，按 ⌘W 就行，进程会留在菜单栏。
            </p>
          </>
        }
        footer={
          <>
            <DialogButton onClick={() => setAskQuit(false)}>取消</DialogButton>
            <DialogButton kind="danger" onClick={() => void invoke("quit_app")}>
              退出
            </DialogButton>
          </>
        }
      />
      {open != null && <RequestDrawer id={open} onClose={() => setOpen(null)} />}
    </div>
    </TooltipRoot>
  );
}
