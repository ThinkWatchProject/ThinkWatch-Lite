import { useState, type ReactNode } from "react";
import { PlugZapIcon, TriangleAlertIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { useNow } from "@/useNow";
import { trouble } from "@/launch/trouble";
import { troubleText } from "@/launch/trouble.i18n";
import { LOCAL, connApi, currentProfile, type ConnView } from "./api";
import { connText } from "./connection.i18n";
import { useConnections } from "./ConnectionProvider";
import { shortReason } from "./describe";

/**
 * 没连上时内容区里的那一页（设计稿 ⑤、⑥ 左）。
 *
 * **启动画面最多等约 8 秒**，之后照常打开窗口显示这一页，而不是一直转圈：需要 core
 * 数据的导航项置灰，设置始终可用（连接管理在那里），侧栏的切换器照常可点。
 *
 * 连着远程时说连不上的原因、第几次、多久后再试，给「立即重试 / 编辑连接 / 切换到本机」。
 * 「切换到本机」直接切，不走确认：这时远程本来就不可用。版本不一致单独一页，给出两个
 * 版本号和在服务器上要执行的命令。
 *
 * 连着本机时说本机 core 怎么了（和启动画面同一套说法），给「重新启动」。
 */
export function Unlinked({ core }: { core: string }) {
  const { view } = useConnections();
  const p = view ? currentProfile(view) : undefined;
  if (!view || !p || p.local) return <LocalDown core={core} />;
  if (view.link.kind === "down" && view.link.error.kind === "version_mismatch")
    return <Mismatch view={view} ours={view.link.error.ours} theirs={view.link.error.theirs} />;
  return <RemoteDown view={view} />;
}

function Page({ icon, tone, title, children }: { icon: ReactNode; tone: "bad" | "warn"; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto px-5 py-16">
      <div className="flex w-full max-w-md flex-col gap-3">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-lg",
            tone === "bad" ? "bg-muted text-muted-foreground" : "bg-warning/15 text-warning",
          )}
        >
          {icon}
        </div>
        <h2 className="tw-title font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 tw-body">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function RemoteDown({ view }: { view: ConnView }) {
  const t = useText(connText);
  const { edit, switchTo } = useConnections();
  const now = useNow(1_000);
  const p = currentProfile(view)!;
  const link = view.link;
  const retry =
    link.kind === "down"
      ? t.retryIn(link.attempt + 1, Math.max(0, Math.ceil((link.at_ms + link.retry_in_ms - now) / 1000)))
      : link.kind === "connecting"
        ? t.retrying(link.attempt)
        : null;
  return (
    <Page icon={<PlugZapIcon className="size-5" />} tone="bad" title={link.kind === "connecting" && link.attempt <= 1 ? t.connectingTo(p.name) : t.cannotConnect(p.name)}>
      <Facts
        rows={[
          [t.address, <code className="font-mono">{p.addr}</code>],
          ...(link.kind === "down" ? ([[t.reason, shortReason(link.error)]] as [string, ReactNode][]) : []),
          ...(retry ? ([[t.retry, retry]] as [string, ReactNode][]) : []),
        ]}
      />
      <div className="mt-1 flex flex-wrap gap-2">
        <Button size="sm" disabled={link.kind === "connecting"} onClick={() => void connApi.retry()}>
          {link.kind === "connecting" && <Spinner />}
          {t.retryNow}
        </Button>
        <Button size="sm" variant="outline" onClick={() => edit(p)}>
          {t.editConnection}
        </Button>
        <Button size="sm" variant="outline" onClick={() => switchTo(LOCAL)}>
          {t.switchToLocal}
        </Button>
      </div>
      <p className="tw-label text-muted-foreground">{t.autoResume}</p>
    </Page>
  );
}

function Mismatch({ view, ours, theirs }: { view: ConnView; ours: string; theirs: string }) {
  const t = useText(connText);
  const { switchTo } = useConnections();
  const p = currentProfile(view)!;
  return (
    <Page icon={<TriangleAlertIcon className="size-5" />} tone="warn" title={t.mismatchTitle(p.name)}>
      <Facts
        rows={[
          [t.server, <code className="font-mono">core {theirs}</code>],
          [t.appNeeds, <code className="font-mono">core {ours}</code>],
        ]}
      />
      <p className="tw-body text-muted-foreground">{t.runOnServer}</p>
      <pre className="rounded-md bg-muted px-3 py-2 font-mono tw-body select-text">{t.upgradeCommand}</pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void connApi.retry()}>
          {t.reconnect}
        </Button>
        <Button size="sm" variant="outline" onClick={() => switchTo(LOCAL)}>
          {t.switchToLocal}
        </Button>
      </div>
    </Page>
  );
}

/** 连着本机、本机 core 没起来（启动画面等过了 8 秒之后） */
function LocalDown({ core }: { core: string }) {
  const t = useText(connText);
  const tt = useText(troubleText);
  const [busy, setBusy] = useState(false);
  const tr = trouble(core, 0);
  return (
    <Page icon={<PlugZapIcon className="size-5" />} tone="bad" title={tr.what}>
      <p className="tw-body whitespace-pre-wrap text-muted-foreground">{tr.next}</p>
      {tr.retry && (
        <div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              invoke("restart_core")
                .catch((e) => toast.error(errorText(e)))
                .finally(() => setBusy(false));
            }}
          >
            {busy && <Spinner />}
            {tt.restart}
          </Button>
        </div>
      )}
      <p className="tw-label text-muted-foreground">{t.autoResume}</p>
    </Page>
  );
}
