/**
 * 客户端页用到的命令。**只是类型化的 invoke**，而且只递 id —— 能不能接管、
 * 写哪几项、用哪把密钥，都由 Rust 那一侧判断（`src-tauri/src/clients/`）。
 *
 * 接管改的是这台机器上别的软件的配置，在应用里做，不经过 core；要问 core 的
 * 只有网关地址和密钥，那也是 Rust 那一侧去问。
 */
import { invoke } from "@tauri-apps/api/core";
import type { AdoptResponse, ClientsResponse, FindingView, PlanView, Retargeted, WslResponse } from "@/types";

export interface RestoreOutcome {
  client: string;
  ok: boolean;
  detail: string;
}

/**
 * 对一个客户端的命令都带着 `env`：它在哪个 WSL 发行版里（发行版的名字）；这台电脑上
 * 的不带。同一个客户端在两处是两份配置、两把密钥。
 */
export const api = {
  list: () => invoke<ClientsResponse>("list_clients"),
  /** WSL 里的那几组。**读 WSL 会唤醒发行版**，所以不跟着请求刷新 */
  wsl: () => invoke<WslResponse>("list_wsl"),
  planAdopt: (id: string, env?: string) => invoke<PlanView>("plan_adopt", { id, env }),
  planRestore: (id: string, env?: string) => invoke<PlanView>("plan_restore", { id, env }),
  adopt: (id: string, env?: string) => invoke<AdoptResponse>("adopt_client", { id, env }),
  restore: (id: string, env?: string) => invoke<AdoptResponse>("restore_client", { id, env }),
  restoreAll: () => invoke<RestoreOutcome[]>("restore_all"),
  /** 连着远程时：还指着本机网关的，改为指向此刻连着的 core */
  retarget: () => invoke<Retargeted>("retarget_clients"),
  /** 一个 WSL 发行版里还指着旧地址的，改为指向此刻该连的那一个 */
  retargetWsl: (env: string) => invoke<Retargeted>("retarget_wsl", { env }),
  diagnose: (id: string, env?: string) => invoke<FindingView[]>("diagnose_client", { id, env }),
  /** 为这个客户端准备它的专用密钥：为它留着的，没有就新建一把绑给它。交回的是名字 */
  prepareKey: (id: string, env?: string) => invoke<string>("prepare_client_key", { id, env }),
  /** 地址由 Rust 侧去问 core 再写进剪贴板，界面只说是哪个客户端 */
  copyEndpoint: (id: string, env?: string) => invoke<void>("copy_client_endpoint", { id, env }),
  copyKey: (name: string) => invoke<void>("copy_key", { name }),
  /** 放行 WSL 的那条防火墙命令，由 Rust 侧拼好写进剪贴板 */
  copyFirewall: () => invoke<void>("copy_wsl_firewall"),
  reveal: (id: string, env?: string) => invoke<void>("reveal_client_config", { id, env }),
};
