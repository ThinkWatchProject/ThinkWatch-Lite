import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CheckIcon, CircleAlertIcon, CircleCheckIcon, CircleHelpIcon, FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/ui/dialog";
import { notify } from "@/ui/notify";
import { Skeleton } from "@/ui/skeleton";
import { ErrorState } from "@/ui/states";
import { cn } from "@/lib/utils";
import { when } from "@/format";
import { takesEffectText } from "@/labels";
import { useNav } from "@/nav";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import type { ClientView, DetectedClient, FindingView } from "@/types";
import type { KeyUse } from "@/keys/data";
import { TakeoverBadge } from "@/keys/KeysTable";
import { ClientMark, CopyIconButton, Tile, focusSelf, useDialogFocus } from "@/keys/parts";
import { useRemote } from "@/connection/useRemote";
import { api } from "./api";
import { clientsText } from "./clients.i18n";
import { pointsHere, statusOf } from "./status";
import { ClientStatus, reasonText } from "./ClientStatus";

/**
 * 一个客户端的详情：配置文件、地址、密钥、用量、接管的影响，以及配置链检查。
 *
 * **配置链检查打开就跑**，结果直接列在这里 —— 用户点开详情多半就是想知道「为什么
 * 没生效」。检查失败时就地说、给重试，不会一直停在「检查中」。
 */
export function DetailDialog({
  client,
  keys,
  usage,
  usageLoaded,
  gatewayBase,
  env,
  stale,
  asking,
  onClose,
  onAdopt,
  onRestore,
}: {
  client: DetectedClient;
  keys: ClientView[];
  /** 它那把密钥 24 小时的用量 */
  usage: KeyUse | undefined;
  usageLoaded: boolean;
  gatewayBase: string;
  /** 在哪个 WSL 发行版里；这台电脑上的不给 */
  env?: string;
  /** WSL 里的、还指着旧地址的 */
  stale?: boolean;
  /** 正在取接管 / 还原的方案 */
  asking: boolean;
  onClose: () => void;
  onAdopt: () => void;
  onRestore: () => void;
}) {
  const t = useText(clientsText);
  const dialogFocus = useDialogFocus();
  const common = useText(commonText);
  const nav = useNav();
  const remote = useRemote();
  const status = statusOf(client, gatewayBase, Date.now(), remote !== null, stale);
  const adopted = client.adopted_at_ms != null;
  const key = client.key ? keys.find((k) => k.name === client.key) : undefined;
  const why = reasonText(status.reason, t);

  const [found, setFound] = useState<FindingView[] | null>(null);
  const [checkError, setCheckError] = useState<unknown>(null);
  const [checking, setChecking] = useState(false);
  const check = useCallback(() => {
    setChecking(true);
    setCheckError(null);
    api
      .diagnose(client.id, env)
      .then(setFound)
      .catch((e: unknown) => setCheckError(e))
      .finally(() => setChecking(false));
  }, [client.id, env]);
  useEffect(() => {
    check();
  }, [check]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        {...dialogFocus}
        // 点一行就打开：焦点落在对话框本身，不落到第一个按钮上 —— WebKit 里
        // 脚本给的焦点会在按钮上画一圈框，而用户根本没按过 Tab。和请求详情
        // 抽屉同一个做法：焦点仍在对话框里，读屏和 Esc 照常
        onOpenAutoFocus={focusSelf}
      >
        <DialogHeader className="flex-row items-center gap-3">
          <Tile className="size-9 rounded-lg [&_svg]:size-[18px]">
            <ClientMark id={client.id} name={client.name} size={18} />
          </Tile>
          <div className="min-w-0">
            <DialogTitle>{client.name}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex min-w-0 flex-wrap items-center gap-x-2">
                <ClientStatus status={status} />
                {why && <span className="tw-label text-muted-foreground">{why}</span>}
              </div>
            </DialogDescription>
          </div>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3 rounded-lg border border-border bg-surface/60 px-3.5 py-3 tw-body">
          <Fact label={t.file}>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <code className="font-mono break-all">{client.path}</code>
              {client.has_config && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="-my-1 text-muted-foreground"
                  onClick={() => void api.reveal(client.id, env).catch((e) => notify.error(e))}
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
          </Fact>

          <Fact label={t.endpoint}>
            {client.endpoint ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <code className="font-mono break-all">{client.endpoint}</code>
                {pointsHere(client.endpoint, gatewayBase) ? (
                  <span className="inline-flex items-center gap-1 text-success">
                    <CheckIcon className="size-3.5" />
                    {t.pointsHere}
                  </span>
                ) : (
                  <span className="text-muted-foreground">{t.notHere}</span>
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">{t.noEndpoint}</span>
            )}
          </Fact>

          <Fact label={t.key}>
            {client.key ? (
              <>
                <span className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="link"
                    className="h-auto p-0 font-normal text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground [font-size:inherit]"
                    onClick={() => nav.open("keys", { key: client.key! })}
                  >
                    {client.key}
                  </Button>
                  <TakeoverBadge
                    owner={{ id: client.id, client: client.name, kind: adopted ? "adopted" : "idle" }}
                  />
                </span>
                {key && (
                  <span className="flex min-w-0 items-center gap-1">
                    <code className="min-w-0 truncate font-mono tw-label text-muted-foreground select-text">
                      {key.key}
                    </code>
                    <CopyIconButton
                      label={common.copy}
                      className="-my-1"
                      onCopy={() =>
                        api.copyKey(key.name).catch((e: unknown) => {
                          notify.error(e);
                          throw e;
                        })
                      }
                    />
                  </span>
                )}
              </>
            ) : (
              <span className="text-muted-foreground">{t.keyOnAdopt}</span>
            )}
          </Fact>

          <Fact label={t.effect}>{takesEffectText(client.takes_effect)}</Fact>

          {client.key && (
            <Fact label={t.usage}>
              <span className="flex flex-wrap items-center gap-x-2">
                {client.last_seen_ms
                  ? usageLoaded
                    ? t.usageLine(usage?.requests ?? 0, when(client.last_seen_ms))
                    : t.lastSeenLine(when(client.last_seen_ms))
                  : t.noUsage}
                <Button
                  variant="link"
                  className="h-auto p-0 font-normal text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground [font-size:inherit]"
                  onClick={() => nav.open("requests", { filter: { client: client.key! } })}
                >
                  {t.traffic}
                </Button>
              </span>
            </Fact>
          )}

          {client.costs.length > 0 && (
            <Fact label={t.costs}>
              <ul className="flex list-disc flex-col gap-1 pl-4">
                {client.costs.map((c, i) => (
                  <li key={i}>{coreText(c)}</li>
                ))}
              </ul>
            </Fact>
          )}
        </dl>

        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <h3 className="tw-head">{t.check}</h3>
            <div className="flex-1" />
            <Button variant="ghost" size="xs" pending={checking} onClick={check} className="text-muted-foreground">
              {!checking && <RefreshCwIcon />}
              {t.recheck}
            </Button>
          </div>
          {checkError !== null && !checking ? (
            <ErrorState compact title={t.checkFailed} error={checkError} onRetry={check} className="rounded-lg border border-border" />
          ) : found == null ? (
            <div role="status" aria-busy="true" className="flex flex-col gap-2.5 py-1">
              {[0, 1].map((i) => (
                <div key={i} className="flex gap-2">
                  <Skeleton className="size-4 rounded-full" />
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Skeleton className={cn("h-3 rounded-sm", i ? "w-48" : "w-64")} />
                    <Skeleton className={cn("h-2.5 rounded-sm opacity-70", i ? "w-72" : "w-80")} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ul className={cn("flex flex-col gap-2.5 tw-body motion-fade", checking && "opacity-60")}>
              {found.map((f, i) => (
                <li key={i} className="flex gap-2">
                  <FindingMark level={f.level} />
                  <div className="min-w-0">
                    <div>{coreText(f.title)}</div>
                    <div className="tw-label text-muted-foreground">{coreText(f.detail)}</div>
                    {/* 命令给出来，执行与否是用户的事 */}
                    {f.fix && (
                      <code className="mt-1 block rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono tw-label break-all select-text">
                        {coreText(f.fix)}
                      </code>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {common.close}
          </Button>
          {adopted ? (
            <Button variant="outline" pending={asking} onClick={onRestore}>
              {t.restore}
            </Button>
          ) : (
            <Button pending={asking} onClick={onAdopt}>
              {t.adopt}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 详情里的一行：左边名目，右边内容 */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5">{children}</dd>
    </>
  );
}

/**
 * 一条发现的记号。**不用 ×**：对话框右上角的 × 是关闭，同一个形状在这里表示
 * 「有问题」会被当成同一种操作。三个都是圆圈里的记号。
 */
function FindingMark({ level }: { level: FindingView["level"] }) {
  const cls = "mt-0.5 size-4 shrink-0";
  if (level === "blocking") return <CircleAlertIcon className={cn(cls, "text-destructive")} />;
  if (level === "suspect") return <CircleHelpIcon className={cn(cls, "text-warning")} />;
  return <CircleCheckIcon className={cn(cls, "text-success")} />;
}
