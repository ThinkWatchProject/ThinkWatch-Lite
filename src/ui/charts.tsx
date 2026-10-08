import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { prefersReducedMotion } from "@/ui/motion";
import { chartsText } from "./charts.i18n";

/**
 * 概览上的那张图。
 *
 * **手写的 SVG，不用图表库。**用过一阵 recharts（经 shadcn 的 `ChartContainer`）：
 * 它连同 d3、immer、Redux Toolkit 一共 331 KB，只为画这一张图；实时档每半秒重画
 * 一次，其中大半的时间花在它自己的状态机上。这里要的东西是有数的 —— 两道刻度、
 * 三道格线、单调曲线、堆叠、一条竖线和一个浮层 —— 都在这个文件里，长相和交互与
 * 原来一致（曲线的画法和 d3 的 `curveMonotoneX` 是同一个算法，浮层的定位规则也照旧）。
 *
 * 文件名是 `charts`（复数）：shadcn 的 `chart.tsx` 曾经占着那个名字，而 macOS 的
 * 文件系统不分大小写。
 *
 * **动画默认关着，只在换了看法的那一下打开**（`animate`）：每次刷新都重演一遍的
 * 图，读的人得等它演完，贴着图形边缘的东西还跟着一起动。所以后台刷新、实时档的
 * 每一帧都不动；换时间范围（整张图重画，从左往右铺开）和换口径（同一批格子，
 * 形状变过去）才动一次，250ms。
 *
 * **没有数据的那一格要画出来，不能跳过。**跳过的话，一天里的空档会被
 * 两边的数据挤没，图上看起来就是连续在用 —— 而「昨天下午我根本没用」
 * 正是看这张图想确认的事。`densify()` 在数据那一侧保证这件事，这里
 * 不做任何过滤。这也是面积图在这儿能用的前提：空桶是实打实的 0，
 * 曲线于是落到底，而不是从一个高峰直接连去下一个。
 */

/**
 * 纵轴那一栏多宽。它在图的右边，**画图的区域到它左边为止**。
 *
 * 图下面跟着时间走的东西（基线上的失败标记、时间刻度）要让出这一栏。
 * 铺满整行的话越往右越对不上：十分钟的实时档上差出半分钟，「2 分钟」
 * 那个刻度会落在一分半的位置。
 */
export const Y_AXIS_WIDTH = 46;

/** 画图区域上面空出的一条：最高的那道格线不贴着顶 */
const TOP = 6;
/** 刻度字离画图区域右边多远 */
const TICK_GAP = 8;
/** 刻度字的半个行高（11px 字、1.5 倍行高）：顶上那个刻度往下挪到整个字露出来为止 */
const TICK_HALF = 8.25;
/** 悬停提示离那一点（横向）和指针（纵向）多远 */
const TIP_GAP = 10;
/** 换看法时那一下动画多长 */
const ANIM_MS = 250;

/**
 * 悬停提示的抬头，一格一份：这一格是什么时候、一共多少，以及一句补充（请求数、
 * 失败数）。**和图的数据分开给**：图的每一格是「层名 → 值」，而层名（模型名）
 * 是客户端送来的任意字符串，抬头塞进同一个对象里迟早撞上一个同名的模型。
 */
export interface ChartTip {
  title: string;
  /** 这一格的合计，写好的样子 */
  value?: string;
  note?: string;
}

/**
 * 按模型分层的用量走势。
 *
 * **一张图回答两个问题**：用量发生在什么时候，以及落在哪个模型上。
 * 拆成「趋势图 + 构成图」的话，读的人要在两张图之间自行对齐时间 ——
 * 而「昨天下午那一阵来自 opus」恰好是要得到的结论。
 *
 * 用面积不用柱子，是因为格子已经细到能看出作息（白天成片、夜里断开、
 * 周末矮一截）—— 那个密度下柱子只剩几像素宽的碎片。**面积图在这里
 * 不会撒谎的前提是空桶已经补成 0**（`densify` 保证），曲线于是在夜里
 * 贴着底走，而不是从一个高峰直接连到下一个。
 *
 * 每层顶部再描一条同色实线：三层相近的蓝叠在一起会失去分界。
 *
 * **填充是渐变不是平涂**：每层一条自己的纵向渐变（0.8 → 0.1）再乘 0.4 的不透明度。
 * 渐变按**这一层自己的外框**铺（`objectBoundingBox`），不按整张图的高度：那样的话
 * 同一层在图的高处几乎不透明、在低处几乎全透，一层的浓淡随它在纵轴上的位置变 ——
 * 堆叠图的层是不可能交叉的，而那样画出来层与层看着在互相穿过，整张图读成了几条
 * 飘着的波。
 *
 * **纵轴要有刻度。**没有刻度的曲线只是纹理 —— 峰高一倍还是十倍读不
 * 出来，而这正是看这张图的原因。两个刻度（一半和顶），细体弱色，不抢形状；
 * 零就是基线，不另写。
 *
 * **悬停的显隐不能只靠容器的 `mouseleave`**：这个事件是会丢的 —— 切走应用、截图
 * 工具接管指针、指针从窗口边缘快速离开，都可能让它收不到，于是那条竖线和那个
 * 浮层就永远停在原地。实时档上这尤其明显：线不动，曲线从它下面走过去，框里的
 * 数字已经不描述屏幕上的任何东西了。
 */
export function StackedArea({
  data,
  keys,
  colors,
  tips,
  height = 96,
  empty,
  tickFormat,
  valueFormat,
  yMax,
  highlight = null,
  liveEdge = false,
  pulse = 0,
  animate = false,
}: {
  data: Record<string, number | string>[];
  /** 图的层，**从下往上** */
  keys: string[];
  colors: string[];
  /** 每一格悬停提示的抬头，和 `data` 一一对应。不给就只列各层 */
  tips?: readonly ChartTip[];
  height?: number;
  empty?: string;
  /** 纵轴刻度怎么写。不给就不画纵轴 —— 光秃秃的数字比没有更难读 */
  tickFormat?: (v: number) => string;
  /**
   * 悬停时每一层的数值怎么写。**和刻度分开给**：刻度是 0、0.5、1 这种整齐
   * 的数，取整会把 0.5 写成 1；而图值可以是任意的浮点，要先取整再写。
   */
  valueFormat?: (v: number) => string;
  /**
   * 纵轴上界。由调用方钉住，**不让它每帧跟着峰值跑**（见 `holdY`）。不给就按这一批
   * 数据的峰值取一个整齐的数
   */
  yMax?: number;
  /**
   * 突出哪一层（图例上指着的那一项）。其余几层淡下去，读的人不用在几层相近
   * 的蓝里自己找。`null` = 都一样。
   */
  highlight?: string | null;
  /** 最右端是「现在」：给它一个点，标出活的那一头 */
  liveEdge?: boolean;
  /**
   * 新数据落地了几次。**每涨一次，「现在」那一点向外闪一圈**（`motion-ping`，一次，
   * 不循环）。0 = 还没有新数据，不闪。
   */
  pulse?: number;
  /** 这一次重画要不要动画（见文件开头）。系统关掉了动效时调用方传 false */
  animate?: boolean;
}) {
  const t = useText(chartsText);
  // hook 一律在提前 return 之前取 —— 空态那一支不走下面的代码，hook 数对不上整棵树就崩了。
  // 同一页上可能有几张图，渐变的 id 不能撞
  const gid = useId().replace(/:/g, "");
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const width = useWidth(box);
  /** 指着第几格，指针离图顶多远（取整，和浮层的定位同一个数） */
  const [hover, setHover] = useState<{ i: number; y: number } | null>(null);
  const hovering = hover !== null;
  useEffect(() => {
    if (!hovering) return;
    // 指针离开的方式不止「移到旁边去」一种，而只有那一种会送来 mouseleave。
    // 这几个是送不来的那些。
    const off = () => setHover(null);
    /*
      **指针移出窗口、而焦点没变**，是第四种走法：用户把鼠标甩到另一块
      屏幕或另一个应用上，但没点它。那时 `blur` 不发（窗口还是焦点）、
      `visibilitychange` 不发（窗口还看得见），WKWebView 也不保证把
      `mouseleave` 送到容器上 —— 前三张网全漏，于是那条竖线留在图上，
      而图还在往左走。

      `mouseout` 且 `relatedTarget` 为空，说的正是「指针去了文档外面」。
    */
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) setHover(null);
    };
    window.addEventListener("blur", off);
    document.addEventListener("mouseleave", off);
    document.addEventListener("mouseout", out);
    document.addEventListener("visibilitychange", off);
    return () => {
      window.removeEventListener("blur", off);
      document.removeEventListener("mouseleave", off);
      document.removeEventListener("mouseout", out);
      document.removeEventListener("visibilitychange", off);
    };
  }, [hovering]);

  const plotW = Math.max(0, width - (tickFormat ? Y_AXIS_WIDTH : 0));
  const plotH = height - TOP;
  const none = data.length === 0 || keys.length === 0;
  const geo = useMemo(
    () => (none || plotW <= 0 ? null : layout(data, keys, plotW, plotH, yMax)),
    [none, data, keys, plotW, plotH, yMax],
  );
  const shown = useTween(geo, animate);
  const drawn = useMemo(
    () => shown?.layers.map((l) => ({ ...l, area: areaPath(shown.xs, l.top, l.base), line: linePath(shown.xs, l.top) })),
    [shown],
  );

  /*
    **没数据时也要占住这块地方。**塌成一行字的话，数据一来整页往下弹
    一百多像素；而切换时间范围时，这一弹是每次都会发生的 —— 页面在
    「有没有数据」之间来回跳，读的人每次都要重新找位置。
  */
  if (none) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-md border border-dashed border-border motion-fade"
        style={{ height }}
      >
        <p className="tw-body text-muted-foreground">{empty ?? t.noData}</p>
      </div>
    );
  }
  const n = data.length;
  const top = colors[keys.length - 1] ?? "var(--chart-1)";
  // 指着的那一格可能已经不在了（实时档往左走、换了区间）
  const row = hover && geo ? data[hover.i] : undefined;
  const at = row && hover && geo ? geo.point(hover.i) : null;
  return (
    <div
      ref={setBox}
      data-slot="chart"
      className="relative w-full text-xs"
      style={{ height }}
      onMouseMove={(e) => {
        if (!geo) return;
        const r = e.currentTarget.getBoundingClientRect();
        const x = Math.round(e.clientX - r.left);
        const y = Math.round(e.clientY - r.top);
        // 只在画图区域里算数：纵轴那一栏和顶上那一条不是哪一格
        if (x < 0 || x > plotW || y < TOP || y >= height) return setHover(null);
        const i = n > 1 ? Math.min(n - 1, Math.max(0, Math.round((x / plotW) * (n - 1)))) : 0;
        if (hover?.i !== i || hover.y !== y) setHover({ i, y });
      }}
      onMouseLeave={() => setHover(null)}
    >
      {geo && shown && drawn && (
        <svg aria-hidden width={width} height={height} className="block">
          <defs>
            {keys.map((k, i) => (
              <linearGradient key={k} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors[i]} stopOpacity={0.8} />
                <stop offset="95%" stopColor={colors[i]} stopOpacity={0.1} />
              </linearGradient>
            ))}
            {shown.sweep !== null && (
              <clipPath id={`${gid}-sweep`}>
                <rect x={0} y={0} width={plotW * shown.sweep} height={height} />
              </clipPath>
            )}
          </defs>
          {/* 格线：顶、一半、基线 */}
          {[TOP, TOP + plotH / 2, height].map((y) => (
            <line key={y} x1={0} x2={plotW} y1={y} y2={y} strokeDasharray="2 4" className="stroke-border/50" />
          ))}
          {/* 先画的在下面。**占得少的垫底、多的在上**：最重的那一层在视觉上也该最重 */}
          <g clipPath={shown.sweep !== null ? `url(#${gid}-sweep)` : undefined}>
            {drawn.map((l, i) => (
              <g
                key={l.key}
                className={cn(
                  "transition-opacity duration-(--motion-fast) ease-(--motion-ease) motion-reduce:transition-none",
                  highlight !== null && highlight !== l.key && "opacity-25",
                )}
              >
                <path d={l.area} fill={`url(#${gid}-${i})`} fillOpacity={0.4} />
                <path d={l.line} fill="none" stroke={colors[i]} strokeWidth={1.6} />
              </g>
            ))}
          </g>
          {/*
            「现在」那一头：一个静止的点，**不一直跳** —— 每秒都在动的东西比不动更难
            读。只在新数据落地时向外闪一圈，说的是「刚到了一条」。
          */}
          {liveEdge && <EdgeDot {...geo.point(n - 1)} color={top} pulse={pulse} />}
          {at !== null && (
            <>
              {/* 竖线用表格线的颜色、还压淡一档：它只是指出是哪一格，要读的是点和浮层 */}
              <line x1={at.x} x2={at.x} y1={TOP} y2={height} stroke="var(--border)" strokeOpacity={0.55} strokeWidth={1} />
              {/*
                悬停时只在最上面那一层的顶上点一个点 —— 那是这一格的合计，和提示抬头
                上的数是同一个。每一层都点的话，量小的几层的点挤在基线上叠成一团
              */}
              <circle cx={at.x} cy={at.y} r={3} fill={top} stroke="var(--background)" strokeWidth={2} />
            </>
          )}
          {tickFormat &&
            /*
              **刻度是上界和它的一半。**上界已经是取整过的数（`niceCeil` 的档位保证一半
              也是整数）。零是基线，不另写。
            */
            [geo.max / 2, geo.max].map((v) => (
              <text
                key={v}
                x={plotW + TICK_GAP}
                y={Math.min(Math.max(geo.yAt(v), TICK_HALF), height - TICK_HALF)}
                dy="0.355em"
                fontSize={11}
                fill="var(--muted-foreground)"
              >
                {tickFormat(v)}
              </text>
            ))}
        </svg>
      )}
      {at !== null && row && hover && (
        <TipBox
          row={row}
          keys={keys}
          colors={colors}
          tip={tips?.[hover.i]}
          valueFormat={valueFormat}
          anchor={{ x: at.x, y: hover.y }}
          bounds={{ right: plotW, top: TOP, bottom: height }}
        />
      )}
    </div>
  );
}

/**
 * 悬停提示。抬头一行是这一格的时刻和合计，下面按图里**从上到下**的次序列出
 * 各层（和图例、和眼睛看到的层叠次序一致），最后一行是补充说明。
 *
 * **这一格里是零的层不列。**一格里常常只有一两个模型在用，把另外四个写成一排
 * 「0」只是让要找的那一行更难找。
 *
 * **放在那一点的右下方，放不下就翻到左边、上边**，不出画图区域。框量出大小之后
 * 才知道往哪放，所以位置在画出来之前（布局阶段）直接写到元素上。出现的那一下就在
 * 原地；之后跟着指针换格子时滑过去（120ms，系统关了动效就直接跳）。
 */
function TipBox({
  row,
  keys,
  colors,
  tip,
  valueFormat,
  anchor,
  bounds,
}: {
  row: Record<string, number | string>;
  keys: string[];
  colors: string[];
  tip?: ChartTip;
  valueFormat?: (v: number) => string;
  anchor: { x: number; y: number };
  bounds: { right: number; top: number; bottom: number };
}) {
  const ref = useRef<HTMLDivElement>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width: w, height: h } = el.getBoundingClientRect();
    const x = anchor.x + TIP_GAP + w > bounds.right ? Math.max(anchor.x - w - TIP_GAP, 0) : anchor.x + TIP_GAP;
    const y = anchor.y + TIP_GAP + h > bounds.bottom ? Math.max(anchor.y - h - TIP_GAP, bounds.top) : Math.max(anchor.y + TIP_GAP, bounds.top);
    el.style.transition = placed.current && !prefersReducedMotion() ? "transform 120ms ease-out" : "none";
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.visibility = "visible";
    placed.current = true;
  });
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString());
  const zero = fmt(0);
  const rows = keys
    .map((k, i) => ({ k, v: row[k], color: colors[i] }))
    .reverse()
    .filter((p): p is { k: string; v: number; color: string } => typeof p.v === "number" && fmt(p.v) !== zero);
  return (
    <div ref={ref} data-slot="chart-tip" className="pointer-events-none invisible absolute top-0 left-0">
      <div className="grid min-w-44 max-w-72 gap-1.5 rounded-lg border border-border bg-popover px-3 py-2 tw-label text-popover-foreground shadow-lg">
        {tip && (
          <Line
            left={<span className="tw-num text-muted-foreground">{tip.title}</span>}
            right={tip.value && <span className="tw-num font-medium">{tip.value}</span>}
          />
        )}
        {rows.length > 0 && (
          <div className={cn("grid gap-1", tip && "border-t border-border/70 pt-1.5")}>
            {rows.map((p) => (
              <Line
                key={p.k}
                left={
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span aria-hidden className="h-2.5 w-1 shrink-0 rounded-[1px]" style={{ background: p.color }} />
                    <span className="truncate text-muted-foreground">{p.k}</span>
                  </span>
                }
                right={<span className="tw-num">{fmt(p.v)}</span>}
              />
            ))}
          </div>
        )}
        {tip?.note && <p className="text-muted-foreground">{tip.note}</p>}
      </div>
    </div>
  );
}

function Line({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4">
      {left}
      {right}
    </div>
  );
}

/**
 * 「现在」那一点。`pulse` 一变，底下那一圈重新挂上、放一次 `motion-ping`：
 * 按键重挂是让同一段 CSS 动画再放一遍的办法。
 */
function EdgeDot({ x, y, color, pulse }: { x: number; y: number; color: string; pulse: number }) {
  return (
    <g>
      {pulse > 0 && <circle key={pulse} cx={x} cy={y} r={3} fill={color} className="motion-ping" />}
      <circle cx={x} cy={y} r={3} fill={color} stroke="var(--background)" strokeWidth={2} />
    </g>
  );
}

/** 容器有多宽。在画出来之前量（布局阶段），第一帧就是对的宽度 */
function useWidth(el: HTMLElement | null): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(() => setW(el.getBoundingClientRect().width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return w;
}

/** 一层画成什么样：每一格的顶和底（像素，纵向从图顶往下数） */
interface Layer {
  key: string;
  top: number[];
  base: number[];
}

interface Geometry {
  /** 每一格的横向位置：等距排开，首尾顶格 */
  xs: number[];
  layers: Layer[];
  /** 纵轴上界 */
  max: number;
  yAt: (v: number) => number;
  /** 第几格最上面那一层的顶：这一格的合计画在哪 */
  point: (i: number) => { x: number; y: number };
}

/** 堆叠：每一层垫在下面那几层的合计上。不是数的格子当 0 */
function layout(
  data: Record<string, number | string>[],
  keys: string[],
  plotW: number,
  plotH: number,
  yMax: number | undefined,
): Geometry {
  const n = data.length;
  const xs = data.map((_, i) => (n > 1 ? (i * plotW) / (n - 1) : plotW / 2));
  // 每一格从下往上的累计：第 j 个数是第 0…j 层加起来
  const cum = data.map((row) => {
    let sum = 0;
    return keys.map((k) => {
      const v = row[k];
      return (sum += typeof v === "number" && Number.isFinite(v) ? v : 0);
    });
  });
  const totals = cum.map((c) => c[c.length - 1] ?? 0);
  const max = yMax && yMax > 0 ? yMax : niceMax(Math.max(0, ...totals));
  const yAt = (v: number) => TOP + plotH * (1 - v / max);
  return {
    xs,
    layers: keys.map((key, j) => ({
      key,
      top: cum.map((c) => yAt(c[j] ?? 0)),
      base: cum.map((c) => yAt(c[j - 1] ?? 0)),
    })),
    max,
    yAt,
    point: (i) => ({ x: xs[i] ?? 0, y: yAt(totals[i] ?? 0) }),
  };
}

/** 调用方没钉上界时取一个整齐的数（1/2/5 档）。全是 0 的时候给 2：刻度写 1 和 2，曲线贴底 */
function niceMax(peak: number): number {
  if (!(peak > 0)) return 2;
  const e = Math.pow(10, Math.floor(Math.log10(peak)));
  const m = peak / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

/** 画在屏幕上的那一份：动画中途是新旧之间的某一帧 */
interface Shown {
  xs: number[];
  layers: Layer[];
  /** 从左往右铺开到了几成；`null` = 不裁 */
  sweep: number | null;
}

/**
 * 换看法时的那一下动画。
 *
 * 新数据和屏幕上的不一样、而且这一次要动（`animate`）时：屏幕上原来没有图（挂上、
 * 换了区间），整张图从左往右铺开；原来有（换口径），每一层从屏幕上那个样子变过去 ——
 * 点数不同时按比例对上，新出现的层从它下面那一层长出来。不动的时候直接换。
 *
 * 逐帧算点的位置，不交给 CSS：路径形状的过渡 WebKit 不支持。
 */
function useTween(geo: Geometry | null, animate: boolean): Shown | null {
  const [tween, setTween] = useState<{ from: Shown | null; start: number; p: number } | null>(null);
  const last = useRef<Geometry | null>(null);
  const onScreen = useRef<Shown | null>(null);
  const shown = useMemo(() => frame(geo, tween), [geo, tween]);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = geo;
    // 没变，或者还在铺开（中途来的新数据直接换上，接着铺）
    const same = geo && before && (before === geo || sameShape(before, geo));
    if (!same && !(geo && tween && tween.from === null)) {
      if (geo && animate) setTween({ from: onScreen.current, start: performance.now(), p: 0 });
      else if (tween) setTween(null);
    }
    onScreen.current = shown;
  });
  const start = tween?.start;
  useEffect(() => {
    if (start === undefined) return;
    let h = requestAnimationFrame(function step(now) {
      const p = Math.min(1, Math.max(0, (now - start) / ANIM_MS));
      if (p >= 1) return setTween(null);
      setTween((x) => (x && x.start === start ? { ...x, p } : x));
      h = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(h);
  }, [start]);
  return shown;
}

function frame(geo: Geometry | null, tween: { from: Shown | null; p: number } | null): Shown | null {
  if (!geo) return null;
  if (!tween) return { xs: geo.xs, layers: geo.layers, sweep: null };
  const e = ease(tween.p);
  const from = tween.from;
  if (!from) return { xs: geo.xs, layers: geo.layers, sweep: e };
  const n = geo.xs.length;
  const pick = (arr: number[], i: number) => arr[Math.min(arr.length - 1, Math.floor((i * arr.length) / n))] ?? 0;
  const old = new Map(from.layers.map((l) => [l.key, l]));
  // 最底下那层的下面是基线
  let below = from.xs.map(() => geo.yAt(0));
  return {
    xs: geo.xs.map((x, i) => lerp(pick(from.xs, i), x, e)),
    layers: geo.layers.map((l) => {
      const f = old.get(l.key) ?? { key: l.key, top: below, base: below };
      below = f.top;
      return {
        key: l.key,
        top: l.top.map((y, i) => lerp(pick(f.top, i), y, e)),
        base: l.base.map((y, i) => lerp(pick(f.base, i), y, e)),
      };
    }),
    sweep: null,
  };
}

function sameShape(a: Geometry, b: Geometry): boolean {
  if (a.xs.length !== b.xs.length || a.layers.length !== b.layers.length) return false;
  if (a.xs.some((x, i) => x !== b.xs[i])) return false;
  return a.layers.every((l, j) => {
    const m = b.layers[j];
    return m !== undefined && l.key === m.key && l.top.every((y, i) => y === m.top[i]) && l.base.every((y, i) => y === m.base[i]);
  });
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** `--motion-ease` 那条曲线：cubic-bezier(0.22, 0.8, 0.24, 1) */
function ease(t: number): number {
  const [x1, y1, x2, y2] = [0.22, 0.8, 0.24, 1];
  const curve = (p1: number, p2: number) => (s: number) => {
    const r = 1 - s;
    return 3 * p1 * s * r * r + 3 * p2 * s * s * r + s * s * s;
  };
  const bx = curve(x1, x2);
  const by = curve(y1, y2);
  // x 随 s 单调增：二分找到 x(s) = t 的那个 s
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (bx(mid) < t) lo = mid;
    else hi = mid;
  }
  return by((lo + hi) / 2);
}

/** 路径里的数留三位小数：再多屏幕上看不出来，只让字符串变长 */
const num = (v: number) => Math.round(v * 1000) / 1000;

type Pt = readonly [x: number, y: number];

const zip = (xs: number[], ys: number[]): Pt[] => xs.map((x, i) => [x, ys[i] ?? 0]);

/** 一层顶上那条线 */
function linePath(xs: number[], ys: number[]): string {
  const out: string[] = [];
  monotone(zip(xs, ys), out, "M");
  return out.join("");
}

/** 一层的填充：沿着顶往右走，再沿着底（下面那一层的顶）走回来 */
function areaPath(xs: number[], top: number[], base: number[]): string {
  const out: string[] = [];
  monotone(zip(xs, top), out, "M");
  monotone(zip(xs, base).reverse(), out, "L");
  out.push("Z");
  return out.join("");
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
