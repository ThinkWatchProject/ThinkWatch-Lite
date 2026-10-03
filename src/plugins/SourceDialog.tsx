import { useRef, useState, type ReactNode } from "react";
import { FileCodeIcon } from "lucide-react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Input } from "@/ui/input";
import { Segmented } from "@/ui/segmented";
import { Textarea } from "@/ui/textarea";
import { call } from "@/control";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { size } from "@/format";
import { focusSelf } from "@/keys/parts";
import { DialogError, FormItem } from "@/upstreams/parts";
import type { ManifestView, PluginInspection } from "@/types";
import { pluginLabelsText } from "./labels.i18n";
import { ID_RE, MAX_SOURCE, shaPrefix, suggestId } from "./model";
import { CodeBox, codeErrorOf, PermissionList, PluginText, RequestKinds, ScopeSummary } from "./parts";
import { pluginPartsText } from "./parts.i18n";
import { sourceDialogText } from "./SourceDialog.i18n";
import { installPlugin, type NativeWrite } from "./write";

/**
 * 添加插件：两步。
 *
 * 1. **代码从哪儿来**：选一个本地的 `.js` 文件，或者粘贴。只从本地来 —— 不从链接装，
 *    没有插件市场。选好之后交给 core 读一遍（`PluginInspect`，不写任何东西）。
 * 2. **审核**：完整的代码、申请的每一项权限和它的后果、代码里写的适用范围和出错时怎么办、
 *    ID；读不了的写明第几行第几列。**按一次「安装」就装上**：改得了回答里工具调用的插件，
 *    紧接着在系统的确认框里点头（Rust 再读一遍这份代码，写明插件名、权限和 SHA-256 的前几位，
 *    和这里显示的是同一段），没有第二遍审核。
 *
 * 出错时怎么办、适用范围、设置都写在代码里：装上之后在插件的编辑器里改。
 */
export function SourceDialog({
  taken,
  native,
  onClose,
  onDone,
}: {
  /** 已有的插件 ID */
  taken: readonly string[];
  native: NativeWrite;
  onClose: () => void;
  /** 装上了：插件的 ID */
  onDone: (id: string) => void;
}) {
  const t = useText(sourceDialogText);
  const common = useText(commonText);
  const [step, setStep] = useState<"source" | "review">("source");
  const [how, setHow] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<{ name: string; size: number; text: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  /** core 读过的那一份：结果，和读的是哪段代码 */
  const [read, setRead] = useState<{ result: PluginInspection; source: string } | null>(null);
  const [writing, setWriting] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);
  const [id, setId] = useState("");

  const source = how === "file" ? (file?.text ?? "") : paste;

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
      setRead({ result, source });
      const m = result.manifest;
      if (m) setId((cur) => cur || suggestId(m.name, how === "file" ? (file?.name ?? null) : null, taken));
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
  const idProblem = !ID_RE.test(id) ? t.idBad : taken.includes(id) ? t.idTaken : null;
  const blocked = !manifest || loadError != null || idProblem != null;

  async function install() {
    if (!read || !manifest || blocked) return;
    setWriting(true);
    setError(null);
    setCancelled(false);
    try {
      const r = await native((base) => installPlugin({ source: read.source, id, enabled: true, base_version: base }, manifest));
      if (r === "done") onDone(id);
      else setCancelled(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWriting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !writing && onClose()}>
      <DialogContent
        className={cn("flex max-h-[85vh] flex-col gap-4", step === "source" ? "sm:max-w-xl" : "sm:max-w-3xl")}
        onOpenAutoFocus={focusSelf}
      >
        <DialogHeader>
          <DialogTitle className="pr-6">{step === "source" ? t.addTitle : t.reviewTitle}</DialogTitle>
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
              <Review result={read.result} source={read.source}>
                {manifest && (
                  <FormItem label={t.id} htmlFor="plugin-id" desc={idProblem ?? t.idHint} className="sm:max-w-sm">
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
                )}
              </Review>
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
            <Button onClick={() => void install()} pending={writing} disabled={blocked}>
              {t.install}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 审核那一步：读不了的原因、插件是谁、要哪些权限、代码里写的范围和出错时怎么办、代码，和 ID */
function Review({ result, source, children }: { result: PluginInspection; source: string; children: ReactNode }) {
  const t = useText(sourceDialogText);
  const pt = useText(pluginPartsText);
  const m = result.manifest ?? null;
  const err = result.error ?? null;
  const lines = source.split("\n").length;
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

      {m && (
        <section className="flex flex-col gap-1">
          <h3 className="tw-head text-foreground">
            <PluginText text={m.name} />
          </h3>
          {m.description && (
            <p className="tw-body text-muted-foreground">
              <PluginText text={m.description} />
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
            <PermissionList permissions={m.permissions} replyMode={m.reply_mode} />
          ) : (
            <p className="tw-body text-muted-foreground">{t.noPermissions}</p>
          )}
          <RequestKinds kinds={m.requests} className="tw-label text-muted-foreground" />
        </section>
      )}

      {m && <Facts m={m} />}

      <section className="flex flex-col gap-2">
        <h3 className="tw-head text-foreground">{t.code}</h3>
        <CodeBox code={source} error={codeErrorOf(err)} />
      </section>

      {children}
    </div>
  );
}

/** 代码里写的适用范围和出错时怎么办：装上就按它们运行 */
function Facts({ m }: { m: ManifestView }) {
  const lt = useText(pluginLabelsText);
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 tw-body">
      <dt className="text-muted-foreground">{lt.scope}</dt>
      <dd className="min-w-0">
        <ScopeSummary scope={m.scope} />
      </dd>
      <dt className="text-muted-foreground">{lt.onError}</dt>
      <dd>{lt.onErrorOptions[m.on_error]}</dd>
    </dl>
  );
}
