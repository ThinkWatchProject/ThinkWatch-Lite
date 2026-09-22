/**
 * 客户端页用到的命令。**只是类型化的 invoke** —— 能不能接管、写哪几项、
 * 用哪把密钥，都由 core 判断。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AdoptResponse,
  ClientKey,
  ClientsResponse,
  ClientView,
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
  planAdopt: (client: string) => invoke<PlanView>("plan_adopt", { client }),
  planRestore: (client: string) => invoke<PlanView>("plan_restore", { client }),
  adopt: (client: string) => invoke<AdoptResponse>("adopt_client", { client }),
  restore: (client: string) => invoke<AdoptResponse>("restore_client", { client }),
  restoreAll: () => invoke<RestoreOutcome[]>("restore_all"),
  diagnose: (client: string) => invoke<FindingView[]>("diagnose_client", { client }),
  /** 为这个客户端准备它的专用密钥：为它留着的，没有就新建一把绑给它 */
  prepareKey: (id: string) => invoke<ClientKey>("prepare_client_key", { id }),
  /** 地址由 Rust 侧去问 core 再写进剪贴板，界面只说是哪个客户端 */
  copyEndpoint: (id: string) => invoke<void>("copy_client_endpoint", { id }),
  copyKey: (name: string) => invoke<void>("copy_key", { name }),
  reveal: (id: string) => invoke<void>("reveal_client_config", { id }),
  keys: () => invoke<ClientView[]>("list_keys"),
  /** 每把密钥这段时间发了多少请求。客户端的用量按它的密钥算 */
  keyUsage: (sinceMs: number) => invoke<CostGroup[]>("key_usage", { sinceMs }),
};
