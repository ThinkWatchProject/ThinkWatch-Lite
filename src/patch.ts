import { call } from "./control";
import type { PatchOp } from "./types";

/**
 * 改配置。**所有改配置的地方都走这里。**
 *
 * 以前直接调 `invoke("patch_config", { ops })`，而 `invoke` 的参数类型是
 * `Record<string, unknown>` —— `ops` 里写什么都能编译过去。`Guard.tsx` 里
 * 有一处写的是 `op: "set"`,协议里根本没有这个操作,于是防护模式那三个
 * 按钮**从第一天起就没有一次生效过**:每次点都被后端拒掉,而拒绝的话
 * 挂在页面角落里，很容易当成没反应。
 *
 * 现在 `call` 按生成的类型检查请求，这一层留着是为了让改配置只有一个入口。
 */
export function patchConfig(ops: PatchOp[], baseVersion: string) {
  return call("PatchConfig", { ops, base_version: baseVersion });
}
