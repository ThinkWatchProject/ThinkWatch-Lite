import { useId } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/ui/chart";
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
 * **进场动画关掉了。这不是省一个效果，是修一个 bug**：数据一换，
 * recharts 会把图形从零重新长一遍，而贴着图形边缘的标签跟着一起动 ——
 * 那几百毫秒里它在跳。刷新一次跳一次，看起来就是「数字一直在闪」。
 * 一张每次刷新都要重演一遍的图，读的人还得等它演完。
 *
 * **没有数据的那一格要画出来，不能跳过。**跳过的话，一天里的空档会被
 * 两边的数据挤没，图上看起来就是连续在用 —— 而「昨天下午我根本没用」
 * 正是看这张图想确认的事。`densify()` 在数据那一侧保证这件事，这里
 * 不做任何过滤。这也是面积图在这儿能用的前提：空桶是实打实的 0，
 * 曲线于是落到底，而不是从一个高峰直接连去下一个。
 */

/**
 * 按模型分层的花费走势。
 *
 * **一张图回答两个问题**：支出发生在什么时候，以及落在哪个模型上。
 * 拆成「趋势图 + 构成图」的话，读的人要在两张图之间自行对齐时间 ——
 * 而「昨天下午那笔支出来自 opus」恰好是要得到的结论。
 *
 * 用面积不用柱子，是因为格子已经细到能看出作息（白天成片、夜里断开、
 * 周末矮一截）—— 那个密度下柱子只剩几像素宽的碎片。**面积图在这里
 * 不会撒谎的前提是空桶已经补成 0**（`densify` 保证），曲线于是在夜里
 * 贴着底走，而不是从一个高峰直接连到下一个。
 *
 * 每层顶部再描一条同色实线：三层相近的蓝叠在一起会失去分界。
 *
 * **填充是渐变不是平涂。**同一条蓝的五档明度叠三层，平涂出来是一片
 * 噪点 —— 每层各自从本色渐隐到透明之后，三层才读得出是三条带子。
 * 渐变走 `userSpaceOnUse`、跨整张图的高度：按图形自己的包围盒渐变的
 * 话，最上面那条薄带子会被拉成一整条完整的渐变，比它下面那层还重。
 *
 * **纵轴要有刻度。**没有刻度的曲线只是纹理 —— 峰高一倍还是十倍读不
 * 出来，而这正是看这张图的原因。三个刻度、细体弱色，不抢形状。
 */
export function StackedArea({
  data,
  keys,
  colors,
  height = 96,
  empty,
  tickFormat,
  yMax,
  liveEdge = false,
}: {
  data: Record<string, number | string>[];
  keys: string[];
  colors: string[];
  height?: number;
  empty?: string;
  /** 纵轴刻度怎么写。不给就不画纵轴 —— 光秃秃的数字比没有更难读 */
  tickFormat?: (v: number) => string;
  /** 纵轴上界。由调用方钉住，**不让它每帧跟着峰值跑**（见 `yHold`） */
  yMax?: number;
  /** 最右端是「现在」：给它一个点，标出活的那一头 */
  liveEdge?: boolean;
}) {
  const t = useText(chartsText);
  // 同一页上可能有几张图，渐变的 id 不能撞。**在提前 return 之前取** ——
  // 空态那一支不走下面的代码，hook 数对不上整棵树就崩了
  const gid = useId().replace(/:/g, "");
  /*
    **没数据时也要占住这块地方。**塌成一行字的话，数据一来整页往下弹
    一百多像素；而切换时间范围时，这一弹是每次都会发生的 —— 页面在
    「有没有数据」之间来回跳，读的人每次都要重新找位置。
  */
  if (data.length === 0 || keys.length === 0) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-sm border border-dashed border-border/60"
        style={{ height }}
      >
        <p className="tw-label text-muted-foreground">{empty ?? t.noData}</p>
      </div>
    );
  }
  const cfg = Object.fromEntries(
    keys.map((k, i) => [k, { label: k, color: colors[i] }]),
  ) satisfies ChartConfig;
  const last = data[data.length - 1];
  // 活边那个点画在最上面一层的顶上 —— 也就是这一格的总量
  const edge = last
    ? keys.reduce((a, k) => a + (typeof last[k] === "number" ? last[k] : 0), 0)
    : 0;
  return (
    <ChartContainer config={cfg} className="w-full" style={{ height }}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          {keys.map((k, i) => (
            <linearGradient
              key={k}
              id={`${gid}-${i}`}
              gradientUnits="userSpaceOnUse"
              x1={0}
              y1={0}
              x2={0}
              y2={height}
            >
              <stop offset="0%" stopColor={colors[i]} stopOpacity={0.95} />
              <stop offset="100%" stopColor={colors[i]} stopOpacity={0.12} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="label" hide />
        {tickFormat && (
          <YAxis
            orientation="right"
            width={46}
            tickCount={3}
            axisLine={false}
            tickLine={false}
            tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
            tickFormatter={tickFormat}
            {...(yMax ? { domain: [0, yMax] as [number, number] } : {})}
          />
        )}
        {/*
          **标题行（时间 · 金额 · 次数）靠 `XAxis dataKey` 传进来，不能给
          `labelKey`。**shadcn 的 `ChartTooltipContent` 把 `labelKey` 当成
          「去 config 里查哪一条」的键：给了 "label"，它先从数据里取出
          `label` 的值（也就是那一整句话），再拿这句话去 config 里找 ——
          config 里只有模型名，找不到，于是 `value` 是 undefined，整个标题
          行 return null。悬停时只剩下面几行模型名和数字，没有时间。
          不给 `labelKey` 走的是另一条：recharts 传进来的 `label` 就是
          `XAxis dataKey="label"` 那一格的值，直接显示。
        */}
        <ChartTooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
          content={<ChartTooltipContent indicator="line" />}
        />
        {/* 先声明的在下面。**便宜的垫底、贵的在上**：贵的那层在视觉上
            也该是最重的一层 */}
        {keys.map((k, i) => (
          <Area
            key={k}
            dataKey={k}
            stackId="a"
            type="monotone"
            fill={`url(#${gid}-${i})`}
            fillOpacity={1}
            stroke={colors[i]}
            strokeWidth={1.6}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        ))}
        {/*
          「现在」那一头。**不做脉冲** —— 这张图当初专门关掉了动画，
          理由是每秒重演一遍比不动更难读；一个静止的点加一圈光晕已经
          够说明哪一端是活的。
        */}
        {liveEdge && last && (
          <ReferenceDot
            x={String(last.label)}
            y={edge}
            r={3}
            fill={colors[keys.length - 1] ?? "var(--chart-1)"}
            stroke="var(--background)"
            strokeWidth={2}
          />
        )}
      </AreaChart>
    </ChartContainer>
  );
}
