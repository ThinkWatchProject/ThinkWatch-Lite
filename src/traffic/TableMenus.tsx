import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { MoreHorizontalIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { ContextMenu, ContextMenuTrigger } from "@/ui/context-menu";
import { DropdownMenu, DropdownMenuTrigger } from "@/ui/dropdown-menu";
import { RowContextMenuContent, RowDropdownMenuContent, type MenuItems } from "@/ui/row-menu";
import { MENU_REVEAL } from "./cells";

/** 菜单对着哪一行：一条请求，或者归组时的一个组头 */
export type MenuTarget = { kind: "request"; id: number } | { kind: "session"; id: string };

const same = (a: MenuTarget, b: MenuTarget) => a.kind === b.kind && a.id === b.id;

/** 行尾「…」那份菜单此刻对着哪一行、开没开 */
type Drop = { target: MenuTarget; open: boolean; buttonId: string };

const Menus = createContext<{
  drop: Drop | null;
  contentId: string;
  toggle: (t: MenuTarget, button: HTMLButtonElement, open?: boolean) => void;
} | null>(null);

/**
 * 整张表共用的两份菜单：右键的，和行尾「…」的。
 *
 * **不是一行一份。**每一行各带一套右键菜单和下拉菜单的话，每一套都有自己的状态、
 * 定位、焦点和事件，两千行就是四千套 —— 表还没画完，内存先多出一百多兆。这里整张
 * 表只有一套：右键挂在表体上，按点中的是哪一行填条目；「…」点哪一行，菜单就贴着
 * 那一行的按钮打开。长相、条目、键盘和焦点和原来一行一份时一样（`@/ui/row-menu`）。
 *
 * `itemsFor`：某一行的菜单条目。那一行已经不在表里了给 `null`，菜单就不开。
 * `children` 是表体（`<tbody>`）：右键菜单的触发器就是它。
 */
export function TableMenus({
  itemsFor,
  children,
}: {
  itemsFor: (t: MenuTarget) => MenuItems | null;
  children: ReactElement;
}) {
  // 关上之后不清空：菜单淡出的那一下还要画着条目
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const contentId = useId();
  /** 打开下拉菜单的那个按钮：关上之后焦点回到它 */
  const button = useRef<HTMLButtonElement | null>(null);
  /** 菜单是被外面的右键点掉的：这时焦点不拉回按钮（和 Radix 自己的触发器一样） */
  const rightClicked = useRef(false);

  const toggle = useCallback((t: MenuTarget, el: HTMLButtonElement, open?: boolean) => {
    button.current = el;
    setDrop((d) => ({ target: t, buttonId: el.id, open: open ?? !(d !== null && same(d.target, t) && d.open) }));
  }, []);
  const api = useMemo(() => ({ drop, contentId, toggle }), [drop, contentId, toggle]);

  const menuItems = menu && itemsFor(menu);
  const dropItems = drop && itemsFor(drop.target);
  return (
    <Menus.Provider value={api}>
      <DropdownMenu
        open={dropItems !== null && drop !== null && drop.open}
        onOpenChange={(open) => setDrop((d) => d && { ...d, open })}
      >
        <ContextMenu>
          <ContextMenuTrigger
            asChild
            onContextMenu={(e) => {
              const t = targetOf(e.target);
              // 不在哪一行上（表体上下垫着的空行）：不开菜单
              if (t === null || itemsFor(t) === null) e.preventDefault();
              else setMenu(t);
            }}
          >
            {children}
          </ContextMenuTrigger>
          {menuItems && <RowContextMenuContent items={menuItems} />}
        </ContextMenu>
        {dropItems && drop && (
          <RowDropdownMenuContent
            items={dropItems}
            id={contentId}
            aria-labelledby={drop.buttonId}
            onInteractOutside={(e) => {
              const o = e.detail.originalEvent;
              const b = "button" in o ? o.button : -1;
              rightClicked.current = b === 2 || (b === 0 && "ctrlKey" in o && o.ctrlKey);
            }}
            // 触发器（下面那块看不见的定位片）拿不到焦点：自己把焦点交回按钮
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              if (!rightClicked.current) button.current?.focus();
              rightClicked.current = false;
            }}
          />
        )}
      </DropdownMenu>
    </Menus.Provider>
  );
}

/** 右键点在哪一行上。片段行（按内容搜到的那一段）算它上面那一行 */
function targetOf(el: EventTarget): MenuTarget | null {
  const tr = el instanceof Element ? el.closest("tr") : null;
  const d = tr instanceof HTMLElement ? tr.dataset : undefined;
  if (d?.row) return { kind: "request", id: Number(d.row) };
  if (d?.hit) return { kind: "request", id: Number(d.hit) };
  if (d?.session !== undefined) return { kind: "session", id: d.session };
  return null;
}

/**
 * 行尾的「…」。和右键打开的是同一份菜单 —— 右键发现不了，按钮是给第一次用的人的入口。
 *
 * 按钮本身是普通的按钮，点下、回车、空格、↓ 和 Radix 的触发器一样开关菜单。菜单要贴着
 * 它打开，所以对着这一行时在按钮上叠一块看不见、不接鼠标的定位片当触发器 —— 不把按钮
 * 本身换成触发器：换的话按钮会重新挂一次，键盘焦点就丢了。
 *
 * `tabIndex`：只有键盘选中的那一行的按钮进 Tab 顺序，免得 Tab 要穿过一整屏的「…」
 * （方向键挑行，Tab 进到它的菜单）。
 */
export function RowActions({ target, label, selected }: { target: MenuTarget; label: string; selected: boolean }) {
  const m = useContext(Menus);
  const id = useId();
  if (!m) throw new Error("RowActions outside TableMenus");
  const here = m.drop !== null && same(m.drop.target, target);
  const open = here && m.drop!.open;
  return (
    <span className={cn(MENU_REVEAL, "relative")}>
      <Button
        id={id}
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? m.contentId : undefined}
        data-state={open ? "open" : "closed"}
        tabIndex={selected ? 0 : -1}
        className="text-muted-foreground"
        onPointerDown={(e) => {
          if (e.button !== 0 || e.ctrlKey) return;
          m.toggle(target, e.currentTarget);
          // 点开时焦点不落在按钮上，交给菜单
          if (!open) e.preventDefault();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") m.toggle(target, e.currentTarget);
          else if (e.key === "ArrowDown") m.toggle(target, e.currentTarget, true);
          else return;
          e.preventDefault();
        }}
        // 行本身双击打开编辑；按钮上的点击不该冒泡成那一下
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <MoreHorizontalIcon />
      </Button>
      {here && (
        <DropdownMenuTrigger asChild>
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </DropdownMenuTrigger>
      )}
    </span>
  );
}
