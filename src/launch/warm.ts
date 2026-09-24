/**
 * 这次开窗是不是热启动：开窗那一刻 core 已经在跑。
 *
 * Rust 侧建窗时判断、在页面加载之前注入成 `window.__TW_WARM__`（见 `lib.rs`
 * 的 `show_main_window`）。热启动不放启动画面：窗口先藏着，首屏取好了调
 * `reveal_main_window` 再出现。冷启动（刚打开应用，网关还在起）照旧放。
 *
 * 不在应用里时（隔离预览）没有注入，按冷启动算。
 */
declare global {
  interface Window {
    __TW_WARM__?: boolean;
  }
}

export const warm = typeof window !== "undefined" && window.__TW_WARM__ === true;
