import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 状态点的五种语气。**全应用只有这五种**，页面把自己的状态映到其中一种：
 *
 * · `ok`      在工作、健康、已生效（绿）
 * · `warn`    能用但要留意：启动中、重试中、降级（琥珀）
 * · `error`   失败、停止、不可用（红）
 * · `idle`    没有在工作，但也不是故障：未使用、已停用、尚无数据（灰）
 * · `pending` 正在进行、结果未定：连接中、获取中、请求在途（深灰，默认带脉冲）
 */
export type StatusTone = "ok" | "warn" | "error" | "idle" | "pending";

const TONE: Record<StatusTone, string> = {
  ok: "text-success",
  warn: "text-warning",
  error: "text-destructive",
  idle: "text-idle",
  pending: "text-muted-foreground",
};

/**
 * 一个状态点。颜色取文字色（`currentColor`），所以放在 `StatusLabel` 里时点和字
 * 同色；单独用时只有点有颜色。
 *
 * `pulse`：实时在发生（请求在途、正在连接）。`pending` 默认就带，其余默认不带。
 */
export function StatusDot({
  tone,
  pulse,
  size = "sm",
  className,
  label,
}: {
  tone: StatusTone;
  pulse?: boolean;
  /** `sm` 6px（表格、侧栏）；`md` 8px（页头摘要、大一号的场合） */
  size?: "sm" | "md";
  className?: string;
  /** 读屏用。点旁边已经有文字时不传 */
  label?: string;
}) {
  const live = pulse ?? tone === "pending";
  return (
    <span
      data-slot="status-dot"
      data-tone={tone}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        "inline-block shrink-0 rounded-full bg-current",
        size === "sm" ? "size-1.5" : "size-2",
        TONE[tone],
        live && "motion-live",
        className,
      )}
    />
  );
}

/**
 * 点加一句状态文字，点和字同色。表格的「状态」列、侧栏底部、页头摘要都用它。
 * `muted` 时字用次要色、只有点带颜色 —— 一列里多数行都「正常」时用，免得满列绿字。
 */
export function StatusLabel({
  tone,
  pulse,
  muted,
  className,
  children,
}: {
  tone: StatusTone;
  pulse?: boolean;
  muted?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-slot="status-label"
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5 tw-body",
        muted ? "text-muted-foreground" : TONE[tone],
        className,
      )}
    >
      <StatusDot tone={tone} pulse={pulse} className={muted ? TONE[tone] : undefined} />
      <span className="truncate">{children}</span>
    </span>
  );
}
