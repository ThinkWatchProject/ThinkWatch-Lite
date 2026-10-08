import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 行首的小方块：客户端的标志，或者一个图标。**28px、细边、压一档的底**，
 * 和空状态里的图标位是同一种面，只是小一号。密钥页、客户端页的每一行和它们的
 * 对话框标题都用它。
 */
export function Tile({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
    >
      {children}
    </span>
  );
}
