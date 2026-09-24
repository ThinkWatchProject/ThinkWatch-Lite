/**
 * 连接：连哪个 core。**列表和状态都来自 Rust 侧**（`src-tauri/src/connection/`），
 * 不经 core —— 远程连不上时这些照样要能显示、能操作。
 *
 * 密钥不在这里：添加、更换时从对话框递过去一次，之后再也拿不回来。
 */
import { invoke } from "@tauri-apps/api/core";
import type { Retargeted } from "@/types";

/** 本机那一条的 id */
export const LOCAL = "local";

export interface Profile {
  id: string;
  /** 本机那一条的名字由界面按语言写，不用这里的 */
  name: string;
  local: boolean;
  host: string | null;
  port: number | null;
  /** `host:port` */
  addr: string | null;
  last_connected_at: number | null;
}

export interface ServerInfo {
  core_version: string;
  /** 服务器的网关地址。客户端要连的是它 */
  gateway_addr: string | null;
}

/** 连不上的原因，按种类。文案见 `describe.ts` */
export type ConnectError =
  | { kind: "unreachable"; addr: string }
  | { kind: "closed"; addr: string }
  | { kind: "wrong_key" }
  | { kind: "version_mismatch"; ours: string; theirs: string }
  | { kind: "timeout"; addr: string }
  | { kind: "not_yet_available" };

export type LinkState =
  /** 连的是本机：状态看 `core-state` */
  | { kind: "local" }
  /** 还没开始连：连接选择开着 */
  | { kind: "waiting" }
  | { kind: "connecting"; attempt: number; ever: boolean }
  | { kind: "connected"; info: ServerInfo }
  | {
      kind: "down";
      error: ConnectError;
      attempt: number;
      at_ms: number;
      retry_in_ms: number;
      /** 这次运行里连上过它：运行中断线，不是启动时连不上 */
      ever: boolean;
    };

export type Startup = "last" | "local";

export interface ConnView {
  profiles: Profile[];
  current: string;
  last_used: string;
  startup: Startup;
  link: LinkState;
  /** 这一版应用配的 core 版本 */
  required_core: string;
  /** 本机的数据目录，`~/.thinkwatch` */
  data_dir: string;
}

export interface ProfileInput {
  id: string | null;
  name: string;
  host: string;
  port: number;
  /** 新建时必填；编辑时不填就沿用已经保存的那一把 */
  key: string | null;
}

export type Tested = { result: "ok"; info: ServerInfo } | { result: "failed"; error: ConnectError };

export type Invalid = {
  field: "name" | "host" | "port" | "key";
  reason: "empty" | "taken" | "invalid";
};

export type Saved = { result: "ok"; profile: Profile } | { result: "invalid"; invalid: Invalid };

/** 切换没做成：列表里已经没有这一条、保存的密钥读不出来、试连没通过 */
export type SwitchError =
  | { kind: "unknown" }
  | { kind: "key_unreadable"; detail: string }
  | { kind: "connect"; error: ConnectError };

/** 切过去之前要说的：这台机器上已接管、还指着本机网关的客户端 */
export interface Adopted {
  count: number;
  local_addr: string | null;
}

/** 切换做完了。勾了「同时将这些客户端改为指向…」的，带着改的结果 */
export interface Switched {
  view: ConnView;
  retargeted: Retargeted | null;
}

export const connApi = {
  view: () => invoke<ConnView>("connections"),
  setStartup: (startup: Startup) => invoke<ConnView>("set_connection_startup", { startup }),
  test: (input: ProfileInput) => invoke<Tested>("test_connection", { input }),
  save: (input: ProfileInput) => invoke<Saved>("save_connection", { input }),
  remove: (id: string) => invoke<ConnView>("delete_connection", { id }),
  preflight: () => invoke<Adopted>("switch_preflight"),
  switchTo: (id: string, retargetClients: boolean) =>
    invoke<Switched>("switch_connection", { id, retargetClients }),
  retry: () => invoke<void>("retry_connection"),
  pick: (id: string, then: string | null) => invoke<void>("pick_connection", { id, then }),
};

/** 当前那一条 */
export function currentProfile(v: ConnView): Profile | undefined {
  return v.profiles.find((p) => p.id === v.current);
}

/** 连着的远程 core：名字、这台机器够到它的地址、它的 core 版本（连上了才有） */
export interface RemoteCore {
  name: string;
  host: string;
  /** 控制端口那个地址，`host:port` */
  addr: string;
  core: string | null;
}

/** 连着的是远程时是它，连本机（或者还没读到连接列表）时是 null */
export function remoteOf(v: ConnView | null): RemoteCore | null {
  const p = v ? currentProfile(v) : undefined;
  if (!v || !p || p.local) return null;
  return {
    name: p.name,
    host: p.host ?? "",
    addr: p.addr ?? "",
    core: v.link.kind === "connected" ? v.link.info.core_version : null,
  };
}

/**
 * 客户端该连的服务器网关：**这台机器连服务器用的那个主机** + 服务器网关的端口。
 * 服务器报的监听地址可能是 `0.0.0.0:8788`，写给客户端是连不上的。和 Rust 侧
 * `clients::gateway_host` 同一个取法
 */
export function clientGateway(host: string, gatewayAddr: string | null): string | null {
  if (!gatewayAddr) return null;
  const port = gatewayAddr.slice(gatewayAddr.lastIndexOf(":") + 1);
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return h && port ? `${h}:${port}` : gatewayAddr;
}
