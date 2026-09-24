// 改过一处：明暗用 `motion-shimmer`（比 animate-pulse 慢、幅度小，系统关掉动效时
// 不动），底色用前景色的 7%：`bg-muted` 在浅色的窗口底上几乎看不见。
import { cn } from "@/lib/utils"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("motion-shimmer rounded-md bg-foreground/[0.07]", className)}
      {...props}
    />
  )
}

export { Skeleton }
