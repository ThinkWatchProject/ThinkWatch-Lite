/**
 * 客户端页用到的命令。**只是类型化的 invoke**，而且只递 id —— 能不能接管、
 * 写哪几项、用哪把密钥，都由 Rust 那一侧判断（`src-tauri/src/clients/`）。
 *
 * 接管改的是这台机器上别的软件的配置，在应用里做，不经过 core；要问 core 的
 * 只有网关地址和密钥，那也是 Rust 那一侧去问。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type {
  AdoptResponse,
  ClientsResponse,
  CostGroup,
  FindingView,
  PlanView,
} from "@/types";

export interface RestoreOutcome {
  client: string;
  ok: boolean;
  detail: string;
}

export const api = {
  list: () => invoke<ClientsResponse>("list_clients"),
  planAdopt: (id: string) => invoke<PlanView>("plan_adopt", { id }),
  planRestore: (id: string) => invoke<PlanView>("plan_restore", { id }),
  adopt: (id: string) => invoke<AdoptResponse>("adopt_client", { id }),
  restore: (id: string) => invoke<AdoptResponse>("restore_client", { id }),
  restoreAll: () => invoke<RestoreOutcome[]>("restore_all"),
  diagnose: (id: string) => invoke<FindingView[]>("diagnose_client", { id }),
  /** 为这个客户端准备它的专用密钥：为它留着的，没有就新建一把绑给它。交回的是名字 */
  prepareKey: (id: string) => invoke<string>("prepare_client_key", { id }),
  /** 地址由 Rust 侧去问 core 再写进剪贴板，界面只说是哪个客户端 */
  copyEndpoint: (id: string) => invoke<void>("copy_client_endpoint", { id }),
  copyKey: (name: string) => invoke<void>("copy_key", { name }),
  reveal: (id: string) => invoke<void>("reveal_client_config", { id }),
  keys: () => call("Keys", null),
  /** 每把密钥这段时间发了多少请求。客户端的用量按它的密钥算 */
  keyUsage: (sinceMs: number) => invoke<CostGroup[]>("key_usage", { sinceMs }),
};
