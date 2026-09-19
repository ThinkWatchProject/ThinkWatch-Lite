/**
 * 路由页几个对话框共用的小件：带建议的模型输入、一排可切换的名称标签。
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/ui/combobox";

/**
 * 模型名：**自由输入 + 建议**。模型可能是刚发布的、也可能是中转自己起的，
 * 建议里没有的照样得能写进去。
 */
export function ModelInput({
  value,
  onChange,
  models,
  placeholder = "模型名",
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
        <ComboboxInput id={id} placeholder={placeholder} className={cn("w-full font-mono", className)} />
        <ComboboxContent container={container ?? undefined}>
          <ComboboxEmpty>无匹配项，可直接输入完整模型名</ComboboxEmpty>
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
 * 一排可切换的名称标签。**和价目表的「使用上游」是同一种控件**：选中的
 * 高亮，悬停可以看一句说明（比如它现在用的是哪条路由）。
 */
export function ToggleChips({
  options,
  value,
  onChange,
  mono = true,
}: {
  options: { id: string; label?: string; title?: string }[];
  value: string[];
  /** 交出去的是更新函数：连点两个标签时，第二下基于第一下的结果 */
  onChange: (update: (prev: string[]) => string[]) => void;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.id);
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            title={o.title}
            onClick={() =>
              onChange((prev) => (prev.includes(o.id) ? prev.filter((x) => x !== o.id) : [...prev, o.id]))
            }
            className={cn(
              "rounded-md border px-2 py-0.5 tw-label transition-colors",
              mono && "font-mono",
              on
                ? "border-foreground/30 bg-foreground/10 text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label ?? o.id}
          </button>
        );
      })}
    </div>
  );
}
