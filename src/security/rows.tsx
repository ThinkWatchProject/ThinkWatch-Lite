import type { KeyboardEvent, ReactNode } from "react";
import { TableCell, TableRow } from "@/ui/table";

/**
 * 表格行的共同做法：安全页的日志和规则表、MCP 页的几张表都用。
 *
 * · 点一行打开它的详情（有详情的那几张表）；
 * · 行能用 Tab 聚焦，`↑` `↓` 在行之间走（跳过组头），`Enter` / 空格打开；
 * · 键盘聚焦的那一行左边一道竖线、底色深一档，鼠标点的不画（`focus-visible`）。
 */

/** 行上的键盘焦点。不用一圈焦点框：表格行一圈框会压到上下两条表格线 */
export const ROW_FOCUS =
  "outline-none focus-visible:bg-foreground/[0.045] focus-visible:shadow-[inset_2px_0_0_0_color-mix(in_oklab,var(--foreground)_60%,transparent)]";

/** 可以用键盘走到、打开的一行。`open` 不给就只能走到，不能打开 */
export function rowNav(open?: () => void) {
  return {
    tabIndex: 0,
    "data-row-nav": "",
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      // 行里的开关、按钮自己处理自己的键
      if (e.target !== e.currentTarget) return;
      if ((e.key === "Enter" || e.key === " ") && open) {
        e.preventDefault();
        open();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const rows = Array.from(
          e.currentTarget.closest("tbody")?.querySelectorAll<HTMLElement>("[data-row-nav]") ?? [],
        );
        const next = rows[rows.indexOf(e.currentTarget) + (e.key === "ArrowDown" ? 1 : -1)];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      }
    },
  };
}

/** 行里的开关、按钮那一格：点它不算点这一行 */
export const stop = { onClick: (e: { stopPropagation: () => void }) => e.stopPropagation() };

/**
 * 表格里一组的标题行：日志的一天、规则的一类。左边标题（可带一段次要的字），
 * 右边条数。整行一条浅底，不响应悬停。
 */
export function GroupRow({
  span,
  title,
  sub,
  count,
}: {
  span: number;
  title: ReactNode;
  sub?: ReactNode;
  count?: ReactNode;
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={span} className="h-7 bg-surface/70 py-0 tw-label text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-foreground/80">{title}</span>
          {sub && <span className="truncate">{sub}</span>}
          <span className="flex-1" />
          {count != null && <span className="shrink-0 tw-num">{count}</span>}
        </div>
      </TableCell>
    </TableRow>
  );
}
