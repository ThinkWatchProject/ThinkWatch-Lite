import { cn } from "@/lib/utils";
import { Skeleton } from "@/ui/skeleton";
import { CHART_H } from "./HeroAxis";

/**
 * 第一次读数据时的骨架，**和读完之后的版面逐块对齐**：用量（六个指标一排、细项一行、带
 * 纵轴的大图和横轴）、去向和额度两栏、最近一年、明细表。数据到了，骨架原地换成内容，
 * 下面的东西不挪。
 *
 * **不是一句「读取中…」。**那一行字占的地方和真正的内容差着好几百像素，读完之后整页
 * 会跳一次；而这一页最大的那几个数字恰好在跳动的位置上。
 *
 * 去向、额度、最近一年三块的高度按设计稿取：它们的内容由各自的数据决定，骨架只占住
 * 大致的地方。
 */
export function OverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="overview-skeleton" className="flex flex-col gap-3.5">
      {/* 用量：和 `Hero` 同一套格子和留白 */}
      <div className="rounded-[10px] border border-border bg-panel">
        <div className="grid grid-cols-3 border-b border-border @min-[760px]/page:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            /* 一格：上 12、名目 18、1、大数 30、1、环比 16、下 11 */
            <div
              key={i}
              className={cn(
                "flex min-w-0 flex-col items-start gap-px border-border px-4 pt-3 pb-[11px]",
                (i === 1 || i === 2) && "border-l",
                i === 3 && "border-t @min-[760px]/page:border-t-0 @min-[760px]/page:border-l",
                i >= 4 && "border-t border-l @min-[760px]/page:border-t-0",
              )}
            >
              <div className="flex h-[18px] items-center">
                <Skeleton className="h-3 w-12 rounded-sm" />
              </div>
              <div className="flex h-[30px] items-center">
                <Skeleton className="h-6 w-20 rounded-md" />
              </div>
              <div className="flex h-4 items-center">
                <Skeleton className="h-2.5 w-9 rounded-sm opacity-60" />
              </div>
            </div>
          ))}
        </div>
        <div className="pt-3.5 pr-5 pb-3.5 pl-3">
          <div className="flex h-5 items-center pl-11">
            <Skeleton className="h-3 w-48 rounded-sm opacity-60" />
          </div>
          <div className="mt-3 flex">
            <div className="flex w-11 shrink-0 flex-col justify-between py-0.5 pr-2.5" style={{ height: CHART_H }}>
              {[0, 1, 2, 3, 4].map((k) => (
                <Skeleton key={k} className="ml-auto h-2.5 w-6 rounded-sm opacity-40" />
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <Skeleton className="w-full rounded-md opacity-50" style={{ height: CHART_H }} />
              <div className="mt-[7px] flex h-4 items-center justify-between">
                {[0, 1, 2, 3, 4, 5].map((k) => (
                  <Skeleton key={k} className="h-2.5 w-8 rounded-sm opacity-40" />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 去向 | 额度与余额 */}
      <div className="grid gap-3.5 @min-[760px]/page:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="h-[312px] rounded-[10px] border border-border bg-panel px-4 pt-3.5">
            <Skeleton className="h-3 w-16 rounded-sm" />
            {[0.9, 0.7, 0.5, 0.35, 0.25].map((w, k) => (
              <div key={k} className="mt-5 flex items-center gap-3" style={{ opacity: 1 - k * 0.15 }}>
                <Skeleton className="h-3 rounded-sm" style={{ width: `${w * 45}%` }} />
                <Skeleton className="ml-auto h-3 w-10 rounded-sm" />
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* 最近一年 */}
      <div className="h-[300px] rounded-[10px] border border-border bg-panel px-4 pt-3.5">
        <Skeleton className="h-3 w-20 rounded-sm" />
        <Skeleton className="mt-6 h-[150px] w-full rounded-md opacity-40" />
      </div>

      {/* 明细：和上面几块同一副外框。标题行 28、8、表头 28、行 31 */}
      <div className="rounded-[10px] border border-border bg-panel px-4 pt-3 pb-1">
        <Skeleton className="h-7 w-40 rounded-lg" />
        <div className="mt-2 h-7 border-b border-border" />
        {[0.9, 0.6, 0.4, 0.25].map((w, i) => (
          <div key={i} className="flex h-[31px] items-center gap-6 border-b border-border last:border-b-0" style={{ opacity: 1 - i * 0.18 }}>
            <Skeleton className="h-3 rounded-sm" style={{ width: `${w * 30}%` }} />
            <div className="ml-auto flex gap-6">
              {[0, 1, 2, 3, 4, 5].map((j) => (
                <Skeleton key={j} className="h-3 w-10 rounded-sm" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
