import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { ChevronRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/ui/badge";
import { LetterTile, Logo } from "@/ui/logos";
import { StatusDot } from "@/ui/status-dot";
import { useText } from "@/i18n";
import { modelGlyph } from "./series";
import { overviewText } from "./overview.i18n";

/**
 * 概览里几张排行共用的小零件。
 */

/** Enter 和空格都算「打开」：可以点的行、可以点的字，键盘上和鼠标一样 */
function onActivate(open: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
}

/**
 * 排行里的一行。给了 `onOpen` 就可以点：悬停整行压暗一档、行尾出现箭头，点下去
 * 落到流量页筛好的那一批（或别的页）。没给就是一行普通的字，行尾留出同样宽的
 * 空位，和能点的行对齐。
 *
 * **不是按钮**：它是去另一页的入口，读屏读作链接，Enter 和空格都能打开。
 */
export function LinkRow({
  onOpen,
  onPoint,
  hint,
  className,
  children,
}: {
  onOpen?: () => void;
  /** 指针移进、移出这一行（能点的行，键盘聚焦、失焦也算）。图例用它突出图里那一层 */
  onPoint?: (on: boolean) => void;
  /** 读屏在这一行后面读出来的去向（「在流量中查看」） */
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  const base = "group/row -mx-2 flex h-8 min-w-0 items-center gap-3 rounded-md px-2 tw-body";
  const point = onPoint && {
    onMouseEnter: () => onPoint(true),
    onMouseLeave: () => onPoint(false),
  };
  if (!onOpen)
    return (
      <div className={cn(base, className)} {...point}>
        {children}
        <span aria-hidden className="size-3.5 shrink-0" />
      </div>
    );
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onActivate(onOpen)}
      {...point}
      onFocus={onPoint && (() => onPoint(true))}
      onBlur={onPoint && (() => onPoint(false))}
      className={cn(
        base,
        "cursor-pointer outline-none transition-colors duration-(--motion-fast) ease-(--motion-ease)",
        "hover:bg-foreground/[0.045] focus-visible:bg-foreground/[0.045] focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    >
      {children}
      {hint && <span className="sr-only">{hint}</span>}
      <ChevronRightIcon
        aria-hidden
        className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-(--motion-fast) group-hover/row:opacity-100 group-focus-visible/row:opacity-100"
      />
    </div>
  );
}

/**
 * 一段可以点的字（「6 次失败」「3 条无法计价」）。悬停出下划线，键盘同样能打开。
 *
 * **别的属性原样落到这个 span 上**：套在 `Tip` 里时，悬停提示的触发器把指针、焦点的
 * 处理和 ref 交给它，吞掉的话提示永远不出来。
 *
 * 点击和按键只打开它自己，**不再往上冒泡**：它放在一整行都能点的排行里时（排行里
 * 「无法计价」那一格），那一行不该跟着再打开一次。
 */
export function LinkText({
  onOpen,
  className,
  children,
  onClick,
  onKeyDown,
  ...rest
}: Omit<ComponentProps<"span">, "role" | "tabIndex"> & {
  onOpen: () => void;
  children: ReactNode;
}) {
  const activate = onActivate(onOpen);
  return (
    <span
      {...rest}
      role="link"
      tabIndex={0}
      onClick={(e) => {
        onClick?.(e);
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.key === "Enter" || e.key === " ") e.stopPropagation();
        activate(e);
      }}
      className={cn(
        "cursor-pointer rounded-sm underline-offset-2 outline-none transition-colors duration-(--motion-fast) hover:underline focus-visible:underline focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** 模型所属厂商的标志；认不出来画首字母方块。**单色**，跟着文字色走 */
export function ModelMark({ name, className }: { name: string; className?: string }) {
  const g = modelGlyph(name);
  const cls = cn("text-muted-foreground", className);
  return g ? <Logo id={g} size={16} className={cls} /> : <LetterTile name={name} size={16} className={cls} />;
}

/** 合并的「其他」那一行没有标志：留同样宽的空位，名字才对得齐 */
export function MarkSpace() {
  return <span aria-hidden className="size-4 shrink-0" />;
}

/** 节标题右边的一小行：这一块按什么口径统计（实时档下的「24 小时」） */
export function Scope({ children }: { children: ReactNode }) {
  return <span className="tw-label text-muted-foreground">{children}</span>;
}

/** 实时档的标记：绿点在跳，说的是真的 —— 那条曲线确实在动 */
export function LiveBadge() {
  const t = useText(overviewText);
  return (
    <Badge variant="success" className="gap-1.5 text-success-foreground">
      <StatusDot tone="ok" pulse />
      {t.live}
    </Badge>
  );
}

/**
 * 一根横条：底是一道浅灰的槽，按 `value / max` 填上颜色。宽度变化时走过去
 * （`motion-bar`），不跳。
 */
export function Meter({
  value,
  max,
  color,
  className,
}: {
  value: number;
  max: number;
  /** 填充色。CSS 颜色值（`var(--chart-1)`） */
  color: string;
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span className={cn("relative block h-2 overflow-hidden rounded-full bg-foreground/[0.06]", className)}>
      <span
        className="motion-bar absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${pct}%`, background: color }}
      />
    </span>
  );
}

/** 一栏的小标题（「各模型命中率」）。和旁边那栏的抬头一样高：24px */
export function ColumnHead({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <p className="flex h-6 items-center justify-between gap-3 tw-label text-muted-foreground">
      <span className="truncate">{children}</span>
      {aside}
    </p>
  );
}
