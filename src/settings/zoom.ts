import { notify } from "@/ui/notify";
import { settingsApi, type ZoomStep } from "./api";

/**
 * 快捷键和命令面板换界面大小：放大一档、缩小一档、回到 100%。
 *
 * 缩放由 Rust 那边做（`src-tauri/src/zoom.rs`），存进 `app.json`；设置页那一行听
 * `ui-zoom-changed` 跟着动。存不进去就报错，界面大小不变
 */
export function stepZoom(step: ZoomStep): void {
  settingsApi.stepZoom(step).catch((e: unknown) => notify.error(e));
}
