import { useState } from "react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { focusSelf } from "@/keys/parts";
import { DialogError } from "@/upstreams/parts";
import type { PluginView } from "@/types";
import { changedDialogText } from "./ChangedDialog.i18n";
import { pluginName } from "./defaults";
import { shaPrefix } from "./model";
import { approvePluginFile } from "./native";
import { CodeBox, PermissionList, PluginText, RequestKinds, SourceDiff } from "./parts";
import { pluginPartsText } from "./parts.i18n";
import type { NativeWrite } from "./SourceDialog";

/**
 * 插件文件在确认之后被改过（状态「文件已更改」）：看清改了什么，再确认。
 *
 * 给人看的三样：**和确认过的那一份逐行对比**（也可以看全文）；**这一版申请的权限**，比原来
 * 多要的标成「新增」；两个 SHA-256。确认由 Rust 去做（`plugin_approve`）：它自己再取一次
 * 文件、再读一遍，在系统原生对话框里写明插件名、权限和新的 SHA-256，点了才算数（I12）。
 *
 * 文件没了、或者改坏了读不了的，确认不了：给「更换代码」。
 */
export function ChangedDialog({
  plugin,
  native,
  onClose,
  onApproved,
  onReplace,
}: {
  plugin: PluginView;
  native: NativeWrite;
  onClose: () => void;
  onApproved: () => void;
  onReplace: () => void;
}) {
  const t = useText(changedDialogText);
  const pt = useText(pluginPartsText);
  const common = useText(commonText);
  const diff = useResource(`plugin-source:${plugin.id}`, () => call("PluginSourceDiff", null, plugin.id));
  const current = diff.data?.current ?? null;
  const read = useResource(current != null ? `plugin-inspect:${plugin.id}:${diff.data?.current_sha256 ?? ""}` : null, () =>
    call("PluginInspect", { source: current! }),
  );
  const [view, setView] = useState<"changes" | "code">("changes");
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const manifest = read.data?.manifest ?? null;
  const loadError = read.data?.error ?? null;
  const ready = current != null && manifest != null && loadError == null;

  async function approve() {
    setWriting(true);
    setError(null);
    setCancelled(false);
    try {
      const r = await native((base) => approvePluginFile({ id: plugin.id, base_version: base }));
      if (r === "done") onApproved();
      else setCancelled(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWriting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !writing && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl" onOpenAutoFocus={focusSelf}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.lead(<PluginText text={pluginName(plugin.id, plugin.name)} />)}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-1">
          {plugin.on_error === "reject" && plugin.enabled && (
            <Banner layout="inline" tone="warning">
              {t.rejecting}
            </Banner>
          )}

          {diff.data === undefined ? (
            diff.error !== undefined && !diff.loading ? (
              <ErrorState title={t.loadFailed} error={diff.error} onRetry={() => void diff.reload()} compact />
            ) : (
              <div className="flex flex-col gap-3" role="status" aria-busy="true">
                <Skeleton className="h-3 w-56 rounded-sm" />
                <Skeleton className="h-24 w-full rounded-lg" />
                <Skeleton className="h-48 w-full rounded-lg" />
              </div>
            )
          ) : current == null ? (
            <Banner layout="inline" tone="error" title={t.missing}>
              {t.missingHint}
            </Banner>
          ) : (
            <>
              <p className="tw-label text-muted-foreground select-text">
                <span className="font-mono">
                  {t.hashes(shaPrefix(diff.data.approved_sha256), shaPrefix(diff.data.current_sha256 ?? ""))}
                </span>
              </p>

              {loadError && (
                <Banner layout="inline" tone="error" title={t.cannotLoad}>
                  <p className="break-words select-text">
                    <PluginText text={coreText(loadError.message)} />
                  </p>
                  {loadError.line != null && <p className="mt-0.5">{t.at(pt.errorAt(loadError.line, loadError.column ?? null))}</p>}
                </Banner>
              )}

              {manifest && (
                <section className="flex flex-col gap-2">
                  <h3 className="tw-head text-foreground">{pt.permissions}</h3>
                  <PermissionList
                    permissions={manifest.permissions}
                    // 原来那一版读不出权限时不比：不知道哪一项是新的
                    previous={plugin.permissions.length > 0 ? plugin.permissions : undefined}
                    replyMode={manifest.reply_mode}
                  />
                  <RequestKinds kinds={manifest.requests} className="tw-label text-muted-foreground" />
                </section>
              )}
              {read.error !== undefined && !read.loading && !read.data && <DialogError error={errorText(read.error)} />}

              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="tw-head text-foreground">{t.code}</h3>
                  <Segmented<"changes" | "code">
                    label={t.code}
                    value={view}
                    options={[
                      { id: "changes", label: t.changes },
                      { id: "code", label: t.fullCode },
                    ]}
                    onChange={setView}
                  />
                </div>
                {view === "changes" ? (
                  <SourceDiff before={diff.data.approved} after={current} />
                ) : (
                  <CodeBox code={current} errorAt={loadError?.line ?? null} />
                )}
              </section>
            </>
          )}
        </div>

        <DialogError error={error} />
        {cancelled && <p className="-mt-2 tw-label text-muted-foreground">{t.cancelled}</p>}

        <DialogFooter className="items-center">
          {(current == null || loadError != null) && diff.data !== undefined && (
            <Button variant="outline" className="sm:mr-auto" disabled={writing} onClick={onReplace}>
              {t.replace}
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={writing}>
            {common.cancel}
          </Button>
          <Button onClick={() => void approve()} pending={writing} disabled={!ready}>
            {t.approve}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
