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
 * 打开一页时能带的参数（深链）。**只放「打开时定位到哪儿」**，不放页面的状态：
 *
 * · `requests`：带着筛选条件打开流量（`filter` 覆盖在空条件上，不和现有的叠加）、
 *   打开某一条请求的详情、聚焦搜索框。
 * · `keys`：定位并高亮某把密钥。
 * · `security`：日志定位到某个时间段。
 * · `upstreams`：定位某个上游（页面接上之前忽略）。
 *
 * 加新的深链：在这里加字段，在目标页用 `useNavParams` 读。
 */
export interface NavParams {
  dashboard: undefined;
  requests: { filter?: Partial<Filter>; grouped?: boolean; request?: number; search?: boolean };
  clients: undefined;
  keys: { key?: string };
  upstreams: { upstream?: string };
  routing: undefined;
  security: { focus?: LogFocus };
  mcp: undefined;
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
