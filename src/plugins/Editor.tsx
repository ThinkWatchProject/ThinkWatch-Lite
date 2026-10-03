import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { FileCodeIcon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { call } from "@/control";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { size } from "@/format";
import { ConfirmAction, focusSelf, useDialogFocus } from "@/keys/parts";
import { DialogError } from "@/upstreams/parts";
import type { ManifestView, Overview, PluginInspection, PluginView } from "@/types";
import { pluginName } from "./defaults";
import { editorText } from "./Editor.i18n";
import { OnErrorField, ScopeFields, SettingsFields } from "./fields";
import { pluginFieldsText } from "./fields.i18n";
import { pluginLabelsText } from "./labels.i18n";
import { manifestUnknown, MAX_SOURCE, saveAsks, shaPrefix, shapeChanged } from "./model";
import { CodeLoading, CodeView, codeErrorOf, PermissionChips, PluginText, RequestKinds } from "./parts";
import { pluginPartsText } from "./parts.i18n";
import { useScopeSuggestions } from "./suggestions";
import { useEditing, valuesOf, type Form } from "./useEditing";
import { savePlugin, type NativeWrite } from "./write";

export type EditorTab = "settings" | "code";

/** 编辑器打开时手上的东西 */
interface Loaded {
  /** core 拿来比的那一份：确认过的代码。读不到是 `null` */
  approved: string | null;
  /** 确认过的那一份读出来的 manifest。读不了是 `null` */
  approvedManifest: ManifestView | null;
  /** 编辑器起头的那一份代码，和读它的结果 */
  start: { source: string; inspection: PluginInspection };
}

/**
 * 取编辑器起头的代码：一般是确认过的那一份；从「审核更改」过来改磁盘上那一份的（`current`），
 * 是磁盘上现在的那一份。两份都交给 core 读一遍：起头的那一份填表单，确认过的那一份用来
 * 判断保存时要不要在系统的确认框里点头。
 */
async function load(id: string, from: "approved" | "current"): Promise<Loaded> {
  const s = await call("PluginSourceDiff", null, id);
  const approved =
    s.approved !== "" ? s.approved : s.current != null && s.current_sha256 === s.approved_sha256 ? s.current : null;
  const source = from === "current" && s.current != null ? s.current : (approved ?? s.current);
  if (source == null) throw { code: "", args: {}, text: textOf(editorText).noCode };
  const [a, b] = await Promise.all([
    approved != null ? call("PluginInspect", { source: approved }) : Promise.resolve(null),
    source !== approved ? call("PluginInspect", { source }) : Promise.resolve(null),
  ]);
  return { approved, approvedManifest: a?.manifest ?? null, start: { source, inspection: (b ?? a)! } };
}

/**
 * 一个插件的编辑器：**「设置」和「代码」两页，一个保存。**
 *
 * 插件的 JS 文件是唯一的真相：出错时怎么办、适用范围、设置项的值都写在代码的 manifest 里。
 * 「设置」页是它们的表单，改了由 core 写回代码里（`PluginRewrite`）；「代码」页直接改代码，
 * 停下来由 core 读一遍（`PluginInspect`），表单跟着变，读不了的写明第几行第几列。两页之间
 * 切换，没保存的改动都留着（见 `useEditing`）。**启用不在代码里**：它是这个应用的开关。
 *
 * 保存把整份代码和开关交给 core（`SavePlugin`）。只在一种情形下要在系统的确认框里点头：
 * 插件改得了回答里的工具调用，而这次要打开它或者改了它的代码（`write.ts`）。
 *
 * 带着没保存的改动关掉（Esc、×、取消、点在外面）时，在应用里问一次。
 */
export function PluginEditor({
  plugin,
  tab: initialTab,
  from = "approved",
  ov,
  native,
  onClose,
  onSaved,
  onReview,
}: {
  plugin: PluginView;
  tab: EditorTab;
  /** 从哪一份代码起头。`current`：磁盘上那一份（审核更改时文件读不了，去修它） */
  from?: "approved" | "current";
  ov: Overview;
  native: NativeWrite;
  onClose: () => void;
  onSaved: () => void;
  /** 打开「审核更改」（磁盘上的文件改过时） */
  onReview: () => void;
}) {
  const t = useText(editorText);
  const common = useText(commonText);
  const dialogFocus = useDialogFocus();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoadError(null);
    load(plugin.id, from).then(
      (l) => live && setLoaded(l),
      (e) => live && setLoadError(e),
    );
    return () => {
      live = false;
    };
    // 只在打开时（和重试时）取一次：编辑开始之后，后台的刷新不能把正在改的代码换掉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // 离开之前（关掉，或者转去审核更改）：有没保存的改动先问一次；保存、写入进行中不让走
  const state = useRef({ dirty: false, busy: false });
  /** 问的时候记下点了「放弃更改」之后去哪 */
  const [asking, setAsking] = useState<(() => void) | null>(null);
  const leave = (then: () => void) => {
    if (state.current.busy) return;
    if (state.current.dirty) setAsking(() => then);
    else then();
  };
  const requestClose = () => leave(onClose);

  const unknown = manifestUnknown(plugin);
  const name = unknown ? <span className="font-mono">{plugin.id}</span> : <PluginText text={pluginName(plugin.id, plugin.name)} />;

  return (
    <Dialog open onOpenChange={(o) => !o && requestClose()}>
      <DialogContent
        className="flex h-[min(85vh,720px)] flex-col gap-0 p-0 sm:max-w-3xl"
        {...dialogFocus}
        onOpenAutoFocus={focusSelf}
        // 点在外面和按 Esc 一样：有改动先问
        onInteractOutside={(e) => {
          if (state.current.dirty || state.current.busy) {
            e.preventDefault();
            requestClose();
          }
        }}
      >
        {loaded ? (
          <Editing
            plugin={plugin}
            loaded={loaded}
            initialTab={initialTab}
            from={from}
            ov={ov}
            native={native}
            title={name}
            onState={(s) => {
              state.current = s;
            }}
            onCancel={requestClose}
            onSaved={onSaved}
            onReview={() => leave(onReview)}
          />
        ) : (
          <>
            <Header title={name} />
            <div className="min-h-0 flex-1 px-4 py-4">
              {loadError != null ? (
                <ErrorState title={t.loadFailed} error={loadError} onRetry={() => setAttempt((n) => n + 1)} compact />
              ) : (
                <div className="flex flex-col gap-3" role="status" aria-busy="true">
                  <Skeleton className="h-7 w-full rounded-lg" />
                  <Skeleton className="h-16 w-full rounded-lg" />
                  <Skeleton className="h-40 w-full rounded-lg" />
                </div>
              )}
            </div>
            <DialogFooter className="mx-0 mb-0">
              <Button variant="outline" onClick={onClose}>
                {common.cancel}
              </Button>
              <Button disabled>{common.save}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      <AlertDialog open={asking != null} onOpenChange={(o) => !o && setAsking(null)}>
        <AlertDialogContent onOpenAutoFocus={focusSelf}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{t.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.keepEditing}</AlertDialogCancel>
            <ConfirmAction
              variant="destructive"
              pending={false}
              onConfirm={() => {
                const then = asking;
                setAsking(null);
                then?.();
              }}
            >
              {t.discard}
            </ConfirmAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/** 标题和下面一行：ID、SHA-256、权限、处理的请求种类，和贴着底边的两个标签 */
function Header({ title, meta, tabs }: { title: ReactNode; meta?: ReactNode; tabs?: ReactNode }) {
  return (
    <DialogHeader className={cn("shrink-0 gap-1 border-b border-border px-4 pt-4", tabs ? "pb-0" : "pb-3")}>
      <DialogTitle className="min-w-0 truncate pr-8">{title}</DialogTitle>
      <DialogDescription asChild>
        <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 tw-label text-muted-foreground">{meta}</div>
      </DialogDescription>
      {/* 左移到标签的字和标题对齐：列表有 3px 内边距、每个标签左右 6px */}
      {tabs && <div className="mt-2 -ml-[9px]">{tabs}</div>}
    </DialogHeader>
  );
}

/** 一段代码的 SHA-256（UTF-8），十六进制。core 读同一份代码得到的是同一串：系统的确认框里写的就是它 */
function useSha256(text: string): string | null {
  const [sha, setSha] = useState<{ text: string; hex: string } | null>(null);
  useEffect(() => {
    let live = true;
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then((buf) => {
      if (!live) return;
      setSha({ text, hex: [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("") });
    });
    return () => {
      live = false;
    };
  }, [text]);
  return sha?.text === text ? sha.hex : null;
}

function Editing({
  plugin,
  loaded,
  initialTab,
  from,
  ov,
  native,
  title,
  onState,
  onCancel,
  onSaved,
  onReview,
}: {
  plugin: PluginView;
  loaded: Loaded;
  initialTab: EditorTab;
  from: "approved" | "current";
  ov: Overview;
  native: NativeWrite;
  title: ReactNode;
  onState: (s: { dirty: boolean; busy: boolean }) => void;
  onCancel: () => void;
  onSaved: () => void;
  onReview: () => void;
}) {
  const t = useText(editorText);
  const lt = useText(pluginLabelsText);
  const ft = useText(pluginFieldsText);
  const common = useText(commonText);
  const ed = useEditing(plugin.id, loaded.start);
  const [tab, setTab] = useState<EditorTab>(
    // 代码读不了、也没有可以填的表单：直接看代码
    initialTab === "settings" && !loaded.start.inspection.manifest ? "code" : initialTab,
  );
  const [enabled, setEnabled] = useState(plugin.enabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const suggestions = useScopeSuggestions(ov);

  const dirty = ed.source !== loaded.start.source || enabled !== plugin.enabled;
  const problem = ed.form ? valuesOf(ed.form).problem : null;
  const problemText = !problem ? null : problem.kind === "scope" ? ft.needOne(lt.scopeParts[problem.part]) : ft.numberBad(problem.label);
  useEffect(() => onState({ dirty, busy: saving }), [dirty, saving, onState]);

  const switchTab = (next: EditorTab) => {
    // 切过去之前把这一页的改动交出去：另一页看到的是一致的样子
    void ed.flush();
    setTab(next);
  };

  async function save() {
    setSaving(true);
    setError(null);
    setCancelled(false);
    try {
      await ed.flush();
      // 刚打的字可能刚读完：按「现在」的判断，不按点下保存那一刻渲染的样子
      const { source, manifest: next, error: broken } = ed.now();
      if (broken || !next) return;
      const old = loaded.approvedManifest;
      const asks = saveAsks({
        old: old?.permissions ?? (plugin.permissions.length > 0 ? plugin.permissions : null),
        next: next.permissions,
        turningOn: enabled && !plugin.enabled,
        // 一定改了代码：manifest 里数据以外的东西变了，或者确认过的那一份读不了而代码不一样。
        // 别的（manifest 以外改了没有）交给 core 判断，它说要点头再请 Rust
        codeChanged: source !== loaded.approved && (old == null || shapeChanged(old, next)),
      });
      const r = await native((base) => savePlugin({ id: plugin.id, source, enabled, base_version: base }, asks));
      if (r === "cancelled") setCancelled(true);
      else onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const m = ed.manifest;
  const sha = useSha256(ed.source);
  const meta = (
    <>
      <span className="font-mono select-text">{t.id(plugin.id)}</span>
      {sha && <span className="font-mono select-text">{t.sha(shaPrefix(sha))}</span>}
      {m && (
        <PermissionChips
          permissions={m.permissions}
          previous={loaded.approvedManifest && ed.source !== loaded.approved ? loaded.approvedManifest.permissions : undefined}
        />
      )}
      {m && <RequestKinds kinds={m.requests} />}
    </>
  );

  return (
    <Tabs value={tab} onValueChange={(v) => switchTab(v as EditorTab)} className="flex min-h-0 flex-1 flex-col gap-0">
      <Header
        title={title}
        meta={meta}
        tabs={
          <TabsList variant="line">
            <TabsTrigger value="settings">{t.tabSettings}</TabsTrigger>
            <TabsTrigger value="code">
              {t.tabCode}
              {ed.error && <StatusDot tone="error" label={t.codeHasError} />}
            </TabsTrigger>
          </TabsList>
        }
      />

      <div className="relative min-h-0 flex-1">
        <TabsContent value="settings" forceMount className={cn(PANE, "flex flex-col")}>
          <SettingsPane
            plugin={plugin}
            form={ed.form}
            onForm={ed.editForm}
            codeError={ed.error != null}
            diskChanged={from === "approved" && plugin.status.kind === "changed"}
            enabled={enabled}
            onEnabled={setEnabled}
            suggestions={suggestions}
            onViewCode={() => switchTab("code")}
            onReview={onReview}
          />
        </TabsContent>
        <TabsContent value="code" forceMount className={cn(PANE, "flex flex-col gap-2 px-4 py-4")}>
          <CodePane
            source={ed.source}
            onChange={(s) => ed.editCode(s)}
            onImport={(s) => ed.editCode(s, true)}
            error={ed.error}
            checking={ed.checking}
          />
        </TabsContent>
      </div>

      <div className="shrink-0 px-4 empty:hidden">
        <DialogError error={error ?? ed.syncError} className="mb-3" />
        {cancelled && <p className="mb-3 tw-label text-muted-foreground">{t.cancelled}</p>}
      </div>

      <DialogFooter className="mx-0 mb-0 items-center">
        {problemText ? (
          <span className="mr-auto tw-label text-warning">{problemText}</span>
        ) : (
          dirty && <span className="mr-auto tw-label text-muted-foreground">{t.unsaved}</span>
        )}
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          {common.cancel}
        </Button>
        <Button
          onClick={() => void save()}
          pending={saving}
          disabled={!dirty || ed.error != null || !m || problem != null}
        >
          {common.save}
        </Button>
      </DialogFooter>
    </Tabs>
  );
}

/** 两页叠在同一块里，没选中的藏起来（不卸载：代码的撤销记录、滚动位置都留着） */
const PANE = "absolute inset-0 data-[state=inactive]:hidden";

function SettingsPane({
  plugin,
  form,
  onForm,
  codeError,
  diskChanged,
  enabled,
  onEnabled,
  suggestions,
  onViewCode,
  onReview,
}: {
  plugin: PluginView;
  form: Form | null;
  onForm: (f: Form) => void;
  codeError: boolean;
  diskChanged: boolean;
  enabled: boolean;
  onEnabled: (on: boolean) => void;
  suggestions: ReturnType<typeof useScopeSuggestions>;
  onViewCode: () => void;
  onReview: () => void;
}) {
  const t = useText(editorText);
  const lt = useText(pluginLabelsText);
  const ft = useText(pluginFieldsText);
  // 横幅钉在上面、不跟着表单滚走：表单滚到底时代码出了错，也一眼看得见
  const banners = (diskChanged || codeError) && (
    <div className="flex shrink-0 flex-col gap-2 px-4 pt-4">
      {diskChanged && (
        <Banner
          layout="inline"
          tone="warning"
          title={t.diskChanged}
          actions={
            <Button size="sm" variant="outline" onClick={onReview}>
              {t.reviewChanges}
            </Button>
          }
        >
          {t.diskChangedHint}
        </Banner>
      )}
      {codeError && (
        <Banner
          layout="inline"
          tone="error"
          title={t.codeError}
          actions={
            <Button size="sm" variant="outline" onClick={onViewCode}>
              {t.viewCode}
            </Button>
          }
        >
          {form ? t.codeErrorHint : t.codeErrorNoForm}
        </Banner>
      )}
    </div>
  );
  return (
    <>
      {banners}
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div>
            <label className="tw-body font-medium" htmlFor={`plugin-enabled-${plugin.id}`}>
              {t.enabled}
            </label>
            <p className="tw-label text-muted-foreground">{t.enabledHint}</p>
          </div>
          <Switch id={`plugin-enabled-${plugin.id}`} checked={enabled} onCheckedChange={onEnabled} />
        </div>

        {form && (
          // 代码读不了时停在上一次读得了的样子，不能改：改了也写不回读不了的代码
          <fieldset disabled={codeError} className="flex min-w-0 flex-col gap-5">
            <OnErrorField value={form.onError} onChange={(onError) => onForm({ ...form, onError })} />
            <section className="flex flex-col gap-3">
              <h3 className="tw-head text-foreground">{lt.scope}</h3>
              <ScopeFields value={form.scope} onChange={(scope) => onForm({ ...form, scope })} suggestions={suggestions} />
            </section>
            {form.schema.length > 0 && (
              <section className="flex flex-col gap-3">
                <h3 className="tw-head text-foreground">{ft.settings}</h3>
                <SettingsFields
                  schema={form.schema}
                  value={form.settings}
                  onChange={(settings) => onForm({ ...form, settings })}
                />
              </section>
            )}
          </fieldset>
        )}
      </div>
    </>
  );
}

function CodePane({
  source,
  onChange,
  onImport,
  error,
  checking,
}: {
  source: string;
  onChange: (s: string) => void;
  onImport: (s: string) => void;
  error: ReturnType<typeof useEditing>["error"];
  checking: boolean;
}) {
  const t = useText(editorText);
  const pt = useText(pluginPartsText);
  const picker = useRef<HTMLInputElement | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [jump, setJump] = useState<{ line: number; column: number | null; at: number } | null>(null);
  const codeError = useMemo(() => codeErrorOf(error), [error]);
  const lines = useMemo(() => source.split("\n").length, [source]);
  // 读一遍通常只要几毫秒：慢了才说「正在检查」，免得每停一下就闪一下
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!checking) {
      setSlow(false);
      return;
    }
    const h = setTimeout(() => setSlow(true), 300);
    return () => clearTimeout(h);
  }, [checking]);

  async function choose(f: File | undefined) {
    setImportError(null);
    if (!f) return;
    if (f.size > MAX_SOURCE) {
      setImportError(t.tooLarge(size(f.size)));
      return;
    }
    try {
      onImport(await f.text());
    } catch {
      setImportError(t.readFailed);
    }
  }

  return (
    <>
      <div className="flex h-7 shrink-0 items-center gap-3">
        <span className="flex min-w-0 flex-1 items-center gap-2 tw-label text-muted-foreground">
          {error ? (
            <span className="flex min-w-0 items-center gap-1.5 text-destructive">
              <StatusDot tone="error" />
              <span className="shrink-0">{t.cannotLoad}</span>
              {error.line != null && (
                <Button
                  variant="link"
                  size="xs"
                  className="h-auto shrink-0 p-0 tw-label text-destructive"
                  onClick={() => setJump({ line: error.line!, column: error.column ?? null, at: Date.now() })}
                >
                  {pt.errorAt(error.line, error.column ?? null)}
                </Button>
              )}
            </span>
          ) : (
            <span className="truncate">
              {pt.lines(lines)} · {size(new Blob([source]).size)}
            </span>
          )}
          {slow && <span className="shrink-0 text-muted-foreground/80">{t.checking}</span>}
        </span>
        <Button size="sm" variant="ghost" className="-mr-2 shrink-0" onClick={() => picker.current?.click()}>
          <FileCodeIcon />
          {t.importFile}
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".js,.mjs,text/javascript,application/javascript"
          className="hidden"
          onChange={(e) => {
            void choose(e.target.files?.[0]);
            // 同一个文件再选一次也要触发
            e.target.value = "";
          }}
        />
      </div>
      {importError && <p className="shrink-0 tw-label text-destructive">{importError}</p>}
      {/* 报错没有行号（清单不对之类）：写在代码上面；有行号的写在那一行下面 */}
      {error && error.line == null && (
        <Banner layout="inline" tone="error" className="shrink-0">
          <span className="break-words select-text">
            <PluginText text={coreText(error.message)} />
          </span>
        </Banner>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-surface/40">
        <Suspense fallback={<CodeLoading label={pt.loadingCode} />}>
          <CodeView code={source} onChange={onChange} error={codeError} focusAt={jump} fill label={pt.codeLabel} />
        </Suspense>
      </div>
    </>
  );
}
