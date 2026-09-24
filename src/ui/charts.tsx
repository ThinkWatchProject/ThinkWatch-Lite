import { useEffect, useId, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { cn } from "@/lib/utils";
import { ChartContainer, ChartTooltip } from "@/ui/chart";
import { useText } from "@/i18n";
import { chartsText } from "./charts.i18n";

/**
 * 概览上的那张图。
 *
 * **从手写 SVG 换成了 recharts（经 shadcn 的 `ChartContainer`）。**
 * 原来那版的理由是「一百多 KB 里我们要的只有两个形状」—— 代价是真的：
 * 实测包从 858 KB 涨到 1171 KB。换回来的是坐标轴、刻度、自动留白、
 * 悬停命中区这些自己写永远差一口气的东西，以及一套跟着 token 走的配色。
 *
 * 文件名是 `charts`（复数）：`chart.tsx` 是 shadcn 抄进来的那个，而
 * macOS 的文件系统不分大小写，`Chart.tsx` 会把它盖掉。
 *
 * **动画默认关着，只在换了看法的那一下打开**（`animate`）：数据一换，
 * recharts 会把图形重新长一遍，而贴着图形边缘的标签跟着一起动 —— 刷新一次
 * 跳一次，看起来就是「数字一直在闪」；一张每次刷新都要重演一遍的图，读的人
 * 还得等它演完。所以后台刷新、实时档的每一帧都不动；换时间范围（整张图重画，
 * 从左往右铺开）和换口径（同一批格子，形状变过去）才动一次，250ms。
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
 * **填充是渐变不是平涂**，按 shadcn 那张堆叠面积图的写法：每层一条
 * 自己的纵向渐变（0.8 → 0.1）再乘 `fillOpacity`。
 *
 * 一度改成过 `userSpaceOnUse`、跨整张图的高度，**那是错的**：同一层
 * 在图的高处几乎不透明、在低处几乎全透，一层的浓淡随它在纵轴上的位置
 * 变。堆叠图的层是不可能交叉的，而那样画出来层与层看着在互相穿过，
 * 整张图读成了几条飘着的波。
 *
 * **纵轴要有刻度。**没有刻度的曲线只是纹理 —— 峰高一倍还是十倍读不
 * 出来，而这正是看这张图的原因。两个刻度（一半和顶），细体弱色，不抢形状；
 * 零就是基线，不另写。
 *
 * **悬停的显隐由这一层说了算，不全交给 recharts。**recharts 只认送到
 * 它自己那个 wrapper 上的 `mouseleave`，而这个事件是会丢的：切走应用、
 * 截图工具接管指针、指针从窗口边缘快速离开 —— 都可能让它收不到，于是
 * 那条竖线和那个浮层就永远停在原地。实时档上这尤其明显：线不动，曲线
 * 从它下面走过去，框里的数字已经不描述屏幕上的任何东西了。
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
  /** 纵轴上界。由调用方钉住，**不让它每帧跟着峰值跑**（见 `holdY`） */
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
  // 同一页上可能有几张图，渐变的 id 不能撞。**在提前 return 之前取** ——
  // 空态那一支不走下面的代码，hook 数对不上整棵树就崩了
  const gid = useId().replace(/:/g, "");
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!over) return;
    // 指针离开的方式不止「移到旁边去」一种，而只有那一种会让 recharts
    // 收到 mouseleave。这几个是它收不到的那些。
    const off = () => setOver(false);
    /*
      **指针移出窗口、而焦点没变**，是第四种走法：用户把鼠标甩到另一块
      屏幕或另一个应用上，但没点它。那时 `blur` 不发（窗口还是焦点）、
      `visibilitychange` 不发（窗口还看得见），WKWebView 也不保证把
      `mouseleave` 送到容器上 —— 前三张网全漏，于是那条竖线留在图上，
      而图还在往左走。

      `mouseout` 且 `relatedTarget` 为空，说的正是「指针去了文档外面」。
    */
    const out = (e: MouseEvent) => {
      if (!e.relatedTarget) setOver(false);
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
  }, [over]);
  /*
    **没数据时也要占住这块地方。**塌成一行字的话，数据一来整页往下弹
    一百多像素；而切换时间范围时，这一弹是每次都会发生的 —— 页面在
    「有没有数据」之间来回跳，读的人每次都要重新找位置。
  */
  if (data.length === 0 || keys.length === 0) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-md border border-dashed border-border motion-fade"
        style={{ height }}
      >
        <p className="tw-body text-muted-foreground">{empty ?? t.noData}</p>
      </div>
    );
  }
  const last = data[data.length - 1];
  // 活边那个点画在最上面一层的顶上 —— 也就是这一格的总量
  const edge = last
    ? keys.reduce((a, k) => a + (typeof last[k] === "number" ? last[k] : 0), 0)
    : 0;
  const top = colors[keys.length - 1] ?? "var(--chart-1)";
  return (
    <ChartContainer
      className="w-full"
      style={{ height }}
      onMouseEnter={() => setOver(true)}
      /*
        **`mouseenter` 只在跨边界时发一次。**下面那几个补救把 `over` 关掉
        的时候，指针往往还停在图上（切走应用再切回来就是这样）——只靠
        `mouseenter` 的话，它要等用户把鼠标移出去再移回来才肯再亮。
      */
      onMouseMove={() => !over && setOver(true)}
      onMouseLeave={() => setOver(false)}
    >
      <AreaChart data={data} margin={{ top: 6, right: 0, bottom: 0, left: 0 }}>
        <defs>
          {keys.map((k, i) => (
            <linearGradient key={k} id={`${gid}-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={colors[i]} stopOpacity={0.8} />
              <stop offset="95%" stopColor={colors[i]} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="label" hide />
        {tickFormat && (
          <YAxis
            orientation="right"
            width={Y_AXIS_WIDTH}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
            tickFormatter={tickFormat}
            /*
              **刻度写死成上界和它的一半。**上界已经是取整过的数（`niceCeil` 的档位
              保证一半也是整数）；交给 recharts 按 `tickCount` 去凑的话，刻度落在哪
              几个数上由它自己的取整规则定，和档位不一定对得上。零是基线，不另写。
            */
            {...(yMax ? { domain: [0, yMax] as [number, number], ticks: [yMax / 2, yMax] } : { tickCount: 3 })}
          />
        )}
        <ChartTooltip
          // `false` = 一定不显示，`undefined` = 照常交给 recharts 判断
          active={over ? undefined : false}
          cursor={{ stroke: "var(--muted-foreground)", strokeOpacity: 0.55, strokeWidth: 1 }}
          animationDuration={120}
          animationEasing="ease-out"
          content={(p: TooltipContentProps) => <TipBox {...p} tips={tips} valueFormat={valueFormat} />}
        />
        {/* 先声明的在下面。**占得少的垫底、多的在上**：最重的那一层在视觉上也该最重 */}
        {keys.map((k, i) => (
          <Area
            key={k}
            dataKey={k}
            stackId="a"
            type="monotone"
            fill={`url(#${gid}-${i})`}
            fillOpacity={0.4}
            stroke={colors[i]}
            strokeWidth={1.6}
            dot={false}
            /*
              悬停时只在最上面那一层的顶上点一个点 —— 那是这一格的合计，和提示抬头
              上的数是同一个。每一层都点的话，量小的几层的点挤在基线上叠成一团
            */
            activeDot={i === keys.length - 1 ? { r: 3, fill: top, stroke: "var(--background)", strokeWidth: 2 } : false}
            isAnimationActive={animate}
            animationDuration={250}
            animationEasing={EASE}
            className={cn(
              "transition-opacity duration-(--motion-fast) ease-(--motion-ease) motion-reduce:transition-none",
              highlight !== null && highlight !== k && "opacity-25",
            )}
          />
        ))}
        {/*
          「现在」那一头：一个静止的点，**不一直跳** —— 每秒都在动的东西比不动更难
          读。只在新数据落地时向外闪一圈，说的是「刚到了一条」。
        */}
        {liveEdge && last && (
          <ReferenceDot
            x={String(last.label)}
            y={edge}
            r={3}
            shape={(p: { cx?: number; cy?: number }) => (
              <EdgeDot cx={p.cx ?? 0} cy={p.cy ?? 0} color={top} pulse={pulse} />
            )}
          />
        )}
      </AreaChart>
    </ChartContainer>
  );
}

/**
 * 悬停提示。抬头一行是这一格的时刻和合计，下面按图里**从上到下**的次序列出
 * 各层（和图例、和眼睛看到的层叠次序一致），最后一行是补充说明。
 *
 * **这一格里是零的层不列。**一格里常常只有一两个模型在用，把另外四个写成一排
 * 「0」只是让要找的那一行更难找。
 */
function TipBox({
  active,
  payload,
  activeIndex,
  tips,
  valueFormat,
}: TooltipContentProps & {
  tips?: readonly ChartTip[];
  valueFormat?: (v: number) => string;
}) {
  if (!active || !payload?.length) return null;
  const fmt = valueFormat ?? ((v: number) => v.toLocaleString());
  const zero = fmt(0);
  const tip = activeIndex == null ? undefined : tips?.[Number(activeIndex)];
  const rows = [...payload]
    .reverse()
    .filter((p) => typeof p.value === "number" && fmt(p.value) !== zero);
  return (
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
              key={String(p.dataKey ?? p.name)}
              left={
                <span className="flex min-w-0 items-center gap-1.5">
                  <span aria-hidden className="h-2.5 w-1 shrink-0 rounded-[1px]" style={{ background: p.color }} />
                  <span className="truncate text-muted-foreground">{String(p.name ?? p.dataKey)}</span>
                </span>
              }
              right={<span className="tw-num">{fmt(Number(p.value))}</span>}
            />
          ))}
        </div>
      )}
      {tip?.note && <p className="text-muted-foreground">{tip.note}</p>}
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
 * 动画的缓动，和 `--motion-ease` 同一条曲线。recharts 运行时认 `cubic-bezier(…)`
 * （`animation/easing` 的 `configEasing`），只是属性的类型只列了几个具名曲线 ——
 * 而它的具名 `ease-out` 其实是一条两头慢的曲线，不是这里要的「开头快、末尾慢」。
 */
const EASE = "cubic-bezier(0.22, 0.8, 0.24, 1)" as "ease-out";

/**
 * 「现在」那一点。`pulse` 一变，底下那一圈重新挂上、放一次 `motion-ping`：
 * 按键重挂是让同一段 CSS 动画再放一遍的办法。
 */
function EdgeDot({ cx, cy, color, pulse }: { cx: number; cy: number; color: string; pulse: number }) {
  return (
    <g>
      {pulse > 0 && <circle key={pulse} cx={cx} cy={cy} r={3} fill={color} className="motion-ping" />}
      <circle cx={cx} cy={cy} r={3} fill={color} stroke="var(--background)" strokeWidth={2} />
    </g>
  );
}
