import { useMemo, useState } from "react";
import { CircleAlertIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Segmented } from "@/ui/segmented";
import { Spinner } from "@/ui/spinner";
import { TableSkeleton } from "@/ui/states";
import { StatusLabel } from "@/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import { Textarea } from "@/ui/textarea";
import { useText } from "@/i18n";
import type { ModelListStatus, ModelSource, Msg, ProviderModelsView, ResolvedPrice } from "@/types";
import { coreText } from "@/i18n/core.i18n";
import { globMatch } from "./glob";
import { contextWindow, modelSourceLabel } from "./labels";
import { modelsSectionText } from "./ModelsSection.i18n";
import { Boxed, FormItem, Note } from "./parts";
import type { UpstreamForm } from "./upstreamForm";

/** 这家上游有哪些模型，以及是怎么知道的 */
export interface ModelCatalog {
  source: ModelSource;
  models: string[];
  checkedAtMs?: number | null;
  /** 没拿到清单的原因 */
  error?: Msg | null;
  /** 获取的结果：拿到了、上游不提供、没问到 */
  status?: ModelListStatus;
  /** core 正在向上游问 */
  fetching?: boolean;
}

/** core 记下的那一份 */
export function catalogOf(v: ProviderModelsView): ModelCatalog {
  return {
    source: v.source,
    models: v.models.map((m) => m.id),
    checkedAtMs: v.checked_at_ms,
    error: v.error,
    status: v.status,
    fetching: v.fetching,
  };
}

/** 这个模型在不在启用范围里。和 core 同一套通配规则 */
export function inScope(form: UpstreamForm, model: string): boolean {
  return form.scope === "all" || form.scopeList.some((p) => globMatch(p, model));
}

export function ModelsSection({
  form,
  set,
  catalog,
  prices,
  perToken,
  sheetLabel,
  loading,
  refreshing,
  onRefresh,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  catalog: ModelCatalog | null;
  /** 按所选价目表查到的价格，键是模型 ID */
  prices: Record<string, ResolvedPrice>;
  /** 按量计费。其余几种计费方式不按单价算费用，定价一列没有意义 */
  perToken: boolean;
  /** 所选价目表的名称，提示里要说「在哪张表里未定价」 */
  sheetLabel: string;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useText(modelsSectionText);
  const [filter, setFilter] = useState("");
  /**
   * 手动清单的原文。**不能直接用 `manualModels.join("\n")` 当值** —— 按行拆
   * 的时候空行被去掉，回车敲出来的那个空行会被立刻吞掉，换不了行。
   */
  const [manualText, setManualText] = useState(() => form.manualModels.join("\n"));
  const listed = catalog?.source === "discovered";
  // 后台正在问、手里还什么都没有：等它，别先让人去填手动清单
  const waiting = !!catalog?.fetching && catalog.source === "none";
  const busy = refreshing || !!catalog?.fetching;
  const models = listed ? catalog.models : form.manualModels;
  const shown = useMemo(
    () => models.filter((m) => m.toLowerCase().includes(filter.trim().toLowerCase())),
    [models, filter],
  );
  // 切回「全部模型」时清单还留着（再切回来不丢），但那时通配规则不生效
  const patterns = form.scope === "some" ? form.scopeList.filter((p) => p.includes("*")) : [];
  const enabled = models.filter((m) => inScope(form, m));
  const unpriced = perToken ? enabled.filter((m) => prices[m] && !prices[m].price) : [];

  function toggle(model: string, on: boolean) {
    // 通配规则一旦被逐个勾选改动，就换成明确的模型清单 —— 两种写法混在
    // 一起时，用户看不出某个模型为什么勾不掉
    const current = models.filter((m) => inScope(form, m));
    const next = on ? [...new Set([...current, model])] : current.filter((m) => m !== model);
    set({ scope: "some", scopeList: next });
  }

  function toggleAll(on: boolean) {
    const current = new Set(models.filter((m) => inScope(form, m)));
    for (const m of shown) {
      if (on) current.add(m);
      else current.delete(m);
    }
    set({ scope: "some", scopeList: models.filter((m) => current.has(m)) });
  }

  const allShownOn = shown.length > 0 && shown.every((m) => inScope(form, m));
  const someShownOn = shown.some((m) => inScope(form, m));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="tw-body font-medium">{t.title}</span>
        {catalog && !waiting && (
          <Badge variant={catalog.source === "none" && catalog.status === "failed" ? "warning" : "secondary"}>
            {modelSourceLabel(catalog.source, catalog.status)}
          </Badge>
        )}
        {catalog && (listed || models.length > 0) && (
          <span className="tw-label tw-num text-muted-foreground">
            {t.count(models.length)}
            {listed && catalog.checkedAtMs ? ` · ${t.fetchedAt(clock(catalog.checkedAtMs))}` : ""}
          </span>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="xs" onClick={onRefresh} disabled={busy} aria-busy={busy || undefined}>
          {busy ? <Spinner /> : <RefreshCwIcon />}
          {t.refresh}
        </Button>
      </div>

      {waiting ? (
        <StatusLabel tone="pending" muted>
          {t.fetching}
        </StatusLabel>
      ) : loading ? (
        <TableSkeleton rows={5} cols={3} />
      ) : !catalog ? (
        <Note>{t.notFetched}</Note>
      ) : (
        <>
          {!listed && (
            <FormItem label={t.manual} desc={t.manualDesc(catalog.error ? coreText(catalog.error) : null)}>
              <Textarea
                className="min-h-24 font-mono"
                value={manualText}
                onChange={(e) => {
                  setManualText(e.target.value);
                  set({
                    manualModels: [
                      ...new Set(
                        e.target.value
                          .split("\n")
                          .map((l) => l.trim())
                          .filter(Boolean),
                      ),
                    ],
                  });
                }}
              />
            </FormItem>
          )}

          <FormItem label={t.scope}>
            <Segmented
              value={form.scope}
              options={[
                { id: "all", label: t.all },
                { id: "some", label: t.some },
              ]}
              onChange={(v) =>
                set({
                  scope: v,
                  // 第一次切到指定模型：从全部勾上开始，由用户往下减
                  scopeList: v === "some" && form.scopeList.length === 0 ? models : form.scopeList,
                })
              }
            />
          </FormItem>

          {patterns.length > 0 && <Note>{t.patterns(patterns)}</Note>}

          {models.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <InputGroup className="w-64">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder={t.filter}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </InputGroup>
                <div className="flex-1" />
                <span className="tw-label tw-num text-muted-foreground">
                  {t.enabled(enabled.length, models.length)}
                </span>
              </div>
              <Boxed className="max-h-72 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-9">
                        <Checkbox
                          aria-label={t.selectAll}
                          checked={allShownOn ? true : someShownOn ? "indeterminate" : false}
                          onCheckedChange={(v) => toggleAll(v === true)}
                        />
                      </TableHead>
                      <TableHead>{t.modelId}</TableHead>
                      <TableHead>{t.context}</TableHead>
                      {perToken && <TableHead>{t.pricing}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {shown.map((m) => {
                      const on = inScope(form, m);
                      const price = prices[m];
                      return (
                        <TableRow key={m}>
                          <TableCell>
                            <Checkbox
                              aria-label={m}
                              checked={on}
                              onCheckedChange={(v) => toggle(m, v === true)}
                            />
                          </TableCell>
                          <TableCell className={on ? "font-mono" : "font-mono text-muted-foreground"}>
                            {m}
                          </TableCell>
                          <TableCell className="tw-num text-muted-foreground">
                            {contextWindow(price?.max_input_tokens)}
                          </TableCell>
                          {perToken && (
                            <TableCell>
                              {!price ? (
                                <span className="text-muted-foreground">—</span>
                              ) : price.price ? (
                                <span className="text-muted-foreground">
                                  {price.estimated ? t.pricedEstimated : t.priced}
                                </span>
                              ) : (
                                <Badge variant="warning">{t.unpriced}</Badge>
                              )}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Boxed>
            </>
          )}

          {unpriced.length > 0 && (
            <p className="flex items-start gap-2 tw-label text-warning">
              <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
              <span>{t.unpricedNote(unpriced.length, sheetLabel)}</span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  const today = new Date();
  const time = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return d.toDateString() === today.toDateString()
    ? time
    : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${time}`;
}
