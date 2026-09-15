import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/ui/chart";

/**
 * 概览上的两种图。
 *
 * **从手写 SVG 换成了 recharts（经 shadcn 的 `ChartContainer`）。**
 * 原来那版的理由是「一百多 KB 里我们要的只有两个形状」—— 代价是真的：
 * 实测包从 858 KB 涨到 1171 KB。换回来的是坐标轴、刻度、自动留白、
 * 悬停命中区这些自己写永远差一口气的东西，以及一套跟着 token 走的配色。
 *
 * 文件名是 `charts`（复数）：`chart.tsx` 是 shadcn 抄进来的那个，而
 * macOS 的文件系统不分大小写，`Chart.tsx` 会把它盖掉。
 *
 * 两种图共用同一条纪律：**没有数据的那一格要画出来，不能跳过**。
 * 跳过的话，一天里的空档会被两边的柱子挤没，图上看起来就是连续在用 ——
 * 而「昨天下午我根本没用」正是看这张图想确认的事。`densify()` 在数据
 * 那一侧保证这件事，这里不做任何过滤。
 */

/** 一根柱子。`value` 是主高度，`sub` 叠在上面（失败/估算那部分）。 */
export interface Bar {
  at: number;
  value: number;
  sub?: number;
  label: string;
}

const barConfig = {
  value: { label: "花费", color: "var(--chart-2)" },
  sub: { label: "其中失败", color: "var(--destructive)" },
} satisfies ChartConfig;

export function BarChart({
  bars,
  height = 56,
  empty,
}: {
  bars: Bar[];
  height?: number;
  empty?: string;
}) {
  if (bars.length === 0) {
    return <p className="tw-label text-muted-foreground">{empty ?? "还没有数据"}</p>;
  }
  return (
    <ChartContainer config={barConfig} className="w-full" style={{ height }}>
      <RBarChart data={bars} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        {/* 只留横向网格线 —— 竖线在几十根柱子上是噪声 */}
        <CartesianGrid vertical={false} strokeDasharray="2 4" />
        <XAxis dataKey="label" hide />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent labelKey="label" indicator="line" />}
        />
        {/* 叠起来而不是并排：读的是「这一小时一共花了多少，其中多少失败了」 */}
        <Bar dataKey="value" stackId="a" fill="var(--color-value)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="sub" stackId="a" fill="var(--color-sub)" radius={[2, 2, 0, 0]} />
      </RBarChart>
    </ChartContainer>
  );
}

/**
 * 横条排行（钱花在哪儿）。
 *
 * 横条而不是饼图：**饼图比不出 12% 和 15%**，而这张图的用途恰恰是排序
 * 和比例。条目也不多，前五个之外的意义很小。
 */
export function BarRows({
  rows,
  unit,
}: {
  rows: { name: string; value: number; note?: string }[];
  unit: (v: number) => string;
}) {
  if (rows.length === 0) {
    return <p className="tw-label text-muted-foreground">还没有数据</p>;
  }
  const cfg = { value: { label: "花费", color: "var(--chart-2)" } } satisfies ChartConfig;
  /*
    **算不出价钱的要说出来,不能只把条子调暗。**调暗只说「这条有点不一样」,
    说不出「少算了 4 条」。所以数字后面直接跟上那句话,和条子尾巴上的标签
    是同一段文字 —— 另起一列就要对齐,而条子本来就不等长。
  */
  const data = rows.map((r) => ({
    ...r,
    tag: unit(r.value) + (r.note ? ` · ${r.note}` : ""),
  }));
  return (
    <ChartContainer config={cfg} className="w-full" style={{ height: rows.length * 26 + 8 }}>
      <RBarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 56, bottom: 0, left: 0 }}
      >
        <YAxis
          dataKey="name"
          type="category"
          width={150}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 13 }}
        />
        <XAxis dataKey="value" type="number" hide />
        <ChartTooltip
          cursor={false}
          content={<ChartTooltipContent hideLabel formatter={(v) => unit(Number(v))} />}
        />
        <Bar dataKey="value" fill="var(--color-value)" radius={3} barSize={12}>
          {/* 数字写在条子尾巴上，不另开一列 —— 一列数字要对齐，而条子本来就不等长 */}
          <LabelList
            dataKey="tag"
            position="right"
            className="fill-foreground tw-num"
            fontSize={12}
          />
          {/*
            **算不出价钱的那几条要显出来。**不标的话它偏短，而看图的人
            没有线索知道少算了什么。
          */}
          {rows.map((r) => (
            <Cell key={r.name} opacity={r.note ? 0.45 : 1} />
          ))}
        </Bar>
      </RBarChart>
    </ChartContainer>
  );
}
