import { cn } from "@/lib/utils";

/**
 * 一根横条：一道浅灰的槽，按 `value / max` 填上一截。宽度变化时走过去（`motion-bar`），不跳。
 *
 * 概览（模型排行、缓存命中率、延迟、生成速度）、会话每一轮的费用、留档的占用、额度、
 * 更新的下载进度用的都是它。原来是各写各的：槽有三种灰、灰色的填充有两种浓淡、有的
 * 一点点的量看不见 —— 现在只有这一份，差别只剩下面这几个属性说得出理由的：
 *
 * · `size`：条多粗。`sm`（4px）跟在一行字旁边，`md`（6px）一般的条、带竖线记号的条，
 *   `lg`（8px）一节里唯一的主角（模型排行、命中率）。
 * · 填充的颜色：数据可视化给 `color`（`var(--chart-2)`、模型的那一色）；不说数据的条
 *   按 `tone` —— 平时是灰的（占用本身不是问题），要提醒时才上琥珀、红；`strong` 是
 *   此刻正在等的那件事（下载进度），用前景色。
 * · `from`：区间条，从 `from` 填到 `value`（延迟的 P50 到 P95）。
 * · `mark`：填充的起点或终点上一道竖线（中位数）。
 * · `label`：要让读屏知道它是多少时给（`role="meter"`，进度条传 `role="progressbar"`）；
 *   旁边已经写着数的不给，整根藏起来。
 *
 * **有量就看得见**：不是 0 的那一截至少 2px —— 一根空槽读作「没有」。
 */
export function Meter({
  value,
  max,
  from = 0,
  size = "md",
  color,
  tone = "neutral",
  mark,
  label,
  valueText,
  role = "meter",
  className,
}: {
  value: number;
  max: number;
  /** 区间条从哪里开始填。默认从 0 */
  from?: number;
  size?: "sm" | "md" | "lg";
  /** 数据可视化的填充色，CSS 颜色值（`var(--chart-1)`）。给了就不看 `tone` */
  color?: string;
  tone?: "neutral" | "strong" | "warn" | "error";
  /** 填充的哪一头画一道竖线（`--chart-1`） */
  mark?: "start" | "end";
  /** 读屏念的名字。不给就整根藏起来 */
  label?: string;
  /** 读屏念的数值（「412 MB / 2 GB」）。不给就念 `value` */
  valueText?: string;
  role?: "meter" | "progressbar";
  className?: string;
}) {
  const pct = (v: number) => (max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0);
  const start = pct(from);
  const span = Math.max(0, pct(value) - start);
  const a11y = label
    ? {
        role,
        "aria-label": label,
        "aria-valuemin": 0,
        "aria-valuemax": max,
        "aria-valuenow": Math.max(0, Math.min(value, max)),
        "aria-valuetext": valueText,
      }
    : { "aria-hidden": true };
  return (
    <span {...a11y} className={cn("relative flex rounded-full bg-foreground/[0.08]", SIZE[size], className)}>
      {start > 0 && <span className="motion-bar shrink-0" style={{ width: `${start}%` }} />}
      {/* 区间的两头重合时（P50 = P95）也画：那 2px 和它的竖线就是这个数 */}
      {(value > from || mark) && (
        <span
          className={cn("motion-bar relative shrink-0 rounded-full", !color && TONE[tone])}
          style={{ width: `max(2px, ${span}%)`, background: color }}
        >
          {mark && (
            <span
              className={cn(
                "absolute top-1/2 h-3 w-0.5 -translate-y-1/2 rounded-full bg-chart-1",
                mark === "start" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
              )}
            />
          )}
        </span>
      )}
    </span>
  );
}

const SIZE = { sm: "h-1", md: "h-1.5", lg: "h-2" } as const;

const TONE = {
  neutral: "bg-foreground/45",
  strong: "bg-foreground",
  warn: "bg-warning",
  error: "bg-destructive",
} as const;
