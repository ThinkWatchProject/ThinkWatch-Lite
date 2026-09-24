/**
 * 客户端页用到的命令。**只是类型化的 invoke** —— 能不能接管、写哪几项、
 * 用哪把密钥，都由 core 判断。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type { CostGroup } from "@/types";

export interface RestoreOutcome {
  client: string;
  ok: boolean;
  detail: string;
}

export const api = {
  list: () => call("Clients", null),
  planAdopt: (client: string) => call("PlanAdopt", { client, key_name: null }),
  planRestore: (client: string) => call("PlanRestore", null, client),
  adopt: (client: string) => call("Adopt", { client, key_name: null }),
  restore: (client: string) => call("Restore", null, client),
  restoreAll: () => invoke<RestoreOutcome[]>("restore_all"),
  diagnose: (client: string) => call("Why", null, client),
  /** 为这个客户端准备它的专用密钥：为它留着的，没有就新建一把绑给它 */
  prepareKey: (id: string) => call("ClientKey", null, id),
  /** 地址由 Rust 侧去问 core 再写进剪贴板，界面只说是哪个客户端 */
  copyEndpoint: (id: string) => invoke<void>("copy_client_endpoint", { id }),
  copyKey: (name: string) => invoke<void>("copy_key", { name }),
  reveal: (id: string) => invoke<void>("reveal_client_config", { id }),
  keys: () => call("Keys", null),
  /** 每把密钥这段时间发了多少请求。客户端的用量按它的密钥算 */
  keyUsage: (sinceMs: number) => invoke<CostGroup[]>("key_usage", { sinceMs }),
};
