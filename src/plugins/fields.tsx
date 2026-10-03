import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/ui/button";
import { Autocomplete, ComboboxBareInput, ComboboxContent, ComboboxItem, ComboboxList } from "@/ui/combobox";
import { Input } from "@/ui/input";
import { rowMotion, usePresentList } from "@/ui/motion";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";
import { Textarea } from "@/ui/textarea";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { appLabel } from "@/labels";
import { Boxed, FormItem } from "@/upstreams/parts";
import type { OnError, PluginScope, SettingSpecView, SettingValue } from "@/types";
import { pluginFieldsText } from "./fields.i18n";
import { pluginLabelsText } from "./labels.i18n";
import { globMatch, SCOPE_PARTS, type ScopePart } from "./model";
import { PluginText } from "./parts";

// ─────────────────────────────────────────────── 适用范围

/**
 * 适用范围在表单里的样子：每一项是「全部」或「指定」几条。
 *
 * **「全部」要明说，不用「空 = 全部」**：约定里名单空着就是全部，界面上照那样画，看到的是
 * 一个空格子、生效的却是全部请求。所以每一项先选「全部 / 指定」，选了指定才列名单。
 */
export type ScopeDraft = Record<ScopePart, { mode: "all" | "some"; list: string[] }>;

export function draftOf(scope: PluginScope): ScopeDraft {
  const one = (list: string[]) => ({ mode: list.length > 0 ? ("some" as const) : ("all" as const), list });
  return { clients: one(scope.clients), models: one(scope.models), upstreams: one(scope.upstreams) };
}

/** 写回去的样子：选了「全部」的那一项是空的 */
export function scopeOf(d: ScopeDraft): PluginScope {
  const one = (p: ScopePart) => (d[p].mode === "all" ? [] : d[p].list);
  return { clients: one("clients"), models: one("models"), upstreams: one("upstreams") };
}

/** 选了「指定」却一项都没加的那一项。没有就是 `null` */
export function scopeProblem(d: ScopeDraft): ScopePart | null {
  return SCOPE_PARTS.find((p) => d[p].mode === "some" && d[p].list.length === 0) ?? null;
}

/** 输入时给的一条建议：已知的客户端、模型或上游。`note` 写在右边（客户端的产品名） */
export interface Suggestion {
  value: string;
  note?: string;
}

export type ScopeSuggestions = Record<ScopePart, readonly Suggestion[]>;

/**
 * 输入的这一段对得上哪几条建议：带 `*` 的按通配比（输入 `claude-*` 就列出它会对上的那些），
 * 不带的按包含比；都不分大小写，和 core 一样
 */
export function suggestionMatches(query: string, value: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const v = value.toLowerCase();
  return q.includes("*") ? globMatch(q, v) : v.includes(q);
}

/**
 * 适用范围的三项。**模型和上游各说一句按什么匹配**：模型比的是发给上游的那个名字（路由改写
 * 过的按改写之后的），上游对请求和回答都管 —— 不说的话，按客户端发的模型名写范围的人会
 * 以为没生效，以为上游只管回答的人会漏掉请求那一头。
 */
export function ScopeFields({
  value,
  onChange,
  suggestions,
}: {
  value: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
  suggestions?: ScopeSuggestions;
}) {
  const t = useText(pluginFieldsText);
  const lt = useText(pluginLabelsText);
  const set = (p: ScopePart, next: Partial<ScopeDraft[ScopePart]>) => onChange({ ...value, [p]: { ...value[p], ...next } });
  return (
    <div className="flex flex-col gap-4">
      {SCOPE_PARTS.map((p) => (
        <FormItem key={p} label={lt.scopeParts[p]} hint={t.matches[p] || undefined}>
          <Segmented<"all" | "some">
            label={lt.scopeParts[p]}
            value={value[p].mode}
            options={[
              { id: "all", label: lt.allOf[p] },
              { id: "some", label: t.some },
            ]}
            onChange={(mode) => set(p, { mode })}
          />
          {value[p].mode === "some" && (
            <PatternList
              part={p}
              value={value[p].list}
              onChange={(list) => set(p, { list })}
              invalid={value[p].list.length === 0}
              suggestions={suggestions?.[p] ?? []}
            />
          )}
        </FormItem>
      ))}
    </div>
  );
}

/**
 * 一项名单：一条一行，最后一行输入新的，右边写「回车添加」（和密钥的通配规则、放行网段
 * 同一个样子）。失焦也算添加，没按回车的那一条不会悄悄丢掉。删一条写成字，不用 ×。
 */
function PatternList({
  part,
  value,
  onChange,
  invalid,
  suggestions,
}: {
  part: ScopePart;
  value: string[];
  onChange: (next: string[]) => void;
  invalid: boolean;
  suggestions: readonly Suggestion[];
}) {
  const t = useText(pluginFieldsText);
  const lt = useText(pluginLabelsText);
  const rows = usePresentList(value, (x) => x);
  const [draft, setDraft] = useState("");

  function add(x: string) {
    const v = x.trim();
    if (v && !value.includes(v)) onChange([...value, v]);
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1">
      <Boxed className={cn(invalid && !draft.trim() && "border-warning/60")}>
        {rows.map(({ item: x, key, presence }) => (
          <div
            key={key}
            className={cn("flex h-8 items-center gap-2.5 border-b border-border pr-1 pl-3", rowMotion(presence))}
          >
            <span className="min-w-0 flex-1 truncate font-mono tw-body">{x}</span>
            {part === "clients" && appLabel(x) !== x && (
              <span className="shrink-0 tw-label text-muted-foreground">{appLabel(x)}</span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t.remove(x)}
              className="shrink-0 text-muted-foreground"
              onClick={() => onChange(value.filter((y) => y !== x))}
            >
              {t.removeShort}
            </Button>
          </div>
        ))}
        <PatternInput
          part={part}
          draft={draft}
          onDraft={setDraft}
          onAdd={add}
          suggestions={suggestions.filter((s) => !value.includes(s.value))}
        />
      </Boxed>
      <p className={cn("tw-label", invalid ? "text-warning" : "text-muted-foreground")}>
        {invalid ? t.needOne(lt.scopeParts[part]) : t.hint[part]}
      </p>
    </div>
  );
}

/** 建议列表最多列几条 */
const MAX_SUGGESTIONS = 50;

/**
 * 名单的最后一行：**自由输入 + 建议**。写的可以是一个名字，也可以是带 `*` 的通配
 * （`claude-*`）；建议是已知的客户端、模型和上游，输入通配时列出它对得上的那些。
 *
 * 所以是 Autocomplete，不是 Combobox（和路由规则的模型名同一个道理）：建议之外的名字、
 * 通配都要留得住。点一条建议、或者用方向键选中再回车，直接加进名单；没选中建议时回车加的
 * 是输入的原样。
 */
function PatternInput({
  part,
  draft,
  onDraft,
  onAdd,
  suggestions,
}: {
  part: ScopePart;
  draft: string;
  onDraft: (v: string) => void;
  onAdd: (v: string) => void;
  suggestions: readonly Suggestion[];
}) {
  const t = useText(pluginFieldsText);
  const lt = useText(pluginLabelsText);
  // **建议列表挂进所在的对话框，不挂在 body 上**：Radix 的模态对话框把 body 设成
  // pointer-events: none，挂在 body 上的列表看得见、点不中（见路由的 `ModelInput`）
  const anchor = useRef<HTMLDivElement>(null);
  const [container, setContainer] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setContainer(anchor.current?.closest<HTMLElement>('[role="dialog"]') ?? null);
  }, []);
  const [open, setOpen] = useState(false);
  // **Esc 只收起列表**，不连同对话框（和里面没保存的改动）一起关掉
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
  /** 方向键选中了一条建议：回车交给列表（加那一条），不是加输入的原样 */
  const highlighted = useRef<string | undefined>(undefined);
  const notes = useMemo(() => new Map(suggestions.map((s) => [s.value, s.note])), [suggestions]);
  const items = useMemo(() => suggestions.map((s) => s.value), [suggestions]);
  const shown = useMemo(() => items.filter((v) => suggestionMatches(draft, v)).slice(0, MAX_SUGGESTIONS), [items, draft]);

  return (
    <div ref={anchor} className="flex h-8 items-center gap-2.5 bg-background px-3">
      <Autocomplete
        items={items}
        filteredItems={shown}
        value={draft}
        onValueChange={(v, d) => {
          if (d.reason === "item-press") onAdd(v);
          else onDraft(v);
        }}
        open={open && shown.length > 0}
        onOpenChange={setOpen}
        onItemHighlighted={(v) => {
          highlighted.current = v as string | undefined;
        }}
        openOnInputClick
      >
        <ComboboxBareInput
          aria-label={lt.scopeParts[part]}
          placeholder={t.placeholder[part]}
          className="font-mono"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            // 对话框会把回车当成提交
            e.preventDefault();
            if (open && highlighted.current !== undefined) return;
            onAdd(draft);
          }}
          onBlur={() => {
            if (!open) onAdd(draft);
          }}
        />
        <ComboboxContent container={container ?? undefined}>
          <ComboboxList>
            {(v: string) => (
              <ComboboxItem key={v} value={v} className="pr-2">
                <span className="min-w-0 flex-1 truncate font-mono">{v}</span>
                {notes.get(v) && <span className="shrink-0 tw-label text-muted-foreground">{notes.get(v)}</span>}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Autocomplete>
      <span className="shrink-0 tw-label text-muted-foreground">{t.enterToAdd}</span>
    </div>
  );
}

// ─────────────────────────────────────────────── 出错时

/** 出错时：拒绝这次请求（默认），或者跳过这个插件 */
export function OnErrorField({ value, onChange }: { value: OnError; onChange: (v: OnError) => void }) {
  const lt = useText(pluginLabelsText);
  return (
    <FormItem label={lt.onError}>
      <Segmented<OnError>
        label={lt.onError}
        value={value}
        options={[
          { id: "reject", label: lt.onErrorOptions.reject },
          { id: "skip", label: lt.onErrorOptions.skip },
        ]}
        onChange={onChange}
      />
    </FormItem>
  );
}

// ─────────────────────────────────────────────── 插件的设置项

/** 设置项在表单里的值：数字先按输入的原样存着，交出去时才换成数 */
export type SettingsDraft = Record<string, string | boolean>;

/** 表单从 manifest 里的值起头。值写在插件文件里（`value`） */
export function settingsDraftOf(schema: readonly SettingSpecView[]): SettingsDraft {
  const out: SettingsDraft = {};
  for (const s of schema) {
    const v = s.value;
    out[s.key] = s.kind === "boolean" ? v === true : typeof v === "boolean" ? "" : String(v);
  }
  return out;
}

/** 交出去的值，和填错的那几项（按标签） */
export function settingsOf(
  schema: readonly SettingSpecView[],
  draft: SettingsDraft,
): { values: Record<string, SettingValue>; bad: string[] } {
  const values: Record<string, SettingValue> = {};
  const bad: string[] = [];
  for (const s of schema) {
    const v = draft[s.key];
    if (s.kind === "boolean") values[s.key] = v === true;
    else if (s.kind === "number") {
      const raw = typeof v === "string" ? v.trim() : "";
      const n = Number(raw);
      if (raw === "" || !Number.isFinite(n)) bad.push(s.label || s.key);
      else values[s.key] = n;
    } else values[s.key] = typeof v === "string" ? v : "";
  }
  return { values, bad };
}

/**
 * 插件声明的设置项。**标签是插件自己写的**，只按纯文本画（`PluginText`）；core 自带的默认
 * 插件按界面语言说（`localSchema`）。
 *
 * 字符串一项一行、可以写多行（一行一条的替换表这类），输入框随内容长高；数字两个一行；开关
 * 一项一行排在最后 —— 开关和输入框并排时，两边的高度对不齐。
 */
export function SettingsFields({
  schema,
  value,
  onChange,
}: {
  schema: readonly SettingSpecView[];
  value: SettingsDraft;
  onChange: (next: SettingsDraft) => void;
}) {
  const t = useText(pluginFieldsText);
  if (schema.length === 0) return null;
  const fields = schema.filter((s) => s.kind !== "boolean");
  const switches = schema.filter((s) => s.kind === "boolean");
  return (
    <div className="flex flex-col gap-4">
      {fields.length > 0 && (
        <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
          {fields.map((s) => {
            const id = `plugin-setting-${s.key}`;
            const label = s.label || s.key;
            const v = value[s.key];
            const text = typeof v === "string" ? v : "";
            const bad = s.kind === "number" && text.trim() !== "" && !Number.isFinite(Number(text.trim()));
            const set = (next: string) => onChange({ ...value, [s.key]: next });
            return (
              <div key={s.key} className={cn("flex min-w-0 flex-col gap-1.5", s.kind === "string" && "sm:col-span-2")}>
                <label htmlFor={id} className="tw-body font-medium">
                  <PluginText text={label} />
                </label>
                {s.kind === "string" ? (
                  <GrowingText id={id} value={text} onChange={set} />
                ) : (
                  <Input
                    id={id}
                    value={text}
                    inputMode="decimal"
                    className="font-mono"
                    aria-invalid={bad || undefined}
                    onChange={(e) => set(e.target.value)}
                  />
                )}
                {bad && <p className="tw-label text-destructive">{t.numberBad(label)}</p>}
              </div>
            );
          })}
        </div>
      )}
      {switches.map((s) => {
        const id = `plugin-setting-${s.key}`;
        return (
          <div key={s.key} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
            <label htmlFor={id} className="min-w-0 tw-body font-medium">
              <PluginText text={s.label || s.key} />
            </label>
            <Switch id={id} checked={value[s.key] === true} onCheckedChange={(on) => onChange({ ...value, [s.key]: on })} />
          </div>
        );
      })}
    </div>
  );
}

/** 这个引擎自己会让输入框随内容长高（CSS 的 `field-sizing: content`） */
const SIZES_ITSELF = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

/**
 * 一段可以写多行的设置值：**一行高起步，随内容长高**，长到九行左右之后在框里滚动。回车是
 * 换行（对话框不把回车当提交）。高度交给 CSS 的 `field-sizing`；不支持它的引擎（旧的
 * WebKitGTK）每次改动时按内容量一次
 */
function GrowingText({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || SIZES_ITSELF) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + (el.offsetHeight - el.clientHeight)}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      id={id}
      rows={1}
      value={value}
      spellCheck={false}
      autoCorrect="off"
      autoCapitalize="off"
      className="max-h-48 min-h-8 resize-none py-1.5 leading-5"
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
