import { Toaster as Sonner, type ToasterProps } from "sonner"

import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon } from "lucide-react"

/**
 * 改过一处：去掉了 `next-themes`。
 *
 * 抄进来的那版从 `useTheme()` 读当前主题 —— 那是 Next.js 那套「应用自己
 * 管明暗、往根上打 class」的做法。这个应用是跟随系统的（`index.css` 开头
 * 就写着：没有切换器，所以不需要那段在首次绘制前跑的脚本），没有主题状态
 * 可读。`theme="system"` 是它唯一正确的值，也就省掉了一个只为读一个常量
 * 而引进来的依赖。
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
