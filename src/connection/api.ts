/**
 * 连接：连哪个 core。**列表和状态都来自 Rust 侧**（`src-tauri/src/connection/`），
 * 不经 core —— 远程连不上时这些照样要能显示、能操作。
 *
 * 密钥不在这里：添加、更换时从对话框递过去一次，之后再也拿不回来。
 */
import { invoke } from "@tauri-apps/api/core";

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
  /** 新建时必填；编辑时不填就沿用钥匙串里的那一把 */
  key: string | null;
}

export type Tested = { result: "ok"; info: ServerInfo } | { result: "failed"; error: ConnectError };

export type Invalid = {
  field: "name" | "host" | "port" | "key";
  reason: "empty" | "taken" | "invalid";
};

export type Saved = { result: "ok"; profile: Profile } | { result: "invalid"; invalid: Invalid };

/** 切换没做成：列表里已经没有这一条、钥匙串取不出密钥、试连没通过 */
export type SwitchError =
  | { kind: "unknown" }
  | { kind: "keychain"; detail: string }
  | { kind: "connect"; error: ConnectError };

/** 切过去之前要说的：这台机器上已接管、还指着本机网关的客户端 */
export interface Adopted {
  count: number;
  local_addr: string | null;
}

export const connApi = {
  view: () => invoke<ConnView>("connections"),
  setStartup: (startup: Startup) => invoke<ConnView>("set_connection_startup", { startup }),
  test: (input: ProfileInput) => invoke<Tested>("test_connection", { input }),
  save: (input: ProfileInput) => invoke<Saved>("save_connection", { input }),
  remove: (id: string) => invoke<ConnView>("delete_connection", { id }),
  preflight: () => invoke<Adopted>("switch_preflight"),
  switchTo: (id: string, retargetClients: boolean) =>
    invoke<ConnView>("switch_connection", { id, retargetClients }),
  retry: () => invoke<void>("retry_connection"),
  pick: (id: string, then: string | null) => invoke<void>("pick_connection", { id, then }),
};

/** 当前那一条 */
export function currentProfile(v: ConnView): Profile | undefined {
  return v.profiles.find((p) => p.id === v.current);
}
