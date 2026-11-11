/**
 * 这台机器上的客户端（`list_clients`）。客户端页和密钥页挂的是同一份缓存。
 */
import { useEffect, useRef } from "react";
import { useResource, type Resource } from "@/lib/resource";
import type { ClientsResponse, CoreEvent, LocalEvent, WslResponse } from "@/types";
import { isWindows } from "@/platform";
import { api } from "./api";

type Kind = CoreEvent["kind"] | LocalEvent["kind"];

/**
 * 客户端页要跟上的：客户端的配置文件被改了（这台机器上的文件监视说的）、请求落地了
 * （「使用中」等的就是它）、配置换了一版（密钥）。
 */
const PAGE_EVENTS: Kind[] = ["clients_changed", "request_finished", "request_failed", "request_cancelled", "config_reloaded"];

/** 别的页只关心谁接管着、哪把密钥是谁的 */
const OWNER_EVENTS: Kind[] = ["clients_changed", "config_reloaded"];

export function useClients({ live = false }: { live?: boolean } = {}): Resource<ClientsResponse> {
  return useResource("clients", api.list, {
    events: live ? PAGE_EVENTS : OWNER_EVENTS,
    throttleMs: live ? 3_000 : undefined,
  });
}

/**
 * WSL 里的那几组（`list_wsl`）。打开页面时读取，随后只轮询运行中的发行版。
 * 后台检查不为探测启动发行版，不跟随每个请求刷新。
 */
export function useWsl(): Resource<WslResponse> {
  const loaded = useRef(false);
  const r = useResource(isWindows ? "clients:wsl" : null, async () => {
    const result = await api.wsl(loaded.current);
    loaded.current = true;
    return result;
  }, { events: ["config_reloaded", "listen_changed"], throttleMs: 3_000 });
  useEffect(() => {
    if (!isWindows) return;
    // Poll only while visible; the backend skips stopped distributions before opening UNC paths.
    const check = () => { if (document.visibilityState === "visible") void r.reload(); };
    const timer = window.setInterval(check, 15_000);
    window.addEventListener("focus", check);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", check); };
  }, [r.reload]);
  return r;
}
