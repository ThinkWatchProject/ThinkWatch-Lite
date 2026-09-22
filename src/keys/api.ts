/**
 * 密钥页用到的控制面调用。
 *
 * **只是类型化的 invoke。**默认密钥能不能删、接管中的能不能删、改名要不要
 * 带着规则一起改、更换要同步给谁 —— 全在 core。界面多判断一次，就多一处
 * 和 core 说法不一致的可能。
 */
import { invoke } from "@tauri-apps/api/core";
import type { ClientView, ConfigWritten, CostGroup, KeyRotated, KeySave, KnownModel } from "@/types";


export const api = {
  listKeys: () => invoke<ClientView[]>("list_keys"),
  createKey: (save: KeySave) => invoke<ConfigWritten>("create_key", { save }),
  updateKey: (name: string, save: KeySave) => invoke<ConfigWritten>("update_key", { name, save }),
  deleteKey: (name: string, baseVersion: string) =>
    invoke<ConfigWritten>("delete_key", { name, baseVersion }),
  /** 换一把新的。core 会把新值同步给正在用它的客户端 */
  rotateKey: (name: string, baseVersion: string) =>
    invoke<KeyRotated>("rotate_key", { name, baseVersion }),
  setDefaultKey: (name: string, baseVersion: string) =>
    invoke<ConfigWritten>("set_default_key", { name, baseVersion }),
  /** 明文留在 Rust 侧：界面拿不到一个往剪贴板里写任意内容的口子 */
  copyKey: (name: string) => invoke<void>("copy_key", { name }),
  gatewayBase: () => invoke<string>("gateway_base"),
  copyGatewayBase: () => invoke<void>("copy_gateway_base"),
  /** 每把密钥这段时间发了多少请求 */
  keyUsage: (sinceMs: number) => invoke<CostGroup[]>("key_usage", { sinceMs }),
  /** 网关聚合出来的模型目录。可见模型那一栏和选择器都按它算 */
  knownModels: () => invoke<KnownModel[]>("known_models"),
};
