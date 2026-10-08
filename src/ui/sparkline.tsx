import { memo } from "react";
import { cn } from "@/lib/utils";
import { Tip } from "@/ui/tip";

/**
 * 一排小柱子：一格一段时间（一小时、一分钟），最右边那一格是正在走的这一段。
 *
 * 密钥页和客户端页（24 小时）、上游页（24 小时）、流量页页头（近 30 分钟）用的都是它。
 * 原来是三份各自手写的，慢慢走了样：一份没有纵轴下限（一次请求就顶满）、一份失败
 * 画在柱顶、一份失败垫在柱底而且是灰的。现在只有这一份：
 *
 * · **每一排按自己的峰值画**：它回答的是「什么时候在用」，量有多大由旁边的数字说。
 *   但峰值**至少按 `MIN_PEAK` 算**：只有一两次请求的那一排要是也顶满，看起来就和
 *   一格几十次的那排一样忙。
 * · **有请求的格子至少 3px 高**：一次请求的那一格要看得见。
 * · **失败的那一截垫在柱底、用红色**：和概览图基线上的失败标记同一个位置；从同一条
 *   基线量起，几格之间的失败多少才比得出来。
 * · **数据可视化的颜色**（`--chart-2`），最右那一格（「现在」）用 `--chart-1`。
 * · **没有请求的格子也占一格**，画一道很淡的底线：跳过的话空档被挤没，看起来就是一直
 *   在用；什么都不画的话又像是没取到。
 *
 * 用普通的块元素画，不用 SVG：高度变化要能走过渡（`motion-bar`），而 WebKit 对 SVG
 * 几何属性的过渡支持不齐。
 */

/** 一格。`n` 是这一格多少次，`failed` 是其中失败的 */
export interface SparkBar {
  n: number;
  failed?: number;
  /**
   * 这一格从哪一刻起。给了就按它认格子：整排往左挪一格时，柱子跟着挪，不在原地
   * 变高变矮
   */
  at?: number;
}

/** 纵轴的下限：峰值不到这个数时按它算满 */
const MIN_PEAK = 4;

/** 一排 `n` 格有多宽（不带 `tip` 的那种：柱子 2px、间隔 1px）。读到之前的占位按这个宽度画 */
export function sparklineWidth(n: number): number {
  return n * 3 - 1;
}

function SparklineBars<B extends SparkBar>({
  bars,
  tip,
  label,
  className,
}: {
  bars: readonly B[];
  /**
   * 每一格悬停时说什么。给了的话每一格是 4px 宽的悬停区、柱子 3px —— 2px 的柱子
   * 指不准；格与格之间没有摸不到的缝。不给就是柱子 2px、间隔 1px，整排不接指针
   */
  tip?: (bar: B) => string;
  /** 读屏念的一句话。不给就整排藏起来：旁边已经写着数，一排柱子念出来是几十个数 */
  label?: string;
  className?: string;
}) {
  const peak = Math.max(MIN_PEAK, ...bars.map((b) => b.n));
  const last = bars.length - 1;
  return (
    <span
      data-slot="sparkline"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
      className={cn("inline-flex h-4 shrink-0 items-end", !tip && "gap-px", className)}
    >
      {bars.map((b, i) => {
        const key = b.at ?? i;
        const props = { n: b.n, failed: b.failed ?? 0, peak, now: i === last, wide: tip !== undefined };
        if (!tip) return <Bar key={key} {...props} />;
        return (
          <Tip key={key} text={tip(b)}>
            <span aria-hidden className="flex h-4 w-1 items-end justify-center">
              <Bar {...props} />
            </span>
          </Tip>
        );
      })}
    </span>
  );
}

/** 见文件开头。`bars` 和 `tip` 保持同一个引用时不重画（流量页页头每条请求都会重画一次） */
export const Sparkline = memo(SparklineBars) as typeof SparklineBars;

function Bar({ n, failed, peak, now, wide }: { n: number; failed: number; peak: number; now: boolean; wide: boolean }) {
  const w = wide ? "w-[3px]" : "w-[2px]";
  if (n <= 0) return <span className={cn("h-px rounded-[1px] bg-foreground/[0.08]", w)} />;
  return (
    <span
      className={cn("relative overflow-hidden rounded-[1px] motion-bar", w, now ? "bg-chart-1" : "bg-chart-2")}
      style={{ height: `max(3px, ${Math.round((n / peak) * 100)}%)` }}
    >
      {failed > 0 && (
        <span
          className="absolute inset-x-0 bottom-0 bg-destructive motion-bar"
          style={{ height: `max(1px, ${Math.round((Math.min(failed, n) / n) * 100)}%)` }}
        />
      )}
    </span>
  );
}
