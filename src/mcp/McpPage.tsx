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
import type { AdoptResponse, McpOpRequest, McpTargetView, PlanView, ScanFinding, ScanResponse } from "@/types";
import { Extensions } from "./Extensions";
import { Findings } from "./Findings";
import { Matrix, McpConfirm } from "./Matrix";
import { mcpText } from "./McpPage.i18n";

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
  // **有新发现就直接落在「发现」上。**通知点进来还要再点一下标签，等于把
  // 那条通知又藏了一层
  const [tab, setTab] = useState<McpTab>(alerts.length > 0 ? "findings" : "servers");
  const [data, setData] = useState<ScanResponse | null>(null);
  const [targets, setTargets] = useState<McpTargetView[]>([]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ req: McpOpRequest; plan: PlanView } | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [scan, ts] = await Promise.all([
        invoke<ScanResponse>("scan_configs", { projects: [] }),
        invoke<McpTargetView[]>("mcp_targets"),
      ]);
      setData(scan);
      setTargets(ts);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** 点了格子。**先算一份改动**，不直接写 —— 和接管同一条纪律 */
  async function ask(req: McpOpRequest) {
    setBusy(true);
    try {
      setPending({ req, plan: await invoke<PlanView>("mcp_plan", { req }) });
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
      await invoke<AdoptResponse>("mcp_apply", { req: pending.req });
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
