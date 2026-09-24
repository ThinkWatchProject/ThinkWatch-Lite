import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/*
  shadcn 的 Command（cmdk）。**改过三处**：

  · 输入框不是 nova 那种框里套框的 `InputGroup`，而是整行：左边放大镜、中间可以放
    当前所在的一级（`lead`）、右边留一个 `trail` 槽（比如 esc 键帽）。命令面板的
    输入框就是它的标题。
  · 一项高 36px，和表格的行一样；字号走字阶（tw-body / tw-label）。
  · 列表的高度跟着结果数走（`--cmdk-list-height`，cmdk 自己量），换结果时是走过去
    的，不是跳；系统关了动效就直接跳（`motion-list-height`，见 index.css）。

  选中态用 `data-selected:`：cmdk 一直渲染这个属性（`"true"` / `"false"`），shadcn 的
  `tailwind.css` 把这个变体定义成只认 `"true"`。
*/

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden bg-popover text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandInput({
  className,
  lead,
  trail,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  /** 放大镜和输入框之间：当前所在的一级（「切换连接」） */
  lead?: React.ReactNode
  /** 输入框右边：键帽、计数 */
  trail?: React.ReactNode
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4"
    >
      <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      {lead}
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "h-full min-w-0 flex-1 bg-transparent outline-hidden placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
      {trail}
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "h-(--cmdk-list-height) max-h-[min(420px,calc(100vh-220px))] scroll-py-1.5 overflow-x-hidden overflow-y-auto overscroll-contain outline-none motion-list-height",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("px-4 py-8 text-center tw-body text-muted-foreground", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "px-1.5 pb-1 text-foreground **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2.5 **:[[cmdk-group-heading]]:pb-1 **:[[cmdk-group-heading]]:tw-label **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("mx-3 my-1 h-px bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex h-9 cursor-default items-center gap-2.5 rounded-md px-2.5 tw-body outline-hidden select-none",
        "data-disabled:pointer-events-none data-disabled:opacity-50",
        "data-selected:bg-accent data-selected:text-accent-foreground",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

/** 一项右端的键帽或标签。选中时颜色跟着加深一档 */
function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto flex shrink-0 items-center gap-1.5 tw-label text-muted-foreground group-data-selected/command-item:text-foreground/70",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
}
