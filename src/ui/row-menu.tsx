import type { ComponentProps, ReactNode } from "react";
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
import { Tip } from "@/ui/tip";

/** 子菜单里的一项：单选的那种，当前选中的打勾 */
export interface MenuChoice {
  label: string;
  checked: boolean;
  onSelect: () => void;
}

/**
 * 一份菜单：条目、子菜单或分隔线。**右键和行尾按钮共用同一份**
 *
 * `name`：条目里带着的那个名字（「仅显示上游 X」的 X，`label` 里原样有它）。名字是用户
 * 起的，可以很长：只截断名字，前后的字留着，菜单不被撑宽；截断了悬停看全。
 */
export type MenuItems = (
  | { kind: "sep" }
  | { kind: "item"; label: string; name?: string; onSelect: () => void; danger?: boolean; disabled?: boolean }
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
      <RowContextMenuContent items={items} />
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
      <RowDropdownMenuContent items={items} />
    </DropdownMenu>
  );
}

/**
 * 两份菜单的内容，单独拿出来给「整张表共用一份菜单」的地方（流量表）：那里的触发器
 * 不是一行一个，菜单打开时才按点中的那一行填条目。
 */
export function RowContextMenuContent({ items }: { items: MenuItems }) {
  return (
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
              <MenuLabel label={it.label} name={it.name} />
            </ContextMenuItem>
          ),
        )}
      </ContextMenuGroup>
    </ContextMenuContent>
  );
}

/** `props` 原样交给 `DropdownMenuContent`：共用一份菜单的地方要自己接焦点、换标签 */
export function RowDropdownMenuContent({
  items,
  ...props
}: { items: MenuItems } & Omit<ComponentProps<typeof DropdownMenuContent>, "children">) {
  return (
    <DropdownMenuContent align="end" className="min-w-[180px]" {...props}>
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
              <MenuLabel label={it.label} name={it.name} />
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

/** 条目里的名字最宽多宽：常见的上游、密钥名都在 150 以内，再长的截断 */
const NAME_MAX_PX = 192;

/**
 * 一个条目的字。带着名字的，名字单独封顶（`NAME_MAX_PX`）、截断了悬停看全；前后的字
 * 不截，「仅显示上游」一直看得见。整句还在格子里（读屏、按首字母跳都按整句）。
 */
function MenuLabel({ label, name }: { label: string; name?: string }) {
  const parts = nameIn(label, name);
  if (!parts) return <>{label}</>;
  const [before, n, after] = parts;
  return (
    <span className="flex min-w-0">
      <span className="shrink-0 whitespace-pre">{before}</span>
      <Tip clip text={n}>
        <span className="min-w-0 truncate" style={{ maxWidth: NAME_MAX_PX }}>
          {n}
        </span>
      </Tip>
      <span className="shrink-0 whitespace-pre">{after}</span>
    </span>
  );
}

/** 条目的字拆成名字前、名字、名字后。没给名字、字里找不到它：不拆 */
export function nameIn(label: string, name?: string): [string, string, string] | null {
  const at = name ? label.indexOf(name) : -1;
  if (!name || at < 0) return null;
  return [label.slice(0, at), name, label.slice(at + name.length)];
}
