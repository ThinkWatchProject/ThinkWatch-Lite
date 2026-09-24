import * as React from "react"
import { cn } from "@/lib/utils"
import * as RechartsPrimitive from "recharts"

const INITIAL_DIMENSION = { width: 320, height: 200 } as const

/**
 * shadcn 的 chart 容器，**只留了容器和 `Tooltip`**。
 *
 * 原版还带一套 `ChartConfig` 上下文、`ChartTooltipContent` 和 `ChartLegend*`：
 * 悬停提示现在是 `charts.tsx` 自己画的（抬头要有这一格的合计和请求数，各层按
 * 图里从上到下的次序列），图例是概览上的模型排行，那几样没有调用方了。原版的
 * `color` / `theme` 更早就删了：它把配色拼成 `--color-<键>` 写进一段 `<style>`，
 * 而这里的键是模型名 —— 客户端请求里带来的、任意的字符串，拼进样式表就是一个
 * CSS 注入口。颜色由调用方直接给到图形上（`stroke` / `fill`）。
 */
function ChartContainer({
  className,
  children,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<"div"> & {
  children: React.ComponentProps<
    typeof RechartsPrimitive.ResponsiveContainer
  >["children"]
  initialDimension?: {
    width: number
    height: number
  }
}) {
  return (
    <div
      data-slot="chart"
      className={cn(
        "flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-surface]:outline-hidden",
        className
      )}
      {...props}
    >
      <RechartsPrimitive.ResponsiveContainer
        initialDimension={initialDimension}
      >
        {children}
      </RechartsPrimitive.ResponsiveContainer>
    </div>
  )
}

const ChartTooltip = RechartsPrimitive.Tooltip

export { ChartContainer, ChartTooltip }
