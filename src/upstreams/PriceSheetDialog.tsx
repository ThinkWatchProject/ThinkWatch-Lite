import { Fragment, useEffect, useMemo, useState } from "react";
import { ChevronRightIcon, PencilIcon, PlusIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/ui/input-group";
import { Spinner } from "@/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/table";
import type { Overview, PriceFields, PriceSheetInput, ResolvedPrice, SheetRef } from "@/types";
import { cn } from "@/lib/utils";
import { api } from "./api";
import { PRICE_COLUMNS, errorText, perMillion, priceSourceLabel } from "./labels";
import { Boxed, FormItem, Note, Segmented } from "./parts";
import { defaultSheetUsers } from "./PriceSheetTable";

export type PriceSheetDialogMode =
  /** `prefill`：从「无法计价」那条提示进来，带着要设价格的模型和上游 */
  | { kind: "create"; prefill?: { models: string[]; usedBy: string[] } }
  /** `add`：打开后为这几个模型各加一条覆盖（从上游对话框的「设置价格」进来） */
  | { kind: "edit"; name: string; add?: string[] }
  | { kind: "duplicate"; from: string }
  /** 默认价目表只能看，不能改 */
  | { kind: "default" };

type Filter = "related" | "overridden" | "all";

/** 缓存与长上下文单价相对输入、输出单价的比例。**填了新的覆盖价之后跟着联动** */
type Ratios = Partial<Record<keyof PriceFields, number>>;

const LONG_KEYS: { key: "input_above_200k" | "output_above_200k"; label: string }[] = [
  { key: "input_above_200k", label: "长上下文输入" },
  { key: "output_above_200k", label: "长上下文输出" },
];

/** 模型不在默认价目表里时，按上游的接口协议给一组常见比例 */
function protocolRatios(protocol: string | null | undefined): Ratios {
  if (protocol?.startsWith("openai")) return { cache_read: 0.5, cache_write_5m: 1, cache_write_1h: 1 };
  if (protocol === "gemini") return { cache_read: 0.25, cache_write_5m: 1, cache_write_1h: 1 };
  return { cache_read: 0.1, cache_write_5m: 1.25, cache_write_1h: 2 };
}

/**
 * 新建、编辑、复制价目表，以及查看默认价目表。
 *
 * **价格怎么算由 core 说。**列表里每一行的单价和来源都是拿当前草稿去问
 * core 的结果 —— 倍率、覆盖、跨平台估算的顺序界面不重写一遍。
 */
export function PriceSheetDialog({
  mode,
  ov,
  configVersion,
  context,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: PriceSheetDialogMode;
  ov: Overview;
  configVersion: string | null;
  /**
   * 从上游对话框里打开时，那一家（可能还没保存）的模型与协议。它的模型算作
   * 相关模型 —— 用户正是为了给它们设价格才打开的
   */
  context?: { models: string[]; protocol: string | null };
  onClose: () => void;
  onSaved: (name: string) => void;
  onDeleted?: () => void;
}) {
  const readOnly = mode.kind === "default";
  const original =
    mode.kind === "edit" ? (ov.price_sheets.find((s) => s.name === mode.name) ?? null) : null;
  const [name, setName] = useState("");
  const [multiplier, setMultiplier] = useState("1.00");
  const [overrides, setOverrides] = useState<Record<string, PriceFields>>({});
  const [ratios, setRatios] = useState<Record<string, Ratios>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [usedBy, setUsedBy] = useState<string[]>(() =>
    mode.kind === "edit"
      ? (original?.used_by ?? [])
      : mode.kind === "create"
        ? (mode.prefill?.usedBy ?? [])
        : mode.kind === "default"
          ? defaultSheetUsers(ov)
          : [],
  );
  const [usedByTouched, setUsedByTouched] = useState(mode.kind === "create" && !!mode.prefill);
  const [loading, setLoading] = useState(mode.kind === "edit" || mode.kind === "duplicate");
  const [filter, setFilter] = useState<Filter>("related");
  const [search, setSearch] = useState("");
  const [related, setRelated] = useState<string[]>([]);
  const [rows, setRows] = useState<ResolvedPrice[]>([]);
  const [matched, setMatched] = useState(0);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // 编辑、复制：读完整定义
  useEffect(() => {
    if (mode.kind !== "edit" && mode.kind !== "duplicate") return;
    const from = mode.kind === "edit" ? mode.name : mode.from;
    let alive = true;
    api
      .priceSheet(from)
      .then((s) => {
        if (!alive) return;
        setName(mode.kind === "edit" ? s.name : `${s.name} 副本`);
        setMultiplier(s.multiplier.toFixed(2));
        setOverrides(s.models);
        if (mode.kind === "edit" && mode.add?.length) {
          for (const m of mode.add) if (!s.models[m]) void addOverride(m, null);
          setFilter("overridden");
        }
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 从「无法计价」进来：那几个模型先各加一条覆盖
  useEffect(() => {
    if (mode.kind !== "create" || !mode.prefill) return;
    for (const m of mode.prefill.models) void addOverride(m, null);
    setFilter("overridden");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 相关模型：使用这张价目表的上游启用范围内的模型，加上打开它的那一家的模型
  const usedKey = usedBy.join("\n");
  const contextKey = context?.models.join("\n") ?? "";
  useEffect(() => {
    let alive = true;
    Promise.all(
      usedBy.map((u) =>
        api
          .providerModels(u)
          .then((v) => v.models.filter((m) => m.enabled).map((m) => m.id))
          .catch(() => [] as string[]),
      ),
    ).then((lists) => {
      if (alive) setRelated([...new Set([...(context?.models ?? []), ...lists.flat()])].sort());
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usedKey, contextKey]);

  const mult = Number(multiplier);
  const draft: PriceSheetInput = useMemo(
    () => ({ name: name.trim() || "草稿", multiplier: mult, models: overrides }),
    [name, mult, overrides],
  );

  // 当前视图里每一行的生效单价，拿草稿去问
  const overriddenList = Object.keys(overrides).sort();
  const q = search.trim().toLowerCase();
  const localList = (filter === "overridden" ? overriddenList : [...new Set([...related, ...overriddenList])].sort())
    .filter((m) => m.toLowerCase().includes(q));
  const listKey = filter === "all" ? `all:${q}` : localList.join("\n");
  useEffect(() => {
    const sheet: SheetRef = readOnly ? { kind: "default" } : { kind: "draft", sheet: draft };
    if (!readOnly && !(Number.isFinite(mult) && mult > 0)) {
      setDraftError("倍率须大于 0");
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      const query =
        filter === "all"
          ? { sheet, search: q, limit: 200 }
          : { sheet, models: localList.slice(0, 500) };
      api
        .queryPrices(query)
        .then((r) => {
          if (!alive) return;
          setRows(r.items);
          setMatched(filter === "all" ? r.matched : localList.length);
          setDraftError(null);
        })
        .catch((e) => alive && setDraftError(errorText(e)));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, listKey, draft, readOnly]);

  /** 加一条覆盖。`from`：以这一行此刻的生效单价为起点；没有就按默认价目表或协议比例 */
  async function addOverride(model: string, from: PriceFields | null) {
    const id = model.trim();
    if (!id || overrides[id]) return;
    let base = from;
    let r: Ratios;
    if (!base) {
      const d = await api.queryPrices({ sheet: { kind: "default" }, models: [id] }).catch(() => null);
      base = d?.items[0]?.price ?? null;
    }
    if (base && base.input > 0) {
      r = {
        cache_read: base.cache_read / base.input,
        cache_write_5m: base.cache_write_5m / base.input,
        cache_write_1h: base.cache_write_1h / base.input,
        input_above_200k: base.input_above_200k != null ? base.input_above_200k / base.input : undefined,
        output_above_200k:
          base.output_above_200k != null && base.output > 0 ? base.output_above_200k / base.output : undefined,
      };
    } else {
      const protocol = context?.protocol ?? ov.providers.find((p) => usedBy.includes(p.name))?.protocol;
      r = protocolRatios(protocol);
      base = { input: 0, output: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 };
    }
    setOverrides((o) => ({ ...o, [id]: base! }));
    setRatios((all) => ({ ...all, [id]: r }));
  }

  function editPrice(model: string, key: keyof PriceFields, raw: string) {
    const v = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(v)) return;
    setOverrides((o) => {
      const cur = o[model];
      if (!cur) return o;
      const next: PriceFields = { ...cur, [key]: v };
      const r = ratios[model] ?? {};
      // 改输入、输出单价时，还在联动的那几项跟着按比例变
      if (key === "input") {
        for (const k of ["cache_read", "cache_write_5m", "cache_write_1h", "input_above_200k"] as const) {
          if (r[k] != null) next[k] = round(v * r[k]!);
        }
      }
      if (key === "output" && r.output_above_200k != null) {
        next.output_above_200k = round(v * r.output_above_200k);
      }
      return { ...o, [model]: next };
    });
    if (key !== "input" && key !== "output") {
      // 手动改过的那一项不再联动
      setRatios((all) => ({ ...all, [model]: { ...(all[model] ?? {}), [key]: undefined } }));
    }
  }

  function toggleLong(model: string) {
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(model)) n.delete(model);
      else n.add(model);
      return n;
    });
  }

  function setLongTier(model: string, on: boolean) {
    setOverrides((o) => {
      const cur = o[model];
      if (!cur) return o;
      return {
        ...o,
        [model]: on
          ? { ...cur, input_above_200k: cur.input_above_200k ?? cur.input, output_above_200k: cur.output_above_200k ?? cur.output }
          : { ...cur, input_above_200k: undefined, output_above_200k: undefined },
      };
    });
  }

  const missing = readOnly
    ? null
    : name.trim() === ""
      ? "填写名称"
      : !(Number.isFinite(mult) && mult > 0)
        ? "倍率须大于 0"
        : null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const save = {
        sheet: { name, multiplier: mult, models: overrides },
        base_version: configVersion ?? undefined,
        used_by: usedByTouched ? usedBy : undefined,
      };
      if (mode.kind === "edit") await api.updatePriceSheet(mode.name, save);
      else await api.createPriceSheet(save);
      onSaved(name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (mode.kind !== "edit") return;
    setSaving(true);
    try {
      await api.deletePriceSheet(mode.name, configVersion);
      onDeleted?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const perTokenProviders = ov.providers.filter((p) => (p.billing ?? p.billing_effective) === "per-token");
  const title =
    mode.kind === "default"
      ? "默认价目表"
      : mode.kind === "edit"
        ? "编辑价目表"
        : mode.kind === "duplicate"
          ? "复制价目表"
          : "新建价目表";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[980px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{title}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? "LiteLLM 公开价格。自定义价目表在此基础上设置倍率与模型覆盖。"
              : "倍率作用于默认价目表中的全部单价，包括缓存与长上下文单价；模型覆盖不受倍率影响。"}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="flex items-center gap-2 tw-body text-muted-foreground">
            <Spinner />
            正在读取价目表
          </p>
        ) : (
          <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4">
            {!readOnly && (
              <div className="grid grid-cols-3 gap-4">
                <FormItem label="名称" htmlFor="ps-name">
                  <Input id="ps-name" value={name} onChange={(e) => setName(e.target.value)} />
                </FormItem>
                <FormItem label="定价依据">
                  <Input readOnly value="默认价目表" className="text-muted-foreground" />
                </FormItem>
                <FormItem label="倍率" htmlFor="ps-mult">
                  <Input
                    id="ps-mult"
                    className="font-mono tabular-nums"
                    inputMode="decimal"
                    value={multiplier}
                    onChange={(e) => setMultiplier(e.target.value)}
                  />
                </FormItem>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tw-body font-medium">模型单价</span>
                <Segmented<Filter>
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { id: "related", label: <>相关模型 <Count n={new Set([...related, ...overriddenList]).size} /></> },
                    ...(readOnly
                      ? []
                      : [{ id: "overridden" as Filter, label: <>已覆盖 <Count n={overriddenList.length} /></> }]),
                    { id: "all", label: "全部" },
                  ]}
                />
                <div className="flex-1" />
                <InputGroup className="w-52">
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    placeholder="筛选模型"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </InputGroup>
                {!readOnly && (
                  <Button variant="outline" size="sm" onClick={() => setAdding("")}>
                    <PlusIcon />
                    添加覆盖
                  </Button>
                )}
              </div>

              {adding != null && (
                <div className="flex items-center gap-2">
                  <Input
                    autoFocus
                    className="w-80 font-mono"
                    placeholder="模型 ID"
                    value={adding}
                    onChange={(e) => setAdding(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && adding.trim()) {
                        void addOverride(adding, null);
                        setAdding(null);
                        setFilter("overridden");
                      }
                      if (e.key === "Escape") setAdding(null);
                    }}
                  />
                  <Button
                    size="sm"
                    disabled={!adding.trim()}
                    onClick={() => {
                      void addOverride(adding, null);
                      setAdding(null);
                      setFilter("overridden");
                    }}
                  >
                    添加
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>
                    取消
                  </Button>
                </div>
              )}

              {draftError && <Note tone="error">{draftError}</Note>}

              <Boxed className="max-h-[42vh] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>模型</TableHead>
                      {PRICE_COLUMNS.map((c) => (
                        <TableHead key={c.key} className="text-right">
                          {c.label}
                        </TableHead>
                      ))}
                      {/* 默认价目表里每一行的来源都是它自己，不必逐行重复 */}
                      {!readOnly && <TableHead>来源</TableHead>}
                      {!readOnly && <TableHead className="w-9" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => {
                      const o = overrides[r.model];
                      const open = expanded.has(r.model);
                      return (
                        <Fragment key={r.model}>
                          <TableRow>
                            <TableCell className="font-mono">
                              {o ? (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1"
                                  onClick={() => toggleLong(r.model)}
                                  aria-expanded={open}
                                  aria-label="长上下文单价"
                                >
                                  <ChevronRightIcon
                                    className={cn("size-3.5 text-muted-foreground transition-transform", open && "rotate-90")}
                                  />
                                  {r.model}
                                </button>
                              ) : (
                                <span className={readOnly ? undefined : "pl-[18px]"}>
                                  {r.model}
                                  {readOnly && !r.price && (
                                    <Badge variant="warning" className="ml-2 font-sans">
                                      未定价
                                    </Badge>
                                  )}
                                </span>
                              )}
                            </TableCell>
                            {PRICE_COLUMNS.map((c) => (
                              <TableCell key={c.key} className="text-right tabular-nums">
                                {o ? (
                                  <PriceInput
                                    value={o[c.key] as number}
                                    onChange={(v) => editPrice(r.model, c.key, v)}
                                    label={`${r.model} ${c.label}`}
                                  />
                                ) : (
                                  perMillion(r.price?.[c.key])
                                )}
                              </TableCell>
                            ))}
                            {!readOnly && (
                              <TableCell className={r.price ? "text-muted-foreground" : "text-warning"}>
                                {o ? "价目表覆盖" : priceSourceLabel(r.source)}
                                {r.estimated && !o && "（估算）"}
                              </TableCell>
                            )}
                            {!readOnly && (
                              <TableCell className="text-right">
                                {o ? (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`移除 ${r.model} 的覆盖`}
                                    onClick={() =>
                                      setOverrides((all) => {
                                        const next = { ...all };
                                        delete next[r.model];
                                        return next;
                                      })
                                    }
                                  >
                                    <XIcon />
                                  </Button>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={`覆盖 ${r.model} 的价格`}
                                    onClick={() => void addOverride(r.model, r.price ?? null)}
                                  >
                                    <PencilIcon />
                                  </Button>
                                )}
                              </TableCell>
                            )}
                          </TableRow>
                          {o && open && (
                            <TableRow className="bg-muted/30">
                              <TableCell colSpan={PRICE_COLUMNS.length + 3}>
                                <div className="flex flex-wrap items-center gap-4 pl-[18px]">
                                  <span className="tw-label text-muted-foreground">
                                    单次请求输入超过 200K tokens 之后的单价
                                  </span>
                                  {o.input_above_200k == null ? (
                                    <Button variant="outline" size="xs" onClick={() => setLongTier(r.model, true)}>
                                      设置长上下文单价
                                    </Button>
                                  ) : (
                                    <>
                                      {LONG_KEYS.map((k) => (
                                        <label key={k.key} className="flex items-center gap-2 tw-label">
                                          {k.label}
                                          <PriceInput
                                            value={o[k.key] ?? 0}
                                            onChange={(v) => editPrice(r.model, k.key, v)}
                                            label={`${r.model} ${k.label}`}
                                          />
                                        </label>
                                      ))}
                                      <Button variant="ghost" size="xs" onClick={() => setLongTier(r.model, false)}>
                                        不分档
                                      </Button>
                                    </>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
                {rows.length === 0 && (
                  <p className="px-3 py-6 text-center tw-body text-muted-foreground">
                    {filter === "overridden"
                      ? "尚无模型覆盖"
                      : filter === "related"
                        ? "使用此价目表的上游尚无模型"
                        : "没有匹配的模型"}
                  </p>
                )}
              </Boxed>
              <div className="flex items-center gap-2">
                <span className="tw-label text-muted-foreground">单位：美元 / 百万 tokens</span>
                <div className="flex-1" />
                {filter === "all" && matched > rows.length && (
                  <span className="tw-label tabular-nums text-muted-foreground">
                    显示前 {rows.length} 个，共 {matched.toLocaleString()} 个匹配。输入模型名称缩小范围。
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="tw-body font-medium">使用此价目表的上游</span>
              {readOnly ? (
                <span className="tw-body">
                  {usedBy.length ? usedBy.join("、") : <span className="text-muted-foreground">未被使用</span>}
                </span>
              ) : perTokenProviders.length === 0 ? (
                <Note>尚无按量计费的上游。</Note>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {perTokenProviders.map((p) => {
                    const on = usedBy.includes(p.name);
                    const elsewhere = !on && p.pricing && p.pricing !== (mode.kind === "edit" ? mode.name : "");
                    return (
                      <button
                        key={p.name}
                        type="button"
                        aria-pressed={on}
                        title={elsewhere ? `当前使用价目表「${p.pricing}」，选中后改用此价目表` : undefined}
                        onClick={() => {
                          setUsedByTouched(true);
                          setUsedBy((u) => (on ? u.filter((x) => x !== p.name) : [...u, p.name]));
                        }}
                        className={cn(
                          "rounded-md border px-2 py-0.5 font-mono tw-label transition-colors",
                          on
                            ? "border-foreground/30 bg-foreground/10 text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {p.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="items-center">
          {mode.kind === "edit" && (
            <>
              <Button
                variant="ghost"
                className="text-destructive"
                disabled={(original?.used_by.length ?? 0) > 0 || saving}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2Icon />
                删除价目表
              </Button>
              {(original?.used_by.length ?? 0) > 0 && (
                <span className="tw-label text-muted-foreground">
                  正在被 {original?.used_by.length} 个上游使用
                </span>
              )}
            </>
          )}
          <div className="flex-1" />
          {missing && <span className="tw-label text-muted-foreground">{missing}</span>}
          {readOnly ? (
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={save} disabled={saving || missing != null}>
                {saving && <Spinner />}
                {mode.kind === "edit" ? "保存" : "创建"}
              </Button>
            </>
          )}
        </DialogFooter>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle>删除价目表「{mode.kind === "edit" ? mode.name : ""}」</AlertDialogTitle>
              <AlertDialogDescription>
                删除后此价目表的倍率与模型覆盖将从配置文件中移除，可在版本历史中恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={remove}>
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function Count({ n }: { n: number }) {
  return <span className="tw-label tabular-nums text-muted-foreground">{n.toLocaleString()}</span>;
}

/** 表格里的单价输入。失焦前保留用户打的原样（「0.」这种中间态） */
function PriceInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (raw: string) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <Input
      aria-label={label}
      inputMode="decimal"
      className="ml-auto h-6 w-20 px-1.5 text-right font-mono tabular-nums"
      value={text ?? perMillion(value)}
      onFocus={() => setText(String(value))}
      onBlur={() => setText(null)}
      onChange={(e) => {
        setText(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

function round(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
