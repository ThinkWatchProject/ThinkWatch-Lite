import { Meter } from "@/ui/meter";

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
  return (
    <Meter
      role="progressbar"
      size="sm"
      value={percent}
      max={100}
      tone={percent >= QUOTA_FULL ? "error" : percent >= QUOTA_WARN ? "warn" : "neutral"}
      label={label}
      className={className}
    />
  );
}
