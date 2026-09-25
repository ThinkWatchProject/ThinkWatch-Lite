import type { ReactNode } from "react";
import { PlugZapIcon, TriangleAlertIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/ui/button";
import { Page } from "@/ui/page";
import { StatusLabel, type StatusTone } from "@/ui/status-dot";
import { usePending } from "@/ui/notify";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { useNow } from "@/useNow";
import { trouble } from "@/launch/trouble";
import { troubleText } from "@/launch/trouble.i18n";
import { LOCAL, connApi, currentProfile, type ConnView } from "./api";
import { connText } from "./connection.i18n";
import { useConnections } from "./ConnectionProvider";
import { profileName, shortReason } from "./describe";

/**
 * 没连上时内容区里的那一页。
 *
 * **启动画面最多等约 8 秒**，之后照常打开窗口显示这一页，而不是一直转圈：需要 core
 * 数据的导航项置灰，设置始终可用（连接管理在那里），侧栏的切换器照常可点。
 *
 * 连着远程时说连不上的原因、第几次、多久后再试，给「立即重试 / 编辑连接 / 切换到本机」。
 * 「切换到本机」直接切，不走确认：这时远程本来就不可用。版本不一致单独一页，给出两个
 * 版本号和在服务器上要执行的命令。连着本机时说本机 core 怎么了（和启动画面同一套
 * 说法），给「重新启动」。
 *
 * **这一页是组件库的示范页**（src/ui/README.md 引用它）：`Page` 限宽、状态用
 * `StatusLabel`、按钮的进行中用 `usePending` + `Button pending`、出错走 `notify`。
 */
export function Unlinked({ core }: { core: string }) {
  const { view } = useConnections();
  const p = view ? currentProfile(view) : undefined;
  if (!view || !p || p.local) return <LocalDown core={core} />;
  if (view.link.kind === "down" && view.link.error.kind === "version_mismatch")
    return <Mismatch view={view} ours={view.link.error.ours} theirs={view.link.error.theirs} />;
  return <RemoteDown view={view} />;
}

/**
 * 这一页的骨架：图标、标题、一行状态，下面是事实表和操作。居中、窄版（`narrow`），
 * 离顶部留出约五分之一的高度 —— 它是整个内容区唯一的东西。
 */
function Frame({
  icon,
  tone,
  title,
  status,
  children,
}: {
  icon: ReactNode;
  tone: StatusTone;
  title: string;
  status?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Page width="narrow" className="flex-1 pt-[14vh]">
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-4">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-xl border bg-surface shadow-[0_1px_0_0_var(--border)] [&_svg]:size-[18px]",
            tone === "warn" ? "border-warning/30 text-warning" : "border-border text-muted-foreground",
          )}
        >
          {icon}
        </div>
        <div>
          <h1 className="tw-title text-foreground">{title}</h1>
          {status && (
            <StatusLabel tone={tone} className="mt-1">
              {status}
            </StatusLabel>
          )}
        </div>
        {children}
      </div>
    </Page>
  );
}

/** 事实表：一块有细边的面，两列，左边是名目 */
function Facts({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-5 gap-y-1.5 rounded-lg border border-border bg-surface/60 px-3.5 py-3 tw-body">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="min-w-0 break-words text-foreground">{v}</dd>
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
  const name = profileName(p);
  const link = view.link;
  const connecting = link.kind === "connecting";
  const retry =
    link.kind === "down"
      ? t.retryIn(link.attempt + 1, Math.max(0, Math.ceil((link.at_ms + link.retry_in_ms - now) / 1000)))
      : connecting
        ? t.retrying(link.attempt)
        : null;
  return (
    <Frame
      icon={<PlugZapIcon />}
      tone={connecting ? "pending" : "error"}
      title={connecting && link.attempt <= 1 ? t.connectingTo(name) : t.cannotConnect(name)}
      status={connecting ? t.connecting : t.unlinked}
    >
      <Facts
        rows={[
          [t.address, <code className="font-mono">{p.addr}</code>],
          ...(link.kind === "down" ? ([[t.reason, shortReason(link.error)]] as [string, ReactNode][]) : []),
          ...(retry ? ([[t.retry, <span className="tw-num">{retry}</span>]] as [string, ReactNode][]) : []),
        ]}
      />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" pending={connecting} onClick={() => void connApi.retry()}>
          {t.retryNow}
        </Button>
        <Button size="sm" variant="outline" onClick={() => edit(p)}>
          {t.editConnection}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => switchTo(LOCAL)}>
          {t.switchToLocal}
        </Button>
      </div>
      <p className="tw-label text-muted-foreground">{t.autoResume}</p>
    </Frame>
  );
}

function Mismatch({ view, ours, theirs }: { view: ConnView; ours: string; theirs: string }) {
  const t = useText(connText);
  const { switchTo } = useConnections();
  const p = currentProfile(view)!;
  return (
    <Frame icon={<TriangleAlertIcon />} tone="warn" title={t.mismatchTitle(profileName(p))}>
      <Facts
        rows={[
          [t.server, <code className="font-mono">core {theirs}</code>],
          [t.appNeeds, <code className="font-mono">core {ours}</code>],
        ]}
      />
      <div className="flex flex-col gap-1.5">
        <p className="tw-body text-muted-foreground">{t.runOnServer}</p>
        <pre className="rounded-md border border-border bg-surface px-3 py-2 font-mono tw-body select-text">
          {t.upgradeCommand}
        </pre>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void connApi.retry()}>
          {t.reconnect}
        </Button>
        <Button size="sm" variant="outline" onClick={() => switchTo(LOCAL)}>
          {t.switchToLocal}
        </Button>
      </div>
    </Frame>
  );
}

/** 连着本机、本机 core 没起来（启动画面等过了 8 秒之后） */
function LocalDown({ core }: { core: string }) {
  const t = useText(connText);
  const tt = useText(troubleText);
  const [restarting, run] = usePending();
  const tr = trouble(core, 0);
  return (
    <Frame icon={<PlugZapIcon />} tone={tr.bad ? "error" : "warn"} title={tr.what}>
      <p className="tw-body whitespace-pre-wrap text-muted-foreground">{tr.next}</p>
      {tr.retry && (
        <div>
          <Button size="sm" pending={restarting} onClick={() => void run(() => invoke("restart_core"))}>
            {tt.restart}
          </Button>
        </div>
      )}
      <p className="tw-label text-muted-foreground">{t.autoResume}</p>
    </Frame>
  );
}
