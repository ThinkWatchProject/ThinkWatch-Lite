/**
 * 密钥页用到的调用。
 *
 * **只是类型化的调用。**默认密钥能不能删、改名要不要带着规则一起改在 core；
 * 接管中的能不能删、更换要同步给谁在 Rust 那一侧（它看得见这台机器上的客户端）。
 * 界面多判断一次，就多一处和它们说法不一致的可能。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type { ClientsResponse, ConfigWritten, KeyRotation, KeySave, KeyUsage } from "@/types";

export const api = {
  listKeys: () => call("Keys", null),
  createKey: (save: KeySave) => call("CreateKey", save),
  updateKey: (name: string, save: KeySave) => call("UpdateKey", save, name),
  /** 接管着的客户端的配置里写着这把的，先不删（Rust 那一侧看得见） */
  deleteKey: (name: string, baseVersion: string) => invoke<ConfigWritten>("delete_key", { name, baseVersion }),
  /** 换一把新的，新值同步进这台机器上正在用它的客户端 */
  rotateKey: (name: string, baseVersion: string) => invoke<KeyRotation>("rotate_key", { name, baseVersion }),
  setDefaultKey: (name: string, baseVersion: string) => call("SetDefaultKey", { name, base_version: baseVersion }),
  /** 明文留在 Rust 侧：界面拿不到一个往剪贴板里写任意内容的口子 */
  copyKey: (name: string) => invoke<void>("copy_key", { name }),
  gatewayBase: () => invoke<string>("gateway_base"),
  /** 这台机器上的客户端：哪把密钥是谁的、谁接管着 */
  clients: () => invoke<ClientsResponse>("list_clients"),
  copyGatewayBase: () => invoke<void>("copy_gateway_base"),
  /** 每把密钥这段时间的用量：合计，加按 `bucketMs` 分格的走势 */
  keyUsage: (sinceMs: number, bucketMs: number) => invoke<KeyUsage>("key_usage", { sinceMs, bucketMs }),
  /** 网关聚合出来的模型目录。可见模型那一栏和选择器都按它算 */
  knownModels: () => call("KnownModels", null),
};
