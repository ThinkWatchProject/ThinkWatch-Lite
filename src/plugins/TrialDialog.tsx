import { useMemo, useState } from "react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Segmented } from "@/ui/segmented";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { focusSelf } from "@/ui/dialog-focus";
import { call } from "@/control";
import { useResource } from "@/lib/resource";
import { useText } from "@/i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import { when } from "@/format";
import { appLabel } from "@/labels";
import { DialogError, FormItem } from "@/upstreams/parts";
import type { HistoryRow, PluginTrialResult, PluginView, TrialSide } from "@/types";
import { pluginName } from "./defaults";
import { LogLines } from "./LogsDialog";
import { requestInScope } from "./model";
import { OutcomeOf, PluginText, SourceDiff } from "./parts";
import { trialDialogText } from "./TrialDialog.i18n";

/** 读最近多少条，列出多少条 */
const READ = 200;
const SHOW = 40;

/**
 * 试运行：拿一条记录下来的请求（密钥已替换的那一份）交给插件，看它改了什么。**不发往上游**，
 * 所以不产生费用；core 照这个插件现在的代码和设置跑一遍（`TrialPlugin`）。
 *
 * 候选是最近的请求里**在这个插件适用范围内的**那些（按客户端、模型、上游的通配挑，挑法和
 * core 的一致与否只影响排序，不影响结果）；一条都不在范围内时列出全部最近的请求，并说一句。
 * 结果按请求、回答两头各给一份改动前后的对比，下面是这次运行写的日志。
 */
export function TrialDialog({ plugin, onClose }: { plugin: PluginView; onClose: () => void }) {
  const t = useText(trialDialogText);
  const history = useResource("plugin-trial-history", () => call("History", { limit: READ }));
  const candidates = useMemo(() => pick(history.data ?? [], plugin), [history.data, plugin]);
  const [chosen, setChosen] = useState<number | null>(null);
  const selected = chosen ?? candidates.rows[0]?.id ?? null;
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: number; r: PluginTrialResult } | null>(null);

  async function run() {
    if (selected == null) return;
    setRunning(true);
    setError(null);
    try {
      const r = await call("TrialPlugin", { request_id: selected }, plugin.id);
      setResult({ id: selected, r });
    } catch (e) {
      setError(errorText(e, plugin.id));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !running && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl" onOpenAutoFocus={focusSelf}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.lead(<PluginText text={pluginName(plugin.id, plugin.name)} />)}</DialogDescription>
        </DialogHeader>

        <div className="-mx-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-1">
          {history.data === undefined ? (
            history.error !== undefined && !history.loading ? (
              <ErrorState title={t.loadFailed} error={history.error} onRetry={() => void history.reload()} compact />
            ) : (
              <Skeleton className="h-8 w-full rounded-lg" />
            )
          ) : candidates.rows.length === 0 ? (
            <p className="tw-body text-muted-foreground">{t.noRequests}</p>
          ) : (
            <FormItem label={t.request} htmlFor="trial-request" desc={candidates.outOfScope ? t.noneInScope : undefined}>
              <div className="flex items-center gap-2">
                <NativeSelect
                  id="trial-request"
                  className="min-w-0 flex-1"
                  value={selected ?? ""}
                  onChange={(e) => setChosen(Number(e.target.value))}
                >
                  {candidates.rows.map((h) => (
                    <NativeSelectOption key={h.id} value={h.id}>
                      {t.option(h.id, when(h.at_ms), h.client_hint ? appLabel(h.client_hint) : h.client, h.model)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Button onClick={() => void run()} pending={running} disabled={selected == null}>
                  {result ? t.runAgain : t.run}
                </Button>
              </div>
            </FormItem>
          )}

          <DialogError error={error} />

          {result && <Result key={result.id} r={result.r} pluginId={plugin.id} />}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={running}>
            {t.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 候选：最近的、跑完了的、不是本地应答的请求，适用范围内的优先 */
function pick(rows: HistoryRow[], plugin: PluginView): { rows: HistoryRow[]; outOfScope: boolean } {
  const done = [...rows].filter((h) => !h.local).sort((a, b) => b.at_ms - a.at_ms);
  const inScope = done.filter((h) => requestInScope(plugin.scope, h));
  if (inScope.length > 0) return { rows: inScope.slice(0, SHOW), outOfScope: false };
  return { rows: done.slice(0, SHOW), outOfScope: done.length > 0 };
}

/** 一次试运行的结果：两头的改动、报错，和日志 */
function Result({ r, pluginId }: { r: PluginTrialResult; pluginId: string }) {
  const t = useText(trialDialogText);
  const sides = (["request", "reply"] as const).filter((s) => r[s] != null);
  // 先看改了的那一头：两头都跑了、只有回答被改写时，落在「请求」上看到的是「未改动」
  const first = sides.find((s) => r[s]?.outcome === "changed") ?? sides.find((s) => r[s]?.outcome !== "unchanged") ?? sides[0];
  const [side, setSide] = useState<"request" | "reply">(first ?? "request");
  const shown = r[side] ?? null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="tw-head text-foreground">{t.result}</h3>
        {sides.length > 1 && (
          <Segmented<"request" | "reply">
            label={t.result}
            value={side}
            options={sides.map((s) => ({ id: s, label: t.sides[s] ?? s }))}
            onChange={setSide}
          />
        )}
      </div>
      {r.error && (
        <Banner layout="inline" tone="error" title={t.failed}>
          <p className="break-words select-text">
            <PluginText text={coreText(r.error, pluginId)} />
          </p>
        </Banner>
      )}
      {shown && <Side s={shown} label={t.sides[side] ?? side} />}
      <div className="flex flex-col gap-2">
        <h3 className="tw-head text-foreground">{t.logs}</h3>
        {r.logs.length > 0 ? <LogLines logs={r.logs} bare /> : <p className="tw-body text-muted-foreground">{t.noLogs}</p>}
      </div>
    </section>
  );
}

function Side({ s, label }: { s: TrialSide; label: string }) {
  const t = useText(trialDialogText);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 tw-body">
        <span className="font-medium">{label}</span>
        <OutcomeOf outcome={s.outcome} />
      </div>
      {s.outcome === "changed" ? (
        <SourceDiff before={s.before} after={s.after} />
      ) : (
        <p className="tw-body text-muted-foreground">
          {s.outcome === "rejected" ? t.rejected : s.outcome === "skipped" ? t.skipped : s.outcome === "error" ? "" : t.unchanged}
        </p>
      )}
    </div>
  );
}
