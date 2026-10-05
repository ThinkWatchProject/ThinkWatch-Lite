import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { call } from "@/control";
import { invalidate, useResource } from "@/lib/resource";
import { latestOnly } from "@/lib/latestOnly";
import { cn } from "@/lib/utils";
import { useNav } from "@/nav";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Autocomplete, ComboboxBareInput, ComboboxContent, ComboboxItem, ComboboxList } from "@/ui/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { rowMotion, usePresentList } from "@/ui/motion";
import { notify } from "@/ui/notify";
import { Skeleton } from "@/ui/skeleton";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import type { AliasHint, KnownModel } from "@/types";
import { Boxed, DialogError, FormItem } from "@/upstreams/parts";
import { aliasDialogText } from "./AliasDialog.i18n";
import type {
  AliasInput,
  AliasPreview,
  AliasSave,
  AliasUsage,
  KnownModelAliasFields,
  PinnedModel,
} from "./api.provisional";
import { dialogApi } from "./dialogApi";
import { ONLY_ITSELF, draftOf, onlyAuto, shownProblems, withModel, withName, withoutModel, type Draft } from "./draft";

/** `GET /models` 的一项，带上别名的两个新字段（core 发版前是临时的） */
type Known = KnownModel & Partial<KnownModelAliasFields>;

/** 输入停下来这么久再问 core 和 Rust */
const PREVIEW_DELAY_MS = 250;

/** 建议列表最多列几条 */
const MAX_SUGGESTIONS = 50;

/**
 * 新建、编辑一个模型别名。
 *
 * 从上往下：名称（只在有问题时下面出提示）、上游模型（一个名称一行，右边写由哪几个上游
 * 提供）、其他上游的同一模型（认得出时才有，勾选才加入）、发往各上游（只读预览，每个上游
 * 实际收到的模型名）。
 *
 * **判断都在 core**：挡保存的问题、谁能服务、谁不再收到这个名称、哪些是同一个模型，都来自
 * `POST /aliases/preview`，草稿一变就问一次。和这台机器上的客户端有关的几条（Claude Code 的
 * 档位名、名称像别家模型、Claude Desktop 显示不显示）来自 Rust 的 `alias_hints`。
 *
 * 红字是 core 说的问题，不能保存；黄字是要留意的，可以保存。
 *
 * 挂载方：别名标签（新建、编辑），上游模型弹窗（「起别名…」，`initial.models` 是那个模型）。
 */
export function AliasDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  /** 编辑哪个别名（原名）。不给就是新建 */
  editing?: string;
  /** 新建时预填。编辑时不用给：模型按原名从 core 读 */
  initial?: Partial<AliasInput>;
  onSaved?(): void;
}) {
  const { open, onOpenChange, editing } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 点到对话框外面不关：填了一半的表单不该因为一次误点丢掉。Esc、×、取消照常 */}
      <DialogContent
        className="flex max-h-[88vh] flex-col gap-4 sm:max-w-[640px]"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          // 编辑时焦点放在对话框上，不直接进名称：名称通常不改。新建时进名称
          if (editing == null) return;
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        {/* 内容只在开着时挂上：每次打开都从头填 */}
        <Body {...props} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  editing,
  initial,
  onSaved,
  onClose,
}: {
  editing?: string;
  initial?: Partial<AliasInput>;
  onSaved?(): void;
  onClose: () => void;
}) {
  const t = useText(aliasDialogText);
  const c = useText(commonText);
  const nav = useNav();
  const creating = editing == null;

  const known = useResource("known-models", () => call("KnownModels", null), {
    events: ["models_changed", "config_reloaded"],
  });
  const catalog = useMemo(() => (known.data ?? []) as Known[], [known.data]);
  /** 上游的真模型（不是别名）：名称 → 提供它的上游 */
  const offered = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const k of catalog) if (!k.alias) m.set(k.id, k.providers);
    return m;
  }, [catalog]);

  const [draft, setDraft] = useState<Draft>(() => draftOf(initial?.name ?? editing ?? "", initial?.models ?? []));
  const { name, models, auto } = draft;
  /** 编辑时从 core 读到的模型和各自的上游。读到之前是 `null` */
  const [loaded, setLoaded] = useState<Map<string, string[]> | null>(() =>
    editing != null && initial?.models === undefined ? null : new Map(),
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  /** 打开时的配置版本，保存时带它（见 KeyDialog 的 `base`） */
  const [base, setBase] = useState<string | undefined>(undefined);
  const [preview, setPreview] = useState<{ key: string; p: AliasPreview } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [hints, setHints] = useState<AliasHint[]>([]);
  const [usage, setUsage] = useState<AliasUsage | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    dialogApi
      .configVersion()
      .then(setBase)
      .catch(() => {});
  }, []);

  // 编辑：按原名读出列着的模型
  useEffect(() => {
    if (editing == null || initial?.models !== undefined) return;
    let live = true;
    dialogApi
      .aliases()
      .then((v) => {
        if (!live) return;
        const a = v.aliases.find((x) => x.name === editing);
        if (!a) {
          setLoadError(t.notFound(editing));
          return;
        }
        setDraft((d) => ({ ...d, models: a.models.map((m) => m.model) }));
        setLoaded(new Map(a.models.map((m) => [m.model, m.providers])));
      })
      .catch((e) => live && setLoadError(errorText(e)));
    return () => {
      live = false;
    };
  }, [editing, initial?.models]);

  const trimmed = name.trim();
  const renaming = editing != null && trimmed !== "" && trimmed !== editing;

  // 改名：先读出在用旧名的地方，保存前说清哪些会一起改
  useEffect(() => {
    if (!renaming || usage || editing == null) return;
    let live = true;
    dialogApi
      .aliasUsage(editing)
      .then((u) => live && setUsage(u))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [renaming, usage, editing]);

  // 草稿一变：问 core 预览、问 Rust 名称提示。**只认最后一次**：回来时草稿可能又变了
  const draftKey = JSON.stringify([trimmed, models]);
  const previewSeq = useRef(latestOnly());
  const hintSeq = useRef(latestOnly());
  useEffect(() => {
    if (loaded === null) return;
    const timer = setTimeout(() => {
      const fresh = hintSeq.current.start();
      dialogApi
        .hints(trimmed, models)
        .then((h) => fresh() && setHints(h))
        .catch(() => fresh() && setHints([]));
      if (trimmed === "" && models.length === 0) {
        previewSeq.current.drop();
        setPreview(null);
        setPreviewError(null);
        return;
      }
      const current = previewSeq.current.start();
      const key = draftKey;
      dialogApi
        .previewAlias({ alias: { name: trimmed, models }, original: editing })
        .then((p) => {
          if (!current()) return;
          setPreview({ key, p });
          setPreviewError(null);
        })
        .catch((e) => {
          if (!current()) return;
          setPreviewError(errorText(e));
        });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
    // draftKey 包含 trimmed 和 models
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey, loaded === null]);

  /** 由哪几个上游提供：上游清单里的，编辑时再用 core 读到的补上 */
  const providersOf = (m: string): string[] => offered.get(m) ?? loaded?.get(m) ?? [];
  const sep = t.sep;

  const changeName = (v: string) => setDraft((d) => withName(d, v, (m) => offered.has(m), creating));
  const add = (m: string) => setDraft((d) => withModel(d, m));
  const remove = (m: string) => setDraft((d) => withoutModel(d, m));

  const p = preview?.p ?? null;
  const fresh = preview?.key === draftKey;
  const problems = shownProblems(p?.problems ?? [], draft);
  const onlyItself = onlyAuto(draft) && fresh && (p?.problems ?? []).some((m) => m.code === ONLY_ITSELF);
  const shadows = trimmed && p ? p.shadows : [];
  const unserved = new Set(p ? p.unserved : models.filter((m) => known.data && !offered.has(m)));
  const sameModel = (p?.same_model ?? []).filter((s) => !models.includes(s.model));
  const listing = hints.find((h) => h.code === "model_lists_update");

  // 读不到要编辑的别名时，报错就在模型列表下面，页脚不再说「正在读取」
  const loading = loaded === null && loadError === null;
  const missing = loadError
    ? null
    : loading
      ? t.loading
      : trimmed === ""
        ? t.needName
        : models.length === 0
          ? t.needModels
          : onlyItself
            ? t.needOtherName
            : null;
  const blocked = missing !== null || loadError !== null || (fresh && problems.length > 0);

  /** 建这个别名之后，名称改发给哪些模型（各上游实际收到的，没有就是列出的） */
  const sentModels = unique((p?.served_by ?? []).map((s) => s.model));

  async function save() {
    setSaving(true);
    setError(null);
    const body: AliasSave = { alias: { name: trimmed, models }, base_version: base };
    try {
      if (editing != null) {
        const w = await dialogApi.updateAlias(editing, body);
        const refs = refsText(w.renamed_in, t);
        if (trimmed !== editing && refs) notify.success(t.renamed(editing, trimmed), t.renamedIn(refs));
      } else {
        await dialogApi.createAlias(body);
      }
      // 列着别名的几处（别名标签、模型建议、上游模型弹窗的别名标记）
      invalidate("aliases");
      invalidate("known-models");
      invalidate("upstream-models:");
      onSaved?.();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const renameRefs = renaming && usage ? refsText({ ...usage, requests_24h: 0 }, t) : "";

  return (
    <>
      <DialogHeader>
        <DialogTitle className="tw-title">{creating ? t.createTitle : t.editTitle(editing ?? "")}</DialogTitle>
        <DialogDescription>{t.desc}</DialogDescription>
      </DialogHeader>

      <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-1">
        <FormItem label={t.name} hint={t.nameHint} htmlFor="alias-name">
          <Input
            id="alias-name"
            className="font-mono"
            value={name}
            placeholder={t.namePlaceholder}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={problems.length > 0 || undefined}
            onChange={(e) => changeName(e.target.value)}
          />
          {(problems.length > 0 || shadows.length > 0 || hints.length > 0 || auto || renameRefs) && (
            <div className="flex flex-col gap-1">
              {problems.map((m) => (
                <Line key={m.code + m.text} tone="error">
                  {coreText(m)}
                </Line>
              ))}
              {auto && models.includes(auto) && (
                <Line tone="info">{t.prefilled(providersOf(auto).join(sep) || "—", auto)}</Line>
              )}
              {shadows.length > 0 && (
                <Line tone="warning">
                  {t.shadows(
                    shadows.join(sep),
                    trimmed,
                    (sentModels.length > 0 ? sentModels : models).join(sep),
                    creating,
                  )}
                </Line>
              )}
              {hints.map((h) => {
                const text = hintText(h, t);
                if (!text) return null;
                return (
                  <Line key={h.code} tone={h.code === "claude_desktop_shown" ? "info" : "warning"}>
                    {text}
                  </Line>
                );
              })}
              {renameRefs && <Line tone="info">{t.renameRefs(editing ?? "", renameRefs)}</Line>}
            </div>
          )}
          {shadows.length > 0 && (
            <div>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => {
                  onClose();
                  nav.open("routing");
                }}
              >
                {t.writeRule}
              </Button>
            </div>
          )}
        </FormItem>

        <FormItem label={t.models}>
          <ModelList
            models={models}
            providersOf={providersOf}
            unserved={unserved}
            candidates={catalog.filter((k) => !k.alias && !models.includes(k.id))}
            loading={loading}
            onAdd={add}
            onRemove={remove}
          />
          {loadError ? (
            <p className="tw-label text-destructive">{loadError}</p>
          ) : (
            <p className={cn("tw-label", unserved.size > 0 ? "text-warning" : "text-muted-foreground")}>
              {unserved.size > 0 ? t.modelsUnserved(unserved.size) : t.modelsWhat}
            </p>
          )}
        </FormItem>

        {sameModel.length > 0 && (
          <FormItem label={t.sameModel} desc={t.sameModelWhat} className="motion-fade">
            <Boxed>
              {sameModel.map((s) => (
                <label
                  key={`${s.provider}:${s.model}`}
                  className="flex h-8 cursor-default items-center gap-2.5 border-b border-border px-3 last:border-b-0"
                >
                  <Checkbox checked={false} onCheckedChange={(on) => on === true && add(s.model)} />
                  <span className="min-w-0 flex-1 truncate font-mono tw-body">{s.model}</span>
                  <span className="shrink-0 tw-label text-muted-foreground">{s.provider}</span>
                </label>
              ))}
            </Boxed>
          </FormItem>
        )}

        <FormItem label={t.sentTo} desc={t.sentWhat}>
          <SentTo
            name={trimmed}
            models={models}
            preview={p}
            error={previewError}
            sameModel={sameModel}
            shadows={shadows}
          />
        </FormItem>
      </div>

      <DialogError error={error} />

      <DialogFooter className="items-center">
        {missing ? (
          <span className="mr-auto tw-label text-muted-foreground">{missing}</span>
        ) : listing && listing.code === "model_lists_update" && (creating || renaming) ? (
          <span className="mr-auto tw-label text-muted-foreground">
            {t.modelListsUpdate(listing.clients.join(sep), creating)}
          </span>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          {c.cancel}
        </Button>
        <Button onClick={() => void save()} pending={saving} disabled={blocked}>
          {creating ? t.create : c.save}
        </Button>
      </DialogFooter>
    </>
  );
}

type DialogText = (typeof aliasDialogText)["zh"];

/** Rust 给的一条名称提示，写成句子。列进页脚的那一条不在这里说 */
function hintText(h: AliasHint, t: DialogText): string | null {
  switch (h.code) {
    case "claude_code_reserved":
      return t.claudeCodeReserved(h.name);
    case "family_mismatch":
      return t.familyMismatch(h.family, h.model, h.clients.join(t.sep));
    case "claude_desktop_hidden":
      return t.desktopHidden(h.name);
    case "claude_desktop_shown":
      return t.desktopShown(h.name);
    case "model_lists_update":
      return null;
  }
}

/** 改名会一起改掉的引用，写成一段（「密钥 a、b 的可见范围和规则 default / x」）。没有就是空 */
function refsText(u: AliasUsage, t: DialogText): string {
  const parts: string[] = [];
  if (u.keys.length > 0) parts.push(t.keysRef(u.keys.join(t.sep)));
  if (u.rules.length > 0) parts.push(t.rulesRef(unique(u.rules.map((r) => `${r.route} / ${r.rule}`)).join(t.sep)));
  return parts.join(t.refsJoin);
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}

/** 名称下面的一行提示：红是挡保存的问题，黄是要留意的，灰是告知 */
function Line({ tone, children }: { tone: "error" | "warning" | "info"; children: ReactNode }) {
  const Icon = tone === "error" ? CircleAlertIcon : tone === "warning" ? TriangleAlertIcon : InfoIcon;
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 tw-label motion-fade",
        tone === "error" ? "text-destructive" : tone === "warning" ? "text-warning" : "text-muted-foreground",
      )}
    >
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  );
}

/**
 * 上游模型：一个名称一行，右边写由哪几个上游提供，没有上游提供的标黄；最后一行输入新的
 * （和密钥的通配规则、放行网段同一个样子）。删一条写成字，不用 ×。
 */
function ModelList({
  models,
  providersOf,
  unserved,
  candidates,
  loading,
  onAdd,
  onRemove,
}: {
  models: string[];
  providersOf: (m: string) => string[];
  unserved: Set<string>;
  candidates: Known[];
  loading: boolean;
  onAdd: (m: string) => void;
  onRemove: (m: string) => void;
}) {
  const t = useText(aliasDialogText);
  const rows = usePresentList(models, (m) => m);
  return (
    <Boxed>
      {loading && (
        <div className="flex h-8 items-center border-b border-border px-3">
          <Skeleton className="h-2.5 w-48 rounded-sm" />
        </div>
      )}
      {rows.map(({ item: m, key, presence }) => {
        const flagged = unserved.has(m);
        const by = providersOf(m);
        return (
          <div
            key={key}
            className={cn("flex h-8 items-center gap-2.5 border-b border-border pr-1 pl-3", rowMotion(presence))}
          >
            <span className={cn("min-w-0 flex-1 truncate font-mono tw-body", flagged && "text-warning")} title={m}>
              {m}
            </span>
            <span
              className={cn("max-w-[45%] shrink-0 truncate tw-label", flagged ? "text-warning" : "text-muted-foreground")}
            >
              {flagged ? t.unserved : by.join(t.sep)}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t.remove(m)}
              className="shrink-0 text-muted-foreground"
              onClick={() => onRemove(m)}
            >
              {t.removeShort}
            </Button>
          </div>
        );
      })}
      <ModelInput candidates={candidates} onAdd={onAdd} disabled={loading} />
    </Boxed>
  );
}

/**
 * 名单的最后一行：**自由输入 + 建议**。建议是各上游清单里的模型，右边写由哪几个上游提供
 * （和插件适用范围的 `PatternInput` 一样）。清单里没有的名称照样能加：上游清单可能还没取到。
 *
 * 所以是 Autocomplete，不是 Combobox：点一条建议、或者用方向键选中再回车，直接加进名单；
 * 没选中建议时回车加的是输入的原样。
 */
function ModelInput({
  candidates,
  onAdd,
  disabled,
}: {
  candidates: Known[];
  onAdd: (m: string) => void;
  disabled: boolean;
}) {
  const t = useText(aliasDialogText);
  const [draft, setDraft] = useState("");
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
  const notes = useMemo(() => new Map(candidates.map((k) => [k.id, k.providers.join(t.sep)])), [candidates, t.sep]);
  const items = useMemo(() => candidates.map((k) => k.id), [candidates]);
  const q = draft.trim().toLowerCase();
  const shown = useMemo(
    () => items.filter((v) => q === "" || v.toLowerCase().includes(q)).slice(0, MAX_SUGGESTIONS),
    [items, q],
  );

  function commit(v: string) {
    onAdd(v);
    setDraft("");
  }

  return (
    <div ref={anchor} className="flex h-8 items-center gap-2.5 bg-background px-3">
      <Autocomplete
        items={items}
        filteredItems={shown}
        value={draft}
        onValueChange={(v, d) => {
          if (d.reason === "item-press") commit(v);
          else setDraft(v);
        }}
        open={open && shown.length > 0}
        onOpenChange={setOpen}
        onItemHighlighted={(v) => {
          highlighted.current = v as string | undefined;
        }}
        openOnInputClick
      >
        <ComboboxBareInput
          aria-label={t.models}
          placeholder={t.modelsPlaceholder}
          className="font-mono"
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
            // 对话框会把回车当成提交
            e.preventDefault();
            if (open && highlighted.current !== undefined) return;
            commit(draft);
          }}
          // 输了没按回车就去点别处：这一条也算上，不让它悄悄丢掉
          onBlur={() => {
            if (!open) commit(draft);
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

/**
 * 发往各上游：只读。每个上游实际收到的模型名（core 按列表顺序取它有的第一个）；认得出、
 * 还没勾选的同一模型所在的上游写「不提供」；有同名真模型、没列进来的上游写「不再收到」。
 */
function SentTo({
  name,
  models,
  preview,
  error,
  sameModel,
  shadows,
}: {
  name: string;
  models: string[];
  preview: AliasPreview | null;
  error: string | null;
  sameModel: PinnedModel[];
  shadows: string[];
}) {
  const t = useText(aliasDialogText);
  if (models.length === 0) return <p className="tw-label text-muted-foreground">{t.sentEmpty}</p>;
  if (!preview) {
    return error ? (
      <p className="tw-label text-muted-foreground">{t.previewFailed(error)}</p>
    ) : (
      <Boxed>
        <div className="flex h-7 items-center bg-surface px-3">
          <Skeleton className="h-2 w-32 rounded-sm" />
        </div>
        <div className="flex h-8 items-center gap-3 px-3">
          <Skeleton className="h-2.5 w-20 rounded-sm" />
          <Skeleton className="h-2.5 w-40 rounded-sm" />
        </div>
      </Boxed>
    );
  }
  const served = preview.served_by;
  const pending = unique(sameModel.map((s) => s.provider)).filter((pr) => !served.some((s) => s.provider === pr));
  const lost = shadows.filter((pr) => !served.some((s) => s.provider === pr));
  const rows: { provider: string; model?: string; note?: string }[] = [
    ...served.map((s) => ({ provider: s.provider, model: s.model })),
    ...pending.map((pr) => ({ provider: pr, note: t.notServing })),
    ...lost.map((pr) => ({ provider: pr, note: t.noLongerReceives(name) })),
  ];
  return (
    <div className="flex flex-col gap-1">
      <Boxed>
        <div className="border-b border-border bg-surface px-3 py-1 tw-label text-muted-foreground">
          {name ? t.sentHead(name) : t.sentHeadUnnamed}
        </div>
        {rows.length === 0 ? (
          <p className="px-3 py-1.5 tw-label text-warning">{t.sentNone}</p>
        ) : (
          rows.map((r) => (
            <div
              key={r.provider}
              className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-2.5 border-b border-border px-3 py-1.5 last:border-b-0"
            >
              <span className="truncate tw-body">{r.provider}</span>
              {r.model ? (
                <span className="truncate font-mono tw-body" title={r.model}>
                  {r.model}
                </span>
              ) : (
                <span className="truncate tw-label text-muted-foreground">{r.note}</span>
              )}
            </div>
          ))
        )}
      </Boxed>
      {error && <p className="tw-label text-muted-foreground">{t.previewFailed(error)}</p>}
    </div>
  );
}
