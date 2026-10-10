import { invoke } from "@tauri-apps/api/core";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { coreText } from "@/i18n/core.i18n";
import { appText } from "@/App.i18n";
import { connText } from "@/connection/connection.i18n";
import { FixList, repairText } from "@/repair";
import { stageLabel } from "@/labels";
import type { Trouble } from "@/launch/trouble";
import type { CoreEvent, ConfigFix } from "@/types";
import { useIgnored } from "@/ignore";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Reveal } from "@/ui/motion";
import { Tip } from "@/ui/tip";

/**
 * 工具栏下面那一摞横幅：配置被拒、凭据换发、断线。**状态类的事都在这里**，不走吐司 ——
 * 吐司一会儿就飘走了，这些要一直挂到解决为止。
 */
export function Banners({
  rejected,
  broken,
  repair,
  rotated,
  onCloseRotated,
  remoteLost,
  remoteName,
  remoteAttempt,
  connecting,
  lost,
  onRestartFailed,
}: {
  /** 最后一次配置被拒（`useRequests`）。出错页在的时候（`broken`）不再挂这一条 */
  rejected: Extract<CoreEvent, { kind: "config_rejected" }> | null;
  broken: boolean;
  repair: { fixes: ConfigFix[]; repairing: boolean; repair: () => void };
  rotated: Extract<CoreEvent, { kind: "credential_rotated" }>[];
  onCloseRotated: (provider: string) => void;
  /** 连着远程、连上过、现在断了 */
  remoteLost: boolean;
  /** 那条远程连接的名字 */
  remoteName: string | null;
  /** 第几次重连 */
  remoteAttempt: number;
  /** 正在重连 */
  connecting: boolean;
  /** 连本机时连上过、又断了：说什么（`trouble`） */
  lost: Trouble | null;
  /** 点「重新启动」没成：状态和概览重读一次 */
  onRestartFailed: () => void;
}) {
  const t = useText(appText);
  const ct = useText(connText);
  const rt = useText(repairText);
  const common = useText(commonText);
  /**
   * 黄色的都能「忽略」。配置被拒的记在这台电脑上，按出错的位置和原因记：改了配置又被拒
   * 在别处，是新情况，再出现。断线的两条只记这一次运行：下次启动还断着就该再说
   */
  const rejectedIg = useIgnored(
    "shell:rejected",
    rejected ? `${rejected.stage}:${rejected.line ?? ""}:${coreText(rejected.message)}` : "",
    (seen, current) => seen === current,
  );
  const remoteIg = useIgnored("shell:remote-lost", remoteName ?? "", (seen, current) => seen === current, {
    session: true,
  });
  const lostIg = useIgnored("shell:lost", lost?.what ?? "", (seen, current) => seen === current, { session: true });
  return (
    <>
      {/*
        配置没通过校验。**一直挂着，直到下一次成功换入** —— 一闪而过的提示等于
        没提示。第一句先说「还在按旧配置转发」：那是最想知道的，会不会断。
      */}
      <Banner
        show={rejected !== null && !broken && !rejectedIg.ignored}
        tone="warning"
        title={t.rejectedTitle}
        onIgnore={rejectedIg.ignore}
        actions={
          repair.fixes.length > 0 && (
            <Button variant="outline" size="sm" pending={repair.repairing} onClick={repair.repair}>
              {rt.action}
            </Button>
          )
        }
      >
        {rejected && (
          <>
            <p>
              {t.rejectedAt(stageLabel(rejected.stage), rejected.line)}
              {coreText(rejected.message)}
            </p>
            {rejected.excerpt && (
              <pre className="mt-1.5 overflow-x-auto rounded-md bg-warning/10 px-2 py-1 font-mono tw-label">
                {rejected.line}│ {rejected.excerpt}
              </pre>
            )}
            {repair.fixes.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                <p className="font-medium">{rt.title}</p>
                <FixList fixes={repair.fixes} />
              </div>
            )}
          </>
        )}
      </Banner>

      {/*
        token 端点换发了新的 refresh token。**两种完全不同的话，长得也要不一样**：
        写回成功只是告知（编辑器会弹「文件已更改」，该知道是谁改的）；写回失败是
        必须处理的问题：重启之前不解决，该上游就不可用了。
      */}
      {rotated.map((r) => (
        <Reveal key={r.provider} show>
          {r.persisted ? (
            <Banner
              tone="info"
              actions={
                <Button variant="ghost" size="xs" onClick={() => onCloseRotated(r.provider)}>
                  {common.close}
                </Button>
              }
            >
              {t.rotatedSaved(<span className="font-medium">{r.provider}</span>)}
              <Tip text={t.reloadTip}>
                <span className="ml-1 text-muted-foreground underline decoration-dotted underline-offset-2">
                  {t.reload}
                </span>
              </Tip>
            </Banner>
          ) : (
            <Banner
              tone="error"
              title={t.rotatedUnsaved(r.provider)}
              actions={
                <Button variant="ghost" size="sm" onClick={() => onCloseRotated(r.provider)}>
                  {common.close}
                </Button>
              }
            >
              <p>{coreText(r.detail)}</p>
              <p className="mt-0.5">{t.oldRevoked((s) => <span className="font-medium">{s}</span>)}</p>
            </Banner>
          )}
        </Reveal>
      ))}

      {/*
        断线。**不是 toast，也不清空页面**：数字留着，旁边写着它们为什么不动了。
        连着远程时是另一条（内容置为只读），见 `remoteLost`。
      */}
      <Banner
        show={remoteLost && remoteName !== null && !remoteIg.ignored}
        tone="warning"
        role="status"
        onIgnore={remoteIg.ignore}
        actions={
          <Button
            variant="outline"
            size="sm"
            pending={connecting}
            onClick={() => void invoke("retry_connection").catch(() => {})}
          >
            {ct.retryNow}
          </Button>
        }
      >
        {remoteName !== null && ct.lostBanner(remoteName, remoteAttempt)}
      </Banner>

      <Banner
        show={lost !== null && !lostIg.ignored}
        tone="warning"
        title={lost && t.staleData(lost.what)}
        onIgnore={lostIg.ignore}
        actions={
          lost?.retry && (
            <Button variant="outline" size="sm" onClick={() => void invoke("restart_core").catch(onRestartFailed)}>
              {t.restart}
            </Button>
          )
        }
      >
        {lost?.next}
      </Banner>
    </>
  );
}
