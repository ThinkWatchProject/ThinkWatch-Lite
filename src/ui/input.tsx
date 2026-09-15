import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * 加了一档 `inline`。
 *
 * 表格里有「就地改」的格子（每客户端并发上限、自定义价格）——它们平时
 * 不显边框，鼠标移上去才显，因为一列里十几个输入框各带一个框，读起来
 * 就不是一张表了。默认档是 32px 高、带边框的表单字段，套上去会让每一
 * 行都变高。
 *
 * **走 cva 而不是在调用点用 className 盖。**盖的话样式散在十几个页面
 * 里，而且和组件自己的 `focus-visible` / `aria-invalid` 打架；加一档是
 * shadcn 自己写在文档里的扩展方式。
 */
const inputVariants = cva(
  "w-full min-w-0 border text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default: "h-8 rounded-lg border-input bg-transparent px-2.5 py-1 dark:bg-input/30",
        inline:
          "h-6 rounded-md border-transparent bg-transparent px-1 hover:border-input focus-visible:border-ring",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Input({
  className,
  type,
  variant,
  ...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(inputVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Input, inputVariants }
