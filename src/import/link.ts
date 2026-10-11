/**
 * 导入链接（`thinkwatch://import?…`）在界面这一侧的两个口子。
 *
 * 链接在 Rust 侧逐项校验（`src-tauri/src/import_link.rs`），**同一时间只留一条**：一份新建上游
 * 的提议，或者一句「无法导入」（链接里有这一版不认识的参数）。界面取走它，打开对应的对话框；
 * 对话框怎么关都要报一声（`releaseImportLink`），没打开就丢掉的也要报，否则之后的链接一直
 * 进不来。
 */
import { invoke } from "@tauri-apps/api/core";
import type { ImportLink } from "@/types";

/** Rust 侧有一条等着取时发的事件（不带内容） */
export const IMPORT_EVENT = "import-link";

/** 取走等着的那一条。没有是 null */
export function takeImportLink(): Promise<ImportLink | null> {
  return invoke<ImportLink | null>("take_import_link");
}

/** 导入的对话框关了，或者没打开就丢了：下一条可以进来 */
export function releaseImportLink(): Promise<void> {
  return invoke<void>("import_link_closed").catch(() => {});
}
