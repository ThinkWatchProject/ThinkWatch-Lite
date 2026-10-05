/**
 * 路由页几个对话框共用的小件：带建议的模型输入、一排可切换的名称标签。
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AliasMark } from "@/aliases/AliasMark";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { asciiLower } from "@/upstreams/glob";
import {
  Autocomplete,
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
 *
 * **所以是 Autocomplete，不是 Combobox。**Combobox 在列表收起时把输入框改回选中的
 * 那一项、没选过就清空：建议里没有的名字，和比建议短的名字（列表里只有
 * `openai.gpt-5.6-sol` 时写 `gpt-5.6-sol`），都在列表收起后被换掉。
 *
 * **建议可以带上它是谁提供的。**`models` 给的是目录里的项（`KnownModel`，含别名）
 * 而不只是名称时，每条建议右边一句灰字：别名写「别名 · 提供它的上游」，其余写上游；
 * 输入框里的值正好是个别名时，框里也标一个「别名」。只给名称的照旧。
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
  /** 建议：名称，或目录里的项（`KnownModel` 直接传进来就行） */
  models: readonly (string | ModelOption)[];
  placeholder?: string;
  id?: string;
  className?: string;
}) {
  const t = useText(fieldsText);
  const items = useMemo(() => models.map((m) => (typeof m === "string" ? m : m.id)), [models]);
  const options = useMemo(() => {
    const byId = new Map<string, ModelOption>();
    for (const m of models) if (typeof m !== "string") byId.set(m.id, m);
    return byId;
  }, [models]);
  const valueIsAlias = useMemo(() => aliasNamed(value, options) != null, [value, options]);
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
      <Autocomplete
        items={items}
        value={value}
        onValueChange={onChange}
        open={open}
        onOpenChange={(next) => setOpen(next)}
        // 点进输入框就给建议，和点右边的箭头一样
        openOnInputClick
      >
        <ComboboxInput id={id} placeholder={placeholder ?? t.modelName} className={cn("w-full font-mono", className)}>
          {/* 排在输入框和右边的箭头之间：箭头那一格是 order-last */}
          {valueIsAlias && <AliasMark className="pointer-events-none mr-1" />}
        </ComboboxInput>
        {/* 带灰字时列表至少这么宽：放在窄的输入框（「模型改为」）下面，名称和灰字都挤不下 */}
        <ComboboxContent container={container ?? undefined} className={options.size > 0 ? "min-w-80" : undefined}>
          <ComboboxEmpty>{t.noMatch}</ComboboxEmpty>
          <ComboboxList>
            {(m: string) => {
              const note = modelNote(options.get(m));
              return (
                // 右边有灰字时不给勾选标记留位置：自由输入没有「选中」一说
                <ComboboxItem key={m} value={m} className={note ? "pr-2" : undefined}>
                  {/* 挤不下时先省略灰字，名称最后才省略 */}
                  <span className="min-w-0 truncate">{m}</span>
                  {note && (
                    <span className="ml-auto min-w-8 shrink-[100] truncate pl-2 tw-label text-muted-foreground">
                      {note}
                    </span>
                  )}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </ComboboxContent>
      </Autocomplete>
    </div>
  );
}

/**
 * 一条模型建议。`KnownModel` 就是这个形状：`alias` 给了就是别名（它的模型列表）。
 */
export type ModelOption = {
  id: string;
  /** 提供它的上游 */
  providers?: readonly string[];
  /** 是别名时它的模型列表 */
  alias?: readonly string[] | null;
};

/**
 * 建议右边那句灰字：别名写「别名 · 上游」，其余写上游。只有名称、没有上游的不写
 */
export function modelNote(m: ModelOption | undefined): string | null {
  if (!m) return null;
  const t = textOf(fieldsText);
  const providers = m.providers?.length ? t.providers(m.providers) : "";
  if (m.alias) return providers ? `${t.alias} · ${providers}` : t.alias;
  return providers || null;
}

/**
 * 输入框里的值是哪个别名。按名称认，**不分 ASCII 大小写**：规则的 `when.model` 是
 * glob，core 比的时候两边都转小写
 */
export function aliasNamed(value: string, options: ReadonlyMap<string, ModelOption>): ModelOption | null {
  const v = asciiLower(value.trim());
  if (!v) return null;
  for (const m of options.values()) if (m.alias && asciiLower(m.id) === v) return m;
  return null;
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
