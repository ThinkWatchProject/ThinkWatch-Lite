import { useMemo, useState } from "react";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { IconClient, IconRemote } from "@/ui/icons";
import { AnimatedNumber } from "@/ui/motion";
import { notify, usePending } from "@/ui/notify";
import { Page, PageHeader, SummaryItem } from "@/ui/page";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, Loadable } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { useNav } from "@/nav";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { appText } from "@/App.i18n";
import type { ClientsResponse, DetectedClient, PlanView, Retargeted } from "@/types";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import { useKeys, useKeyUsage } from "@/keys/data";
import { RowsSkeleton } from "@/keys/parts";
import { api } from "./api";
import { clientsText } from "./clients.i18n";
import { DetectedTable, ManualTable, Section, type RowContext } from "./ClientsTable";
import { useClients } from "./data";
import { DetailDialog } from "./DetailDialog";
import { ManualDialog, type ManualTarget } from "./ManualDialog";
import { PlanDialog } from "./PlanDialog";
import { RestoreAllDialog } from "./RestoreAllDialog";
import { hostOf, isLoopback, manualStatusOf, statusOf, type ClientState } from "./status";

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
 * 改的是一个文件，而那个文件有没有被读到，只有带着它那把密钥的请求能证明。
 *
 * 页头一行是各档各有几个；下面一张表是检测到的客户端，再往下两组（需要手动配置、
 * 未检测到）可以收起。详情、接管、还原、手动配置、全部还原都在对话框里。
 */
export default function ClientsPage({
  busy,
}: {
  /** 此刻有请求在跑的密钥 */
  busy: ReadonlySet<string>;
}) {
  const t = useText(clientsText);
  const rt = useText(remoteText);
  const title = useText(appText).surfaces.clients;
  const nav = useNav();
  /** 连着远程 core：这一页改的仍是这台机器，写进去的是服务器的网关 */
  const remote = useRemote();
  const clients = useClients({ live: true });
  const keys = useKeys();
  const usage = useKeyUsage();
  const [dialog, setDialog] = useState<DialogState>(null);
  /** 正在取接管方案的那一个：它的按钮转圈 */
  const [asking, setAsking] = useState<string | null>(null);
  const [confirming, confirm] = usePending();
  const [restoringAll, restoreAllRun] = usePending();
  const [retargeting, retargetRun] = usePending();
  /** 「改为指向服务器」有没改成的：留在页上，直到再改一次或者离开这一页 */
  const [retargeted, setRetargeted] = useState<Retargeted | null>(null);

  const data = clients.data;
  const adopted = data?.clients.filter((c) => c.adopted_at_ms != null) ?? [];
  /** 连着远程时，接管着却还指着本机网关的 */
  const leftBehind = remote ? adopted.filter((c) => c.endpoint != null && isLoopback(c.endpoint)) : [];

  async function ask(c: DetectedClient, restore: boolean) {
    setAsking(c.id);
    try {
      const plan = restore ? await api.planRestore(c.id) : await api.planAdopt(c.id);
      setDialog({ kind: "plan", id: c.id, restore, plan });
    } catch (e) {
      notify.error(e);
    } finally {
      setAsking(null);
    }
  }

  /**
   * 落盘。**成功之后不弹第二个对话框** —— 行上的状态会说「等待首个请求」。
   * 只有不至于失败、但用户该知道的事（符号链接、权限太松）才另说一句。
   */
  function apply(id: string, restore: boolean) {
    void confirm(async () => {
      const r = restore ? await api.restore(id) : await api.adopt(id);
      setDialog(null);
      if (r.warnings.length > 0) notify.info(r.warnings.map((w) => coreText(w)).join(" "));
      await clients.reload();
    });
  }

  function restoreAll() {
    void restoreAllRun(async () => {
      const rs = await api.restoreAll();
      const bad = rs.filter((r) => !r.ok);
      // **一个失败不影响其余的**，所以逐条报，不能只说「失败了」
      if (bad.length === 0) notify.success(t.restoredAll(rs.length));
      else notify.error(t.restoreFailed(bad));
      setDialog(null);
      await clients.reload();
    });
  }

  /** 还指着本机网关的，改为指向连着的那台服务器 */
  function retarget(serverName: string) {
    void retargetRun(async () => {
      const r = await api.retarget();
      setRetargeted(r.failed.length > 0 ? r : null);
      if (r.failed.length === 0) {
        if (r.synced.length > 0) notify.success(rt.retargeted(serverName, r.synced.map((s) => s.name)));
        else notify.info(rt.retargetNone);
      }
      await clients.reload();
    });
  }

  const byId = (id: string) => data?.clients.find((c) => c.id === id);
  const manualTarget = (id: string): ManualTarget | null => {
    const c = byId(id);
    if (c) return { id: c.id, name: c.name, setup: c.manual, key: c.key };
    const m = data?.manual.find((x) => x.id === id);
    return m ? { id: m.id, name: m.name, setup: m.setup, caveat: m.caveat, key: m.key } : null;
  };
  const detail = dialog?.kind === "detail" ? byId(dialog.id) : undefined;
  const planned = dialog?.kind === "plan" ? byId(dialog.id) : undefined;
  const manual = dialog?.kind === "manual" ? manualTarget(dialog.id) : null;

  const ctx: RowContext | null = data
    ? {
        usage: usage.byKey,
        busy,
        gatewayBase: data.gateway_base,
        remote: remote !== null,
        asking,
        actions: {
          details: (c) => setDialog({ kind: "detail", id: c.id }),
          adopt: (c) => void ask(c, false),
          restore: (c) => void ask(c, true),
          manual: (id) => setDialog({ kind: "manual", id }),
          reveal: (c) => void api.reveal(c.id).catch((e) => notify.error(e)),
          // 流量表的「密钥」一列就是密钥名
          traffic: (key) => nav.open("requests", { filter: { client: key } }),
          openKey: (key) => nav.open("keys", { key }),
        },
      }
    : null;

  return (
    <Page className="@container/page">
      <PageHeader
        title={title}
        summary={<Summary data={data} loading={clients.loading} remote={remote !== null} />}
        actions={
          // **退路要一直看得见。**用户敢按下「接管」的前提，就是看得见怎么退回去
          adopted.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "restoreAll" })}>
              {t.restoreAll}
            </Button>
          )
        }
      />

      {remote && data && (
        <Banner layout="inline" tone="info" icon={<IconRemote />} className="mb-3">
          {rt.clientsNote(remote.name, hostOf(data.gateway_base))}
        </Banner>
      )}
      <Banner
        show={remote !== null && leftBehind.length > 0}
        layout="inline"
        tone="warning"
        className="mb-3"
        actions={
          remote && (
            <Button size="sm" variant="outline" pending={retargeting} onClick={() => retarget(remote.name)}>
              {rt.retargetTo(remote.name)}
            </Button>
          )
        }
      >
        {leftBehind.length > 0 && rt.localLeft(leftBehind.length, hostOf(leftBehind[0]?.endpoint ?? ""))}
      </Banner>
      <Banner
        show={remote !== null && retargeted !== null}
        layout="inline"
        tone="error"
        className="mb-3"
        title={remote && rt.retargetFailedTitle(remote.name)}
      >
        <ul className="flex flex-col gap-0.5">
          {retargeted?.failed.map((f) => (
            <li key={f.client}>
              <span className="font-medium">{f.name}</span>
              {rt.sep}
              {coreText(f.error)}
            </li>
          ))}
        </ul>
      </Banner>

      <Loadable r={clients} loading={<RowsSkeleton rows={5} cols={5} />} errorTitle={t.loadFailed}>
        {(d) => ctx && <Body data={d} ctx={ctx} />}
      </Loadable>

      {detail && (
        <DetailDialog
          client={detail}
          keys={keys.data ?? []}
          usage={detail.key ? usage.byKey?.get(detail.key) : undefined}
          usageLoaded={usage.byKey !== undefined}
          gatewayBase={data?.gateway_base ?? ""}
          asking={asking === detail.id}
          onClose={() => setDialog(null)}
          onAdopt={() => void ask(detail, false)}
          onRestore={() => void ask(detail, true)}
        />
      )}

      {dialog?.kind === "plan" && planned && (
        <PlanDialog
          plan={dialog.plan}
          client={planned}
          restore={dialog.restore}
          pending={confirming}
          onCancel={() => setDialog(null)}
          onConfirm={() => apply(dialog.id, dialog.restore)}
        />
      )}

      {manual && (
        <ManualDialog
          target={manual}
          keys={keys.data ?? []}
          onClose={() => setDialog(null)}
          onKeyReady={() => {
            void clients.reload();
            void keys.reload();
          }}
        />
      )}

      {dialog?.kind === "restoreAll" && (
        <RestoreAllDialog
          adopted={adopted}
          gatewayBase={data?.gateway_base ?? ""}
          pending={restoringAll}
          onCancel={() => setDialog(null)}
          onConfirm={restoreAll}
        />
      )}
    </Page>
  );
}

/**
 * 表格和两组。检测到的客户端在最上面一张表里；需要手动配置的、没检测到的各是一组，
 * 可以收起。一个都没检测到时，上面那张表换成一句话。
 */
function Body({ data, ctx }: { data: ClientsResponse; ctx: RowContext }) {
  const t = useText(clientsText);
  const installed = data.clients.filter((c) => c.installed);
  const absent = data.clients.filter((c) => !c.installed);
  return (
    <>
      {installed.length > 0 ? (
        <DetectedTable clients={installed} ctx={ctx} head />
      ) : (
        <EmptyState
          variant="outlined"
          icon={<IconClient />}
          title={t.noneTitle}
          description={t.noneHint}
        />
      )}
      {data.manual.length > 0 && (
        <Section id="manual" title={t.manualTitle} count={data.manual.length} description={t.manualIntro}>
          <ManualTable manual={data.manual} ctx={ctx} />
        </Section>
      )}
      {absent.length > 0 && (
        <Section id="absent" title={t.absentTitle} count={absent.length} description={t.absentIntro}>
          <DetectedTable clients={absent} ctx={ctx} head={false} dim />
        </Section>
      )}
    </>
  );
}

/**
 * 页头那一行：各档各有几个。**只写不为零的档**；一个都没接管、也没有在用的，写一句
 * 「尚未接管客户端」和检测到几个 —— 不再跟一个「3 未接管」，那是同一件事说两遍。
 */
function Summary({
  data,
  loading,
  remote,
}: {
  data: ClientsResponse | undefined;
  /** 还在取。**取失败了不画骨架**：下面是一个报错，页头不该还像在等 */
  loading: boolean;
  remote: boolean;
}) {
  const t = useText(clientsText);
  const counts = useMemo(() => {
    const n: Record<ClientState, number> = { in_use: 0, waiting: 0, broken: 0, idle: 0, absent: 0 };
    if (!data) return n;
    const now = Date.now();
    for (const c of data.clients) n[statusOf(c, data.gateway_base, now, remote).state] += 1;
    for (const m of data.manual) {
      const s = manualStatusOf(m).state;
      // 手动配置、还没配的不算「未接管」：它们本来就接管不了
      if (s !== "idle") n[s] += 1;
    }
    return n;
  }, [data, remote]);
  if (!data) return loading ? <Skeleton className="my-1 h-3 w-56 rounded-sm" /> : null;
  const connected = counts.in_use + counts.waiting + counts.broken;
  if (connected === 0) {
    const detected = data.clients.filter((c) => c.installed).length;
    return (
      <>
        <span>{t.noneConnected}</span>
        {detected > 0 && (
          <span className="whitespace-nowrap">
            {t.nDetected(detected, <AnimatedNumber value={detected} className="tw-num font-medium text-foreground" />)}
          </span>
        )}
      </>
    );
  }
  return (
    <>
      {counts.in_use > 0 && (
        <SummaryItem lead={<StatusDot tone="ok" />} value={<AnimatedNumber value={counts.in_use} />} label={t.nInUse} />
      )}
      {counts.waiting > 0 && (
        <SummaryItem lead={<StatusDot tone="warn" />} value={<AnimatedNumber value={counts.waiting} />} label={t.nWaiting} />
      )}
      {counts.broken > 0 && (
        <SummaryItem lead={<StatusDot tone="error" />} value={<AnimatedNumber value={counts.broken} />} label={t.nBroken} />
      )}
      {counts.idle > 0 && (
        <SummaryItem lead={<StatusDot tone="idle" />} value={<AnimatedNumber value={counts.idle} />} label={t.nIdle} />
      )}
    </>
  );
}
