import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";

/**
 * 行右键菜单。
 *
 * 桌面应用里,列表行右键是肌肉记忆 —— 这个项目之前一处都没有
 * (`onContextMenu` 全 app 零次),所以在请求列表上想复制一个请求 id、
 * 或者只看这个上游,都只能靠眼睛和手打。
 *
 * **和 `Tip` 一样是组合,不是自绘**:长相、键盘导航、焦点、Esc 全是
 * shadcn 的 `ContextMenu`;这里只把一个声明式的 `items` 数组摊成 JSX。
 * 调用点那份数组有十来项,散成标签写法会把它淹掉。
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
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="min-w-[180px]">
        <ContextMenuGroup>
          {items.map((it, i) =>
            it.kind === "sep" ? (
              <ContextMenuSeparator key={i} />
            ) : (
              <ContextMenuItem
                key={i}
                onSelect={it.onSelect}
                variant={it.danger ? "destructive" : "default"}
              >
                {it.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
