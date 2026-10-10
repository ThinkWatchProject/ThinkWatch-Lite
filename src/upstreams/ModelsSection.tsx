import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlertIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { compact, whenMinute } from "@/format";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { rowMotion, usePresentList } from "@/ui/motion";
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
import { textOf, useText } from "@/i18n";
import type { ModelListStatus, ModelSource, Msg, ProviderModelsView, ResolvedPrice } from "@/types";
import { coreText } from "@/i18n/core.i18n";
import { modelSourceLabel } from "./labels";
import { type ManualAdd, type ManualEntry, ManualModelList, ManualTag } from "./ManualModelInput";
import { manualModelInputText } from "./ManualModelInput.i18n";
import { unionModels } from "./manualModels";
import { modelsSectionText } from "./ModelsSection.i18n";
import { Note } from "./parts";
import { inScope, withManualRemoved, type UpstreamForm } from "./upstreamForm";

/** 这家上游有哪些模型，以及是怎么知道的 */
export interface ModelCatalog {
  source: ModelSource;
  /**
   * **上游自己列出的**模型（`ModelRow.listed`）。手动添加的不在这里：那一份以表单里的
   * `manualModels` 为准 —— 对话框里加了、移除了还没保存的，这一节照样要列对
   */
  listed: string[];
  checkedAtMs?: number | null;
  /** 没拿到清单的原因 */
  error?: Msg | null;
  /** 获取的结果：拿到了、上游不提供、没问到 */
  status?: ModelListStatus;
  /** core 正在向上游问 */
  fetching?: boolean;
  /**
   * 这一家手写了上下文窗口的模型（`model_specs`）和那个数。手写的优先于价目表，这一节的
   * 上下文窗口一列照它写，和模型弹窗里是同一个数
   */
  manualContext?: Record<string, number>;
}

/** core 记下的那一份 */
export function catalogOf(v: ProviderModelsView): ModelCatalog {
  return {
    source: v.source,
    listed: v.models.filter((m) => m.listed).map((m) => m.id),
    checkedAtMs: v.checked_at_ms,
    error: v.error,
    status: v.status,
    fetching: v.fetching,
    manualContext: Object.fromEntries(
      v.models.flatMap((m) =>
        m.context_window_source === "manual" && m.context_window != null ? [[m.id, m.context_window]] : [],
      ),
    ),
  };
}

/**
 * 标题旁那一行数。上游列出的清单里接了手动添加的，两个数分开说（和模型弹窗一样）：「上游
 * 列出 5 个」里有两个其实是手动添加的，就不对了。手动添加、上游也列了的算在上游列出的里。
 * 没有清单时全是手动添加的，前面的标签已经说了「手动添加」，只说数；一个也没有就不说。
 */
export function modelCount(hasList: boolean, listed: number, added: number): string | null {
  const t = textOf(modelsSectionText);
  if (hasList) return added > 0 ? t.listedAndAdded(listed, added) : t.count(listed);
  return added > 0 ? t.count(added) : null;
}

/**
 * 对话框的「模型」一节，**一屏放下**：顶上一行（新建时是检测结果或登录的账号，编辑时是清单从哪儿
 * 来、多少个），一条工具条（启用范围、已启用几个、筛选、刷新），下面是上游列出的和手动添加的
 * 合成的一张表，最后一行手动添加模型（名单式输入，和模型弹窗的「添加模型…」共用，见
 * `ManualModelInput`）。**只有那张表在自己的框里滚**，框按剩下的高度收放。
 *
 * 手动添加的那几行标「手动」、行尾「移除」。加和移除都只改表单，和别的设置一起保存。
 * 指定了启用范围时，新加的一并勾上（`withManualAdded`）。
 *
 * 输入框的状态（`entry`）放在对话框里：切到别的分节再保存，输入框里没按回车的也要先加上、
 * 写错了不存（见 `UpstreamDialog` 的 `save`）。
 */
export function ModelsSection({
  head,
  form,
  set,
  catalog,
  entry,
  prices,
  perToken,
  sheetLabel,
  loading,
  refreshing,
  onRefresh,
}: {
  /** 顶上那一行：新建时检测通过的结果，或者登录的账号。不给就写清单的来历 */
  head?: ReactNode;
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  catalog: ModelCatalog | null;
  /** 手动添加的输入框。加进去由对话框做（查重、勾上启用范围） */
  entry: ManualEntry<ManualAdd>;
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
  const shared = useText(manualModelInputText);
  const [filter, setFilter] = useState("");
  const hasList = catalog?.source === "discovered";
  // 后台正在问、手里还什么都没有：等它
  const waiting = !!catalog?.fetching && catalog.source === "none";
  const busy = refreshing || !!catalog?.fetching;
  const pending = waiting || loading;
  /**
   * 知道上游列了哪些。不知道的时候（还在读、没读到）不给勾选：勾一下就把范围换成手里这几个，
   * 上游列出的那些就悄悄掉出去了
   */
  const known = catalog != null && !pending;
  const listed = catalog?.listed;
  const union = useMemo(() => unionModels(listed ?? [], form.manualModels), [listed, form.manualModels]);
  const models = useMemo(() => union.map((m) => m.id), [union]);
  // 第一次知道上游列了哪些时整张表一起出来，之后新加的那几行才带进场的动效
  const present = usePresentList(known ? union : [], (m) => m.id);
  const rows = known ? present : union.map((item) => ({ item, key: item.id, presence: "idle" as const }));
  const q = known ? filter.trim().toLowerCase() : "";
  const shown = rows.filter(({ item }) => item.id.toLowerCase().includes(q));
  /** 看得见、还在的（刚移除、正在淡出的那一行不算）：全选管的是这些 */
  const live = shown.flatMap(({ item, presence }) => (presence === "exit" ? [] : [item.id]));
  // 切回「全部模型」时清单还留着（再切回来不丢），但那时通配规则不生效
  const patterns = form.scope === "some" ? form.scopeList.filter((p) => p.includes("*")) : [];
  const enabled = models.filter((m) => inScope(form, m));
  const unpriced = perToken ? enabled.filter((m) => prices[m] && !prices[m].price) : [];
  const anyManual = union.some((m) => m.manual);
  const added = union.filter((m) => m.manual && !m.listed).length;
  const count = pending ? null : modelCount(hasList, union.length - added, added);
  const source: ModelSource = hasList ? "discovered" : form.manualModels.length > 0 ? "manual" : "none";

  /*
    新加了模型：让那一行露出来。手动添加的接在表的最后，滚到底就是它；筛选框里写着别的、
    把它筛掉了的话，清掉筛选。输入框跟着往下挪，也让它留在视野里
  */
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const before = useRef(form.manualModels);
  const [reveal, setReveal] = useState(0);
  useLayoutEffect(() => {
    const fresh = form.manualModels.filter((m) => !before.current.includes(m));
    before.current = form.manualModels;
    if (fresh.length === 0) return;
    if (fresh.some((m) => !m.toLowerCase().includes(filter.trim().toLowerCase()))) setFilter("");
    setReveal((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.manualModels]);
  useLayoutEffect(() => {
    if (reveal === 0) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
    input.current?.scrollIntoView({ block: "nearest" });
  }, [reveal]);

  function toggle(model: string, on: boolean) {
    // 通配规则一旦被逐个勾选改动，就换成明确的模型清单 —— 两种写法混在
    // 一起时，用户看不出某个模型为什么勾不掉
    const current = models.filter((m) => inScope(form, m));
    const next = on ? [...new Set([...current, model])] : current.filter((m) => m !== model);
    set({ scope: "some", scopeList: next });
  }

  function toggleAll(on: boolean) {
    const current = new Set(models.filter((m) => inScope(form, m)));
    for (const id of live) {
      if (on) current.add(id);
      else current.delete(id);
    }
    set({ scope: "some", scopeList: models.filter((m) => current.has(m)) });
  }

  const allShownOn = live.length > 0 && live.every((id) => inScope(form, id));
  const someShownOn = live.some((id) => inScope(form, id));
  const note = known && !hasList ? noListNote(catalog) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {head ?? (
        <div className="flex min-h-6 shrink-0 items-center gap-2">
          <span className="tw-body font-medium">{t.title}</span>
          {catalog && !waiting && (
            <Badge variant={source === "none" && catalog.status === "failed" ? "warning" : "secondary"}>
              {modelSourceLabel(source, catalog.status)}
            </Badge>
          )}
          {count && (
            <span className="tw-label tw-num text-muted-foreground">
              {count}
              {hasList && catalog.checkedAtMs ? ` · ${t.fetchedAt(whenMinute(catalog.checkedAtMs))}` : ""}
            </span>
          )}
        </div>
      )}

      {note && <Note tone={note.tone}>{note.text}</Note>}
      {!catalog && !loading && <Note>{t.notFetched}</Note>}

      {/* 工具条：同一行的控件一样高（28px） */}
      <div className="flex shrink-0 items-center gap-2.5">
        {known && (
          <>
            <span className="tw-body font-medium">{t.scope}</span>
            <Segmented
              label={t.scope}
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
            {union.length > 0 && (
              <span className="tw-label tw-num text-muted-foreground">{t.enabled(enabled.length, models.length)}</span>
            )}
          </>
        )}
        <div className="flex-1" />
        {known && union.length > 0 && (
          <InputGroup className="h-7 w-48">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput placeholder={t.filter} aria-label={t.filter} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </InputGroup>
        )}
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={busy} aria-busy={busy || undefined}>
          {busy ? <Spinner /> : <RefreshCwIcon />}
          {t.refresh}
        </Button>
      </div>

      {known && patterns.length > 0 && <Note>{t.patterns(patterns)}</Note>}

      <ManualModelList
        fill
        entry={entry}
        inputRef={input}
        label={t.addLabel}
        placeholder={t.addPlaceholder}
        hint={hasList ? `${shared.about}${t.sep}${shared.hint}` : shared.hint}
        // 和上面的模型 ID 对齐：让出勾选那一列（36px）和单元格的内边距
        inputRowClassName={known && union.length > 0 ? "pl-11" : undefined}
      >
        {waiting ? (
          <div className="border-b border-border px-3 py-2.5">
            <StatusLabel tone="pending" muted>
              {t.fetching}
            </StatusLabel>
          </div>
        ) : loading ? (
          <TableSkeleton rows={5} cols={3} />
        ) : union.length > 0 ? (
          // 表在自己的框里滚，表头吸顶。框至少留几行高：再矮就让整页去滚
          <div ref={scroller} className="min-h-28 overflow-y-auto border-b border-border">
            <Table scroll={false}>
              <TableHeader className="sticky top-0 z-10 bg-background [&_th]:shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-b-0">
                <TableRow>
                  {known && (
                    <TableHead className="w-9">
                      <Checkbox
                        aria-label={t.selectAll}
                        checked={allShownOn ? true : someShownOn ? "indeterminate" : false}
                        onCheckedChange={(v) => toggleAll(v === true)}
                      />
                    </TableHead>
                  )}
                  <TableHead>{t.modelId}</TableHead>
                  <TableHead>{t.context}</TableHead>
                  {perToken && <TableHead>{t.pricing}</TableHead>}
                  {anyManual && (
                    <TableHead>
                      <span className="sr-only">{t.actions}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(({ item: m, key, presence }) => {
                  const on = inScope(form, m.id);
                  const price = prices[m.id];
                  const ctx = catalog?.manualContext?.[m.id] ?? price?.max_input_tokens;
                  return (
                    <TableRow key={key} className={rowMotion(presence)}>
                      {known && (
                        <TableCell>
                          <Checkbox aria-label={m.id} checked={on} onCheckedChange={(v) => toggle(m.id, v === true)} />
                        </TableCell>
                      )}
                      <TableCell className={cn("w-full max-w-0", !on && "text-muted-foreground")}>
                        <div className="flex min-w-0 items-center gap-2">
                          {/* Bedrock 应用推理配置的 ARN 有八十来个字符：截断，悬停看全 */}
                          <span title={m.id} className="min-w-0 truncate font-mono">
                            {m.id}
                          </span>
                          {m.manual && <ManualTag listed={m.listed} />}
                        </div>
                      </TableCell>
                      <TableCell className="tw-num text-muted-foreground">{ctx ? compact(ctx) : "—"}</TableCell>
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
                      {anyManual && (
                        <TableCell className="py-0 pr-1 text-right">
                          {m.manual && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              aria-label={t.removeLabel(m.id)}
                              className="text-muted-foreground"
                              onClick={() => set(withManualRemoved(form, m.id, m.listed))}
                            >
                              {t.remove}
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {shown.length === 0 && <p className="px-3 py-2.5 tw-label text-muted-foreground">{t.noMatch}</p>}
          </div>
        ) : null}
      </ManualModelList>

      {unpriced.length > 0 && (
        <p className="flex shrink-0 items-start gap-2 tw-label text-warning">
          <CircleAlertIcon className="mt-px size-3.5 shrink-0" />
          <span>{t.unpricedNote(unpriced.length, sheetLabel)}</span>
        </p>
      )}
    </div>
  );
}

/**
 * 没从上游拿到清单时，表上面那一句：为什么，以及手动添加是下一步。获取失败用琥珀色 ——
 * 连接本身可能有问题；上游本来就不提供清单是灰的
 */
function noListNote(c: ModelCatalog): { tone: "muted" | "warning"; text: string } {
  const t = textOf(modelsSectionText);
  const why = c.error ? coreText(c.error) : null;
  if (c.status === "failed") return { tone: "warning", text: t.noList(why ?? t.unreachable) };
  if (c.status === "no_list") return { tone: "muted", text: t.noList(why ?? t.noListReason) };
  return { tone: "muted", text: t.notFetched };
}
