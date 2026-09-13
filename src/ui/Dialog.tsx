import { Dialog as D } from "radix-ui";
import type { ReactNode } from "react";

/**
 * 对话框。
 *
 * **拿的是行为，不是样式。**自造的 `fixed inset-0` 浮层在这个项目里有
 * 五处，它们共同缺的东西是一样的：Esc 关不掉、Tab 会跑到背景里去、打开
 * 时焦点不进来、关闭后焦点不回到触发它的那个按钮、读屏软件不知道这是个
 * 对话框。这几件每一件都能自己写，而五份手写的实现里一定有几份是错的
 * —— 事实上现在全 app 只有一个 `onKeyDown`。
 *
 * 视觉全部自己定，按 macOS 的度量：正文 13px、次要 11px、圆角 10px、
 * 0.5px 的分隔线、120ms 的淡入。**不抄企业版那套** —— 那是给 Web 后台
 * 的卡片阴影和大圆角，放在一个 1100px 的桌面窗口里会显得又大又软。
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  /** 危险操作：标题前面挂一个红点，按钮区右对齐 */
  danger = false,
  width = "max-w-md",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  danger?: boolean;
  width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
        <D.Content
          className={
            "fixed left-1/2 top-1/2 z-50 w-full -translate-x-1/2 -translate-y-1/2 rounded-[10px] border border-neutral-300 bg-neutral-50 p-4 shadow-2xl outline-none dark:border-neutral-700 dark:bg-neutral-900 " +
            width
          }
        >
          <D.Title className="flex items-center gap-2 tw-body font-semibold">
            {danger && (
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
            )}
            {title}
          </D.Title>
          {description && (
            <D.Description asChild>
              <div className="mt-1.5 tw-body leading-relaxed text-neutral-600 dark:text-neutral-400">
                {description}
              </div>
            </D.Description>
          )}
          {children && <div className="mt-3 tw-body">{children}</div>}
          {footer && (
            <div className="mt-4 flex justify-end gap-2">{footer}</div>
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** 对话框里的按钮。三种分量，不要再有第四种。 */
export function DialogButton({
  onClick,
  children,
  kind = "normal",
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  kind?: "normal" | "primary" | "danger";
  disabled?: boolean;
}) {
  const base =
    "rounded-md px-3 py-1.5 tw-body disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-neutral-400";
  const style =
    kind === "danger"
      ? "bg-red-600 text-white hover:bg-red-700"
      : kind === "primary"
        ? "bg-neutral-900 text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
        : "border border-neutral-300 hover:bg-neutral-200/60 dark:border-neutral-700 dark:hover:bg-neutral-800";
  return (
    <button onClick={onClick} disabled={disabled} className={base + " " + style}>
      {children}
    </button>
  );
}
