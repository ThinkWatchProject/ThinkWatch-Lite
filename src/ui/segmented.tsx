import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 几个互斥选项排成一段。**不是标签页** —— 它改的是一个值，不切换视图。
 *
 * **全应用的单选都用它**（外观、档位、区间、口径…），不用一排分开的按钮：
 * 分开的按钮读起来是几个各自独立的动作，连在一起才是「几个里选一个」。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { id: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** 读屏读出来的这一组叫什么。旁边没有可见的标题时要给 */
  label?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex h-7 w-fit items-center rounded-lg bg-muted p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled || o.disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-md border border-transparent px-2.5 tw-body font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50",
            value === o.id &&
              "border-input bg-background text-foreground shadow-sm dark:bg-input/30",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
