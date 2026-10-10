/**
 * 路由图上在途请求「流过去」的光点怎么排。**纯函数**，画的是 `ChainMap` 的 `FlowEdge`。
 *
 * · **每条线上一样大、一样快**：线的 `pathLength` 写成它装得下的整数个间距
 *   （`flowCycles`），虚线的一个周期就是一个单位。光点的长短、走一个间距的时间按单位写，
 *   CSS 只要一组关键帧（偏移从 1 走到 0，见 index.css 的 `motion-flow`）。
 * · **一段一段接得上**：每条线都是整数个周期，所有线对着同一个时钟走（`flowDelay`），
 *   一个光点从上一段的终点出去，同一刻从下一段的起点进来 —— 读起来是请求从密钥一路走到
 *   上游。后亮起来的线（请求路由之后才画到上游）也接得上。
 * · 一个光点是叠在一起的几层（`FLOW_LAYERS`）：长而淡的尾巴、一圈柔光、短而亮的头，
 *   头都对齐在前面。
 * · 同一段线上在途的请求越多越亮一点（`flowStrength`），封顶。
 * · **每个请求一种颜色，整条路同色**（`flowColor`）：密钥到路由、路由到上游是同一个请求
 *   的光点，看得出它是一条路。同一段线上几个请求的光点错开着走（`flowShift`），不叠在
 *   一起；错开量跟着请求走，一段一段照样接得上。
 */

/** 光点之间大约隔这么远（像素） */
export const FLOW_PERIOD_PX = 84;
/** 走过一个间距要这么久：大约每秒 65 像素，看得出在走，不催人 */
export const FLOW_MS = 1300;
/** 这段线不在途了之后，光点淡出要这么久（之后才卸掉，动画随之停下） */
export const FLOW_FADE_MS = 600;

/** 有几种颜色（index.css 的 `--flow-1…`，浅色、深色各一套）。先后到的请求轮着取，相邻的不同色 */
export const FLOW_COLORS = 5;

/** 请求 `id` 的光点是哪种颜色 */
export function flowColor(id: number): string {
  return `var(--flow-${(Math.abs(id) % FLOW_COLORS) + 1})`;
}

/** 请求 `id` 的光点比基准相位错开多少（一个间距的几分之几）。同色的请求错开量也一样 */
export function flowShift(id: number): number {
  return (Math.abs(id) % FLOW_COLORS) / FLOW_COLORS;
}

/** 长 `length` 像素的线上排几个间距：取最接近的整数，至少一个 */
export function flowCycles(length: number): number {
  return Math.max(1, Math.round(length / FLOW_PERIOD_PX));
}

/** 同一段线上有 `n` 个在途请求时光点多亮（不透明度）。没有请求时为 0 */
export function flowStrength(n: number): number {
  if (n <= 0) return 0;
  return Math.min(1, 0.76 + 0.08 * (n - 1));
}

/**
 * 一层光点的动画该从哪儿开始（`animation-delay`，毫秒，≤ 0）：此刻 `now`（页面时钟，
 * `performance.now()`，和动画的时间线是同一个起点）对到同一个相位上，后挂上的线和
 * 先挂上的接得上。`dash` 是这一层的长短（单位）：长的那层往后错开同样多，每层的**前头**
 * 落在同一处。`shift`：这个请求的错开量（`flowShift`），它每一段都传同一个。
 */
export function flowDelay(now: number, dash: number, shift = 0): number {
  const phase = (((now - (dash + shift) * FLOW_MS) % FLOW_MS) + FLOW_MS) % FLOW_MS;
  return phase === 0 ? 0 : -phase;
}

/**
 * 一个光点的几层，从下往上画。`dash`：长短（一个间距是 1）；`extra`：比线粗多少像素；
 * `opacity`：这一层自己的不透明度（整段的强弱另乘）。
 */
export const FLOW_LAYERS: readonly { dash: number; extra: number; opacity: number }[] = [
  { dash: 0.5, extra: 0, opacity: 0.3 },
  { dash: 0.18, extra: 4, opacity: 0.2 },
  { dash: 0.13, extra: 1, opacity: 1 },
];
