/**
 * 路由页几个对话框共用的小件：带建议的模型输入、一排可切换的名称标签。
 */
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
  return (
    <Combobox items={models} inputValue={value} onInputValueChange={onChange}>
      <ComboboxInput id={id} placeholder={placeholder} className={cn("w-full font-mono", className)} />
      <ComboboxContent>
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
