import type { KeyboardEvent, MouseEvent } from "react";

/**
 * 可以点开的一行：单击打开，回车或空格也打开，Tab 能停上去。
 *
 * **选中文字时不打开**：双击密钥的值是要选中它，而单击整行是打开对话框 —— 拖选
 * 结束的那一下也是一次 click。
 */
export function openable(open: () => void) {
  return {
    tabIndex: 0,
    onClick: (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && e.currentTarget.contains(sel.anchorNode)) return;
      open();
    },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    },
  };
}

/** 可以点开的行的样子：默认光标（桌面应用不用手形），键盘停上去时一圈内描边 */
export const OPENABLE_ROW =
  "cursor-default focus-visible:bg-muted/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring/50";

/**
 * 行里不该触发整行打开的那一块（按钮、链接）。点击到它为止。
 */
export function stop(e: MouseEvent | KeyboardEvent) {
  e.stopPropagation();
}
