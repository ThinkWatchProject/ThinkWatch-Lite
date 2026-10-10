import { cn } from "@/lib/utils";
import { TW_STROKES } from "./tw-strokes";

/**
 * ThinkWatch 自己的标志，和厂商标志一样**单色**、跟着文字色走（`@/ui/logos`），放进
 * 同一种方片里一列对得齐。启动画面上那个带霓虹渐变、一笔一笔画出来的是同样四笔。
 */
export function AppMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      data-slot="logo"
      // 四笔连笔帽落在 (5.7, 7.7)–(26.3, 26.3)：正方形的画框，图形居中
      viewBox="5 6 22 22"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={cn("shrink-0", className)}
    >
      {TW_STROKES.map(([d]) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
