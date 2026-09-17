/**
 * 上游页几张表和几个对话框共用的小件。
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/ui/label";

/** 状态点：正常、需要留意、失败、已停用 */
export function StatusDot({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "off";
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <i
        aria-hidden
        className={cn(
          "inline-block size-1.5 shrink-0 rounded-full",
          tone === "ok" && "bg-success",
          tone === "warn" && "bg-warning",
          tone === "bad" && "bg-destructive",
          tone === "off" && "bg-muted-foreground/50",
        )}
      />
      <span className={cn(tone === "off" && "text-muted-foreground")}>{children}</span>
    </span>
  );
}

/** 一组名称标签（使用上游、引用它的上游）。空的时候说清是空的 */
export function NameChips({ names, empty }: { names: string[]; empty: string }) {
  if (names.length === 0) {
    return <span className="text-muted-foreground">{empty}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-md border border-border bg-muted/40 px-1.5 font-mono tw-label leading-5"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

/** 表单里的一项：标签在上，说明在下 */
export function FormItem({
  label,
  desc,
  htmlFor,
  className,
  children,
}: {
  label: string;
  desc?: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor} className="tw-body font-medium">
        {label}
      </Label>
      {children}
      {desc && <p className="tw-label text-muted-foreground">{desc}</p>}
    </div>
  );
}

/**
 * 几个互斥选项排成一段。**不是标签页** —— 它改的是一个值，不切换视图。
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex h-7 w-fit items-center rounded-lg bg-muted p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={disabled}
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

/** 单选的一行：圆点 + 标题 + 说明 */
export function RadioRow({
  checked,
  title,
  desc,
  onSelect,
  disabled,
}: {
  checked: boolean;
  title: string;
  desc: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      disabled={disabled}
      onClick={onSelect}
      className="flex w-full items-start gap-2.5 rounded-md text-left disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input",
          checked && "border-primary",
        )}
      >
        {checked && <span className="size-2 rounded-full bg-primary" />}
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="tw-body font-medium">{title}</span>
        <span className="tw-label text-muted-foreground">{desc}</span>
      </span>
    </button>
  );
}

/** 对话框顶部的分节导航。新建时按顺序走，编辑时随意切换 */
export function StepNav<T extends string>({
  steps,
  current,
  done,
  onPick,
}: {
  steps: { id: T; label: string }[];
  current: T;
  /** 新建流程里已经走过的；编辑时传 undefined，每一节都能点 */
  done?: Set<T>;
  onPick?: (id: T) => void;
}) {
  return (
    <ol className="flex items-center gap-1">
      {steps.map((s, i) => {
        const on = s.id === current;
        const reachable = !done || done.has(s.id) || on;
        return (
          <li key={s.id} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden className="mx-1 h-px w-6 bg-border" />}
            <button
              type="button"
              disabled={!reachable || !onPick}
              onClick={() => onPick?.(s.id)}
              aria-current={on ? "step" : undefined}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2 tw-body font-medium text-muted-foreground transition-colors enabled:hover:text-foreground disabled:cursor-default",
                on && "bg-muted text-foreground",
              )}
            >
              {done && (
                <span
                  className={cn(
                    "inline-flex size-4 items-center justify-center rounded-full border border-input tw-label tabular-nums",
                    (on || done.has(s.id)) && "border-foreground/40 text-foreground",
                  )}
                >
                  {i + 1}
                </span>
              )}
              {s.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** 表格外框：圆角、描边、内部可滚 */
export function Boxed({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn("overflow-hidden rounded-lg border border-border", className)}>
      {children}
    </div>
  );
}

/** 对话框里一段说明或提示 */
export function Note({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warning" | "error";
  children: ReactNode;
}) {
  return (
    <p
      className={cn(
        "tw-label",
        tone === "muted" && "text-muted-foreground",
        tone === "warning" && "text-warning",
        tone === "error" && "text-destructive",
      )}
    >
      {children}
    </p>
  );
}
