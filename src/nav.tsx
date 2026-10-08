import { createContext, useContext, useEffect, useRef } from "react";
import type { Filter } from "./requestTable";
import type { BedrockDraft } from "./types";
import type { LogFocus } from "./security/SecurityPage";

/**
 * 主窗口的几个面，按源列表从上到下的顺序。**⌘1…⌘9 也按这个顺序**（见 App.tsx）：
 * 前九页各占一个数字，排在最后的设置是 ⌘,（macOS 的惯例），不占数字。
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
  "plugins",
  "settings",
] as const;

export type Surface = (typeof SURFACES)[number];

/**
 * 打开一页时能带的参数（深链）。**只放「打开时定位到哪儿、打开哪个对话框」**，不放
 * 页面的状态：
 *
 * · `requests`：带着筛选条件打开流量（`filter` 覆盖在空条件上，不和现有的叠加）、
 *   打开某一条请求的详情、聚焦搜索框。
 * · `keys`：定位并高亮某把密钥（`key`）。
 * · `security`：日志定位到某个时间段。
 * · `upstreams`：定位某个上游（`upstream`，页面接上之前忽略）。
 * · `settings`：滚到某一节（`section`，设置页自己认；命令面板送的见 palette/sections.ts）。
 * · `plugins`：定位某个插件（`plugin`）。
 *
 * **打开对话框**（命令面板、别的页上的入口用）：页面收到就打开它自己的那个对话框，
 * 和点页面上的按钮、点那一行一模一样 —— 对话框只有一份，在页面里。
 *
 * · `edit` / `editRoute` / `editGroup` / `detail`：打开这一项的编辑或详情（点那一行）。
 * · `create`：新建。`upstreams` 的新建分上游、代理、价目表；新建上游可以带一份 `draft`
 *   预填（接管确认框里的「新建 Bedrock 上游」）。
 * · `upstreams.test`：推理测速、链路测速；`routing.dryRun`：试算。
 * · `clients.setup`：手动配置（未安装的、不能接管的客户端，点那一行就是它）。
 * · `plugins.add`：添加插件；`plugins.review`：审核这个插件变了的文件。
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
    /** 新建上游时按它预填：客户端原来直连 Bedrock 时的设置（接管确认框里带过来的） */
    draft?: BedrockDraft;
    test?: "speed" | "link";
  };
  routing: { editRoute?: string; editGroup?: string; create?: "route" | "group"; dryRun?: boolean };
  security: { focus?: LogFocus };
  mcp: undefined;
  plugins: { plugin?: string; add?: boolean; review?: string };
  settings: { section?: string };
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
