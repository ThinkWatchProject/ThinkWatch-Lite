/**
 * 要在系统的确认框里点头的几步（I12）：装插件、换代码、批准改过的文件，以及打开改得了回答
 * 里工具调用的插件、改它的设置或范围。
 *
 * 这几个端点**不在网页的白名单里**（`src/control.ts`）。网页只能请 Rust 去做：Rust 自己再
 * 读一遍插件（不信这里给的任何关于插件的说法），在系统的确认框里写明它是谁、能做什么、这次
 * 改什么，点了头才写配置。用户在那个框里点了取消不是失败：回执是 `cancelled`，界面照原样。
 */
import { invoke } from "@tauri-apps/api/core";
import { call } from "@/control";
import type {
  PluginApproveRequest,
  PluginInstallRequest,
  PluginReplaceRequest,
  PluginUpdate,
  PluginUpdateRequest,
  PluginView,
  PluginWrite,
} from "@/types";
import { changesWhatItDoes, guarded } from "./model";

export const installPlugin = (req: PluginInstallRequest) => invoke<PluginWrite>("plugin_install", { req });

export const replacePluginSource = (req: PluginReplaceRequest) => invoke<PluginWrite>("plugin_replace_source", { req });

export const approvePluginFile = (req: PluginApproveRequest) => invoke<PluginWrite>("plugin_approve", { req });

const updateConfirmed = (req: PluginUpdateRequest) => invoke<PluginWrite>("plugin_update_confirmed", { req });

/** core 说这次改动要在系统的确认框里点头（`UpdatePlugin` 答 403） */
const NEEDS_CONFIRMATION = "control.plugin.needs_confirmation";

/**
 * 保存一个插件的开关、出错时、范围、设置。
 *
 * 改得了工具调用的插件（或者读不出权限的），打开它、改设置、改范围**直接请 Rust 弹系统的
 * 确认框**；别的照常走 `UpdatePlugin`。core 说这次要点头的（界面的判断和 core 对不上的
 * 时候），同一份改动再请 Rust 走一遍确认 —— 用户不必再按一次保存。
 */
export async function savePlugin(p: PluginView, update: PluginUpdate): Promise<PluginWrite> {
  if (guarded(p) && changesWhatItDoes(p, update)) return updateConfirmed({ id: p.id, update });
  try {
    const w = await call("UpdatePlugin", update, p.id);
    return { kind: "done", version: w.version };
  } catch (e) {
    if (needsConfirmation(e)) return updateConfirmed({ id: p.id, update });
    throw e;
  }
}

function needsConfirmation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === NEEDS_CONFIRMATION;
}
