import type { ReactNode } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";

/** 子菜单里的一项：单选的那种，当前选中的打勾 */
export interface MenuChoice {
  label: string;
  checked: boolean;
  onSelect: () => void;
}

/** 一份菜单：条目、子菜单或分隔线。**右键和行尾按钮共用同一份** */
export type MenuItems = (
  | { kind: "sep" }
  | { kind: "item"; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }
  | { kind: "sub"; label: string; choices: MenuChoice[] }
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
            ) : it.kind === "sub" ? (
              <ContextMenuSub key={i}>
                <ContextMenuSubTrigger>{it.label}</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {it.choices.map((c) => (
                    <ContextMenuCheckboxItem key={c.label} checked={c.checked} onSelect={c.onSelect}>
                      {c.label}
                    </ContextMenuCheckboxItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
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
 *
 * `tabIndex`：行多的表（流量）只让键盘选中的那一行的按钮进 Tab 顺序，别的给 -1，
 * 免得 Tab 要穿过两千个「…」。
 */
export function RowMenuButton({ items, label, tabIndex }: { items: MenuItems; label: string; tabIndex?: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          tabIndex={tabIndex}
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
            ) : it.kind === "sub" ? (
              <DropdownMenuSub key={i}>
                <DropdownMenuSubTrigger>{it.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {it.choices.map((c) => (
                    <DropdownMenuCheckboxItem key={c.label} checked={c.checked} onSelect={c.onSelect}>
                      {c.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
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
