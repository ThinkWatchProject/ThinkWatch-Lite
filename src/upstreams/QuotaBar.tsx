import { cn } from "@/lib/utils";

/** 额度用到这个比例就算紧张（琥珀） */
export const QUOTA_WARN = 80;
/** 用满：这个窗口里已经用完（红） */
export const QUOTA_FULL = 100;

/**
 * 订阅额度的一根条：已用的比例。
 *
 * 平时是灰的 —— 这个界面只在说状态时用颜色：用到八成变琥珀（紧张），用满变红
 * （用完）。宽度变化走过去（`motion-bar`），额度随请求涨的时候不跳。
 */
export function QuotaBar({ percent, label, className }: { percent: number; label: string; className?: string }) {
  const v = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className={cn("h-1 overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn(
          "h-full rounded-full motion-bar",
          percent >= QUOTA_FULL ? "bg-destructive" : percent >= QUOTA_WARN ? "bg-warning" : "bg-foreground/50",
        )}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
