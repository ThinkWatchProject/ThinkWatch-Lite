import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/ui/chart";

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
 * **一张图回答两个问题**：什么时候花的，以及花在哪个模型上。拆成
 * 「趋势图 + 构成图」的话，读的人要在两张图之间自己对时间 —— 而
 * 「昨天下午那笔钱是 opus 花的」正是要看的结论。
 *
 * 用面积不用柱子，是因为格子已经细到能看出作息（白天成片、夜里断开、
 * 周末矮一截）—— 那个密度下柱子只剩几像素宽的碎片。**面积图在这里
 * 不会撒谎的前提是空桶已经补成 0**（`densify` 保证），曲线于是在夜里
 * 贴着底走，而不是从一个高峰直接连到下一个。
 *
 * 每层顶上再勾一条同色实线：三层蓝叠在一起容易糊成一块。
 */
export function StackedArea({
  data,
  keys,
  colors,
  height = 96,
  empty,
}: {
  data: Record<string, number | string>[];
  keys: string[];
  colors: string[];
  height?: number;
  empty?: string;
}) {
  if (data.length === 0 || keys.length === 0) {
    return <p className="tw-label text-muted-foreground">{empty ?? "还没有数据"}</p>;
  }
  const cfg = Object.fromEntries(
    keys.map((k, i) => [k, { label: k, color: colors[i] }]),
  ) satisfies ChartConfig;
  return (
    <ChartContainer config={cfg} className="w-full" style={{ height }}>
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="label" hide />
        <ChartTooltip
          cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
          content={<ChartTooltipContent labelKey="label" indicator="line" />}
        />
        {/* 先声明的在下面。**便宜的垫底、贵的在上**：贵的那层在视觉上
            也该是最重的一层 */}
        {keys.map((k, i) => (
          <Area
            key={k}
            dataKey={k}
            stackId="a"
            type="monotone"
            fill={colors[i]}
            fillOpacity={0.82}
            stroke={colors[i]}
            strokeWidth={1.2}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}
