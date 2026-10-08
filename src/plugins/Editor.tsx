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
  AlertDialogConfirm,
} from "@/ui/alert-dialog";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { focusSelf, useDialogFocus } from "@/ui/dialog-focus";
import { call } from "@/control";
import { cn } from "@/lib/utils";
import { textOf, useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { size } from "@/format";
import { DialogError, FormItem } from "@/upstreams/parts";
import type { ManifestView, Overview, PluginInspection, PluginView } from "@/types";
import { pluginName } from "./defaults";
import { editorText } from "./Editor.i18n";
import { OnErrorField, ScopeFields, SettingsFields } from "./fields";
import { pluginFieldsText } from "./fields.i18n";
import { pluginLabelsText } from "./labels.i18n";
import { idProblem, manifestUnknown, MAX_SOURCE, saveAsks, shaPrefix, shapeChanged, suggestId } from "./model";
import { CodeLoading, CodeView, codeErrorOf, PermissionChips, PluginText, RequestKinds } from "./parts";
import { pluginPartsText } from "./parts.i18n";
import { useScopeSuggestions } from "./suggestions";
import { useEditing, valuesOf, type Form } from "./useEditing";
import { installPlugin, savePlugin, type NativeWrite } from "./write";

export type EditorTab = "settings" | "code";

/**
 * 编辑器开着的是哪一个：装着的插件（`from` 是从哪一份代码起头），或者一个还没装上的新插件
 * （`taken` 是已有的插件 ID）
 */
export type Target =
  | { kind: "edit"; plugin: PluginView; from: "approved" | "current" }
  | { kind: "new"; taken: readonly string[] };

/** 编辑器打开时手上的东西 */
export interface Loaded {
  /** core 拿来比的那一份：确认过的代码。读不到（和新插件）是 `null` */
  approved: string | null;
  /** 确认过的那一份读出来的 manifest。读不了（和新插件）是 `null` */
  approvedManifest: ManifestView | null;
  /** 编辑器起头的那一份代码，和读它的结果 */
  start: { source: string; inspection: PluginInspection };
}

/**
 * 取编辑器起头的代码。新插件是一段装得上的模板（按界面语言）。装着的插件一般是确认过的
 * 那一份；从「审核更改」过来改磁盘上那一份的（`current`），是磁盘上现在的那一份。都交给
 * core 读一遍：起头的那一份填表单，确认过的那一份用来判断保存时要不要在系统的确认框里点头。
 */
async function load(target: Target): Promise<Loaded> {
  if (target.kind === "new") {
    const source = textOf(editorText).template;
    const inspection = await call("PluginInspect", { source });
    return { approved: null, approvedManifest: null, start: { source, inspection } };
  }
  const s = await call("PluginSourceDiff", null, target.plugin.id);
  const approved =
    s.approved !== "" ? s.approved : s.current != null && s.current_sha256 === s.approved_sha256 ? s.current : null;
  const source = target.from === "current" && s.current != null ? s.current : (approved ?? s.current);
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
  tab,
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
  return (
    <EditorDialog
      target={{ kind: "edit", plugin, from }}
      tab={tab}
      ov={ov}
      native={native}
      onClose={onClose}
      onDone={onSaved}
      onReview={onReview}
    />
  );
}

/**
 * 添加插件：**和编辑同一个编辑器**，从一段装得上的模板起头，先开着「代码」页。
 *
 * 代码可以就地改、粘贴，也可以从本地的 `.js` 文件导入（只从本地来：不从链接装，没有插件
 * 市场）。「设置」页和标题栏跟着代码走，和编辑时一样；「设置」页多一个插件 ID，按导入的
 * 文件名或代码里的名字给好，可以改。启用默认关着。
 *
 * **按一次「安装」就装上**，没有另外的审核一步：改得了回答里工具调用的插件，紧接着在系统的
 * 确认框里点头（`plugin_install_confirmed`，Rust 再读一遍这份代码，写明插件名、权限和 SHA-256
 * 的前几位，和标题栏上的是同一段）；别的插件直接装上（`CreatePlugin`）。
 */
export function NewPluginEditor({
  taken,
  ov,
  native,
  onClose,
  onInstalled,
}: {
  /** 已有的插件 ID */
  taken: readonly string[];
  ov: Overview;
  native: NativeWrite;
  onClose: () => void;
  /** 装上了：插件的 ID */
  onInstalled: (id: string) => void;
}) {
  return (
    <EditorDialog
      target={{ kind: "new", taken }}
      tab="code"
      ov={ov}
      native={native}
      onClose={onClose}
      onDone={onInstalled}
    />
  );
}

/** 编辑器的对话框：先取代码（取的时候是骨架），取到了交给 `Editing`；带着改动关掉时问一次 */
function EditorDialog({
  target,
  tab: initialTab,
  ov,
  native,
  onClose,
  onDone,
  onReview,
}: {
  target: Target;
  tab: EditorTab;
  ov: Overview;
  native: NativeWrite;
  onClose: () => void;
  /** 保存了、装上了：插件的 ID */
  onDone: (id: string) => void;
  onReview?: () => void;
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
    load(target).then(
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
  const isNew = target.kind === "new";

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
            target={target}
            loaded={loaded}
            initialTab={initialTab}
            ov={ov}
            native={native}
            onState={(s) => {
              state.current = s;
            }}
            onCancel={requestClose}
            onDone={onDone}
            onReview={onReview && (() => leave(onReview))}
          />
        ) : (
          <>
            <Header title={target.kind === "edit" ? <InstalledName plugin={target.plugin} /> : t.newTitle} />
            <div className="min-h-0 flex-1 px-4 py-4">
              {loadError != null ? (
                <ErrorState
                  title={isNew ? t.templateFailed : t.loadFailed}
                  error={loadError}
                  onRetry={() => setAttempt((n) => n + 1)}
                  compact
                />
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
              <Button disabled>{isNew ? t.install : common.save}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>

      <AlertDialog open={asking != null} onOpenChange={(o) => !o && setAsking(null)}>
        <AlertDialogContent onOpenAutoFocus={focusSelf}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.discardTitle}</AlertDialogTitle>
            <AlertDialogDescription>{isNew ? t.discardNewDescription : t.discardDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.keepEditing}</AlertDialogCancel>
            <AlertDialogConfirm
              variant="destructive"
              pending={false}
              onConfirm={() => {
                const then = asking;
                setAsking(null);
                then?.();
              }}
            >
              {t.discard}
            </AlertDialogConfirm>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/** 装着的插件叫什么：默认插件按界面语言说；读不出 manifest 的只有 id */
function InstalledName({ plugin }: { plugin: PluginView }) {
  return manifestUnknown(plugin) ? (
    <span className="font-mono">{plugin.id}</span>
  ) : (
    <PluginText text={pluginName(plugin.id, plugin.name)} />
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

/**
 * 取到代码之后的编辑器。**编辑和添加是同一个**，只差在几处：
 *
 * - 标题：装着的插件写它现在的名字；新插件写代码里的名字（照它自己写的），跟着代码变。
 * - 新插件的「设置」页多一个插件 ID（`idProblem` 查写法、保留词、重名）；启用默认关着。
 * - 按钮：「保存」（`SavePlugin`，有改动才能按）和「安装」（`CreatePlugin`）。
 *
 * 导出给测试用。
 */
export function Editing({
  target,
  loaded,
  initialTab,
  ov,
  native,
  onState,
  onCancel,
  onDone,
  onReview,
}: {
  target: Target;
  loaded: Loaded;
  initialTab: EditorTab;
  ov: Overview;
  native: NativeWrite;
  onState: (s: { dirty: boolean; busy: boolean }) => void;
  onCancel: () => void;
  onDone: (id: string) => void;
  onReview?: () => void;
}) {
  const t = useText(editorText);
  const lt = useText(pluginLabelsText);
  const ft = useText(pluginFieldsText);
  const common = useText(commonText);
  const plugin = target.kind === "edit" ? target.plugin : null;
  const taken = target.kind === "new" ? target.taken : null;
  const ed = useEditing(plugin?.id ?? null, loaded.start);
  const [tab, setTab] = useState<EditorTab>(
    // 代码读不了、也没有可以填的表单：直接看代码
    initialTab === "settings" && !loaded.start.inspection.manifest ? "code" : initialTab,
  );
  const [enabled, setEnabled] = useState(plugin?.enabled ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const suggestions = useScopeSuggestions(ov);
  /** 新插件自己改过的 ID。没改过（`null`）就跟着建议走 */
  const [idDraft, setIdDraft] = useState<string | null>(null);
  /** 新插件最近一次从哪个文件导入的：建议的 ID 先按文件名 */
  const [fileName, setFileName] = useState<string | null>(null);

  const m = ed.manifest;
  const idOf = (name: string) => plugin?.id ?? idDraft ?? suggestId(name, fileName, taken ?? []);
  const id = idOf(m?.name ?? "");
  const badId = taken ? idProblem(id, taken) : null;
  const dirty = ed.source !== loaded.start.source || enabled !== (plugin?.enabled ?? false) || idDraft !== null;
  const problem = ed.form ? valuesOf(ed.form).problem : null;
  const problemText = problem
    ? problem.kind === "scope"
      ? ft.needOne(lt.scopeParts[problem.part])
      : ft.numberBad(problem.label)
    : badId
      ? t.idProblems[badId]
      : null;
  useEffect(() => onState({ dirty, busy: saving }), [dirty, saving, onState]);

  const switchTab = (next: EditorTab) => {
    // 切过去之前把这一页的改动交出去：另一页看到的是一致的样子
    void ed.flush();
    setTab(next);
  };

  async function commit() {
    setSaving(true);
    setError(null);
    setCancelled(false);
    /** 写的是哪一个插件 */
    let wrote = id;
    try {
      await ed.flush();
      // 刚打的字可能刚读完：按「现在」的判断，不按点下按钮那一刻渲染的样子
      const { source, manifest: next, error: broken } = ed.now();
      if (broken || !next) return;
      let r: "done" | "cancelled";
      if (plugin) {
        const old = loaded.approvedManifest;
        const asks = saveAsks({
          old: old?.permissions ?? (plugin.permissions.length > 0 ? plugin.permissions : null),
          next: next.permissions,
          turningOn: enabled && !plugin.enabled,
          // 一定改了代码：manifest 里数据以外的东西变了，或者确认过的那一份读不了而代码不一样。
          // 别的（manifest 以外改了没有）交给 core 判断，它说要点头再请 Rust
          codeChanged: source !== loaded.approved && (old == null || shapeChanged(old, next)),
        });
        r = await native((base) => savePlugin({ id: plugin.id, source, enabled, base_version: base }, asks));
      } else {
        // 代码里的名字可能刚变：跟着建议走的 ID 按现在的名字给
        wrote = idOf(next.name);
        if (idProblem(wrote, taken ?? [])) return;
        // 改得了工具调用的直接请 Rust（一个系统的确认框），别的直接装上
        const newId = wrote;
        r = await native((base) => installPlugin({ source, id: newId, enabled, base_version: base }, next));
      }
      if (r === "cancelled") setCancelled(true);
      else onDone(wrote);
    } catch (e) {
      setError(errorText(e, wrote));
    } finally {
      setSaving(false);
    }
  }

  const sha = useSha256(ed.source);
  const meta = (
    <>
      {id && <span className="font-mono select-text">{t.id(id)}</span>}
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
  // 新插件的名字照代码里写的，跟着代码变（还没读出来时说这是在添加插件）
  const title = plugin ? <InstalledName plugin={plugin} /> : m ? <PluginText text={m.name} /> : t.newTitle;

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
            switchId={`plugin-enabled-${plugin?.id ?? "new"}`}
            idField={taken ? { value: id, problem: badId ? t.idProblems[badId] : null, onChange: setIdDraft } : null}
            form={ed.form}
            onForm={ed.editForm}
            codeError={ed.error != null}
            diskChanged={target.kind === "edit" && target.from === "approved" && target.plugin.status.kind === "changed"}
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
            onImport={(s, name) => {
              ed.editCode(s, true);
              setFileName(name);
            }}
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
          plugin && dirty && <span className="mr-auto tw-label text-muted-foreground">{t.unsaved}</span>
        )}
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          {common.cancel}
        </Button>
        <Button
          onClick={() => void commit()}
          pending={saving}
          disabled={(plugin != null && !dirty) || ed.error != null || !m || problem != null || badId != null}
        >
          {plugin ? common.save : t.install}
        </Button>
      </DialogFooter>
    </Tabs>
  );
}

/** 两页叠在同一块里，没选中的藏起来（不卸载：代码的撤销记录、滚动位置都留着） */
const PANE = "absolute inset-0 data-[state=inactive]:hidden";

function SettingsPane({
  switchId,
  idField,
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
  /** 启用开关的 id（标签用） */
  switchId: string;
  /** 新插件的 ID：输入框里的值、哪里不对、改了 */
  idField: { value: string; problem: string | null; onChange: (id: string) => void } | null;
  form: Form | null;
  onForm: (f: Form) => void;
  codeError: boolean;
  diskChanged: boolean;
  enabled: boolean;
  onEnabled: (on: boolean) => void;
  suggestions: ReturnType<typeof useScopeSuggestions>;
  onViewCode: () => void;
  onReview?: () => void;
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
            onReview && (
              <Button size="sm" variant="outline" onClick={onReview}>
                {t.reviewChanges}
              </Button>
            )
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
        {idField && (
          <FormItem label={t.idLabel} htmlFor="plugin-new-id" desc={idField.problem ?? t.idHint} className="sm:max-w-sm">
            <Input
              id="plugin-new-id"
              className="font-mono"
              value={idField.value}
              aria-invalid={idField.problem != null || undefined}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => idField.onChange(e.target.value.trim())}
            />
          </FormItem>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div>
            <label className="tw-body font-medium" htmlFor={switchId}>
              {t.enabled}
            </label>
            <p className="tw-label text-muted-foreground">{t.enabledHint}</p>
          </div>
          <Switch id={switchId} checked={enabled} onCheckedChange={onEnabled} />
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
  /** 从文件导入的整份代码，和文件名 */
  onImport: (s: string, fileName: string) => void;
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
      onImport(await f.text(), f.name);
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
