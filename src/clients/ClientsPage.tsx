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
import { useNav, useNavParams } from "@/nav";
import { useText } from "@/i18n";
import { coreText } from "@/i18n/core.i18n";
import { appText } from "@/App.i18n";
import type { ClientsResponse, DetectedClient, PlanView, Retargeted, WslGroup } from "@/types";
import { useRemote } from "@/connection/useRemote";
import { remoteText } from "@/connection/remote.i18n";
import { useKeys, useKeyUsage } from "@/keys/data";
import { CopyIconButton, RowsSkeleton } from "@/keys/parts";
import { api } from "./api";
import { clientsText } from "./clients.i18n";
import { DetectedTable, ManualTable, Section, type RowContext } from "./ClientsTable";
import { useClients, useWsl } from "./data";
import { DetailDialog } from "./DetailDialog";
import { ManualDialog, type ManualTarget } from "./ManualDialog";
import { PlanDialog } from "./PlanDialog";
import { RestoreAllDialog } from "./RestoreAllDialog";
import { hostOf, isLoopback, manualStatusOf, statusOf, type ClientState, type Status } from "./status";

/** `env`：在哪个 WSL 发行版里（发行版的名字）；这台电脑上的不带 */
type DialogState =
  | null
  | { kind: "detail"; id: string; env?: string }
  | { kind: "plan"; id: string; env?: string; restore: boolean; plan: PlanView }
  | { kind: "manual"; id: string; env?: string }
  | { kind: "restoreAll" };

/** 一个客户端，连同它在哪一处、那一处该连的地址 */
interface Located {
  /** 名字里带着发行版（对话框里要分得清是哪一份） */
  c: DetectedClient;
  env?: string;
  base: string;
  stale: boolean;
}

/** 正在取方案的那一个的标识：同一个客户端在这台电脑上和 WSL 里是两份 */
const slot = (id: string, env?: string) => (env ? `${env}/${id}` : id);

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
  /** WSL 里的那几组。**不跟着请求刷新**（读它会唤醒发行版），动过之后才重取 */
  const wsl = useWsl();
  const groups = wsl.data?.distros ?? [];
  const keys = useKeys();
  const usage = useKeyUsage();
  const [dialog, setDialog] = useState<DialogState>(null);
  /** 正在取接管方案的那一个：它的按钮转圈 */
  const [asking, setAsking] = useState<string | null>(null);
  const [confirming, confirm] = usePending();
  const [restoringAll, restoreAllRun] = usePending();
  const [retargeting, retargetRun] = usePending();
  /** 正在「重新指向」的那个发行版 */
  const [readdressing, setReaddressing] = useState<string | null>(null);
  /** 「改为指向服务器」有没改成的：留在页上，直到再改一次或者离开这一页 */
  const [retargeted, setRetargeted] = useState<Retargeted | null>(null);
  // 命令面板送来的：打开这一行的详情或手动配置，和点那一行一样（见 nav.tsx）
  useNavParams("clients", (p) => {
    if (p.detail) setDialog({ kind: "detail", id: p.detail });
    else if (p.setup) setDialog({ kind: "manual", id: p.setup });
  });

  const data = clients.data;
  const adopted = data?.clients.filter((c) => c.adopted_at_ms != null) ?? [];
  /** 全部还原会还原的：这台电脑上的，加上各个 WSL 发行版里的 */
  const adoptedEverywhere: { key: string; client: DetectedClient; status: Status }[] = [
    ...adopted.map((c) => ({
      key: c.id,
      client: c,
      status: statusOf(c, data?.gateway_base ?? "", Date.now(), remote !== null),
    })),
    ...groups.flatMap((g) =>
      g.clients
        .filter((c) => c.adopted_at_ms != null)
        .map((c) => ({
          key: slot(c.id, g.distro),
          client: { ...c, name: t.inWsl(c.name, g.distro) },
          status: statusOf(c, g.gateway_base, Date.now(), remote !== null, g.stale.includes(c.id)),
        })),
    ),
  ];
  /** 配置里的模型清单跟网关对不上了（opencode）：更新走的是接管那一遍「差异 → 确认 → 写入」 */
  const staleModels = data?.clients.filter((c) => c.models_stale) ?? [];
  /** 连着远程时，接管着却还指着本机网关的 */
  const leftBehind = remote ? adopted.filter((c) => c.endpoint != null && isLoopback(c.endpoint)) : [];

  async function ask(c: DetectedClient, restore: boolean, env?: string) {
    setAsking(slot(c.id, env));
    try {
      const plan = restore ? await api.planRestore(c.id, env) : await api.planAdopt(c.id, env);
      setDialog({ kind: "plan", id: c.id, env, restore, plan });
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
  function apply(id: string, restore: boolean, env?: string) {
    void confirm(async () => {
      const r = restore ? await api.restore(id, env) : await api.adopt(id, env);
      setDialog(null);
      if (r.warnings.length > 0) notify.info(r.warnings.map((w) => coreText(w)).join(" "));
      // 接管 WSL 里的那一份会用掉一把新密钥，这台电脑上的列表里密钥名也跟着变
      await Promise.all([clients.reload(), env ? wsl.reload() : undefined]);
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
      await Promise.all([clients.reload(), groups.length > 0 ? wsl.reload() : undefined]);
    });
  }

  /** 一个 WSL 发行版里还指着旧地址的，改为指向此刻该连的那一个 */
  async function readdress(distro: string) {
    setReaddressing(distro);
    try {
      const r = await api.retargetWsl(distro);
      if (r.failed.length > 0) {
        notify.error(`${t.readdressFailed}: ${r.failed.map((f) => `${f.name} (${coreText(f.error)})`).join("; ")}`);
      } else if (r.synced.length > 0) {
        notify.success(t.readdressed(r.synced.map((x) => x.name)));
      }
      await wsl.reload();
    } catch (e) {
      notify.error(e);
    } finally {
      setReaddressing(null);
    }
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

  const locate = (id: string, env?: string): Located | undefined => {
    if (!env) {
      const c = data?.clients.find((x) => x.id === id);
      return c && data ? { c, base: data.gateway_base, stale: false } : undefined;
    }
    const g = groups.find((x) => x.distro === env);
    const c = g?.clients.find((x) => x.id === id);
    return g && c
      ? { c: { ...c, name: t.inWsl(c.name, g.distro) }, env, base: g.gateway_base, stale: g.stale.includes(id) }
      : undefined;
  };
  const manualTarget = (id: string, env?: string): ManualTarget | null => {
    const l = locate(id, env);
    if (l) {
      const listen = env ? groups.find((x) => x.distro === env)?.listen : undefined;
      return { id: l.c.id, name: l.c.name, setup: l.c.manual, key: l.c.key, env, listen };
    }
    const m = env ? undefined : data?.manual.find((x) => x.id === id);
    return m ? { id: m.id, name: m.name, setup: m.setup, caveat: m.caveat, key: m.key } : null;
  };
  const detail = dialog?.kind === "detail" ? locate(dialog.id, dialog.env) : undefined;
  const planned = dialog?.kind === "plan" ? locate(dialog.id, dialog.env) : undefined;
  const manual = dialog?.kind === "manual" ? manualTarget(dialog.id, dialog.env) : null;

  /** 一处（这台电脑，或者一个 WSL 发行版）的表格要用的东西。行上的操作都带着 `env` */
  const ctxFor = (
    gatewayBase: string,
    ids: string[],
    env?: string,
    stale?: ReadonlySet<string>,
  ): RowContext => ({
    usage: usage.byKey,
    busy,
    gatewayBase,
    remote: remote !== null,
    // 表格按客户端 id 认转圈的那一个：只认这一处的
    asking: asking === null ? null : (ids.find((id) => slot(id, env) === asking) ?? null),
    stale,
    actions: {
      details: (c) => setDialog({ kind: "detail", id: c.id, env }),
      adopt: (c) => void ask(c, false, env),
      restore: (c) => void ask(c, true, env),
      manual: (id) => setDialog({ kind: "manual", id, env }),
      reveal: (c) => void api.reveal(c.id, env).catch((e) => notify.error(e)),
      // 流量表的「密钥」一列就是密钥名
      traffic: (key) => nav.open("requests", { filter: { client: key } }),
      openKey: (key) => nav.open("keys", { key }),
    },
  });
  const ctx: RowContext | null = data ? ctxFor(data.gateway_base, data.clients.map((c) => c.id)) : null;

  return (
    <Page className="@container/page">
      <PageHeader
        title={title}
        summary={<Summary data={data} groups={groups} loading={clients.loading} remote={remote !== null} />}
        actions={
          // **退路要一直看得见。**用户敢按下「接管」的前提，就是看得见怎么退回去
          adoptedEverywhere.length > 0 && (
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

      {staleModels.map((c) => (
        <Banner
          key={c.id}
          layout="inline"
          tone="warning"
          className="mb-3"
          actions={
            <Button size="sm" variant="outline" pending={asking === c.id} onClick={() => void ask(c, false)}>
              {t.updateModels}
            </Button>
          }
        >
          {t.modelsStale(c.name)}
        </Banner>
      ))}

      <Loadable r={clients} loading={<RowsSkeleton rows={5} cols={5} />} errorTitle={t.loadFailed}>
        {(d) =>
          ctx && (
            <>
              {/* 有 WSL 时分组：先是这台电脑，再是每个发行版 */}
              {groups.length > 0 && <h2 className="mb-3 tw-head text-foreground">{t.thisComputer}</h2>}
              <Body data={d} ctx={ctx} />
              {groups.map((g) => (
                <WslSection
                  key={g.distro}
                  group={g}
                  ctx={ctxFor(
                    g.gateway_base,
                    g.clients.map((c) => c.id),
                    g.distro,
                    new Set(g.stale),
                  )}
                  readdressing={readdressing === g.distro}
                  onReaddress={() => void readdress(g.distro)}
                />
              ))}
            </>
          )
        }
      </Loadable>

      {detail && (
        <DetailDialog
          client={detail.c}
          keys={keys.data ?? []}
          usage={detail.c.key ? usage.byKey?.get(detail.c.key) : undefined}
          usageLoaded={usage.byKey !== undefined}
          gatewayBase={detail.base}
          env={detail.env}
          stale={detail.stale}
          asking={asking === slot(detail.c.id, detail.env)}
          onClose={() => setDialog(null)}
          onAdopt={() => void ask(detail.c, false, detail.env)}
          onRestore={() => void ask(detail.c, true, detail.env)}
        />
      )}

      {dialog?.kind === "plan" && planned && (
        <PlanDialog
          plan={dialog.plan}
          client={planned.c}
          restore={dialog.restore}
          pending={confirming}
          onCancel={() => setDialog(null)}
          onConfirm={() => apply(dialog.id, dialog.restore, dialog.env)}
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
            if (manual.env) void wsl.reload();
          }}
          onListenChanged={() => void wsl.reload()}
        />
      )}

      {dialog?.kind === "restoreAll" && (
        <RestoreAllDialog
          adopted={adoptedEverywhere}
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
 * 「WSL · <发行版>」那一组：可以收起，和上面几组一样。
 *
 * 组名下面一句说它经由哪个地址连网关（按网络模式）。读不到这个发行版、找不到 WSL
 * 的虚拟网卡、防火墙缺规则、有客户端还指着 WSL 重启前的地址，各在表格上面说一句，
 * 能动手的给一个按钮。
 */
function WslSection({
  group: g,
  ctx,
  readdressing,
  onReaddress,
}: {
  group: WslGroup;
  ctx: RowContext;
  readdressing: boolean;
  onReaddress: () => void;
}) {
  const t = useText(clientsText);
  const installed = g.clients.filter((c) => c.installed);
  const absent = g.clients.filter((c) => !c.installed);
  const description = g.error
    ? t.wslUnreadable
    : g.gateway_base
      ? t.wslIntro(g.network, hostOf(g.gateway_base))
      : t.wslIntroNoHost;
  return (
    <Section id={`wsl.${g.distro}`} title={t.wslGroup(g.distro)} count={installed.length} description={description}>
      <div className="flex flex-col gap-3">
        {g.error && (
          <Banner layout="inline" tone="warning">
            {coreText(g.error)}
          </Banner>
        )}
        {g.base_error && (
          <Banner layout="inline" tone="warning">
            {coreText(g.base_error)}
          </Banner>
        )}
        {g.firewall && (
          <Banner layout="inline" tone="warning" title={t.firewallTitle}>
            <p>{t.firewallBody}</p>
            <div className="mt-1.5 flex items-start gap-1">
              <code className="min-w-0 flex-1 font-mono tw-label break-all select-text">{g.firewall}</code>
              <CopyIconButton
                label={t.copyCommand}
                onCopy={() =>
                  api.copyFirewall().catch((e: unknown) => {
                    notify.error(e);
                    throw e;
                  })
                }
              />
            </div>
          </Banner>
        )}
        {g.stale.length > 0 && (
          <Banner
            layout="inline"
            tone="warning"
            actions={
              <Button size="sm" variant="outline" pending={readdressing} onClick={onReaddress}>
                {t.readdress}
              </Button>
            }
          >
            {t.wslStale(g.stale.length)}
          </Banner>
        )}
        {!g.error && (
          <>
            {installed.length > 0 && <DetectedTable clients={installed} ctx={ctx} head={false} />}
            {absent.length > 0 && <DetectedTable clients={absent} ctx={ctx} head={false} dim />}
          </>
        )}
      </div>
    </Section>
  );
}

/**
 * 页头那一行：各档各有几个。**只写不为零的档**；一个都没接管、也没有在用的，写一句
 * 「尚未接管客户端」和检测到几个 —— 不再跟一个「3 未接管」，那是同一件事说两遍。
 */
function Summary({
  data,
  groups,
  loading,
  remote,
}: {
  data: ClientsResponse | undefined;
  /** WSL 里的那几组：它们的客户端也算进各档 */
  groups: WslGroup[];
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
    for (const g of groups) {
      for (const c of g.clients) n[statusOf(c, g.gateway_base, now, remote, g.stale.includes(c.id)).state] += 1;
    }
    for (const m of data.manual) {
      const s = manualStatusOf(m).state;
      // 手动配置、还没配的不算「未接管」：它们本来就接管不了
      if (s !== "idle") n[s] += 1;
    }
    return n;
  }, [data, groups, remote]);
  if (!data) return loading ? <Skeleton className="my-1 h-3 w-56 rounded-sm" /> : null;
  const connected = counts.in_use + counts.waiting + counts.broken;
  if (connected === 0) {
    const detected =
      data.clients.filter((c) => c.installed).length +
      groups.reduce((n, g) => n + g.clients.filter((c) => c.installed).length, 0);
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
