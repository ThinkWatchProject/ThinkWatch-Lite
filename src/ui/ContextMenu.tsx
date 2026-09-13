import { ContextMenu as C } from "radix-ui";
import type { ReactNode } from "react";

/**
 * 行右键菜单。
 *
 * 桌面应用里，列表行右键是肌肉记忆 —— 这个项目之前一处都没有
 * （`onContextMenu` 全 app 零次），所以在请求列表上想复制一个请求 id、
 * 或者只看这个上游，都只能靠眼睛和手打。
 *
 * 键盘也能开（菜单键 / Shift+F10），焦点、方向键、Esc 都是 Radix 带的。
 */
export function RowMenu({
  children,
  items,
}: {
  children: ReactNode;
  items: (
    | { kind: "sep" }
    | { kind: "item"; label: string; onSelect: () => void; danger?: boolean }
  )[];
}) {
  return (
    <C.Root>
      <C.Trigger asChild>{children}</C.Trigger>
      <C.Portal>
        <C.Content className="z-50 min-w-[180px] rounded-[8px] border border-neutral-300 bg-neutral-50 p-1 shadow-xl dark:border-neutral-700 dark:bg-neutral-800">
          {items.map((it, i) =>
            it.kind === "sep" ? (
              <C.Separator
                key={i}
                className="my-1 h-px bg-neutral-200 dark:bg-neutral-700"
              />
            ) : (
              <C.Item
                key={i}
                onSelect={it.onSelect}
                className={
                  "cursor-default select-none rounded px-2 py-1 text-[12px] outline-none data-[highlighted]:bg-neutral-200 dark:data-[highlighted]:bg-neutral-700 " +
                  (it.danger ? "text-red-600 dark:text-red-400" : "")
                }
              >
                {it.label}
              </C.Item>
            ),
          )}
        </C.Content>
      </C.Portal>
    </C.Root>
  );
}
