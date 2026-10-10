/**
 * ThinkWatch 标志的 TW 四笔和各自的长度，32×32 的画布。坐标和应用图标
 * （src-tauri/icons/render.py 的 STROKES）是同一套。启动画面和上游页的标志都画它。
 *
 * **这个文件不引任何东西**：启动画面是冷启动最先画出来的，它那一块越小越好。
 *
 * **长度写死，不用 `pathLength="1"` 归一。**虚线按归一的长度算，WebKit 各个
 * 版本的支持不一样；写死的长度哪儿都一样。V 的一边是 √(4.5² + 8²)
 */
const V = Math.hypot(4.5, 8);

export const TW_STROKES: [string, number][] = [
  ["M7 9H25", 18],
  ["M16 9V17", 8],
  ["M7 17L11.5 25L16 17", 2 * V],
  ["M16 17L20.5 25L25 17", 2 * V],
];
