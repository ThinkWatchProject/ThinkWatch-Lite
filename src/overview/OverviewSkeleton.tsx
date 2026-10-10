import { Skeleton } from "@/ui/skeleton";

/**
 * 第一次读数据时的骨架，**和读完之后的版面逐块对齐**：六张指标卡（名目、大数、注解、
 * 小图、首尾两头，外框和真卡片同高）、明细表的切换和几行。数据到了，骨架原地换成内容，
 * 下面的东西一个像素都不挪。
 *
 * **不是一句「读取中…」。**那一行字占的地方和真正的内容差着好几百像素，读完之后整页
 * 会跳一次；而这一页最大的那几个数字恰好在跳动的位置上。
 */
export function OverviewSkeleton() {
  return (
    <div role="status" aria-busy="true" data-slot="overview-skeleton" className="flex flex-col gap-6">
      <div className="@container">
        <div className="grid grid-cols-2 gap-3 @min-[680px]:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            /* 卡片：上 14、名目 20、6、大数 29、3、注解 16、12、图 64、6、首尾 16、下 12，加边框 */
            <div key={i} className="flex min-w-0 flex-col rounded-[10px] border border-border bg-panel px-4 pt-3.5 pb-3">
              <div className="flex h-5 items-center justify-between">
                <Skeleton className="h-3 w-14 rounded-sm" />
                <Skeleton className="h-5 w-11 rounded-md opacity-60" />
              </div>
              <div className="mt-1.5 flex h-[29px] items-center">
                <Skeleton className="h-6 w-24 rounded-md" />
              </div>
              <div className="mt-[3px] flex h-4 items-center">
                <Skeleton className="h-2.5 w-32 rounded-sm opacity-60" />
              </div>
              <Skeleton className="mt-3 h-16 w-full rounded-md opacity-50" />
              <div className="mt-1.5 flex h-4 items-center justify-between">
                <Skeleton className="h-2.5 w-12 rounded-sm opacity-50" />
                <Skeleton className="h-2.5 w-8 rounded-sm opacity-50" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 明细表：离卡片 24（和真版面的 gap 加 mt 一样），切换 28、8、表头 28、行 31 */}
      <div>
        <Skeleton className="h-7 w-40 rounded-lg" />
        <div className="mt-2 h-7 border-b border-border" />
        {[0.9, 0.6, 0.4, 0.25].map((w, i) => (
          <div key={i} className="flex h-[31px] items-center gap-6 border-b border-border" style={{ opacity: 1 - i * 0.18 }}>
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
