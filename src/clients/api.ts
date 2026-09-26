/**
 * 客户端页用到的命令。**只是类型化的 invoke**，而且只递 id —— 能不能接管、
 * 写哪几项、用哪把密钥，都由 Rust 那一侧判断（`src-tauri/src/clients/`）。
 *
 * 接管改的是这台机器上别的软件的配置，在应用里做，不经过 core；要问 core 的
 * 只有网关地址和密钥，那也是 Rust 那一侧去问。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AdoptResponse,
  ClientsResponse,
  FindingView,
  Msg,
  PlanView,
  Retargeted,
  WslConfigKept,
  WslConfigPlan,
  WslResponse,
} from "@/types";

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
  /**
   * 连着远程时：还指着本机网关的，改为指向此刻连着的 core。`env` 和别的命令一样：
   * 只改这个 WSL 发行版里的；不带是这台电脑上的
   */
  retarget: (env?: string) => invoke<Retargeted>("retarget_clients", { env }),
  diagnose: (id: string, env?: string) => invoke<FindingView[]>("diagnose_client", { id, env }),
  /** 为这个客户端准备它的专用密钥：为它留着的，没有就新建一把绑给它。交回的是名字 */
  prepareKey: (id: string, env?: string) => invoke<string>("prepare_client_key", { id, env }),
  /** 地址由 Rust 侧去问 core 再写进剪贴板，界面只说是哪个客户端 */
  copyEndpoint: (id: string, env?: string) => invoke<void>("copy_client_endpoint", { id, env }),
  copyKey: (name: string) => invoke<void>("copy_key", { name }),
  /** 把 WSL 2 改成 mirrored 网络：`.wslconfig` 的改动，确认之前不写 */
  planMirrored: () => invoke<WslConfigPlan>("plan_wsl_mirrored"),
  /** 落盘上面那一份（全文备份之后）。交回不至于失败、但该说一声的事 */
  setMirrored: () => invoke<Msg[]>("set_wsl_mirrored"),
  /** `wsl --shutdown`：所有正在运行的发行版都会停下 */
  shutdownWsl: () => invoke<void>("shutdown_wsl"),
  /** 卸载不改回的 `.wslconfig`（是在这里改成 mirrored 的）。没改过就是 null */
  wslconfigKept: () => invoke<WslConfigKept | null>("wslconfig_kept"),
  reveal: (id: string, env?: string) => invoke<void>("reveal_client_config", { id, env }),
  /**
   * 这台电脑上的一个客户端读哪个配置文件。`null` 是回到默认位置；核对不过（接管着、
   * 不是完整路径、文件夹不在、后缀不对）时报的是那一句
   */
  setPath: (id: string, path: string | null) => invoke<void>("set_client_path", { id, path }),
};
