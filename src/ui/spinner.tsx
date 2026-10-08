import { cn } from "@/lib/utils"
import { useText } from "@/i18n"

import { Loader2Icon } from "lucide-react"
import { uiText } from "./ui.i18n"

// 改过一处：读屏标签原来写死英文「Loading」，换成界面语言的那一句
function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const t = useText(uiText)
  return (
    <Loader2Icon data-slot="spinner"
      role="status"
      aria-label={t.loading}
      className={cn("size-4 animate-spin", className)}
      {...props} />
  )
}

export { Spinner }
