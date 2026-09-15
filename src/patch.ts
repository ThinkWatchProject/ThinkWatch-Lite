import { invoke } from "@tauri-apps/api/core";
import type { PatchOp } from "./types";

/**
 * 改配置。**所有改配置的地方都走这里。**
 *
 * 直接调 `invoke("patch_config", { ops })` 的问题是 `invoke` 的参数类型是
 * `Record<string, unknown>` —— `ops` 里写什么都能编译过去。`Guard.tsx` 里
 * 有一处写的是 `op: "set"`,协议里根本没有这个操作,于是防护模式那三个
 * 按钮**从第一天起就没有一次生效过**:每次点都被后端拒掉,而拒绝的话
 * 挂在页面角落里，很容易当成没反应。
 *
 * 这个函数唯一的作用就是让 `PatchOp[]` 这个类型真的被检查一次。
 */
export function patchConfig(ops: PatchOp[], baseVersion: string) {
  return invoke<{ version: string }>("patch_config", { ops, baseVersion });
}
