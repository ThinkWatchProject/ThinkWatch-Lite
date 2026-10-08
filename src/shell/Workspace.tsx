import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { SearchIcon } from "lucide-react";
import { subscribe } from "@/lib/tauriEvent";
import { useLang, textOf, useText } from "@/i18n";
import { appText } from "@/App.i18n";
import { EMPTY_FILTER } from "@/requestTable";
import type { ConfigFocus } from "@/configLocate";
import { importDialogText } from "@/import/ImportDialog.i18n";
import { notify } from "@/ui/notify";
import type { LogFocus } from "@/security/SecurityPage";
import { useTrafficView } from "@/traffic/view";
import { Notices } from "@/Notices";
import { Tip, TooltipRoot } from "@/ui/tip";
import { isMac, isMod } from "@/platform";
import type { ImportProposal } from "@/types";
import { Button } from "@/ui/button";
import { Toaster } from "@/ui/sonner";
import { trouble } from "@/launch/trouble";
import { parseCoreState } from "@/coreState";
import { useConnections } from "@/connection/ConnectionProvider";
import { currentProfile } from "@/connection/api";
import { useRepair } from "@/repair";
import { NavContext, SURFACES, type Nav, type NavDelivery, type NavParams, type Surface } from "@/nav";
import { paletteText } from "@/palette/palette.i18n";
import { COMBOS, DIGIT_PAGES, Keys, isTyping, modalOpen } from "@/palette/keys";
import { SidebarProvider, SidebarTrigger } from "@/ui/sidebar";
import { Banners } from "./Banners";
import { CONFIG_PAGES, describeCore, surfaceOf } from "./describe";
import { lazyPart, usePart } from "./lazyPart";
import { Pages, preloadPage, preloadPages } from "./Pages";
import { SourceList, drag } from "./SourceList";
import type { CoreLink } from "./useCoreLink";

/*
  只在打开时才用得到的几块：命令面板（cmdk）、配置文件和版本历史、导入链接的确认框。
  **用到时才载入**，交接之后空闲下来时预先载入（见下面 `warmUp`）。
*/
const Palette = lazyPart(() => import("@/palette/Palette").then((m) => m.Palette));
const ConfigFileDialog = lazyPart(() => import("@/ConfigDialogs").then((m) => m.ConfigFileDialog));
const VersionHistoryDialog = lazyPart(() => import("@/ConfigDialogs").then((m) => m.VersionHistoryDialog));
const ImportDialog = lazyPart(() => import("@/import/ImportDialog").then((m) => m.ImportDialog));

/** 交接之后等这么久再预先载入其余各块：先让眼前这一页画完、取完数 */
const WARM_UP_MS = 1_500;

/** 其余各块一块接一块地载入，不挤在同一刻：每一块的求值各占一小段，不卡住界面 */
async function warmUp(alive: () => boolean) {
  preloadPages();
  for (const part of [Palette, ConfigFileDialog, ImportDialog]) {
    if (!alive()) return;
    await part.preload().catch(() => {});
  }
}

/**
 * 主界面：源列表、工具栏、横幅、内容区，和挂在最外层的几个浮层。
 *
 * **它是单独的一块，用到时才载入。**冷启动先画启动画面（`App` 那一小块），这一块在启动
 * 画面下面加载、挂上、开始取数；热启动时窗口藏到交接那一刻，那时它已经画好了。数据都
 * 来自 `useCoreLink`（`link`），这里只管界面上的状态：在哪一页、开着什么。
 *
 * `onViewReady`：落地的那一页取好了首屏的数据，启动画面可以交接了（见 `useCoreLink`）。
 */
export default memo(function Workspace({
  link,
  onViewReady,
}: {
  link: CoreLink;
  onViewReady: (ready: boolean) => void;
}) {
  const t = useText(appText);
  const pt = useText(paletteText);
  const lang = useLang();
  const conn = useConnections();
  const profile = conn.view ? currentProfile(conn.view) : undefined;
  /** 连着的是远程 core */
  const remote = profile !== undefined && !profile.local;
  const connLink = conn.view?.link ?? null;
  const { core, linked, tries, status, ov, ovError, nudge, refresh, changed, launching, handover } = link;
  const { rejected, rotated, alerts, reloads, clearAlerts, clearRotated } = link.feed;
  const traffic = useTrafficView();
  const { setFilter, setGrouped } = traffic;

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

  /** 概览那一页的第一份数据到了。启动画面等它，交接时数字已经是对的 */
  const [landed, setLanded] = useState(false);
  const onLanded = useCallback(() => setLanded(true), []);
  const viewReady = tab !== "dashboard" || landed;
  useEffect(() => onViewReady(viewReady), [viewReady, onViewReady]);

  // 落地的那一页先载入：和连 core 同时进行，交接时已经在了
  const landing = useRef(tab);
  useEffect(() => preloadPage(landing.current), []);
  // 交接之后空闲下来，把其余各块也载入：第一次换到哪一页、打开命令面板都不用等
  useEffect(() => {
    if (!handover) return;
    let alive = true;
    const h = setTimeout(() => void warmUp(() => alive), WARM_UP_MS);
    return () => {
      alive = false;
      clearTimeout(h);
    };
  }, [handover]);

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

  /** 配置文件对话框。`focus`：打开时选中的那一项 */
  const [configFile, setConfigFile] = useState<{ focus: ConfigFocus | null } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  /** 快捷键一览（`?`，或者命令面板左下角） */
  const [shortcuts, setShortcuts] = useState(false);
  /** 命令面板、快捷键一览打开过。**打开过才挂上**：在那之前它那一块不用载入 */
  const paletteUsed = useRef(false);
  if (palette || shortcuts) paletteUsed.current = true;
  const PaletteView = usePart(Palette, paletteUsed.current);

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
    导入链接（`thinkwatch://import?…`）：Rust 那边校验过、一次只留一份，这里取走、弹确认框。
    和落页一样，窗口可能是为它新建的，所以挂上时先取一次。**挂上时先报「关了」**：网页
    重新加载过的话，之前开着的那个对话框已经不在了，不报的话之后的链接一直进不来
  */
  const [importing, setImporting] = useState<ImportProposal | null>(null);
  useEffect(() => {
    const take = () =>
      invoke<ImportProposal | null>("take_import_link")
        .then((p) => {
          if (p) setImporting((cur) => cur ?? p);
        })
        .catch(() => {});
    void invoke("import_link_closed")
      .catch(() => {})
      .then(take);
    const un = subscribe("import-link", () => void take());
    return () => {
      un();
    };
  }, []);
  const closeImport = useCallback(() => {
    setImporting(null);
    void invoke("import_link_closed").catch(() => {});
  }, []);

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
      // `settings:listen`：设置页并滚到那一节（「监听设置未生效」）
      else if (page === "settings" && id) openRef.current("settings", { section: id });
      else openRef.current(page as Surface);
    };
    void invoke<string | null>("take_pending_view")
      .then(go)
      .catch(() => {});
    const un = subscribe<string>("open-view", (e) => {
      go(e.payload);
      void invoke("take_pending_view").catch(() => {});
    });
    // 连接那一层（切换器里的「管理连接…」）要落页时发的
    const local = (e: Event) => go((e as CustomEvent<string>).detail);
    window.addEventListener("tw-open-view", local);
    return () => {
      un();
      window.removeEventListener("tw-open-view", local);
    };
  }, []);

  /**
   * 全局快捷键。**在「正在输入」判断之前处理** —— ⌘F 的全部意义就是从任何地方跳到
   * 搜索框，在输入框里按它该重选。行内的方向键导航在流量页里（`TrafficPage`）。
   * 键位和界面上显示的键帽在 `palette/keys.tsx`，改一边要改另一边。
   *
   * · ⌘K 命令面板 · ⌘1…⌘9 按源列表的顺序换页（设置之外的前九页，`DIGIT_PAGES`）
   * · ⌘F 流量搜索 · ⌘, 设置 · ⌘R 刷新
   * · `?` 快捷键一览（在打字时不接管）
   * · ⌘⌥S 收起/展开源列表（访达、邮件、备忘录都是这个键；判 `code` 不判 `key`：
   *   ⌥ 会把 s 变成 ß）。**只在 macOS 上有**：Windows 上 Ctrl+Alt 常是 AltGr，
   *   Linux 上 Ctrl+Alt 加字母常被桌面拿去。那两边用 Ctrl+B（`SidebarProvider` 在听）。
   *
   * **开着编辑、确认这类对话框时不换页、不开面板**：对话框里可能是改了一半的表单，
   * 页面一换就没了（`modalOpen`；命令面板、快捷键一览、右侧的请求详情不算）。换页时
   * 顺手关掉面板和一览 —— 在面板里按 ⌘2、看着一览按 ⌘4 也是换页。
   *
   * Windows 上是 Ctrl 加同一个键；`preventDefault` 在那边更要紧：WebView2 自己会把
   * Ctrl+F 当成页内查找、Ctrl+R 当成刷新页面。所以对话框开着时键照样吞掉，只是不做事。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isMac && e.metaKey && e.altKey && !e.ctrlKey && e.code === "KeyS") {
        e.preventDefault();
        setRailOpen((v) => !v);
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.defaultPrevented || isTyping(e.target) || modalOpen()) return;
        e.preventDefault();
        setShortcuts(true);
        return;
      }
      if (!isMod(e) || e.altKey) return;
      const k = e.key.toLowerCase();
      const busy = modalOpen();
      const go = <S extends Surface>(s: S, params?: NavParams[S]) => {
        setPalette(false);
        setShortcuts(false);
        open(s, params);
      };
      if (k === "k" && !e.shiftKey) {
        e.preventDefault();
        if (busy) return;
        setShortcuts(false);
        setPalette((v) => !v);
        return;
      }
      if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
        const s = DIGIT_PAGES[Number(e.key) - 1];
        if (!s) return;
        e.preventDefault();
        if (!busy && (linked || s === "settings")) go(s);
        return;
      }
      if (k === "f") {
        e.preventDefault();
        if (!busy && linked) go("requests", { search: true });
        return;
      }
      if (k === ",") {
        e.preventDefault();
        if (!busy) go("settings");
        return;
      }
      if (k === "r") {
        e.preventDefault();
        refresh();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [linked, open, refresh]);

  /**
   * 本机 core 此刻怎么样。**引用不变**，设置页、源列表才不跟着外壳重画；`lang` 也在依赖里：
   * 句子是按当前语言取的，换了语言要重取
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const c = useMemo(() => describeCore(core), [core, lang]);
  /**
   * 安全模式、配置文件读不了。core 只起了控制面，配置是它临时顶上的空配置 —— 各页画出来
   * 的都不是用户的东西，所以内容区换成说明这件事的那一页（设置页除外，同未连接时）
   */
  const broken = linked && parseCoreState(core).kind === "safe_mode" ? (status?.config_rejected ?? null) : null;
  /** 出错页和配置被拒的横幅在的时候，问一下能不能一键修复。被拒的那一处、配置换了一份，重问 */
  const repair = useRepair(broken !== null || rejected !== null, `${broken?.at_ms}:${rejected?.at_ms}:${reloads}`);
  /** 连上过、又断了。**只在这时候挂那条横幅**。连着远程时断线另有一条（见下面） */
  const lost = linked && tries > 0 && !remote ? trouble(core, tries) : null;
  /**
   * 连着远程、连上过、现在断了。**不换成「未连接」整页**：已有的内容留着、置为只读，
   * 顶上一条横幅。连上后按现有的对账机制补齐。
   */
  const remoteLost = remote && linked && connLink !== null && connLink.kind !== "connected";
  const remoteAttempt =
    connLink?.kind === "down" ? connLink.attempt : connLink?.kind === "connecting" ? connLink.attempt : 0;

  // 几个浮层：开着才载入那一块，载入完当场画（载入的那一下什么都不画）
  const ConfigFileView = usePart(ConfigFileDialog, configFile !== null);
  const HistoryView = usePart(VersionHistoryDialog, historyOpen);
  const importReady = importing !== null && ov !== null && !remoteLost;
  const ImportView = usePart(ImportDialog, importReady);

  const openConfigFile = useCallback((focus: ConfigFocus | null) => setConfigFile({ focus }), []);
  const openHistory = useCallback(() => setHistoryOpen(true), []);
  /** 页面、提醒要落到别的页时用。`settings:listen`：设置页并滚到那一节 */
  const go = useCallback(
    (to: string) => {
      const [page, section] = to.split(":");
      if (page === "settings" && section) open("settings", { section });
      else open(to as Surface);
    },
    [open],
  );

  /** 命令面板里只有外壳做得了的几件事。**引用不变**：面板按它们建条目，变了就要重建 */
  const paletteShell = useMemo(
    () => ({
      toggleRail: () => setRailOpen((v) => !v),
      refresh,
      configFile: () => setConfigFile({ focus: null }),
      history: () => setHistoryOpen(true),
      notices: () => setNoticesAsked((n) => n + 1),
    }),
    [refresh],
  );

  return (
    <TooltipRoot>
      <NavContext.Provider value={navValue}>
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
          <SourceList
            tab={tab}
            onOpen={open}
            linked={linked}
            findings={alerts.length}
            core={c}
            addr={status?.gateway_addr ?? null}
            listenError={status?.listen_error ?? null}
          />

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
                    <Keys combo={COMBOS.rail} />
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
                当前在哪一页。**页名只写在这儿**，各页的页头从摘要开始（见 `PageHeader`）。
              */}
              <h1 className="min-w-0 truncate tw-head" style={{ color: "var(--chrome-text)" }} {...drag}>
                {t.surfaces[tab]}
              </h1>
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
                    <Button variant="ghost" size="sm" onClick={openHistory}>
                      {t.versionHistory}
                    </Button>
                  </>
                )}
                <Tip
                  side="bottom"
                  text={
                    <>
                      {pt.title}
                      <Keys combo={COMBOS.palette} />
                    </>
                  }
                >
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={pt.title}
                    onClick={() => setPalette(true)}
                    // 指上去就开始载入命令面板那一块，点下去时多半已经在了
                    onPointerEnter={() => void Palette.preload().catch(() => {})}
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
              <Banners
                rejected={rejected}
                broken={broken !== null}
                repair={repair}
                rotated={rotated}
                onCloseRotated={clearRotated}
                remoteLost={remoteLost}
                remoteName={profile ? profile.name : null}
                remoteAttempt={remoteAttempt}
                connecting={connLink?.kind === "connecting"}
                lost={lost}
                onRestartFailed={changed}
              />
              <Pages
                tab={tab}
                linked={linked}
                launching={launching}
                core={core}
                local={c}
                status={status}
                ov={ov}
                ovError={ovError}
                nudge={nudge}
                broken={broken}
                repair={repair}
                remoteLost={remoteLost}
                alerts={alerts}
                onSeenAlerts={clearAlerts}
                securityFocus={securityFocus}
                traffic={traffic}
                onLanded={onLanded}
                onChanged={changed}
                onRetry={changed}
                onOpenConfigFile={openConfigFile}
                onOpenHistory={openHistory}
              />
            </div>
          </div>

          {/* 浮层挂在最外层，不跟着右列滚动 */}
          {configFile && ConfigFileView && (
            <ConfigFileView
              reloads={reloads}
              focus={configFile.focus}
              rejectedLine={broken?.line ?? rejected?.line ?? null}
              onClose={() => setConfigFile(null)}
              onJump={(section) => {
                setConfigFile(null);
                // 监听、日志保留是设置页里的两节：直接滚到那一节
                if (section === "listen" || section === "retention") open("settings", { section });
                else open(surfaceOf(section));
              }}
            />
          )}
          {historyOpen && HistoryView && (
            <HistoryView
              reloads={reloads}
              onClose={() => setHistoryOpen(false)}
              onOpenPlugins={() => {
                setHistoryOpen(false);
                open("plugins");
              }}
            />
          )}
          {/* 等连上 core、拿到概览再弹：名称是否重名、保存基于哪一版都要它 */}
          {importReady && importing && ov && ImportView && (
            <ImportView
              proposal={importing}
              ov={ov}
              onClose={closeImport}
              onCreated={(name) => {
                closeImport();
                notify.success(textOf(importDialogText).created(name));
                changed();
                open("upstreams", { upstream: name });
              }}
            />
          )}
          {PaletteView && (
            <PaletteView
              open={palette}
              onOpenChange={setPalette}
              shortcuts={shortcuts}
              onShortcutsChange={setShortcuts}
              linked={linked}
              readOnly={remoteLost}
              remote={remote}
              ov={ov}
              railOpen={railOpen}
              shell={paletteShell}
            />
          )}
          {/*
            **所有出错都走这里**（`notify`）。吐司统一在右下角，谁触发的都一样；状态类的
            事走横幅，不走吐司。
          */}
          <Toaster position="bottom-right" closeButton />
        </SidebarProvider>
      </NavContext.Provider>
    </TooltipRoot>
  );
});
