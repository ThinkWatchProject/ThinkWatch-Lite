import type { ReactNode } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

/** 一份菜单：条目或分隔线。**右键和行尾按钮共用同一份** */
export type MenuItems = (
  | { kind: "sep" }
  | { kind: "item"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }
)[];

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
export function RowMenu({ children, items }: { children: ReactNode; items: MenuItems }) {
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
                disabled={it.disabled}
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

/**
 * 行尾的「…」按钮。和右键打开的是**同一份**菜单 —— 右键发现不了，按钮是
 * 给第一次用的人的入口。
 */
export function RowMenuButton({ items, label }: { items: MenuItems; label: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          className="text-muted-foreground"
          // 行本身双击打开编辑；按钮上的点击不该冒泡成那一下
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuGroup>
          {items.map((it, i) =>
            it.kind === "sep" ? (
              <DropdownMenuSeparator key={i} />
            ) : (
              <DropdownMenuItem
                key={i}
                onSelect={it.onSelect}
                disabled={it.disabled}
                variant={it.danger ? "destructive" : "default"}
              >
                {it.label}
              </DropdownMenuItem>
            ),
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
