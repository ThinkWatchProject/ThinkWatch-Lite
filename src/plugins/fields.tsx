import { useState } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { rowMotion, usePresentList } from "@/ui/motion";
import { Segmented } from "@/ui/segmented";
import { Switch } from "@/ui/switch";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { appLabel } from "@/labels";
import { Boxed, FormItem } from "@/upstreams/parts";
import type { Permission, PluginScope, SettingSpecView } from "./api.provisional";
import { pluginFieldsText } from "./fields.i18n";
import { pluginLabelsText } from "./labels.i18n";
import { SCOPE_PARTS, touchesReplies, touchesRequests, type ScopePart } from "./model";
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

/**
 * 适用范围的三项。上游只约束回答：**只改请求的插件不给这一项**；两头都改的，写明只对
 * 回答生效 —— 不说的话，限了上游的人会以为请求那一头也跟着限了。
 */
export function ScopeFields({
  value,
  onChange,
  permissions,
}: {
  value: ScopeDraft;
  onChange: (next: ScopeDraft) => void;
  permissions: readonly Permission[];
}) {
  const t = useText(pluginFieldsText);
  const lt = useText(pluginLabelsText);
  const parts = SCOPE_PARTS.filter((p) => p !== "upstreams" || touchesReplies(permissions));
  const set = (p: ScopePart, next: Partial<ScopeDraft[ScopePart]>) => onChange({ ...value, [p]: { ...value[p], ...next } });
  return (
    <div className="flex flex-col gap-4">
      {parts.map((p) => (
        <FormItem
          key={p}
          label={lt.scopeParts[p]}
          desc={p === "upstreams" && touchesRequests(permissions) ? t.upstreamsReplyOnly : undefined}
        >
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
}: {
  part: ScopePart;
  value: string[];
  onChange: (next: string[]) => void;
  invalid: boolean;
}) {
  const t = useText(pluginFieldsText);
  const lt = useText(pluginLabelsText);
  const rows = usePresentList(value, (x) => x);
  const [draft, setDraft] = useState("");

  function commit() {
    const x = draft.trim();
    if (!x) return;
    if (!value.includes(x)) onChange([...value, x]);
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
        <div className="flex h-8 items-center gap-2.5 bg-background px-3">
          <Input
            aria-label={lt.scopeParts[part]}
            className="h-7 flex-1 border-0 bg-transparent px-0 font-mono shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={draft}
            placeholder={t.placeholder[part]}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              // 对话框会把回车当成提交
              e.preventDefault();
              commit();
            }}
            onBlur={commit}
          />
          <span className="shrink-0 tw-label text-muted-foreground">{t.enterToAdd}</span>
        </div>
      </Boxed>
      <p className={cn("tw-label", invalid ? "text-warning" : "text-muted-foreground")}>
        {invalid ? t.needOne(lt.scopeParts[part]) : t.hint[part]}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────── 插件的设置项

/** 设置项在表单里的值：数字先按输入的原样存着，保存时才换成数 */
export type SettingsDraft = Record<string, string | boolean>;

export function settingsDraftOf(schema: readonly SettingSpecView[], values: Record<string, unknown>): SettingsDraft {
  const out: SettingsDraft = {};
  for (const s of schema) {
    const v = s.key in values ? values[s.key] : s.default;
    out[s.key] = s.kind === "boolean" ? v === true : v == null ? "" : String(v);
  }
  return out;
}

/** 写回去的值，和填错的那几项（按标签） */
export function settingsOf(
  schema: readonly SettingSpecView[],
  draft: SettingsDraft,
): { values: Record<string, unknown>; bad: string[] } {
  const values: Record<string, unknown> = {};
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
 * 插件声明的设置项。**标签是插件自己写的**，只按纯文本画（`PluginText`）；默认值写在下面，
 * 改过之后对照得上。
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
  // 要填的两列排，开关一项一行排在后面：开关和输入框并排时，两边的高度对不齐
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
            const def = s.default == null || s.default === "" ? t.emptyDefault : t.defaultIs(String(s.default));
            const bad = s.kind === "number" && typeof v === "string" && v.trim() !== "" && !Number.isFinite(Number(v.trim()));
            return (
              <div key={s.key} className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={id} className="tw-body font-medium">
                  <PluginText text={label} />
                </label>
                <Input
                  id={id}
                  value={typeof v === "string" ? v : ""}
                  inputMode={s.kind === "number" ? "decimal" : undefined}
                  className={s.kind === "number" ? "font-mono" : undefined}
                  aria-invalid={bad || undefined}
                  onChange={(e) => onChange({ ...value, [s.key]: e.target.value })}
                />
                {bad ? (
                  <p className="tw-label text-destructive">{t.numberBad(label)}</p>
                ) : (
                  <p className="truncate tw-label text-muted-foreground">
                    <PluginText text={def} />
                  </p>
                )}
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
