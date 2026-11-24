import { useMemo, useRef } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/ui/input-group";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/ui/combobox";
import { SelectField, SelectOption } from "@/ui/select-field";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { useResource } from "@/lib/resource";
import type { AliasView, KnownModel, ProviderView } from "@/types";
import { compact } from "@/format";
import { modelsKey } from "@/upstreams/data";
import { api } from "./api";
import { api as aliasApi } from "@/aliases/api";
import { pinnedChoices } from "./pinnedChoices";
import { blankPinned, type PinnedDraft } from "./model";
import { pinnedModelsText } from "./PinnedModels.i18n";

/**
 * 「转发至 → 指定模型」：几行「上游 + 模型」，按顺序备用。
 *
 * **模型从这个上游自己的清单里选**（`/providers/{name}/models`，和上游页的模型弹窗是同一份），
 * 右边是它的上下文窗口；清单里没有的照样能写（中转刚上的新模型）。模型名原样发出，不经过
 * 别名表。搜索可按别名找到这家上游对应的 ID，选择后仍只保存 ID。
 */
export function PinnedModels({
  value,
  onChange,
  providers,
  known,
}: {
  value: PinnedDraft[];
  onChange: (next: PinnedDraft[]) => void;
  providers: readonly ProviderView[];
  known: readonly KnownModel[];
}) {
  const t = useText(pinnedModelsText);
  const aliases = useResource("aliases", aliasApi.aliases, {
    events: ["config_reloaded", "models_changed"],
  }).data?.aliases;
  const patch = (i: number, p: Partial<PinnedDraft>) =>
    onChange(value.map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-col gap-2 rounded-lg border border-border p-2.5">
        {value.map((p, i) => (
          <PinnedRow
            key={p.key}
            n={i + 1}
            p={p}
            providers={providers}
            known={known}
            aliases={aliases}
            onProvider={(provider) =>
              // 换了上游：新上游也有这个模型就留着，否则清空重选
              patch(i, {
                provider,
                model: known.some((m) => m.id === p.model && !m.alias && m.providers.includes(provider))
                  ? p.model
                  : "",
              })
            }
            onModel={(model) => patch(i, { model })}
            onRemove={() => onChange(value.filter((_, j) => j !== i))}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => onChange([...value, blankPinned()])}
        >
          <PlusIcon />
          {value.length === 0 ? t.addModel : t.addBackup}
        </Button>
      </div>
      <p className="tw-label text-muted-foreground">{t.note}</p>
    </div>
  );
}

function PinnedRow({
  n,
  p,
  providers,
  known,
  aliases,
  onProvider,
  onModel,
  onRemove,
}: {
  n: number;
  p: PinnedDraft;
  providers: readonly ProviderView[];
  known: readonly KnownModel[];
  aliases: readonly AliasView[] | undefined;
  onProvider: (provider: string) => void;
  onModel: (model: string) => void;
  onRemove: () => void;
}) {
  const t = useText(pinnedModelsText);
  const ct = useText(commonText);
  const pv = providers.find((x) => x.name === p.provider);
  // 和上游页的模型弹窗共用一份缓存；那边刷新了清单，这里跟着换
  const inventory = useResource(
    pv ? modelsKey(pv.name) : null,
    () => api.providerModels(p.provider),
    {
      deps: [pv?.model_checked_at_ms, pv?.model_fetching, pv?.model_count],
      events: ["config_reloaded", "models_changed"],
    },
  ).data;
  const choices = useMemo(() => pinnedChoices(p.provider, inventory, known, aliases ?? []), [p.provider, inventory, known, aliases]);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const ctx = inventory?.models.find((r) => r.id === p.model.trim())?.context_window;
  return (
    <div className="flex items-center gap-2">
      <span className="w-3.5 shrink-0 text-right tw-num text-muted-foreground">{n}</span>
      <SelectField
        aria-label={t.provider(n)}
        className="w-36 shrink-0"
        value={p.provider}
        onValueChange={(nextValue) => onProvider(nextValue)}
      >
        {!p.provider && <SelectOption value="">{t.chooseProvider}</SelectOption>}
        {/* 配置里写着、却已经不在的上游：照样显示出来，保存时由 core 说它不存在 */}
        {p.provider && !pv && <SelectOption value={p.provider}>{t.missing(p.provider)}</SelectOption>}
        {providers.map((x) => (
          <SelectOption key={x.name} value={x.name}>
            {x.disabled ? t.disabled(x.name) : x.name}
          </SelectOption>
        ))}
      </SelectField>
      <Combobox<string>
        key={p.provider}
        items={Array.from(choices.keys())}
        value={p.model || null}
        onValueChange={(id) => {
          if (id !== null) onModel(id);
        }}
        filter={(id, query) => {
          const needle = query.trim().toLowerCase();
          return id.toLowerCase().includes(needle) || !!choices.get(id)?.some((name) => name.toLowerCase().includes(needle));
        }}
      >
        <InputGroup ref={anchor} className="min-w-0 flex-1">
          <InputGroupInput
            aria-label={t.model}
            placeholder={t.model}
            className="font-mono"
            value={p.model}
            onChange={(e) => onModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                trigger.current?.click();
              }
            }}
          />
          <InputGroupAddon align="inline-end">
            <ComboboxTrigger ref={trigger} aria-label={t.search} title={t.search}
              render={<InputGroupButton type="button" size="icon-xs" variant="ghost" />} />
          </InputGroupAddon>
        </InputGroup>
        <ComboboxContent anchor={anchor} finalFocus={trigger} className="min-w-64">
          <ComboboxInput showTrigger={false} aria-label={t.search} placeholder={t.search} />
          <ComboboxEmpty>{t.noMatch}</ComboboxEmpty>
          <ComboboxList>
            {(id: string) => {
              const names = choices.get(id);
              return (
                <ComboboxItem key={id} value={id} className="flex-col items-start gap-0.5">
                  <span className="max-w-full break-all font-mono">{id}</span>
                  {names && names.length > 0 && (
                    <span className="max-w-full break-words tw-label text-muted-foreground">{t.aliases(names)}</span>
                  )}
                </ComboboxItem>
              );
            }}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <span className="w-10 shrink-0 text-right tw-label tw-num text-muted-foreground">
        {ctx ? compact(ctx) : ""}
      </span>
      {/* 写成字：对话框右上角的 × 是关闭 */}
      <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" aria-label={t.remove(n)} onClick={onRemove}>
        {ct.delete}
      </Button>
    </div>
  );
}
