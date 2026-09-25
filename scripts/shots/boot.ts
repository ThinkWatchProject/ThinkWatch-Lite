// **最先求值的一个模块**（main.tsx 的第一个 import）：在界面的任何模块读到之前，
// 把应用里 Rust 侧注入的那几样摆好，再把时钟定住。
//
// 顺序要紧：`@/platform` 和 `@/i18n` 在模块求值时就读 `window.__TW_PLATFORM__`、
// `window.__TW_LANG__`，晚一步就按「不在应用里」画了 —— 侧栏顶上没有给红绿灯留的那一条、
// 文案写成「这台电脑」。所以这里不 import 任何东西。

const q = new URLSearchParams(location.search);
const lang = q.get("lang") === "en" ? "en" : "zh";

window.__TW_LANG__ = lang;
window.__TW_PLATFORM__ = "macos";
// `__TW_VIBRANT__` 故意不设：真应用的侧栏是系统的半透材质，由窗口服务器画，离屏拍不到。
// 不设它，侧栏按实色画，和别的平台一样
// 热启动：core 已经在跑，窗口取好首屏的数才露面，没有启动画面
(window as { __TW_WARM__?: boolean }).__TW_WARM__ = true;
document.documentElement.lang = lang === "en" ? "en" : "zh-CN";

/**
 * 定住的时钟：2026-09-25（周五）16:42:07，**本地时间**。
 *
 * **不走。**「9 秒前」「3 分钟前」这类字按拍的那一刻算，时钟走的话，同一张图拍两次、
 * 慢一秒就不一样了。示例数据全按它往前推，所以换了时区拍出来的字也一样。计时器、
 * 动画用的是 `setTimeout` 和 `performance.now()`，不受影响。
 */
export const NOW = new Date(2026, 8, 25, 16, 42, 7).getTime();
{
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(NOW);
      else super(...(args as [number]));
    }
    static now() {
      return NOW;
    }
  }
  (globalThis as { Date: DateConstructor }).Date = FixedDate as DateConstructor;
}
