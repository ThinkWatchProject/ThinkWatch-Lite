/**
 * 别名用到的调用：控制面的 `/aliases` 那几个端点，加上名称提示（Rust 这边的命令）。
 *
 * 和上游页一样**只是类型化的调用**：名称校验、谁能服务、改名时一起改掉的引用、
 * 建议哪几组，全在 core。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type { AliasHint, AliasPreviewRequest, AliasSave } from "@/types";

export const api = {
  /** 全部别名、各自由谁服务，以及同一模型不同名称的建议 */
  aliases: () => call("Aliases", null),
  createAlias: (save: AliasSave) => call("CreateAlias", save),
  /** 可以改名：密钥范围和规则里写着旧名的地方一起改，改了哪些在 `renamed_in` 里 */
  updateAlias: (name: string, save: AliasSave) => call("UpdateAlias", save, name),
  deleteAlias: (name: string, baseVersion: string) =>
    call("DeleteAlias", { base_version: baseVersion }, name),
  previewAlias: (req: AliasPreviewRequest) => call("PreviewAlias", req),
  /** 在用这个名称的地方：24 小时的请求、密钥的可见范围、规则 */
  aliasUsage: (name: string) => call("AliasUsage", null, name),
  /** 打开对话框那一刻的配置版本：保存时带它 */
  configVersion: async () => (await call("GetConfig", null)).version,
  /** 名称提示：这台机器上检测到的客户端会怎么对待这个名称 */
  hints: (name: string, models: string[]) => invoke<AliasHint[]>("alias_hints", { name, models }),
};
