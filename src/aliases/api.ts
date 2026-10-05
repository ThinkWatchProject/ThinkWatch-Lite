/**
 * 别名用到的控制面调用（ThinkWatch-Core#283 的 `/aliases` 那几个端点）。
 *
 * 和上游页一样**只是类型化的调用**：名称校验、谁能服务、改名时一起改掉的引用、
 * 建议哪几组，全在 core。
 *
 * 集成：core 发版、`src/generated/tw-api.ts` 重新生成之后 ——
 * · 六个端点名加进 `src/control.ts` 的 `WEBVIEW_ENDPOINTS` 和 `src-tauri/src/call.rs`
 *   的 `ALLOWED`；
 * · 下面的 `pending` 换成 `call`（`call("Aliases", null)` …），类型从 `@/types` 取，
 *   删掉 `api.provisional.ts`。
 */
import { invoke } from "@tauri-apps/api/core";
import type { ConfigWritten } from "@/types";
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

export const api = {
  /** 全部别名、各自由谁服务，以及同一模型不同名称的建议 */
  aliases: () => pending<AliasesView>("Aliases", null),
  createAlias: (save: AliasSave) => pending<ConfigWritten>("CreateAlias", save),
  /** 可以改名：密钥范围和规则里写着旧名的地方一起改，改了哪些在 `renamed_in` 里 */
  updateAlias: (name: string, save: AliasSave) => pending<AliasWritten>("UpdateAlias", save, name),
  deleteAlias: (name: string, baseVersion: string) =>
    pending<ConfigWritten>("DeleteAlias", { base_version: baseVersion }, name),
  previewAlias: (req: AliasPreviewRequest) => pending<AliasPreview>("PreviewAlias", req),
  /** 在用这个名称的地方：24 小时的请求、密钥的可见范围、规则 */
  aliasUsage: (name: string) => pending<AliasUsage>("AliasUsage", null, name),
};
