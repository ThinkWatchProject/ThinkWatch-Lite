/**
 * 指标卡上那几张小图的几何：线、线下面那片淡色、没有样本的那几段的虚线连接。
 *
 * 和 `Spark.tsx` 分开，是为了能测：曲线会不会越过数据冒出一个峰、空档两头接得对不对，
 * 写在 JSX 里没有东西会回答。
 */

/** 路径里的数留一位小数：两百多像素宽的小图上，再多也看不出来，只让字符串变长 */
const num = (v: number) => Math.round(v * 10) / 10;

type Pt = readonly [x: number, y: number];

export interface LineGeometry {
  /** 有数据的那几段的实线。每一段两个点以上，各自一条单调曲线 */
  line: string;
  /** 实线下面那片：沿着线往右，再沿着基线回来 */
  area: string;
  /**
   * **没有样本的那几格**（夜里没请求时首 token 的分位）：前一个有数的点和后一个有数的
   * 点之间连一条直线，画成淡的虚线。连贯，又看得出这一段没有数据 —— 实线和面积只画在
   * 有数据的地方，空档里不编数。
   */
  gap: string;
  /** 前后都没有邻居的孤点：一段实线画不出来，给它一个小点，免得那个数看不见 */
  dots: { x: number; y: number }[];
}

/**
 * 一条线的几何。`values[i]` 画在 `xs[i]`；`null` 是这一格没有样本（不是零：零是实打实的
 * 数，线贴着基线走）。`y` 把值换成纵向的像素，`base` 是基线的纵坐标。
 */
export function lineGeometry(
  values: readonly (number | null)[],
  xs: readonly number[],
  y: (v: number) => number,
  base: number,
): LineGeometry {
  const line: string[] = [];
  const area: string[] = [];
  const gap: string[] = [];
  const dots: { x: number; y: number }[] = [];
  let run: Pt[] = [];
  let last: Pt | null = null;
  let lastIndex = -1;
  const flush = () => {
    const first = run[0];
    const end = run[run.length - 1];
    if (run.length >= 2 && first && end) {
      const path: string[] = [];
      monotone(run, path, "M");
      line.push(path.join(""));
      area.push(`${path.join("")}L${num(end[0])},${num(base)}L${num(first[0])},${num(base)}Z`);
    } else if (first) {
      dots.push({ x: first[0], y: first[1] });
    }
    run = [];
  };
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) {
      flush();
      return;
    }
    const p: Pt = [xs[i] ?? 0, y(v)];
    if (last && lastIndex < i - 1) gap.push(`M${num(last[0])},${num(last[1])}L${num(p[0])},${num(p[1])}`);
    run.push(p);
    last = p;
    lastIndex = i;
  });
  flush();
  // 孤点有虚线接着的话，虚线已经把它标出来了；只有前后都没有数的才补一个点
  const lonely = gap.length === 0 ? dots : [];
  return { line: line.join(""), area: area.join(""), gap: gap.join(""), dots: lonely };
}

/**
 * 单调三次曲线（Steffen 1990，d3 的 `curveMonotoneX` 也是它）：每一段都不越过两端的值，
 * 所以曲线不会冒出数据里没有的峰，也不会在空桶那里钻到基线下面去。
 */
function monotone(pts: Pt[], out: string[], start: "M" | "L"): void {
  const [a, b] = pts;
  if (!a) return;
  out.push(`${start}${num(a[0])},${num(a[1])}`);
  if (!b) return;
  if (pts.length === 2) {
    out.push(`L${num(b[0])},${num(b[1])}`);
    return;
  }
  // 每一点的切线斜率：中间的看两边，两头的由相邻那一段推出来
  const m = pts.map((p, i) => {
    const prev = pts[i - 1];
    const next = pts[i + 1];
    return prev && next ? slope3(prev, p, next) : 0;
  });
  const n = pts.length;
  m[0] = slope2(a, b, m[1] ?? 0);
  m[n - 1] = slope2(pts[n - 2]!, pts[n - 1]!, m[n - 2] ?? 0);
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i]!;
    const [x1, y1] = pts[i + 1]!;
    const dx = (x1 - x0) / 3;
    out.push(`C${num(x0 + dx)},${num(y0 + dx * m[i]!)},${num(x1 - dx)},${num(y1 - dx * m[i + 1]!)},${num(x1)},${num(y1)}`);
  }
}

const sign = (v: number) => (v < 0 ? -1 : 1);

/** 中间一点的切线斜率：两边割线斜率同号时取其中较缓的（再和两者的加权平均比），异号取 0 */
function slope3([x0, y0]: Pt, [x1, y1]: Pt, [x2, y2]: Pt): number {
  const h0 = x1 - x0;
  const h1 = x2 - x1;
  const s0 = (y1 - y0) / (h0 || (h1 < 0 ? -0 : 0));
  const s1 = (y2 - y1) / (h1 || (h0 < 0 ? -0 : 0));
  const p = (s0 * h1 + s1 * h0) / (h0 + h1);
  return (sign(s0) + sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p)) || 0;
}

/** 端点的切线斜率：由相邻那一段的割线和另一头的切线推出来 */
function slope2([x0, y0]: Pt, [x1, y1]: Pt, t: number): number {
  const h = x1 - x0;
  return h ? ((3 * (y1 - y0)) / h - t) / 2 : t;
}

/**
 * 纵轴的上界：这张图里最大的那个数，上面留一成。全是零（或者没有数）时给 1，线贴着
 * 基线走。**每张卡片按自己的峰值画**：它回答的是「什么时候多、什么时候少」，量有多大
 * 写在上面那个大数里。
 */
export function peakOf(...series: readonly (readonly (number | null)[] | null | undefined)[]): number {
  let max = 0;
  for (const s of series) for (const v of s ?? []) if (v != null && v > max) max = v;
  return max > 0 ? max * 1.1 : 1;
}
