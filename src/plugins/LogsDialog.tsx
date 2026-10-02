import { RefreshCwIcon, ScrollTextIcon } from "lucide-react";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { EmptyState, ListSkeleton, Loadable } from "@/ui/states";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { clock } from "@/security/labels";
import { focusSelf } from "@/keys/parts";
import { PLUGIN_FAILED, pluginCall, type PluginLogEntry, type PluginView } from "./api.provisional";
import { logsDialogText } from "./LogsDialog.i18n";
import { PluginText } from "./parts";

/**
 * 一个插件的日志：它在每次运行里用 `console.log/info/warn/error` 写下的东西（core 在内存里
 * 留着最近的一段，`PluginLogs`），新的在前。**写的是什么都只按纯文本画**。哪一条请求写下的，
 * 点过去是那条请求的详情。
 */
export function LogsDialog({
  plugin,
  onClose,
  onOpenRequest,
}: {
  plugin: PluginView;
  onClose: () => void;
  onOpenRequest: (id: number) => void;
}) {
  const t = useText(logsDialogText);
  const logs = useResource(`plugin-logs:${plugin.id}`, () => pluginCall("PluginLogs", null, plugin.id), {
    events: [PLUGIN_FAILED],
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-4 sm:max-w-3xl" onOpenAutoFocus={focusSelf}>
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.lead(<PluginText text={plugin.name} />)}</DialogDescription>
        </DialogHeader>
        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
          <Loadable
            r={logs}
            loading={<ListSkeleton rows={4} />}
            errorTitle={t.loadFailed}
            isEmpty={(d) => d.length === 0}
            empty={<EmptyState variant="outlined" icon={<ScrollTextIcon />} title={t.empty} description={t.emptyHint} />}
          >
            {(data) => <LogLines logs={[...data].sort((a, b) => b.at_ms - a.at_ms)} onOpenRequest={onOpenRequest} />}
          </Loadable>
        </div>
        <DialogFooter>
          <Button variant="outline" className="sm:mr-auto" pending={logs.refreshing} onClick={() => void logs.reload()}>
            <RefreshCwIcon />
            {t.refresh}
          </Button>
          <Button variant="outline" onClick={onClose}>
            {t.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LEVEL_VARIANT: Record<string, "secondary" | "warning" | "destructive"> = {
  log: "secondary",
  info: "secondary",
  warn: "warning",
  error: "destructive",
};

/**
 * 几行日志：时刻、级别、请求或回答、哪条请求，下面是写下的话（等宽，保留换行）。
 * 试运行的结果里也用它（那里没有时刻和请求号）。
 */
export function LogLines({
  logs,
  onOpenRequest,
  bare,
}: {
  logs: PluginLogEntry[];
  onOpenRequest?: (id: number) => void;
  /** 试运行里：不写时刻和请求 */
  bare?: boolean;
}) {
  const t = useText(logsDialogText);
  return (
    <ul className="flex flex-col overflow-hidden rounded-lg border border-border">
      {logs.map((l, i) => {
        const id = l.request_id != null && /^\d+$/.test(String(l.request_id)) ? String(l.request_id) : null;
        return (
          <li key={i} className="flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 tw-label text-muted-foreground">
              {!bare && <span className="tw-num">{clock(l.at_ms)}</span>}
              <Badge variant={LEVEL_VARIANT[l.level] ?? "secondary"} className="h-[18px] rounded-[5px] px-1.5 font-normal">
                {t.levels[l.level] ?? l.level}
              </Badge>
              <span>{t.hooks[l.hook] ?? l.hook}</span>
              {!bare && id && onOpenRequest && (
                <Button
                  variant="link"
                  className="h-auto p-0 tw-label font-normal text-muted-foreground underline-offset-2 hover:text-foreground"
                  aria-label={t.openRequest(id)}
                  onClick={() => onOpenRequest(Number(id))}
                >
                  {t.request(id)}
                </Button>
              )}
            </div>
            <pre
              className={cn(
                "font-mono tw-label leading-relaxed break-all whitespace-pre-wrap",
                l.level === "error" ? "text-destructive" : "text-foreground",
              )}
            >
              <PluginText text={l.text} />
            </pre>
          </li>
        );
      })}
    </ul>
  );
}
