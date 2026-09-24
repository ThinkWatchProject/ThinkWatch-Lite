import { createContext, useContext, useEffect, useRef } from "react";
import type { Filter } from "./requestTable";
import type { LogFocus } from "./security/SecurityPage";

/**
 * 主窗口的几个面，按源列表从上到下的顺序。**⌘1…⌘9 也按这个顺序**（见 App.tsx）。
 */
export const SURFACES = [
  "dashboard",
  "requests",
  "clients",
  "keys",
  "upstreams",
  "routing",
  "security",
  "mcp",
  "settings",
] as const;

export type Surface = (typeof SURFACES)[number];

/**
 * 设置页的各节。`nav.open("settings", { section })` 打开设置并滚到那一节（外壳做，
 * 见 `revealSection`）。节上标 `data-section="<id>"`；没标的按标题的字找。
 */
export type SettingsSection =
  | "connections"
  | "language"
  | "appearance"
  | "menubar"
  | "autostart"
  | "listen"
  | "retention"
  | "updates"
  | "notices"
  | "about"
  | "diagnostics"
  | "uninstall";

/**
 * 打开一页时能带的参数（深链）。**只放「打开时定位到哪儿、打开哪个对话框」**，不放
 * 页面的状态：
 *
 * · `requests`：带着筛选条件打开流量（`filter` 覆盖在空条件上，不和现有的叠加）、
 *   打开某一条请求的详情、聚焦搜索框。
 * · `keys`：定位并高亮某把密钥（`key`）。
 * · `security`：日志定位到某个时间段。
 * · `upstreams`：定位某个上游（`upstream`，页面接上之前忽略）。
 * · `settings`：滚到某一节。
 *
 * **打开对话框**（命令面板、别的页上的入口用）：页面收到就打开它自己的那个对话框，
 * 和点页面上的按钮、点那一行一模一样 —— 对话框只有一份，在页面里。
 *
 * · `edit` / `editRoute` / `editGroup` / `detail`：打开这一项的编辑或详情（点那一行）。
 * · `create`：新建。`upstreams` 的新建分上游、代理、价目表。
 * · `upstreams.test`：推理测速、链路测速；`routing.dryRun`：试算。
 * · `clients.setup`：手动配置（未安装的、不能接管的客户端，点那一行就是它）。
 *
 * 加新的深链：在这里加字段，在目标页用 `useNavParams` 读。
 */
export interface NavParams {
  dashboard: undefined;
  requests: { filter?: Partial<Filter>; grouped?: boolean; request?: number; search?: boolean };
  clients: { detail?: string; setup?: string };
  keys: { key?: string; edit?: string; create?: boolean };
  upstreams: {
    upstream?: string;
    edit?: string;
    create?: "upstream" | "proxy" | "sheet";
    test?: "speed" | "link";
  };
  routing: { editRoute?: string; editGroup?: string; create?: "route" | "group"; dryRun?: boolean };
  security: { focus?: LogFocus };
  mcp: undefined;
  settings: { section?: SettingsSection };
}

export interface Nav {
  /** 现在在哪一页 */
  surface: Surface;
  /** 打开一页，可带参数。已经在那一页也会再送一次参数（比如再次定位） */
  open: <S extends Surface>(surface: S, params?: NavParams[S]) => void;
}

/** 外壳放进来的一次深链。`seq` 每次打开都加一，同样的参数再送一次也认得出 */
export interface NavDelivery {
  surface: Surface;
  params: unknown;
  seq: number;
}

export const NavContext = createContext<{ nav: Nav; delivery: NavDelivery | null } | null>(null);

/**
 * 在任何一页里跳到另一页：
 *
 *   const nav = useNav();
 *   nav.open("requests", { filter: { client: key.name } });
 *   nav.open("keys", { key: "claude-code" });
 */
export function useNav(): Nav {
  const c = useContext(NavContext);
  if (!c) throw new Error("useNav must be used inside the app shell");
  return c.nav;
}

/**
 * 读送到这一页的深链参数。**每次送达只回调一次**（挂上时正好有一份也算）：
 *
 *   useNavParams("keys", (p) => setHighlight(p.key ?? null));
 */
export function useNavParams<S extends Surface>(surface: S, onParams: (params: NonNullable<NavParams[S]>) => void) {
  const c = useContext(NavContext);
  const cb = useRef(onParams);
  cb.current = onParams;
  const seen = useRef(-1);
  const d = c?.delivery;
  useEffect(() => {
    if (!d || d.surface !== surface || d.seq === seen.current || d.params === undefined) return;
    seen.current = d.seq;
    cb.current(d.params as NonNullable<NavParams[S]>);
  }, [d, surface]);
}

/**
 * 滚到页面里的一节（`nav.open("settings", { section })` 用，外壳在换页时调）。
 *
 * 先找 `[data-section="<id>"]`，没有就找字是 `title` 的标题（`h1`–`h3`）。**节是
 * 陆续画出来的**（语言、外观要先读到当前值），所以等它出现，最多 1.5 秒；它上面
 * 的节后画出来会把它往下挤，所以出现之后再跟 0.6 秒。用户自己滚了、点了、按了键，
 * 就不再跟。找不到就什么都不做 —— 停在那一页的顶上。
 */
export function revealSection(id: string, title?: string) {
  if (typeof document === "undefined") return;
  let stop = false;
  const cancel = () => {
    stop = true;
    for (const ev of STOP_EVENTS) window.removeEventListener(ev, cancel, true);
  };
  for (const ev of STOP_EVENTS) window.addEventListener(ev, cancel, { capture: true, passive: true });

  const find = (): HTMLElement | null => {
    const tagged = document.querySelector<HTMLElement>(`[data-section="${CSS.escape(id)}"]`);
    if (tagged) return tagged;
    if (!title) return null;
    for (const h of document.querySelectorAll<HTMLElement>("h1, h2, h3")) {
      if (h.textContent?.trim() === title) return h.closest<HTMLElement>("section") ?? h;
    }
    return null;
  };
  const behavior: ScrollBehavior = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  /** 离滚动层顶边留一点，标题不贴着工具栏 */
  const MARGIN = 16;
  /** 上一次要滚到哪儿。平滑滚动走在半路时 `scrollTop` 不是终点，拿它比会来回拉扯 */
  let target: number | null = null;
  const align = (el: HTMLElement) => {
    const box = scrollParent(el);
    if (!box) return;
    const top = Math.max(
      0,
      Math.min(
        box.scrollHeight - box.clientHeight,
        el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - MARGIN,
      ),
    );
    if (target !== null && Math.abs(top - target) <= 2) return;
    target = top;
    box.scrollTo({ top, behavior });
  };

  const start = performance.now();
  let found = 0;
  const tick = () => {
    if (stop) return;
    const now = performance.now();
    const el = find();
    if (el) {
      if (found === 0) found = now;
      align(el);
    }
    const done = found > 0 ? now - found > 600 : now - start > 1500;
    if (done) cancel();
    else setTimeout(() => requestAnimationFrame(tick), found > 0 ? 120 : 16);
  };
  requestAnimationFrame(tick);
}

const STOP_EVENTS = ["wheel", "pointerdown", "keydown", "touchmove"] as const;

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}
