/**
 * 路由页几个对话框共用的小件：带建议的模型输入、一排可切换的名称标签。
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";
import { Tip } from "@/ui/tip";
import { Toggle } from "@/ui/toggle";
import { fieldsText } from "./fields.i18n";

/**
 * 对话框打开时焦点落在哪（`onOpenAutoFocus`）。
 *
 * **打开一个已有的东西来编辑时，落在对话框本身。**落进名称框的话，名字被整段选中、
 * 带一圈焦点框（WebKit 里脚本给的焦点照样画框），而点开它多半是来改别处的。新建时
 * 照常落进第一个输入框。焦点仍在对话框里，Esc、Tab、读屏都照常。
 */
export function onOpenFocus(e: Event, onDialog: boolean) {
  if (!onDialog) return;
  e.preventDefault();
  (e.currentTarget as HTMLElement | null)?.focus();
}

/**
 * 模型名：**自由输入 + 建议**。模型可能是刚发布的、也可能是中转自己起的，
 * 建议里没有的照样得能写进去。
 */
export function ModelInput({
  value,
  onChange,
  models,
  placeholder,
  id,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  models: string[];
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const t = useText(fieldsText);
  // **建议列表挂进所在的对话框，不挂在 body 上。**Radix 的模态对话框把 body
  // 设成 pointer-events: none，并把对话框外的点击当成「点在外面」，滚轮也
  // 只放行对话框内部 —— 挂在 body 上的列表看得见、点不中也滚不动
  const anchor = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setContainer(anchor.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);
  // **Esc 只收起列表。**对话框的 Esc 监听在 document 的捕获阶段，比输入框先
  // 拿到这一下；不在 window 上先截住，就连对话框带没保存的编辑一起关掉了
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing) return;
      e.stopPropagation();
      setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);
  return (
    <div ref={anchor} className="contents">
      <Combobox
        items={models}
        inputValue={value}
        onInputValueChange={onChange}
        open={open}
        onOpenChange={(next) => setOpen(next)}
      >
        <ComboboxInput id={id} placeholder={placeholder ?? t.modelName} className={cn("w-full font-mono", className)} />
        <ComboboxContent container={container ?? undefined}>
          <ComboboxEmpty>{t.noMatch}</ComboboxEmpty>
          <ComboboxList>
            {(m: string) => (
              <ComboboxItem key={m} value={m}>
                {m}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </div>
  );
}

/**
 * 一排可切换的名称标签（多选）。**和价目表的「使用上游」是同一种控件**：选中的
 * 高亮，悬停可以看一句说明（比如它现在用的是哪条路由）。可以带一个标志（密钥是
 * 客户端的标志，上游是厂商的标志）。
 */
export function ToggleChips({
  options,
  value,
  onChange,
  mono = true,
  label,
}: {
  options: { id: string; label?: string; title?: string; icon?: ReactNode }[];
  value: string[];
  /** 交出去的是更新函数：连点两个标签时，第二下基于第一下的结果 */
  onChange: (update: (prev: string[]) => string[]) => void;
  mono?: boolean;
  /** 读屏读出来的这一组叫什么 */
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        const chip = (
          <Toggle
            key={o.id}
            variant="outline"
            pressed={on}
            onPressedChange={() =>
              onChange((prev) => (prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id]))
            }
            className={cn(
              "h-6 min-w-0 gap-1 rounded-md px-2 font-normal transition-colors",
              mono && "font-mono",
              on
                ? "border-foreground/30 bg-foreground/10 text-foreground hover:bg-foreground/15 aria-pressed:bg-foreground/10 data-[state=on]:bg-foreground/10"
                : "border-border text-muted-foreground hover:bg-transparent hover:text-foreground",
            )}
            // 字号走字阶的 tw-label。Toggle 自带的 text-sm 在样式表里排在自定义工具类后面，
            // 写成类会被它盖掉
            style={{ fontSize: "var(--fs-label)" }}
          >
            {o.icon}
            {o.label ?? o.id}
          </Toggle>
        );
        return o.title ? (
          <Tip key={o.id} text={o.title}>
            {chip}
          </Tip>
        ) : (
          chip
        );
      })}
    </div>
  );
}
