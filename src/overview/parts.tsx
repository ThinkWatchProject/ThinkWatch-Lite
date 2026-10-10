import type { ComponentProps, KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 概览里几处共用的小零件。
 */

/** Enter 和空格都算「打开」：可以点的字，键盘上和鼠标一样 */
function onActivate(open: () => void) {
  return (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
}

/**
 * 一段可以点的字（「失败 6 次」「在流量中查看」「无法计价」）。悬停出下划线，键盘同样能打开。
 * **不是按钮**：它是去另一页的入口，读屏读作链接。
 *
 * **别的属性原样落到这个 span 上**：套在 `Tip` 里时，悬停提示的触发器把指针、焦点的
 * 处理和 ref 交给它，吞掉的话提示永远不出来。
 *
 * 点击和按键只打开它自己，**不再往上冒泡**：它放在一整行都能点的明细表里时（「无法计价」
 * 那一格），那一行不该跟着再打开一次。
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
