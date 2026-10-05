import { PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { useResource } from "@/lib/resource";
import type { ProviderView } from "@/types";
import { contextWindow } from "@/upstreams/labels";
import { api } from "./api";
import { ModelInput } from "./fields";
import { blankPinned, type PinnedDraft } from "./model";
import { pinnedModelsText } from "./PinnedModels.i18n";
import type { KnownModelX } from "./provisional";

/**
 * 「转发至 → 指定模型」：几行「上游 + 模型」，按顺序备用。
 *
 * **模型从这个上游自己的清单里选**（`/providers/{name}/models`，和上游页的模型弹窗是同一份），
 * 右边是它的上下文窗口；清单里没有的照样能写（中转刚上的新模型）。模型名原样发出，不经过
 * 别名表，所以候选里**不列别名**。
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
  known: readonly KnownModelX[];
}) {
  const t = useText(pinnedModelsText);
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
  onProvider,
  onModel,
  onRemove,
}: {
  n: number;
  p: PinnedDraft;
  providers: readonly ProviderView[];
  known: readonly KnownModelX[];
  onProvider: (provider: string) => void;
  onModel: (model: string) => void;
  onRemove: () => void;
}) {
  const t = useText(pinnedModelsText);
  const ct = useText(commonText);
  const pv = providers.find((x) => x.name === p.provider);
  // 和上游页的模型弹窗共用一份缓存；那边刷新了清单，这里跟着换
  const rows = useResource(
    pv ? `upstream-models:${pv.name}` : null,
    () => api.providerModels(p.provider),
    { deps: [pv?.model_checked_at_ms, pv?.model_fetching, pv?.model_count] },
  ).data?.models;
  // 清单还没取到时先用网关的模型目录里这家的那些
  const ids = rows
    ? rows.filter((r) => r.enabled).map((r) => r.id)
    : known.filter((m) => !m.alias && m.providers.includes(p.provider)).map((m) => m.id);
  const ctx = rows?.find((r) => r.id === p.model.trim())?.context_window;
  return (
    <div className="flex items-center gap-2">
      <span className="w-3.5 shrink-0 text-right tw-num text-muted-foreground">{n}</span>
      <NativeSelect
        aria-label={t.provider(n)}
        className="w-36 shrink-0"
        value={p.provider}
        onChange={(e) => onProvider(e.target.value)}
      >
        {!p.provider && <NativeSelectOption value="">{t.chooseProvider}</NativeSelectOption>}
        {/* 配置里写着、却已经不在的上游：照样显示出来，保存时由 core 说它不存在 */}
        {p.provider && !pv && <NativeSelectOption value={p.provider}>{t.missing(p.provider)}</NativeSelectOption>}
        {providers.map((x) => (
          <NativeSelectOption key={x.name} value={x.name}>
            {x.disabled ? t.disabled(x.name) : x.name}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {/* 集成（L3）：ModelInput 加了别名/上游说明的 prop 之后，这里不用传 —— 指定模型只列真名 */}
      <ModelInput
        className="min-w-0 flex-1"
        value={p.model}
        onChange={onModel}
        models={ids}
        placeholder={t.model}
      />
      <span className="w-10 shrink-0 text-right tw-label tw-num text-muted-foreground">
        {ctx ? contextWindow(ctx) : ""}
      </span>
      {/* 写成字：对话框右上角的 × 是关闭 */}
      <Button variant="ghost" size="xs" className="shrink-0 text-muted-foreground" aria-label={t.remove(n)} onClick={onRemove}>
        {ct.delete}
      </Button>
    </div>
  );
}
