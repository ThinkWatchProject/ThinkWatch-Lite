/**
 * 这个界面跑在哪个平台上。
 *
 * Rust 侧在页面加载之前注入成 `window.__TW_PLATFORM__`（见 `i18n.rs` 的
 * `init_script`）。**不用异步查询**，理由和语言那一处一样：要它的地方都在
 * 首帧之前，查一次会让第一帧画错然后跳一下。
 *
 * 不在应用里时（浏览器直接打开、隔离预览）是 `"other"` —— 那些地方不该出现
 * 任何按平台分叉的东西。
 */
export type Platform = "macos" | "windows" | "other";

declare global {
  interface Window {
    /** Rust 侧在页面加载之前注入的平台 */
    __TW_PLATFORM__?: Platform;
  }
}

export const platform: Platform =
  typeof window !== "undefined" &&
  (window.__TW_PLATFORM__ === "macos" || window.__TW_PLATFORM__ === "windows")
    ? window.__TW_PLATFORM__
    : "other";

export const isMac = platform === "macos";
