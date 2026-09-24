import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/ui/skeleton";

/**
 * 第一次读数据时的骨架，**和读完之后的版面逐块对齐**：三栏大数、趋势图（连同基线、
 * 刻度和图下那一行）、模型排行。每一块的外框和真实版面同高 —— 数据到了，骨架原地
 * 换成内容，下面的东西一个像素都不挪。
 *
 * **不是一句「读取中…」。**那一行字占的地方和真正的内容差着好几百像素，读完之后
 * 整页会跳一次；而这一页最大的那几个数字恰好在跳动的位置上。
 */
export function OverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="overview-skeleton">
      {/* 三个大数：名目 19、数 42、环比 20、限定语 16，间距同 `Stat` */}
      <div className="grid grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-w-0 border-l border-border pl-6 first:border-l-0 first:pl-0">
            <Box h="h-[19px]">
              <Skeleton className="h-3 w-14 rounded-sm" />
            </Box>
            <Box h="mt-1 h-[42px]">
              <Skeleton className="h-[30px] w-32 rounded-md" />
            </Box>
            <Box h="mt-1.5 h-5">
              <Skeleton className="h-5 w-12 rounded-md opacity-70" />
              <Skeleton className="h-2.5 w-20 rounded-sm opacity-60" />
            </Box>
            <Box h="mt-1 h-4">
              <Skeleton className="h-2.5 w-28 rounded-sm opacity-50" />
            </Box>
          </div>
        ))}
      </div>

      {/* 趋势：标题行 28（右边是口径的分段控件），图 200，基线和刻度 30，图下一行 16 */}
      <div className="mt-8">
        <div className="mb-3 flex h-7 items-end justify-between">
          <Skeleton className="mb-1 h-3 w-10 rounded-sm" />
          <Skeleton className="h-7 w-28 rounded-lg" />
        </div>
        <Skeleton className="h-[200px] w-full rounded-md opacity-80" />
        <div className="relative h-[30px]">
          <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-border" />
          <div className="absolute inset-x-0 bottom-0 flex h-4 items-center justify-between">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-2.5 w-10 rounded-sm opacity-50" />
            ))}
          </div>
        </div>
        <div className="mt-1.5 h-4" />
      </div>

      {/* 模型排行：标题 19，行 32 */}
      <div className="mt-8">
        <Box h="mb-3 h-[19px]">
          <Skeleton className="h-3 w-10 rounded-sm" />
        </Box>
        {[0.9, 0.35, 0.22, 0.12].map((w, i) => (
          <div key={i} className="flex h-8 items-center gap-3" style={{ opacity: 1 - i * 0.18 }}>
            <Skeleton className="size-4 rounded-sm" />
            <Skeleton className="h-3 w-32 rounded-sm" />
            <div className="min-w-12 flex-1">
              <Skeleton className="h-2 rounded-full" style={{ width: `${w * 100}%` }} />
            </div>
            <Skeleton className="h-3 w-12 rounded-sm" />
            <Skeleton className="h-3 w-12 rounded-sm" />
            <Skeleton className="h-2.5 w-8 rounded-sm" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 一格定高的外框：里面的骨架条竖着居中 */
function Box({ h, children }: { h: string; children: ReactNode }) {
  return <div className={cn("flex items-center gap-1.5", h)}>{children}</div>;
}
