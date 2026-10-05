/**
 * 新建、编辑别名的对话框用到的调用。
 *
 * 控制面那几个（ThinkWatch-Core#283 的 `/aliases`）**还不在白名单里**：core 发版、
 * `src/generated/tw-api.ts` 重新生成之后，端点名加进 `src/control.ts` 的 `WEBVIEW_ENDPOINTS`
 * 和 `src-tauri/src/call.rs` 的 `ALLOWED`，`pending` 换成 `call`，并进 `./api.ts`。
 *
 * 名称提示（`alias_hints`）是 Rust 这边的命令：说的是这台机器上的客户端。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type { AliasHint, ConfigWritten } from "@/types";
import type {
  AliasPreview,
  AliasPreviewRequest,
  AliasSave,
  AliasUsage,
  AliasWritten,
  AliasesView,
} from "./api.provisional";

/** 端点进白名单之前的调用：和 `call` 走同一个命令，只是类型手写 */
function pending<T>(endpoint: string, req: unknown, ...params: string[]): Promise<T> {
  return invoke<T>("call", { endpoint, params, req });
}

export const dialogApi = {
  /** 编辑时读出这个别名现在列着的模型 */
  aliases: () => pending<AliasesView>("Aliases", null),
  createAlias: (save: AliasSave) => pending<ConfigWritten>("CreateAlias", save),
  /** 可以改名：密钥范围和规则里写着旧名的地方一起改，改了哪些在 `renamed_in` 里 */
  updateAlias: (name: string, save: AliasSave) => pending<AliasWritten>("UpdateAlias", save, name),
  previewAlias: (req: AliasPreviewRequest) => pending<AliasPreview>("PreviewAlias", req),
  /** 在用这个名称的地方。改名前列出会一起改的引用 */
  aliasUsage: (name: string) => pending<AliasUsage>("AliasUsage", null, name),
  /** 打开对话框那一刻的配置版本：保存时带它 */
  configVersion: async () => (await call("GetConfig", null)).version,
  /** 名称提示：这台机器上检测到的客户端会怎么对待这个名称 */
  hints: (name: string, models: string[]) => invoke<AliasHint[]>("alias_hints", { name, models }),
};
