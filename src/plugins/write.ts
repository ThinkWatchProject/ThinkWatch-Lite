/**
 * 插件的写入：装、存（代码和开关）、批准磁盘上改过的文件。
 *
 * **只有一种情形要在系统的确认框里点头**（约定附录 4 §3）：插件改得了回答里的工具调用
 * （原来的或者新的代码里），而这次要装上它、打开它、改它的代码，或者批准它磁盘上改过的
 * 文件。别的写入（只改了出错时、范围、设置的值，停用，不碰工具调用的插件）都不问。
 *
 * 要点头的那几个端点**不在网页的白名单里**（`src/control.ts`）：网页只能请 Rust 去做
 * （`plugin_install_confirmed` 等），Rust 自己把代码再读一遍、在系统的确认框里写明它是谁、
 * 能做什么，点了头才写。用户在那个框里点了取消不是失败：回执是 `cancelled`，界面照原样。
 *
 * 走哪条路：**界面按手上已有的权限先判断**，确定要点头的直接请 Rust；判断不了的照常走网页
 * 那条，core 说要点头（403 `control.plugin.needs_confirmation`）再请 Rust —— 同一份改动，
 * 用户不必再按一次。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import { textOf } from "@/i18n";
import type {
  ManifestView,
  PluginApproveRequest,
  PluginInstallRequest,
  PluginSaveRequest,
  PluginView,
  PluginWrite,
} from "@/types";
import { holdsToolCalls, saveAsks } from "./model";
import { writeText } from "./write.i18n";

/**
 * 一次写入，排进插件页的写入队列（见 `PluginsPage`）：`run` 拿到轮到它时的版本号。`done` 是
 * 写成了，`cancelled` 是用户在系统的确认框里点了取消 —— 什么都没写，不是失败
 */
export type NativeWrite = (run: (base: string) => Promise<PluginWrite>) => Promise<"done" | "cancelled">;

/** core 说这次要在系统的确认框里点头 */
const NEEDS_CONFIRMATION = "control.plugin.needs_confirmation";

export function needsConfirmation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === NEEDS_CONFIRMATION;
}

/** Rust 的三个命令：再读一遍、弹系统的确认框、点了头才发 `…Confirmed` */
const confirmed = {
  install: (req: PluginInstallRequest) => invoke<PluginWrite>("plugin_install_confirmed", { req }),
  save: (req: PluginSaveRequest) => invoke<PluginWrite>("plugin_save_confirmed", { req }),
  approve: (req: PluginApproveRequest) => invoke<PluginWrite>("plugin_approve_confirmed", { req }),
};

/** 先走网页那条；core 说要点头就请 Rust 走一遍同一份改动 */
async function plainThenNative(
  plain: () => Promise<{ version: string }>,
  native: () => Promise<PluginWrite>,
): Promise<PluginWrite> {
  try {
    const w = await plain();
    return { kind: "done", version: w.version };
  } catch (e) {
    if (needsConfirmation(e)) return native();
    throw e;
  }
}

/** 装一个插件。`manifest` 是编辑器里读出来的那一份（判断用，Rust 不信它，自己再读） */
export function installPlugin(req: PluginInstallRequest, manifest: ManifestView): Promise<PluginWrite> {
  const native = () => confirmed.install(req);
  if (holdsToolCalls(manifest.permissions)) return native();
  return plainThenNative(() => call("CreatePlugin", req), native);
}

/**
 * 保存一个插件：整份代码和开关。`asks`：界面已经确定要点头（`saveAsks`）
 */
export function savePlugin(req: PluginSaveRequest, asks: boolean): Promise<PluginWrite> {
  const native = () => confirmed.save(req);
  if (asks) return native();
  const { id, ...body } = req;
  return plainThenNative(() => call("SavePlugin", body, id), native);
}

/**
 * 批准磁盘上改过的文件。`sha256` 是给人看过的那一份的哈希；`next` 是它读出来的 manifest
 * （读不出来是 `null`，按改得了工具调用算）
 */
export function approvePlugin(
  p: PluginView,
  sha256: string,
  next: ManifestView | null,
  base: string,
): Promise<PluginWrite> {
  const native = () => confirmed.approve({ id: p.id, base_version: base });
  if (holdsToolCalls(p.permissions) || holdsToolCalls(next?.permissions)) return native();
  return plainThenNative(() => call("ApprovePluginFile", { sha256, base_version: base }, p.id), native);
}

/**
 * 确认过的那一份代码：开关要和代码一起交（`SavePlugin`）。底稿没了的，磁盘上那一份的哈希
 * 和确认过的一样也行；两样都没有就写不了
 */
export async function approvedSource(id: string): Promise<string> {
  const s = await call("PluginSourceDiff", null, id);
  if (s.approved !== "") return s.approved;
  if (s.current != null && s.current_sha256 === s.approved_sha256) return s.current;
  throw { code: "", args: {}, text: textOf(writeText).approvedMissing };
}

/**
 * 拨开关：确认过的那一份代码原样交回去，只改开关。`from` 是拨之前的样子（撤销时反过来）
 */
export async function setEnabled(p: PluginView, on: boolean, from: boolean, base: string): Promise<PluginWrite> {
  const source = await approvedSource(p.id);
  const asks = saveAsks({ old: p.permissions, next: p.permissions, turningOn: on && !from, codeChanged: false });
  return savePlugin({ id: p.id, source, enabled: on, base_version: base }, asks);
}
