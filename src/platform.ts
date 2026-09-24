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
export const isWindows = platform === "windows";

/**
 * 挂到 `<html data-platform>` 上，给只能在 CSS 里分的东西用 —— 字号、字体栈
 * （见 `index.css` 里 `[data-platform="windows"]` 那一段）。
 *
 * **在模块求值时就挂**，不等 React：这个文件在首帧渲染之前就被 import 了，
 * 挂晚了第一帧是 macOS 的字号，然后整页跳一下。
 */
if (typeof document !== "undefined") {
  document.documentElement.dataset.platform = platform;
}

/**
 * 主修饰键。macOS 上是 ⌘；Windows 上 `metaKey` 是 Win 键，那个键按下去
 * 系统先拿走了，应用收不到 —— 对应的是 Ctrl。
 *
 * 判定和提示里的键帽都从这里取，两处才不会一处说 ⌘ 一处认 Ctrl。
 * **另一个修饰键必须没按**：Windows 上 Ctrl+Win 是切虚拟桌面，macOS 上
 * ⌘+Ctrl 是另一组系统快捷键，都不该被当成我们的。
 */
export const modKey = isMac ? "⌘" : "Ctrl";

export function isMod(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
