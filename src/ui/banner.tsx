import type { ReactNode } from "react";
import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Reveal } from "./motion";

/**
 * 横幅的三种语气：
 *
 * · `info`    告知，不用处理（凭据已写回、有新版本）—— 灰
 * · `warning` 要留意，功能还在（配置未通过但仍按旧版本转发、断线后数据停在
 *             断开时）—— 琥珀
 * · `error`   有东西坏了，要处理（凭据没写回、重启后会 401）—— 红
 */
export type BannerTone = "info" | "warning" | "error";

const TONE: Record<BannerTone, { box: string; icon: string; title: string; body: string }> = {
  info: {
    box: "bg-surface border-border",
    icon: "text-muted-foreground",
    title: "text-foreground",
    body: "text-muted-foreground",
  },
  warning: {
    box: "bg-warning/10 border-warning/30",
    icon: "text-warning",
    title: "text-warning-foreground",
    body: "text-warning-foreground/85",
  },
  error: {
    box: "bg-destructive/8 border-destructive/25",
    icon: "text-destructive",
    title: "text-destructive-foreground",
    body: "text-destructive-foreground/85",
  },
};

const ICON: Record<BannerTone, typeof InfoIcon> = {
  info: InfoIcon,
  warning: TriangleAlertIcon,
  error: CircleAlertIcon,
};

/**
 * 横幅：一件持续成立、要一直看得见的事。**不是 toast** —— toast 说「刚才发生了
 * 什么」，会飘走；横幅说「现在是什么状态」，状态结束才消失。
 *
 * 两种摆法：
 * · `strip`（默认）：外壳顶上通栏的一条，只有下边线。App.tsx 的几条就是这种。
 * · `inline`：页面里的一块，四边圆角框。放在 PageHeader 下面、内容上面。
 *
 * `show` 传了就带进出场动画（`Reveal`）；不传就是一直在。
 *
 *   <Banner show={!!rejected} tone="warning" title={t.rejectedTitle}
 *     actions={<Button size="sm" variant="outline">…</Button>}>
 *     {detail}
 *   </Banner>
 */
export function Banner({
  tone = "info",
  title,
  children,
  actions,
  icon,
  layout = "strip",
  show,
  className,
  role,
}: {
  tone?: BannerTone;
  /** 一句话说清是什么事。有它时 `children` 是补充说明 */
  title?: ReactNode;
  children?: ReactNode;
  /** 右侧的按钮。`size="sm"`，一般是 `variant="outline"` 或 `ghost` */
  actions?: ReactNode;
  /** 换掉默认图标；传 `null` 不要图标 */
  icon?: ReactNode | null;
  layout?: "strip" | "inline";
  /** 传了就在 true/false 之间带进出场动画 */
  show?: boolean;
  className?: string;
  /** 默认 warning / error 是 `alert`，info 是 `status` */
  role?: string;
}) {
  const s = TONE[tone];
  const Icon = ICON[tone];
  const body = (
    <div
      data-slot="banner"
      data-tone={tone}
      role={role ?? (tone === "info" ? "status" : "alert")}
      className={cn(
        "flex items-start gap-2.5 tw-body",
        layout === "strip" ? "border-b px-5 py-2.5" : "rounded-lg border px-3.5 py-2.5",
        s.box,
        className,
      )}
    >
      {icon !== null && (
        <span className={cn("mt-[3px] shrink-0 [&_svg]:size-3.5", s.icon)}>{icon ?? <Icon />}</span>
      )}
      <div className="min-w-0 flex-1">
        {title && <p className={cn("font-medium", s.title)}>{title}</p>}
        {children && <div className={cn(title && "mt-0.5", title ? s.body : s.title)}>{children}</div>}
      </div>
      {actions && <div className="-my-0.5 flex shrink-0 items-center gap-1.5">{actions}</div>}
    </div>
  );
  return show === undefined ? body : <Reveal show={show}>{body}</Reveal>;
}
