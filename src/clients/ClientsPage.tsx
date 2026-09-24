import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { useText } from "@/i18n";
import { coreText, errorText } from "@/i18n/core.i18n";
import type { ClientsResponse, ClientView, CostGroup, DetectedClient, PlanView } from "@/types";
import { useCoreEvent } from "@/useCoreEvent";
import { api } from "./api";
import { clientsText } from "./clients.i18n";
import { ClientsTable } from "./ClientsTable";
import { DetailDialog } from "./DetailDialog";
import { ManualDialog, type ManualTarget } from "./ManualDialog";
import { PlanDialog } from "./PlanDialog";
import { RestoreAllDialog } from "./RestoreAllDialog";
import { useRemote } from "@/connection/useRemote";
import { RemoteNote, RetargetReport } from "@/connection/Remote";
import { remoteText } from "@/connection/remote.i18n";
import type { Retargeted } from "@/types";
import { hostOf, isLoopback } from "./status";

const DAY_MS = 24 * 3_600_000;

type DialogState =
  | null
  | { kind: "detail"; id: string }
  | { kind: "plan"; id: string; restore: boolean; plan: PlanView }
  | { kind: "manual"; id: string }
  | { kind: "restoreAll" };

/**
 * 客户端：这台电脑上的 AI 客户端，哪些经过网关、是不是真的生效，没接上的怎么接上。
 *
 * 这是整个应用里唯一会去改**用户其他软件**配置的地方，所以每一处交互都按
 * 「让他敢按下去、也退得回来」设计：接管前必须看到改哪几项（没有一键接管）；
 * 接管的代价在确认框里就列出来；接管完不宣布成功，只说「等待首个请求」——
 * 我们改了一个文件，但那个文件有没有被读到，只有带着它那把密钥的请求能证明。
 *
 * 页面只放状态和入口：详情、接管、还原、手动配置、全部还原都在对话框里。
 */
export default function ClientsPage({
  onOpenKey,
  onShowTraffic,
}: {
  /** 去密钥页，定位到这一把 */
  onOpenKey: (key: string) => void;
  /** 去流量页，只看这把密钥的请求 */
  onShowTraffic: (key: string) => void;
}) {
  const t = useText(clientsText);
  const rt = useText(remoteText);
  /** 连着远程 core：这一页改的仍是这台机器，写进去的是服务器的网关（设计稿 ⑧） */
  const remote = useRemote();
  /** 「改为指向服务器」有没改成的：留在页上，直到再改一次或者离开这一页 */
  const [retargeted, setRetargeted] = useState<Retargeted | null>(null);
  const [data, setData] = useState<ClientsResponse | null>(null);
  const [keys, setKeys] = useState<ClientView[]>([]);
  const [usage, setUsage] = useState<CostGroup[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.list());
    } catch (e) {
      toast.error(errorText(e));
    }
    // 密钥的值（详情里原样显示）和 24 小时的用量：拿不到时少一样东西，页面照常用
    api.keys().then(setKeys).catch(() => setKeys([]));
    api
      .keyUsage(Date.now() - DAY_MS)
      .then(setUsage)
      .catch(() => setUsage([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    这一页有两件事会变，而它们各自都有事件：客户端的配置文件被改了
    （`clients_changed`，这台机器上的文件监视说的），和请求落地了（「使用中」
    等的就是它，core 说的）。
  */
  useCoreEvent(
    ["clients_changed", "request_finished", "request_failed", "request_cancelled", "config_reloaded"],
    () => void load(),
    3_000,
  );

  async function ask(c: DetectedClient, restore: boolean) {
    setBusy(true);
    try {
      const plan = restore ? await api.planRestore(c.id) : await api.planAdopt(c.id);
      setDialog({ kind: "plan", id: c.id, restore, plan });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /**
   * 落盘。**成功之后不弹第二个对话框** —— 行上的状态会说「等待首个请求」。
   * 只有不至于失败、但用户该知道的事（符号链接、权限太松）才另说一句。
   */
  async function confirm(id: string, restore: boolean) {
    setBusy(true);
    try {
      const r = restore ? await api.restore(id) : await api.adopt(id);
      setDialog(null);
      if (r.warnings.length > 0) toast.warning(r.warnings.map((w) => coreText(w)).join(" "));
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  /** 还指着本机网关的，改为指向连着的那台服务器 */
  async function retarget(serverName: string) {
    setBusy(true);
    try {
      const r = await api.retarget();
      if (r.failed.length > 0) setRetargeted(r);
      else {
        setRetargeted(null);
        if (r.synced.length > 0) toast.success(rt.retargeted(serverName, r.synced.map((s) => s.name)));
      }
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function restoreAll() {
    setBusy(true);
    try {
      const rs = await api.restoreAll();
      const bad = rs.filter((r) => !r.ok);
      // **一个失败不影响其余的**，所以逐条报，不能只说「失败了」
      if (bad.length === 0) toast.success(t.restoredAll(rs.length));
      else toast.error(t.restoreFailed(bad));
      setDialog(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="p-5 tw-body text-muted-foreground">{t.scanning}</div>;

  const byId = (id: string) => data.clients.find((c) => c.id === id);
  const adopted = data.clients.filter((c) => c.adopted_at_ms != null);
  const noneHere = !data.clients.some((c) => c.installed);
  /** 连着远程时，接管着却还指着本机网关的 */
  const leftBehind = remote
    ? adopted.filter((c) => c.endpoint != null && isLoopback(c.endpoint))
    : [];
  const manualTarget = (id: string): ManualTarget | null => {
    const c = byId(id);
    if (c) return { id: c.id, name: c.name, setup: c.manual, key: c.key };
    const m = data.manual.find((x) => x.id === id);
    return m ? { id: m.id, name: m.name, setup: m.setup, caveat: m.caveat, key: m.key } : null;
  };

  const detail = dialog?.kind === "detail" ? byId(dialog.id) : undefined;
  const planned = dialog?.kind === "plan" ? byId(dialog.id) : undefined;
  const manual = dialog?.kind === "manual" ? manualTarget(dialog.id) : null;

  return (
    <div className="flex flex-col gap-4 p-5">
      {remote && <RemoteNote>{rt.clientsNote(remote.name, hostOf(data.gateway_base))}</RemoteNote>}

      {remote && leftBehind.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 tw-body">
          <p className="min-w-0 flex-1 text-warning">
            {rt.localLeft(leftBehind.length, hostOf(leftBehind[0]?.endpoint ?? ""))}
          </p>
          <Button size="sm" disabled={busy} onClick={() => void retarget(remote.name)}>
            {rt.retargetTo(remote.name)}
          </Button>
        </div>
      )}

      {remote && retargeted && <RetargetReport name={remote.name} result={retargeted} />}

      <div className="flex flex-wrap items-center gap-2">
        <p className="tw-body text-muted-foreground">{t.intro}</p>
        <div className="flex-1" />
        {/*
          **退路要一直看得见。**用户敢按下「接管」的前提，就是看得见怎么退回去 ——
          藏在二级菜单里的退路等于没有退路。
        */}
        {adopted.length > 0 && (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog({ kind: "restoreAll" })}>
            {t.restoreAll}
          </Button>
        )}
      </div>

      {noneHere && <p className="tw-body text-muted-foreground">{t.noneDetected}</p>}

      <ClientsTable
        clients={data.clients}
        manual={data.manual}
        usage={usage}
        gatewayBase={data.gateway_base}
        remote={remote !== null}
        actions={{
          details: (c) => setDialog({ kind: "detail", id: c.id }),
          adopt: (c) => void ask(c, false),
          restore: (c) => void ask(c, true),
          manual: (id) => setDialog({ kind: "manual", id }),
          reveal: (c) => void api.reveal(c.id).catch((e) => toast.error(errorText(e))),
          traffic: onShowTraffic,
          openKey: onOpenKey,
        }}
      />

      {detail && (
        <DetailDialog
          client={detail}
          keys={keys}
          usage={usage}
          gatewayBase={data.gateway_base}
          onClose={() => setDialog(null)}
          onAdopt={() => void ask(detail, false)}
          onRestore={() => void ask(detail, true)}
          onOpenKey={onOpenKey}
          onTraffic={onShowTraffic}
        />
      )}

      {dialog?.kind === "plan" && planned && (
        <PlanDialog
          plan={dialog.plan}
          client={planned}
          restore={dialog.restore}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void confirm(dialog.id, dialog.restore)}
        />
      )}

      {manual && (
        <ManualDialog target={manual} keys={keys} onClose={() => setDialog(null)} onKeyReady={() => void load()} />
      )}

      {dialog?.kind === "restoreAll" && (
        <RestoreAllDialog
          adopted={adopted}
          gatewayBase={data.gateway_base}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => void restoreAll()}
        />
      )}
    </div>
  );
}
