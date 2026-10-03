import { useRef, useState, type ReactNode } from "react";
import { FileCodeIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Segmented } from "@/ui/segmented";
import { Textarea } from "@/ui/textarea";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { size } from "@/format";
import { focusSelf } from "@/keys/parts";
import { DialogError, FormItem } from "@/upstreams/parts";
import type { OnError, PluginInspection, PluginView, PluginWrite } from "@/types";
import { localSchema, pluginDescription, pluginName } from "./defaults";
import { draftOf, scopeOf, scopeProblem, ScopeFields, settingsDraftOf, settingsOf, SettingsFields, type ScopeDraft, type SettingsDraft } from "./fields";
import { pluginFieldsText } from "./fields.i18n";
import { pluginLabelsText } from "./labels.i18n";
import { ID_RE, shaPrefix, suggestId } from "./model";
import { installPlugin, replacePluginSource } from "./native";
import { CodeBox, PermissionList, PluginText, RequestKinds, SourceDiff } from "./parts";
import { pluginPartsText } from "./parts.i18n";
import { sourceDialogText } from "./SourceDialog.i18n";

/** 插件文件的上限，和 core 一样 */
export const MAX_SOURCE = 1024 * 1024;

/**
 * 一次要原生确认的写入，排进这一页的写入队列（见 `PluginsPage`）。`done` 是写成了，
 * `cancelled` 是用户在系统对话框里点了取消 —— 什么都没写，不是失败。
 */
export type NativeWrite = (run: (base: string) => Promise<PluginWrite>) => Promise<"done" | "cancelled">;

type Mode = { kind: "add" } | { kind: "replace"; plugin: PluginView };

/**
 * 添加插件、更换插件的代码：两步。
 *
 * 1. **代码从哪儿来**：选一个本地的 `.js` 文件，或者粘贴。只从本地来 —— 不从链接装，
 *    没有插件市场。选好之后交给 core 读一遍（`PluginInspect`，不写任何东西）。
 * 2. **审核**：完整的代码、申请的每一项权限和它的后果、适用范围、设置项、ID、出错时的
 *    处置；读不了的说清第几行第几列。按「安装」之后，**由 Rust 再读一遍这份代码**，在
 *    系统原生对话框里写明插件名、权限和 SHA-256 的前几位，点了那里的「安装」才写配置
 *    （I12：网页自己完成不了这一步）。这里显示的 SHA-256 和系统对话框里的是同一段，
 *    对得上就是同一份代码。
 *
 * 更换代码时没有安装选项（ID、范围、设置项都留着），权限和原来的对比：新增的标出来；
 * 代码可以和现在确认过的那一份对比。
 */
export function SourceDialog({
  mode,
  taken,
  native,
  onClose,
  onDone,
}: {
  mode: Mode;
  /** 已有的插件 ID */
  taken: readonly string[];
  native: NativeWrite;
  onClose: () => void;
  /** 写成了：插件的 ID */
  onDone: (id: string) => void;
}) {
  const t = useText(sourceDialogText);
  const ft = useText(pluginFieldsText);
  const common = useText(commonText);
  const [step, setStep] = useState<"source" | "review">("source");
  const [how, setHow] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  /** core 读过的那一份：结果，和读的是哪段代码 */
  const [read, setRead] = useState<{ result: PluginInspection; source: string; fileName: string | null } | null>(null);
  const [writing, setWriting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);

  // 安装选项（只有添加时有）
  const [id, setId] = useState("");
  const [onError, setOnError] = useState<OnError>("reject");
  const [scope, setScope] = useState<ScopeDraft>(() => draftOf({ clients: [], models: [], upstreams: [] }));
  const [settings, setSettings] = useState<SettingsDraft>({});

  const source = how === "file" ? (file?.text ?? "") : paste;
  const replacing = mode.kind === "replace" ? mode.plugin : null;

  async function choose(f: File | undefined) {
    setInputError(null);
    setError(null);
    if (!f) return;
    if (f.size > MAX_SOURCE) {
      setFile(null);
      setInputError(t.tooLarge(size(f.size)));
      return;
    }
    try {
      setFile({ name: f.name, size: f.size, text: await f.text() });
    } catch {
      setFile(null);
      setInputError(t.readFailed);
    }
  }

  async function inspect() {
    if (new Blob([source]).size > MAX_SOURCE) {
      setInputError(t.tooLarge(size(new Blob([source]).size)));
      return;
    }
    setInspecting(true);
    setError(null);
    try {
      const result = await call("PluginInspect", { source });
      const fileName = how === "file" ? (file?.name ?? null) : null;
      setRead({ result, source, fileName });
      const m = result.manifest;
      if (m && !replacing) {
        setId((cur) => cur || suggestId(m.name, fileName, taken));
        setScope(draftOf(m.scope));
        setSettings(settingsDraftOf(m.settings_schema, {}));
      }
      setCancelled(false);
      setStep("review");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setInspecting(false);
    }
  }

  const manifest = read?.result.manifest ?? null;
  const loadError = read?.result.error ?? null;
  const idProblem = replacing ? null : !ID_RE.test(id) ? t.idBad : taken.includes(id) ? t.idTaken : null;
  // 装的是 core 自带的那个默认插件（id 和名字都对得上）时，标签按界面语言说
  const schema = manifest ? localSchema(replacing?.id ?? id, manifest.name, manifest.settings_schema) : [];
  const settingsCheck = manifest ? settingsOf(schema, settings) : { values: {}, bad: [] };
  const blocked =
    !manifest || loadError != null || idProblem != null || (!replacing && scopeProblem(scope) != null) || settingsCheck.bad.length > 0;

  async function write() {
    if (!read || blocked) return;
    setWriting(true);
    setError(null);
    setCancelled(false);
    try {
      const r = replacing
        ? await native((base) => replacePluginSource({ id: replacing.id, source: read.source, base_version: base }))
        : await native((base) =>
            installPlugin({
              source: read.source,
              id,
              enabled: true,
              on_error: onError,
              scope: scopeOf(scope),
              settings: settingsCheck.values,
              base_version: base,
            }),
          );
      if (r === "done") onDone(replacing ? replacing.id : id);
      else setCancelled(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWriting(false);
    }
  }

  // 名字是插件写的：按纯文本画（`PluginText`），不拼进字符串
  const title = replacing
    ? t.replaceTitle(<PluginText text={pluginName(replacing.id, replacing.name)} />)
    : step === "source"
      ? t.addTitle
      : t.reviewTitle;

  return (
    <Dialog open onOpenChange={(o) => !o && !writing && onClose()}>
      <DialogContent
        className={cn(
          "flex max-h-[85vh] flex-col gap-4",
          step === "source" ? "sm:max-w-xl" : "sm:max-w-3xl",
        )}
        onOpenAutoFocus={focusSelf}
      >
        <DialogHeader>
          <DialogTitle className="pr-6">
{title}
          </DialogTitle>
          {step === "source" ? (
            <DialogDescription>{t.sourceDescription}</DialogDescription>
          ) : (
            <DialogDescription className="sr-only">{t.reviewTitle}</DialogDescription>
          )}
        </DialogHeader>

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          {step === "source" ? (
            <div className="flex flex-col gap-3">
              <Segmented<"file" | "paste">
                value={how}
                options={[
                  { id: "file", label: t.fromFile },
                  { id: "paste", label: t.fromPaste },
                ]}
                onChange={(v) => {
                  setHow(v);
                  setInputError(null);
                }}
              />
              {how === "file" ? (
                <div className="flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-4 py-5 text-center">
                  {file ? (
                    <>
                      <span className="flex max-w-full items-center gap-2 tw-body">
                        <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
                        <span className="truncate font-mono">{file.name}</span>
                        <span className="shrink-0 tw-label text-muted-foreground">{size(file.size)}</span>
                      </span>
                      <Button size="sm" variant="outline" onClick={() => picker.current?.click()}>
                        {t.chooseAgain}
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => picker.current?.click()}>
                        <FileCodeIcon />
                        {t.chooseFile}
                      </Button>
                      <span className="tw-label text-muted-foreground">{t.fileHint}</span>
                    </>
                  )}
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
              ) : (
                <Textarea
                  aria-label={t.fromPaste}
                  value={paste}
                  onChange={(e) => {
                    setPaste(e.target.value);
                    setInputError(null);
                  }}
                  placeholder={t.pastePlaceholder}
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  className="field-sizing-fixed h-60 resize-none font-mono tw-label leading-relaxed"
                />
              )}
              {inputError && <p className="tw-label text-destructive">{inputError}</p>}
            </div>
          ) : (
            read && (
              <Review
                result={read.result}
                source={read.source}
                replacing={replacing}
                options={
                  replacing || !manifest ? null : (
                    <>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <FormItem label={t.id} htmlFor="plugin-id" desc={idProblem ?? t.idHint}>
                          <Input
                            id="plugin-id"
                            className="font-mono"
                            value={id}
                            aria-invalid={idProblem != null || undefined}
                            autoComplete="off"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            onChange={(e) => setId(e.target.value.trim())}
                          />
                        </FormItem>
                        <OnErrorField value={onError} onChange={setOnError} />
                      </div>
                      <ScopeFields value={scope} onChange={setScope} />
                      {schema.length > 0 && (
                        <div className="flex flex-col gap-3">
                          <h4 className="tw-body font-medium text-foreground">{ft.settings}</h4>
                          <SettingsFields schema={schema} value={settings} onChange={setSettings} />
                        </div>
                      )}
                    </>
                  )
                }
              />
            )
          )}
        </div>

        <DialogError error={error} />
        {cancelled && <p className="-mt-2 tw-label text-muted-foreground">{t.cancelled}</p>}

        <DialogFooter className="items-center">
          {step === "review" && (
            <Button variant="ghost" className="mr-auto" disabled={writing} onClick={() => setStep("source")}>
              {t.back}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={writing}>
            {common.cancel}
          </Button>
          {step === "source" ? (
            <Button onClick={() => void inspect()} pending={inspecting} disabled={source.trim() === ""}>
              {t.next}
            </Button>
          ) : (
            <Button onClick={() => void write()} pending={writing} disabled={blocked}>
              {replacing ? t.replace : t.install}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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

/** 审核那一步：读不了的原因、插件是谁、要哪些权限、代码，和安装选项 */
function Review({
  result,
  source,
  replacing,
  options,
}: {
  result: PluginInspection;
  source: string;
  replacing: PluginView | null;
  options: ReactNode;
}) {
  const t = useText(sourceDialogText);
  const pt = useText(pluginPartsText);
  const m = result.manifest ?? null;
  const err = result.error ?? null;
  const lines = source.split("\n").length;
  const [view, setView] = useState<"code" | "compare">("code");
  const current = useResource(replacing ? `plugin-source:${replacing.id}` : null, () =>
    call("PluginSourceDiff", null, replacing!.id),
  );
  // 换上来的是 core 自带的那个默认插件（id 和名字都对得上）：按界面语言说
  const words = m && {
    name: pluginName(replacing?.id, m.name),
    description: replacing ? pluginDescription({ id: replacing.id, name: m.name, description: m.description }) : m.description,
  };
  return (
    <div className="flex flex-col gap-5 pb-1">
      {err && (
        <Banner layout="inline" tone="error" title={t.cannotLoad}>
          <p className="break-words select-text">
            <PluginText text={coreText(err.message)} />
          </p>
          {err.line != null && <p className="mt-0.5">{t.at(pt.errorAt(err.line, err.column ?? null))}</p>}
        </Banner>
      )}

      {m && words && (
        <section className="flex flex-col gap-1">
          <h3 className="tw-head text-foreground">
            <PluginText text={words.name} />
          </h3>
          {words.description && (
            <p className="tw-body text-muted-foreground">
              <PluginText text={words.description} />
            </p>
          )}
          <p className="flex flex-wrap items-center gap-x-3 tw-label text-muted-foreground">
            <span className="select-text">
              {t.sha} <span className="font-mono text-foreground">{shaPrefix(result.sha256)}</span>
            </span>
            <span>{pt.lines(lines)}</span>
            <span>{size(new Blob([source]).size)}</span>
          </p>
        </section>
      )}

      {m && (
        <section className="flex flex-col gap-2">
          <h3 className="tw-head text-foreground">{pt.permissions}</h3>
          {m.permissions.length > 0 ? (
            <PermissionList
              permissions={m.permissions}
              // 装着的那一版读不出权限时不比：不知道哪一项是新的
              previous={replacing && replacing.permissions.length > 0 ? replacing.permissions : undefined}
              replyMode={m.reply_mode}
            />
          ) : (
            <p className="tw-body text-muted-foreground">{t.noPermissions}</p>
          )}
          <RequestKinds kinds={m.requests} className="tw-label text-muted-foreground" />
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="tw-head text-foreground">{t.code}</h3>
          {replacing && current.data && (
            <Segmented<"code" | "compare">
              label={t.code}
              value={view}
              options={[
                { id: "code", label: t.fullCode },
                { id: "compare", label: t.compare },
              ]}
              onChange={setView}
            />
          )}
        </div>
        {view === "compare" && current.data ? (
          <SourceDiff before={current.data.approved} after={source} />
        ) : (
          <CodeBox code={source} errorAt={err?.line ?? null} />
        )}
      </section>

      {options && (
        <section className="flex flex-col gap-4">
          <h3 className="tw-head text-foreground">{t.options}</h3>
          {options}
        </section>
      )}
    </div>
  );
}
