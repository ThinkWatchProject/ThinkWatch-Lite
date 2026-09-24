import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CircleHelpIcon, FolderOpenIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { IconCopied, IconCopy } from "@/ui/icons";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/lib/utils";
import { when } from "@/format";
import { takesEffectText } from "@/labels";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import type { ClientView, CostGroup, DetectedClient, FindingView } from "@/types";
import { TakeoverBadge } from "@/keys/KeysTable";
import { api } from "./api";
import { clientsText } from "./clients.i18n";
import { useRemote } from "@/connection/useRemote";
import { pointsHere, statusOf } from "./status";
import { reasonText, StatusLabel } from "./StatusLabel";

/**
 * 一个客户端的详情：配置文件、地址、密钥、用量、接管的影响，以及配置链检查。
 *
 * **配置链检查打开就跑**，结果直接列在这里 —— 以前它是另一个对话框，而用户
 * 点开详情多半就是想知道「为什么没生效」。
 */
export function DetailDialog({
  client,
  keys,
  usage,
  gatewayBase,
  onClose,
  onAdopt,
  onRestore,
  onOpenKey,
  onTraffic,
}: {
  client: DetectedClient;
  keys: ClientView[];
  usage: CostGroup[];
  gatewayBase: string;
  onClose: () => void;
  onAdopt: () => void;
  onRestore: () => void;
  onOpenKey: (key: string) => void;
  onTraffic: (key: string) => void;
}) {
  const t = useText(clientsText);
  const remote = useRemote();
  const common = useText(commonText);
  const status = statusOf(client, gatewayBase, Date.now(), remote !== null);
  const adopted = client.adopted_at_ms != null;
  const key = client.key ? keys.find((k) => k.name === client.key) : undefined;
  const requests = client.key ? (usage.find((u) => u.name === client.key)?.requests ?? 0) : 0;
  const why = reasonText(status.reason, t);

  const [found, setFound] = useState<FindingView[] | null>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(() => {
    setChecking(true);
    api
      .diagnose(client.id)
      .then(setFound)
      .catch((e) => toast.error(errorText(e)))
      .finally(() => setChecking(false));
  }, [client.id]);
  useEffect(() => {
    check();
  }, [check]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        // 点一行就打开：焦点落在对话框本身，不落到第一个按钮上 —— WebKit 里
        // 脚本给的焦点会在按钮上画一圈框，而用户根本没按过 Tab。和请求详情
        // 抽屉同一个做法：焦点仍在对话框里，读屏和 Esc 照常
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {client.name}
            <span className="rounded-full bg-muted px-2 py-0.5 tw-label font-medium">
              <StatusLabel status={status} />
            </span>
          </DialogTitle>
          {why && <p className="tw-body text-muted-foreground">{why}</p>}
        </DialogHeader>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3 tw-body">
          <dt className="text-muted-foreground">{t.file}</dt>
          <dd className="flex min-w-0 flex-col gap-0.5">
            <span className="flex flex-wrap items-center gap-2">
              <code className="font-mono break-all">{client.path}</code>
              {client.has_config && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void api.reveal(client.id).catch((e) => toast.error(errorText(e)))}
                >
                  <FolderOpenIcon />
                  {t.revealShort}
                </Button>
              )}
            </span>
            {/* 用户以为在改 ~/.claude/settings.json，实际写的可能是他 dotfiles 仓库里的那份 */}
            {client.real !== client.path && (
              <span className="font-mono tw-label text-muted-foreground break-all">{t.realFile(client.real)}</span>
            )}
          </dd>

          <dt className="text-muted-foreground">{t.endpoint}</dt>
          <dd className="flex min-w-0 flex-wrap items-center gap-2">
            {client.endpoint ? (
              <>
                <code className="font-mono break-all">{client.endpoint}</code>
                {pointsHere(client.endpoint, gatewayBase) ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckIcon className="size-3.5" />
                    {t.pointsHere}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t.notHere}</span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{t.noEndpoint}</span>
            )}
          </dd>

          <dt className="text-muted-foreground">{t.key}</dt>
          <dd className="flex min-w-0 flex-col gap-0.5">
            {client.key ? (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                    onClick={() => onOpenKey(client.key!)}
                  >
                    {client.key}
                  </button>
                  <TakeoverBadge owner={{ client: client.name, kind: adopted ? "adopted" : "idle" }} />
                </span>
                {key && <KeyValue name={key.name} value={key.key} />}
              </>
            ) : (
              <span className="text-muted-foreground">{t.keyOnAdopt}</span>
            )}
          </dd>

          <dt className="text-muted-foreground">{t.effect}</dt>
          <dd>{takesEffectText(client.takes_effect)}</dd>

          {client.key && (
            <>
              <dt className="text-muted-foreground">{t.usage}</dt>
              <dd className="flex flex-wrap items-center gap-2">
                {client.last_seen_ms ? t.usageLine(requests, when(client.last_seen_ms)) : t.noUsage}
                <button
                  type="button"
                  className="underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground"
                  onClick={() => onTraffic(client.key!)}
                >
                  {t.traffic}
                </button>
              </dd>
            </>
          )}

          {client.costs.length > 0 && (
            <>
              <dt className="text-muted-foreground">{t.costs}</dt>
              <dd>
                <ul className="flex list-disc flex-col gap-1 pl-4">
                  {client.costs.map((c, i) => (
                    <li key={i}>{coreText(c)}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <div className="flex items-center gap-2">
            <span className="tw-body font-medium">{t.check}</span>
            <div className="flex-1" />
            <Button variant="ghost" size="xs" disabled={checking} onClick={check}>
              {checking ? <Spinner /> : <RefreshCwIcon />}
              {t.recheck}
            </Button>
          </div>
          {found == null ? (
            <p className="tw-body text-muted-foreground">{t.checking}</p>
          ) : (
            <ul className="flex flex-col gap-2 tw-body">
              {found.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <FindingMark level={f.level} />
                  <div className="min-w-0">
                    <div>{coreText(f.title)}</div>
                    <div className="tw-label text-muted-foreground">{coreText(f.detail)}</div>
                    {/* 命令给出来，执行与否是用户的事 */}
                    {f.fix && (
                      <code className="mt-1 block rounded bg-muted px-1.5 py-0.5 font-mono tw-label break-all">
                        {coreText(f.fix)}
                      </code>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {adopted ? (
            <Button variant="destructive" onClick={onRestore}>
              {t.restore}
            </Button>
          ) : (
            <Button onClick={onAdopt}>{t.adopt}</Button>
          )}
          <Button variant="outline" onClick={onClose}>
            {common.close}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FindingMark({ level }: { level: FindingView["level"] }) {
  const cls = "mt-0.5 size-4 shrink-0";
  if (level === "blocking") return <XIcon className={cn(cls, "text-destructive")} />;
  if (level === "suspect") return <CircleHelpIcon className={cn(cls, "text-warning")} />;
  return <CheckIcon className={cn(cls, "text-success")} />;
}

/** 密钥的完整值和复制按钮，和密钥页上的一样 */
function KeyValue({ name, value }: { name: string; value: string }) {
  const common = useText(commonText);
  const [copied, setCopied] = useState(false);
  return (
    <span className="flex min-w-0 items-center gap-1">
      <code className="min-w-0 truncate font-mono tw-label text-muted-foreground select-text">{value}</code>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={common.copy}
        className="shrink-0 text-muted-foreground"
        onClick={() =>
          void api
            .copyKey(name)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            })
            .catch((e) => toast.error(errorText(e)))
        }
      >
        {copied ? <IconCopied /> : <IconCopy />}
      </Button>
    </span>
  );
}
