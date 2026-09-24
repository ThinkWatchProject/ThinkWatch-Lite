import { cn } from "@/lib/utils";
import { SLOTS, type Slot } from "./data";

/**
 * 纵轴的下限：一小时里只有一两个请求时，柱子不该顶满。
 *
 * 每一行按自己的峰值画 —— 看的是这一家一天里的形状（白天成片、夜里没有），量
 * 有多大写在右边的数字里。但只有一个请求的那一家要是也顶满，看起来就和一小时
 * 几十个的那家一样忙。
 */
const MIN_PEAK = 4;

/** 一根柱子 2px、间隔 1px，一共 `SLOTS` 根。读到之前的占位按这个宽度画 */
export const SPARKLINE_WIDTH = SLOTS * 3 - 1;

/**
 * 一天的走势：一小时一根柱子，最右边是现在这一小时。
 *
 * **和密钥页的小柱图同一个样子**（柱宽、高度、配色、空格子的底线），两页并排看是
 * 同一套东西；多出来的一样是失败：这一小时里失败的那一截画在柱顶、用红色 ——
 * 上游好不好，看的就是失败落在哪几个小时。
 *
 * **没有请求的小时也占一格**，画成一道很淡的底线：跳过的话空档被挤没，看起来就是
 * 一直在用。用普通的块元素画，不用 SVG：高度变化要能走过渡（`motion-bar`），而
 * WebKit 对 SVG 几何属性的过渡支持不齐。
 */
export function Sparkline({ slots, className }: { slots: Slot[]; className?: string }) {
  const peak = Math.max(MIN_PEAK, ...slots.map((s) => s.requests));
  const last = slots.length - 1;
  return (
    <span data-slot="sparkline" aria-hidden className={cn("flex h-4 shrink-0 items-end gap-px", className)}>
      {slots.map((s, i) => {
        if (s.requests === 0) return <span key={s.at} className="h-px w-[2px] rounded-[1px] bg-foreground/[0.08]" />;
        const share = s.requests / peak;
        const bad = s.failed / s.requests;
        return (
          <span
            key={s.at}
            className={cn(
              "relative w-[2px] overflow-hidden rounded-[1px] motion-bar",
              i === last ? "bg-chart-1" : "bg-chart-2",
            )}
            // 有请求的格子至少 3px 高：一次请求的那一格要看得见
            style={{ height: `max(3px, ${Math.round(share * 100)}%)` }}
          >
            {bad > 0 && (
              <span
                className="absolute inset-x-0 top-0 bg-destructive motion-bar"
                style={{ height: `max(1px, ${Math.round(bad * 100)}%)` }}
              />
            )}
          </span>
        );
      })}
    </span>
  );
}
