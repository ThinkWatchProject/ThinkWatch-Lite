import { cn } from "@/lib/utils";
import { SLOTS, type Slot } from "./data";

/** 柱高多少像素。和两行字（次数、费用）叠起来差不多高 */
const HEIGHT = 20;

/**
 * 纵轴的下限：一小时里只有一两个请求时，柱子不该顶满。
 *
 * 每一行按自己的峰值画 —— 看的是这一家一天里的形状（白天成片、夜里没有），量
 * 有多大写在右边的数字里。但只有一个请求的那一家要是也顶满，看起来就和一小时
 * 几十个的那家一样忙。
 */
const MIN_PEAK = 4;

/** 一根柱子 3px、间隔 1px，一共 `SLOTS` 根。读到之前的占位按这个宽度画 */
export const SPARKLINE_WIDTH = SLOTS * 4 - 1;

/**
 * 一天的走势：一小时一根柱子，最右边是现在这一小时。
 *
 * **没有请求的小时也占一格**，画成贴底的一道细线 —— 跳过的话空档被挤没，看起来
 * 就是一直在用。失败的那一截画在柱顶、用红色：失败集中在哪个小时一眼看得见。
 *
 * 用普通的块元素画，不用 SVG：高度变化要能走过渡（`motion-bar`），而 WebKit
 * 对 SVG 几何属性的过渡支持不齐。
 */
export function Sparkline({ slots, className }: { slots: Slot[]; className?: string }) {
  const peak = Math.max(MIN_PEAK, ...slots.map((s) => s.requests));
  return (
    <div
      data-slot="sparkline"
      aria-hidden
      className={cn("flex shrink-0 items-end gap-px", className)}
      style={{ height: HEIGHT }}
    >
      {slots.map((s) => {
        if (s.requests === 0) return <div key={s.at} className="h-px w-[3px] shrink-0 rounded-full bg-border" />;
        const h = Math.max(2, Math.round((s.requests / peak) * HEIGHT));
        const bad = s.failed > 0 ? Math.min(h, Math.max(2, Math.round((s.failed / s.requests) * h))) : 0;
        return (
          <div
            key={s.at}
            className="relative w-[3px] shrink-0 overflow-hidden rounded-[1px] bg-muted-foreground/55 motion-bar"
            style={{ height: h }}
          >
            {bad > 0 && <div className="absolute inset-x-0 top-0 bg-destructive motion-bar" style={{ height: bad }} />}
          </div>
        );
      })}
    </div>
  );
}
