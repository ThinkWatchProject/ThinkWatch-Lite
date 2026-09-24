import { useCallback, useEffect, useState } from "react";
import { RefreshCwIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { Button } from "@/ui/button";
import { Count } from "@/ui/count";
import { Spinner } from "@/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import type {
  AdoptResponse,
  McpOpRequest,
  McpTargetView,
  PlanView,
  ScanFinding,
  ScanReport,
} from "@/types";
import { useCoreEvent } from "@/useCoreEvent";
import { Extensions } from "./Extensions";
import { Findings } from "./Findings";
import { Matrix, McpConfirm } from "./Matrix";
import { mcpText } from "./McpPage.i18n";
import { useRemote } from "@/connection/useRemote";
import { RemoteNote } from "@/connection/Remote";
import { remoteText } from "@/connection/remote.i18n";

type McpTab = "servers" | "extensions" | "findings";

/**
 * MCP 页：各客户端配置的 MCP 服务器、技能与钩子，以及扫描发现。
 *
 * **这些不经过网关**，是客户端自己读的配置文件 —— 所以它们不在安全页。
 * 安全页的规则只作用于经过网关的请求，这里的扫描只用内置规则。
 *
 * 三条纪律：
 *
 * - **只报告，不自动删除。**误报删掉用户的正常配置比漏报还糟。
 * - **查干净了要说「未发现问题」**，而不是让这一块消失。
 * - **不存任何状态。**每次打开现扫一遍，看到的永远是磁盘上此刻的样子。
 *
 * 扫描、读写 MCP 配置都在应用里做（这台机器上的文件），不经过 core。
 */
export default function McpPage({
  alerts,
  onSeen,
}: {
  /** 监听到的、新出现的发现。有的话直接落在「发现」上 */
  alerts: ScanFinding[];
  onSeen: () => void;
}) {
  const t = useText(mcpText);
  const rt = useText(remoteText);
  /** 连着远程 core：这一页看的、改的仍是这台机器（设计稿 ⑧） */
  const remote = useRemote();
  // **有新发现就直接落在「发现」上。**通知点进来还要再点一下标签，等于把
  // 那条通知又藏了一层
  const [tab, setTab] = useState<McpTab>(alerts.length > 0 ? "findings" : "servers");
  const [data, setData] = useState<ScanReport | null>(null);
  const [targets, setTargets] = useState<McpTargetView[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ req: McpOpRequest; plan: PlanView } | null>(null);

  const fetchAll = useCallback(async () => {
    const [scan, ts] = await Promise.all([
      invoke<ScanReport>("scan_clients"),
      invoke<McpTargetView[]>("mcp_targets"),
    ]);
    setData(scan);
    setTargets(ts);
  }, []);
  const load = useCallback(async () => {
    setBusy(true);
    try {
      await fetchAll();
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }, [fetchAll]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    **配置文件变了就重扫。**扫描告警说的是磁盘上多了一个可疑的东西，客户端配置
    变了说的是矩阵里某一格变了 —— 两件事发生时这一页可能正开着，而列表还是打开
    那一刻扫的那一份。在后台重扫，不动「忙」的状态：用户可能正在确认一次改动。
  */
  useCoreEvent(["scan_alert", "clients_changed"], () => {
    fetchAll().catch(() => {});
  });

  /** 点了格子。**先算一份改动**，不直接写 —— 和接管同一条纪律 */
  async function ask(req: McpOpRequest) {
    setBusy(true);
    try {
      setPending({ req, plan: await invoke<PlanView>("plan_mcp", { req }) });
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      await invoke<AdoptResponse>("apply_mcp", { req: pending.req });
      setPending(null);
      await load();
    } catch (e) {
      toast.error(errorText(e));
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  const nameOf = (c: string) => targets.find((x) => x.client === c)?.name ?? c;

  if (!data) {
    return <p className="p-5 tw-body text-muted-foreground">{t.scanning}</p>;
  }

  const servers = new Set(data.mcp.map((m) => m.name)).size;

  return (
    <div className="flex flex-col gap-4 p-5">
      {remote && <RemoteNote>{rt.mcpNote(remote.name)}</RemoteNote>}
      <Tabs value={tab} onValueChange={(v) => setTab(v as McpTab)}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="servers">
              {t.tabServers} <Count n={servers} />
            </TabsTrigger>
            <TabsTrigger value="extensions">
              {t.tabExtensions} <Count n={data.hooks.length + data.skills.length} />
            </TabsTrigger>
            <TabsTrigger value="findings">
              {t.tabFindings} <Count n={data.findings.length} />
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={busy}>
            {busy ? <Spinner /> : <RefreshCwIcon />}
            {t.rescan}
          </Button>
        </div>

        <TabsContent value="servers" className="mt-2">
          <Matrix mcp={data.mcp} conflicting={data.conflicting} targets={targets} busy={busy} onAsk={ask} />
        </TabsContent>
        <TabsContent value="extensions" className="mt-2">
          <Extensions data={data} nameOf={nameOf} />
        </TabsContent>
        <TabsContent value="findings" className="mt-2">
          <Findings data={data} alerts={alerts} nameOf={nameOf} onSeen={onSeen} />
        </TabsContent>
      </Tabs>

      {pending && (
        <McpConfirm
          plan={pending.plan}
          req={pending.req}
          nameOf={nameOf}
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void confirm()}
        />
      )}
    </div>
  );
}
