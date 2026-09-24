import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { cn } from "@/lib/utils";
import { StatusDot, type StatusTone } from "@/ui/status-dot";
import { notify } from "@/ui/notify";
import type { ScanFinding, ScanLevel } from "@/types";
import { mcpText } from "./McpPage.i18n";

/** 级别从高到低 */
export const LEVELS: readonly ScanLevel[] = ["high", "medium", "low"];
const RANK: Record<ScanLevel, number> = { high: 0, medium: 1, low: 2 };

/** 级别的先后，排序用 */
export const rank = (l: ScanLevel) => RANK[l] ?? 3;

/** 级别 → 状态点的语气：高红、中琥珀、低灰 */
export function levelTone(level: ScanLevel): StatusTone {
  return level === "high" ? "error" : level === "medium" ? "warn" : "idle";
}

/** 几处发现里最高的那一级。一处都没有就是 `null` */
export function worst(findings: ScanFinding[]): ScanLevel | null {
  let out: ScanLevel | null = null;
  for (const f of findings) if (out == null || rank(f.level) < rank(out)) out = f.level;
  return out;
}

const TINT: Record<ScanLevel, string> = {
  high: "bg-destructive/10 text-destructive-foreground ring-destructive/25",
  medium: "bg-warning/12 text-warning-foreground ring-warning/30",
  low: "bg-surface text-muted-foreground ring-border",
};

/**
 * 级别：浅底上一个点加一个字。**颜色和字一起说** —— 只靠颜色的话，色弱的人
 * 分不出高和中。
 */
export function Level({ level, className }: { level: ScanLevel; className?: string }) {
  const t = useText(mcpText);
  return (
    <span
      data-slot="level"
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-md px-1.5 tw-label font-medium ring-1 ring-inset",
        TINT[level],
        className,
      )}
    >
      <StatusDot tone={levelTone(level)} />
      {t.levels[level] ?? level}
    </span>
  );
}

/** 路径收成 `~/…`，一行放得下 */
export function shortPath(p: string): string {
  return p.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~");
}

/** 放进剪贴板，说一声。**界面上看不出来的结果才弹提示**，复制就是 */
export function copyText(text: string) {
  navigator.clipboard.writeText(text).then(
    () => notify.success(textOf(commonText).copied),
    (e) => notify.error(e),
  );
}
