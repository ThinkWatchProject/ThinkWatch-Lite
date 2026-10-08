import { useRef, useState } from "react";

/**
 * 对话框的焦点。几页的对话框都要这两样，所以放在组件库里，不各写一份。
 */

/**
 * 对话框打开时焦点落在对话框本身，不落到第一个按钮上（`onOpenAutoFocus`）。
 *
 * **WebKit 里脚本给的焦点会在按钮上画一圈框**，除非上一次焦点来自点击 —— 从行菜单
 * 里点一项打开的确认框就不算，于是「取消」上带着一圈框，像是被选中了。焦点仍在
 * 对话框里：读屏照读，Esc 照样关，Tab 一下就到按钮。
 */
export function focusSelf(e: Event) {
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus();
}

/**
 * 按 Esc 关掉对话框时，焦点回到打开它的那一行（`DialogContent` 上展开用）。
 *
 * Radix 的对话框关掉时只把焦点还给它自己的 Trigger。这几个对话框是点行打开的，没有
 * Trigger，焦点就落到了 body 上：用键盘的人回车打开一行、Esc 关掉之后，下一个 Tab
 * 要从页面顶上重新数起。**鼠标关掉的不还**：那是一次脚本给的焦点，WebKit 会在行上
 * 画一圈框，而点鼠标的人并不需要它。
 *
 * 打开它的元素在第一次渲染时记下（那时焦点还在行上，对话框的 effect 还没把焦点
 * 挪进来）。
 */
export function useDialogFocus() {
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  const byKey = useRef(false);
  return {
    onEscapeKeyDown: () => {
      byKey.current = true;
    },
    onCloseAutoFocus: (e: Event) => {
      if (!byKey.current || !(opener instanceof HTMLElement) || !opener.isConnected) return;
      e.preventDefault();
      opener.focus();
    },
  };
}
