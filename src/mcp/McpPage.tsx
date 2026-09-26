import { useState } from "react";
import { MonitorIcon, RefreshCwIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useResource } from "@/lib/resource";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Count } from "@/ui/count";
import { usePending } from "@/ui/notify";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { Skeleton } from "@/ui/skeleton";
import { Loadable, TableSkeleton } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { useText } from "@/i18n";
import type { AdoptResponse, McpOpRequest, McpTargetView, PlanView, ScanFinding, ScanReport } from "@/types";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import { clock } from "@/security/labels";
import { LocationsDialog } from "@/clients/LocationsDialog";
import { Extensions } from "./Extensions";
import { FindingDetail, Findings } from "./Findings";
import { Matrix, McpConfirm, ServerDialog } from "./Matrix";
import { mcpText } from "./McpPage.i18n";
import { LEVELS, levelTone } from "./parts";

type McpTab = "servers" | "extensions" | "findings";

/** 一次扫描：各客户端的配置面，和哪些客户端能写。`at` 是扫完的时刻 */
interface Scan {
  report: ScanReport;
  targets: McpTargetView[];
  at: number;
}

async function scan(): Promise<Scan> {
  const [report, targets] = await Promise.all([
    invoke<ScanReport>("scan_clients"),
    invoke<McpTargetView[]>("mcp_targets"),
  ]);
  return { report, targets, at: Date.now() };
}

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
 * - **不存任何状态。**每次打开现扫一遍，看到的永远是磁盘上此刻的样子（上一次
 *   扫的结果先画着，扫完无声替换）。
 *
 * 页头一行是全貌：各级发现几项（没有就是「未发现问题」），扫了多少个文件、
 * 什么时候扫的。扫描、读写 MCP 配置都在应用里做（这台机器上的文件），不经过
 * core。
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
  /** 连着远程 core：这一页看的、改的仍是这台机器 */
  const remote = useRemote();
  // **有新发现就直接落在「发现」上。**通知点进来还要再点一下标签，等于把
  // 那条通知又藏了一层
  const [tab, setTab] = useState<McpTab>(alerts.length > 0 ? "findings" : "servers");
  /*
    **配置文件变了就重扫。**扫描告警说的是磁盘上多了一个可疑的东西，客户端配置
    变了说的是矩阵里某一格变了 —— 两件事发生时这一页可能正开着。
  */
  const data = useResource("mcp-scan", scan, { events: ["scan_alert", "clients_changed"] });
  const [rescanning, runRescan] = usePending();
  // 手动重扫失败要说出来（后台重扫失败照旧画着上一次的结果）
  const rescan = () => void runRescan(async () => void data.mutate(await scan()));

  /** 点了格子：先算一份改动，不直接写 —— 和接管同一条纪律 */
  const [confirm, setConfirm] = useState<{ req: McpOpRequest; plan: PlanView } | null>(null);
  const [planning, runPlan] = usePending();
  const ask = (req: McpOpRequest) =>
    void runPlan(async () => setConfirm({ req, plan: await invoke<PlanView>("plan_mcp", { req }) }));
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<unknown>(null);
  async function apply() {
    if (!confirm) return;
    setApplying(true);
    setApplyError(null);
    try {
      await invoke<AdoptResponse>("apply_mcp", { req: confirm.req });
      setConfirm(null);
      // 写成了就关；重扫在后台，那一格随后变过来
      void data.reload();
    } catch (e) {
      setApplyError(e);
    } finally {
      setApplying(false);
    }
  }

  /** 正在看配置的那个服务器；正在看详情的那一处发现；正在改配置位置的那个客户端 */
  const [server, setServer] = useState<string | null>(null);
  const [finding, setFinding] = useState<ScanFinding | null>(null);
  const [moving, setMoving] = useState<string | null>(null);

  const report = data.data?.report;
  const targets = data.data?.targets ?? [];
  const nameOf = (c: string) => targets.find((x) => x.client === c)?.name ?? c;
  const movable = (c: string) => targets.find((x) => x.client === c)?.movable ?? false;
  const servers = report ? new Set(report.mcp.map((m) => m.name)).size : null;

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as McpTab)} className="gap-0">
      <Page>
        <PageHeader
          title={t.title}
          summary={data.data ? <Summary of={data.data} /> : data.loading ? <Skeleton className="my-1 h-3 w-56 rounded-sm" /> : null}
          actions={
            <Button size="sm" variant="outline" pending={rescanning} disabled={!data.data} onClick={rescan}>
              {!rescanning && <RefreshCwIcon />}
              {t.rescan}
            </Button>
          }
          tabs={
            <TabsList variant="line">
              <TabsTrigger value="servers">
                {t.tabServers}
                {servers != null && <Count n={servers} />}
              </TabsTrigger>
              <TabsTrigger value="extensions">
                {t.tabExtensions}
                {report && <Count n={report.hooks.length + report.skills.length} />}
              </TabsTrigger>
              <TabsTrigger value="findings">
                {t.tabFindings}
                {report && <Count n={report.findings.length} />}
                {alerts.length > 0 && <StatusDot tone="error" label={t.newDot} />}
              </TabsTrigger>
            </TabsList>
          }
        />

        {remote && (
          <Banner layout="inline" tone="info" icon={<MonitorIcon />} className="mt-4">
            {rt.mcpNote(remote.name)}
          </Banner>
        )}

        {(["servers", "extensions", "findings"] as const).map((k) => (
          <TabsContent key={k} value={k} className="pt-4">
            <Loadable
              r={data}
              loading={k === "extensions" ? <TableSkeleton rows={4} cols={4} /> : <TableSkeleton rows={5} cols={4} />}
              errorTitle={t.loadFailed}
            >
              {(d) =>
                k === "servers" ? (
                  <Matrix
                    mcp={d.report.mcp}
                    conflicting={d.report.conflicting}
                    targets={d.targets}
                    busy={planning || applying}
                    rescanning={rescanning}
                    onAsk={ask}
                    onOpen={setServer}
                    onRescan={rescan}
                    onMove={setMoving}
                  />
                ) : k === "extensions" ? (
                  <Extensions
                    data={d.report}
                    nameOf={nameOf}
                    onFinding={setFinding}
                    movable={movable}
                    onMove={setMoving}
                  />
                ) : (
                  <Findings
                    data={d.report}
                    alerts={alerts}
                    nameOf={nameOf}
                    onSeen={onSeen}
                    onOpen={setFinding}
                    movable={movable}
                    onMove={setMoving}
                  />
                )
              }
            </Loadable>
          </TabsContent>
        ))}
      </Page>

      {finding && <FindingDetail f={finding} nameOf={nameOf} onClose={() => setFinding(null)} />}
      {moving && (
        <LocationsDialog
          client={moving}
          onClose={() => setMoving(null)}
          onSaved={() => {
            setMoving(null);
            void data.reload();
          }}
        />
      )}
      {server && report && (
        <ServerDialog
          name={server}
          peers={report.mcp.filter((m) => m.name === server)}
          differs={report.conflicting.includes(server)}
          nameOf={nameOf}
          onClose={() => setServer(null)}
        />
      )}
      {confirm && (
        <McpConfirm
          plan={confirm.plan}
          req={confirm.req}
          nameOf={nameOf}
          applying={applying}
          error={applyError}
          onCancel={() => {
            setConfirm(null);
            setApplyError(null);
          }}
          onConfirm={() => void apply()}
        />
      )}
    </Tabs>
  );
}

/** 页头的一行：各级发现几项，扫了多少文件、什么时候 */
function Summary({ of }: { of: Scan }) {
  const t = useText(mcpText);
  const f = of.report.findings;
  return (
    <>
      {f.length === 0 ? (
        <SummaryItem lead={<StatusDot tone="ok" />} label={t.clean} />
      ) : (
        LEVELS.map((l) => {
          const n = f.filter((x) => x.level === l).length;
          return n > 0 ? <SummaryItem key={l} lead={<StatusDot tone={levelTone(l)} />} value={n} label={t.levelCount[l]} /> : null;
        })
      )}
      {/* 有文件没读到时，「未发现问题」只对读到的那些成立：一起说 */}
      {of.report.unreadable.length > 0 && (
        <SummaryItem
          lead={<StatusDot tone="warn" />}
          value={of.report.unreadable.length}
          label={t.unreadableCount}
        />
      )}
      <span aria-hidden className="h-3 w-px bg-border" />
      <span className="whitespace-nowrap">{t.scannedAt(of.report.scanned, clock(of.at))}</span>
    </>
  );
}
