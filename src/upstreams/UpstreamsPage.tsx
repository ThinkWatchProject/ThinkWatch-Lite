import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ActivityIcon, NetworkIcon, PlusIcon, RefreshCwIcon, ServerIcon, ZapIcon } from "lucide-react";
import { invalidate, type Resource } from "@/lib/resource";
import { useNav, useNavParams } from "@/nav";
import { Banner } from "@/ui/banner";
import { Button } from "@/ui/button";
import { Count } from "@/ui/count";
import { AnimatedNumber } from "@/ui/motion";
import { notify, undoable, usePending } from "@/ui/notify";
import { Page, PageHeader } from "@/ui/page";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState } from "@/ui/states";
import { StatusDot } from "@/ui/status-dot";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { usd, type Overview, type PricingStatus, type ProviderView } from "@/types";
import { api, type UpstreamStats } from "./api";
import { ChatgptLoginDialog } from "./ChatgptLoginDialog";
import { patch, useAccountQuotas, useInFlight, usePricingStatus, useUpstreamStats } from "./data";
import { DeleteDialog, type Referrer } from "./DeleteDialog";
import { coreText, errorText, plain } from "./labels";
import { PriceSheetDialog, type PriceSheetDialogMode } from "./PriceSheetDialog";
import { PriceSheetTable } from "./PriceSheetTable";
import { ProxyDialog, type ProxyDialogMode } from "./ProxyDialog";
import { ProxyTable, type ProxyCheck } from "./ProxyTable";
import { LinkTestDialog, SpeedTestDialog, TestConnectionDialog } from "./TestDialogs";
import { UpstreamDialog, type UpstreamDialogMode } from "./UpstreamDialog";
import { formFromView, toInput } from "./upstreamForm";
import { upstreamsPageText } from "./UpstreamsPage.i18n";
import { UpstreamTable, problemsOf } from "./UpstreamTable";
import { ZaiLoginDialog } from "./ZaiLoginDialog";

export type UpstreamTab = "upstreams" | "proxies" | "pricing";

/**
 * 这次打开应用以来最后看的那个标签。切到别的页再回来，还停在那一个。
 * 不存盘：重新打开应用从上游开始。
 */
let lastTab: UpstreamTab = "upstreams";

type DialogState =
  | null
  | { kind: "upstream"; mode: UpstreamDialogMode }
  /** `relogin`：给已有的 ChatGPT 账号换一次凭据，名称和出站方式沿用它的 */
  | { kind: "chatgpt-login"; relogin?: { name: string; proxy: string } }
  | { kind: "zai-login" }
  | { kind: "delete-upstream"; name: string }
  | { kind: "test"; name: string }
  | { kind: "link"; provider: string | null }
  | { kind: "speed"; provider: string | null }
  | { kind: "proxy"; mode: ProxyDialogMode }
  | { kind: "delete-proxy"; name: string }
  | { kind: "sheet"; mode: PriceSheetDialogMode }
  | { kind: "delete-sheet"; name: string };

/**
 * 上游页：上游、代理、价目表三个标签。
 *
 * 三者描述出站侧的三个方面 —— 请求发往哪个服务、经过哪条网络路径、按什么
 * 价格结算 —— 而代理和价目表只被上游引用，所以放在同一页里，引用关系在
 * 页内闭合。**列表只读**，新建与编辑都在对话框里完成，一次保存一个版本。
 *
 * 页头的摘要说上游的整体状况：几个、几个正常、几个要处理，24 小时的请求与费用。
 */
export default function UpstreamsPage({
  ov,
  onChanged,
  onOpenConfigFile,
}: {
  ov: Overview;
  /** 写入之后让外面立刻重读概览 */
  onChanged: () => void;
  /** 打开配置文件，并定位到这个名字 */
  onOpenConfigFile: (focus: string | null) => void;
}) {
  const t = useText(upstreamsPageText);
  const c = useText(commonText);
  const nav = useNav();
  const configVersion = ov.config_version;
  const [tab, setTabState] = useState<UpstreamTab>(lastTab);
  const setTab = (next: UpstreamTab) => {
    lastTab = next;
    setTabState(next);
  };
  const [dialog, setDialog] = useState<DialogState>(null);
  const { stats, since } = useUpstreamStats();
  const pricing = usePricingStatus(configVersion);
  useAccountQuotas(ov.providers, () => void stats.reload());
  const inFlight = useInFlight();
  const proxies = ov.proxies;

  /**
   * 停用、启用是**乐观的**：先按新值画，写入回来、概览重读之后以概览为准。
   * 这里记的是「还没被概览证实的那几个」，概览对上了就撤掉。
   */
  const [pendingDisabled, setPendingDisabled] = useState<Record<string, boolean>>({});
  const providers = useMemo(
    () =>
      ov.providers.map((p) =>
        p.name in pendingDisabled ? { ...p, disabled: pendingDisabled[p.name]! } : p,
      ),
    [ov.providers, pendingDisabled],
  );
  useEffect(() => {
    const stale = Object.keys(pendingDisabled).filter((n) => {
      const p = ov.providers.find((x) => x.name === n);
      return !p || p.disabled === pendingDisabled[n];
    });
    if (stale.length === 0) return;
    setPendingDisabled((o) => {
      const next = { ...o };
      for (const n of stale) delete next[n];
      return next;
    });
  }, [ov.providers, pendingDisabled]);

  /*
    别的页和命令面板送来的（见 nav.tsx）。带着一个上游名打开：切到上游标签，那一行滚进
    视野、亮一下。打开这一页上的对话框：和点按钮、点那一行一样
  */
  const [focus, setFocus] = useState<{ name: string; at: number } | null>(null);
  useNavParams("upstreams", (p) => {
    if (p.upstream) {
      setTab("upstreams");
      setFocus({ name: p.upstream, at: Date.now() });
    }
    if (p.edit && ov.providers.some((x) => x.name === p.edit)) {
      setTab("upstreams");
      setDialog({ kind: "upstream", mode: { kind: "edit", name: p.edit } });
    } else if (p.create) {
      setTab(p.create === "proxy" ? "proxies" : p.create === "sheet" ? "pricing" : "upstreams");
      setDialog({ kind: p.create, mode: { kind: "create" } });
    } else if (p.test) {
      setTab("upstreams");
      setDialog({ kind: p.test, provider: null });
    }
  });

  /**
   * **打开这一页时补问模型清单**：还没有的、没问到的、过期的。
   *
   * 不等、不管结果 —— core 立刻回话，答案随 `models_changed` 一家一家地到，
   * 概览跟着重读。一分钟内问过的它自己会跳过，来回切页面不会每次都打网络。
   */
  useEffect(() => {
    api.refreshStaleModels().catch(() => {
      // 问不了（core 正在重启）就等后台那一轮，列表照常可用
    });
  }, []);

  const changed = () => {
    onChanged();
    void stats.reload();
  };

  async function toggle(p: ProviderView) {
    const saved = ov.providers.find((x) => x.name === p.name);
    if (!saved) return;
    const next = !p.disabled;
    // 撤销要基于这一次写入之后的版本，不然会被当成冲突
    let version = configVersion;
    const write = (disabled: boolean) =>
      api
        .updateProvider(saved.name, {
          provider: { ...toInput(formFromView(saved)), disabled },
          base_version: version,
        })
        .then((w) => {
          version = w.version;
        });
    await undoable({
      message: next ? t.disabledToast(p.name) : t.enabledToast(p.name),
      apply: () => {
        setPendingDisabled((o) => ({ ...o, [p.name]: next }));
        return () => setPendingDisabled((o) => ({ ...o, [p.name]: !next }));
      },
      do: () => write(next),
      undo: () => write(!next),
      after: changed,
    });
  }

  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(() => new Set());
  async function refreshModels(name: string) {
    setRefreshing((s) => new Set(s).add(name));
    try {
      const v = await api.refreshProviderModels(name);
      if (v.error) notify.error(v.error, t.modelsFailed(name));
      else notify.success(t.modelsFetched(name, v.models.length));
      invalidate(`upstream-models:${name}`);
      changed();
    } catch (e) {
      notify.error(e, t.modelsFailed(name));
    } finally {
      setRefreshing((s) => {
        const n = new Set(s);
        n.delete(name);
        return n;
      });
    }
  }

  const [checks, setChecks] = useState<Record<string, ProxyCheck>>({});
  async function testProxy(name: string) {
    const x = proxies.find((p) => p.name === name);
    if (!x) return;
    setChecks((prev) => ({ ...prev, [name]: { running: true } }));
    try {
      const result = await api.testProxy({
        proxy: { name: x.name, kind: x.kind, addr: x.addr, auth: x.auth },
        current: x.name,
      });
      setChecks((prev) => ({ ...prev, [name]: { running: false, result, at: Date.now() } }));
    } catch (e) {
      setChecks((prev) => ({
        ...prev,
        [name]: {
          running: false,
          result: { target: name, ok: false, segments: [], total_ms: 0, error: plain(errorText(e)) },
          at: Date.now(),
        },
      }));
    }
  }
  const [checkingAll, checkAll] = usePending();

  const [updatingPrices, updatePrices] = usePending();
  const refreshPrices = () =>
    updatePrices(async () => {
      try {
        const r = await api.refreshPricing();
        pricing.mutate(r.status);
        notify.success(r.changed > 0 ? t.pricesUpdated(r.changed) : t.pricesCurrent);
      } catch (e) {
        void pricing.reload();
        throw e;
      }
    });

  /**
   * 自动更新的开关：先按新值画、转圈；写成了就记下新值（配置换了版本，状态随之重读），
   * 失败拨回去并报错。
   */
  const [autoUpdate, setAutoUpdateState] = useState<boolean | null>(null);
  async function setAutoUpdate(on: boolean) {
    setAutoUpdateState(on);
    try {
      await api.setPriceAutoUpdate(on, configVersion);
      pricing.mutate(patch((s) => ({ ...s, auto_update: on })));
      onChanged();
    } catch (e) {
      notify.error(e);
    } finally {
      setAutoUpdateState(null);
    }
  }

  const createUpstream = () => setDialog({ kind: "upstream", mode: { kind: "create" } });
  const createProxy = () => setDialog({ kind: "proxy", mode: { kind: "create" } });

  const actions =
    tab === "upstreams" ? (
      <>
        {providers.length > 0 && (
          <>
            <HeaderAction
              icon={<ActivityIcon />}
              label={t.linkTest}
              onClick={() => setDialog({ kind: "link", provider: null })}
            />
            <HeaderAction
              icon={<ZapIcon />}
              label={t.speedTest}
              onClick={() => setDialog({ kind: "speed", provider: null })}
            />
          </>
        )}
        <Button size="sm" onClick={createUpstream}>
          <PlusIcon />
          {t.newUpstream}
        </Button>
      </>
    ) : tab === "proxies" ? (
      <>
        {proxies.length > 0 && (
          <HeaderAction
            icon={<ActivityIcon />}
            label={t.checkAll}
            pending={checkingAll}
            onClick={() =>
              void checkAll(async () => {
                // 逐个检测：并发时各自的握手耗时互相干扰
                for (const x of proxies) await testProxy(x.name);
              })
            }
          />
        )}
        <Button size="sm" onClick={createProxy}>
          <PlusIcon />
          {t.newProxy}
        </Button>
      </>
    ) : (
      <>
        <label className="mr-1 flex items-center gap-2 tw-body">
          <Switch
            checked={autoUpdate ?? pricing.data?.auto_update ?? true}
            pending={autoUpdate !== null}
            disabled={!pricing.data}
            onCheckedChange={(on) => void setAutoUpdate(on)}
          />
          {t.autoUpdate}
        </label>
        <HeaderAction
          icon={<RefreshCwIcon />}
          label={t.updateNow}
          pending={updatingPrices}
          onClick={() => void refreshPrices()}
        />
        <Button size="sm" onClick={() => setDialog({ kind: "sheet", mode: { kind: "create" } })}>
          <PlusIcon />
          {t.newSheet}
        </Button>
      </>
    );

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as UpstreamTab)} className="gap-0">
      {/* 具名容器：窄了之后页头的次要操作只画图标、表格收起走势（和密钥页同一个断点） */}
      <Page className="@container/page">
        <PageHeader
          title={t.title}
          summary={providers.length > 0 ? <Hero providers={providers} stats={stats} /> : undefined}
          actions={actions}
          tabs={
            <TabsList variant="line">
              <TabsTrigger value="upstreams">
                {t.tabs.upstreams} <Count n={providers.length} />
              </TabsTrigger>
              <TabsTrigger value="proxies">
                {t.tabs.proxies} <Count n={proxies.length} />
              </TabsTrigger>
              <TabsTrigger value="pricing">
                {t.tabs.pricing} <Count n={ov.price_sheets.length + 1} />
              </TabsTrigger>
            </TabsList>
          }
        />

        <TabsContent value="upstreams" className="flex flex-col gap-3 pt-4">
          <Banner
            show={stats.error !== undefined && stats.data === undefined}
            layout="inline"
            tone="warning"
            title={t.statsFailed}
            actions={
              <Button variant="outline" size="sm" pending={stats.loading} onClick={() => void stats.reload()}>
                {c.retry}
              </Button>
            }
          >
            {stats.error !== undefined ? errorText(stats.error) : null}
          </Banner>
          {providers.length === 0 ? (
            <EmptyState
              icon={<ServerIcon />}
              title={t.noUpstreams}
              description={t.noUpstreamsDesc}
              action={
                <Button size="sm" onClick={createUpstream}>
                  <PlusIcon />
                  {t.newUpstream}
                </Button>
              }
            />
          ) : (
            <UpstreamTable
              providers={providers}
              stats={stats}
              since={since}
              inFlight={inFlight}
              refreshing={refreshing}
              focus={focus}
              actions={{
                edit: (name) => setDialog({ kind: "upstream", mode: { kind: "edit", name } }),
                test: (name) => setDialog({ kind: "test", name }),
                linkTest: (name) => setDialog({ kind: "link", provider: name }),
                speedTest: (name) => setDialog({ kind: "speed", provider: name }),
                refreshModels: (name) => void refreshModels(name),
                editModels: (name) =>
                  setDialog({ kind: "upstream", mode: { kind: "edit", name, section: "models" } }),
                account: (name) =>
                  setDialog({ kind: "upstream", mode: { kind: "edit", name, section: "account" } }),
                traffic: (name) => nav.open("requests", { filter: { provider: name } }),
                toggle: (p) => void toggle(p),
                locate: (name) => onOpenConfigFile(name),
                remove: (name) => setDialog({ kind: "delete-upstream", name }),
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="proxies" className="pt-4">
          {proxies.length === 0 ? (
            <EmptyState
              icon={<NetworkIcon />}
              title={t.noProxies}
              description={t.noProxiesDesc}
              action={
                <Button size="sm" onClick={createProxy}>
                  <PlusIcon />
                  {t.newProxy}
                </Button>
              }
            />
          ) : (
            <ProxyTable
              proxies={proxies}
              providers={ov.providers}
              checks={checks}
              onEdit={(name) => setDialog({ kind: "proxy", mode: { kind: "edit", name } })}
              onTest={(name) => void testProxy(name)}
              onRemove={(name) => setDialog({ kind: "delete-proxy", name })}
            />
          )}
        </TabsContent>

        <TabsContent value="pricing" className="flex flex-col gap-3 pt-4">
          <PricingNotices
            ov={ov}
            status={pricing}
            updating={updatingPrices}
            onUpdate={() => void refreshPrices()}
            onSetPrices={(prefill) => setDialog({ kind: "sheet", mode: { kind: "create", prefill } })}
          />
          <PriceSheetTable
            ov={ov}
            status={pricing}
            onViewDefault={() => setDialog({ kind: "sheet", mode: { kind: "default" } })}
            onEdit={(name) => setDialog({ kind: "sheet", mode: { kind: "edit", name } })}
            onDuplicate={(name) => setDialog({ kind: "sheet", mode: { kind: "duplicate", from: name } })}
            onRemove={(name) => setDialog({ kind: "delete-sheet", name })}
          />
        </TabsContent>
      </Page>

      {dialog?.kind === "upstream" && (
        <UpstreamDialog
          mode={dialog.mode}
          ov={ov}
          configVersion={configVersion}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            // 新建的那一行自己会滑进来；改动未必看得出来，说一声
            if (dialog.mode.kind === "edit") notify.success(t.saved(name));
            changed();
          }}
          onChanged={changed}
          onChatgptLogin={(relogin) => setDialog({ kind: "chatgpt-login", relogin })}
          onZaiLogin={() => setDialog({ kind: "zai-login" })}
        />
      )}
      {dialog?.kind === "delete-upstream" && (
        <DeleteDialog
          what={t.what.upstream}
          name={dialog.name}
          referrers={(ov.providers.find((p) => p.name === dialog.name)?.references ?? []).map((ref) => ({
            kind: "reference" as const,
            ref,
          }))}
          consequence={t.upstreamGone}
          onDelete={async () => {
            await api.deleteProvider(dialog.name, configVersion);
            setDialog(null);
            changed();
          }}
          onClose={() => setDialog(null)}
          onShow={() => {
            setDialog(null);
            nav.open("routing");
          }}
        />
      )}
      {dialog?.kind === "chatgpt-login" && (
        <ChatgptLoginDialog
          ov={ov}
          relogin={dialog.relogin}
          onClose={() => setDialog(null)}
          onSaved={() => changed()}
        />
      )}
      {dialog?.kind === "zai-login" && (
        <ZaiLoginDialog ov={ov} onClose={() => setDialog(null)} onSaved={() => changed()} />
      )}
      {dialog?.kind === "test" && (
        <TestConnectionDialog ov={ov} name={dialog.name} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "link" && (
        <LinkTestDialog ov={ov} provider={dialog.provider} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "speed" && (
        <SpeedTestDialog ov={ov} preselect={dialog.provider} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "proxy" && (
        <ProxyDialog
          mode={dialog.mode}
          ov={ov}
          configVersion={configVersion}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            if (dialog.mode.kind === "edit") notify.success(t.saved(name));
            changed();
          }}
        />
      )}
      {dialog?.kind === "delete-proxy" && (
        <DeleteDialog
          what={t.what.proxy}
          name={dialog.name}
          referrers={(proxies.find((x) => x.name === dialog.name)?.used_by ?? []).map((name) => ({
            kind: "upstream" as const,
            name,
          }))}
          consequence={t.proxyGone}
          onDelete={async () => {
            await api.deleteProxy(dialog.name, configVersion);
            setDialog(null);
            changed();
          }}
          onClose={() => setDialog(null)}
          onShow={(r) => showUpstream(r, "connection")}
        />
      )}
      {dialog?.kind === "sheet" && (
        <PriceSheetDialog
          mode={dialog.mode}
          ov={ov}
          configVersion={configVersion}
          onClose={() => setDialog(null)}
          onSaved={(name) => {
            setDialog(null);
            if (dialog.mode.kind === "edit") notify.success(t.saved(name));
            // 配置换了版本，价目表的状态（无法计价的次数）随之重读
            changed();
          }}
          onDeleted={() => {
            setDialog(null);
            changed();
          }}
        />
      )}
      {dialog?.kind === "delete-sheet" && (
        <DeleteDialog
          what={t.what.sheet}
          name={dialog.name}
          referrers={(ov.price_sheets.find((s) => s.name === dialog.name)?.used_by ?? []).map((name) => ({
            kind: "upstream" as const,
            name,
          }))}
          consequence={t.sheetGone}
          onDelete={async () => {
            await api.deletePriceSheet(dialog.name, configVersion);
            setDialog(null);
            changed();
          }}
          onClose={() => setDialog(null)}
          onShow={(r) => showUpstream(r, "billing")}
        />
      )}
    </Tabs>
  );

  function showUpstream(r: Referrer, section: "connection" | "billing") {
    if (r.kind !== "upstream") return;
    setTab("upstreams");
    setDialog({ kind: "upstream", mode: { kind: "edit", name: r.name, section } });
  }
}

/**
 * 页头的摘要：几个上游、几个正常、几个要处理（凭据被拒、要重新登录、熔断）、
 * 几个停用，以及 24 小时的请求数和费用。数字变了走过去，不跳。
 *
 * 24 小时的两个数**读到之前不画**（画一截骨架）：从 0 滚到实际值像是在眼前涨了一截。
 */
function Hero({ providers, stats }: { providers: ProviderView[]; stats: Resource<UpstreamStats> }) {
  const t = useText(upstreamsPageText);
  const enabled = providers.filter((p) => !p.disabled);
  const attention = enabled.filter((p) => problemsOf(p).length > 0).length;
  const disabled = providers.length - enabled.length;
  const day = stats.data
    ? stats.data.costs.reduce(
        (a, c) => ({ requests: a.requests + c.requests, cost: a.cost + c.cost_micros }),
        { requests: 0, cost: 0 },
      )
    : null;
  return (
    <>
      <Fact>{t.hero.upstreams(<Num value={providers.length} />, providers.length)}</Fact>
      <Fact lead={<StatusDot tone="ok" />}>{t.hero.healthy(<Num value={enabled.length - attention} />)}</Fact>
      {attention > 0 && <Fact lead={<StatusDot tone="error" />}>{t.hero.attention(<Num value={attention} />, attention)}</Fact>}
      {disabled > 0 && <Fact lead={<StatusDot tone="idle" />}>{t.hero.disabled(<Num value={disabled} />)}</Fact>}
      {day ? (
        <>
          <Fact>{t.hero.requests(<Num value={day.requests} />, day.requests)}</Fact>
          <Fact>{t.hero.cost(<Num value={day.cost} format={(n) => usd(Math.round(n))} />)}</Fact>
        </>
      ) : (
        stats.loading && <Skeleton className="h-3 w-40 rounded-sm" />
      )}
    </>
  );
}

/**
 * 页头上的一个次要操作（测速、检测全部、立即更新）。
 *
 * **这一页窄了就只画图标**，名称进悬停：小窗口里三个带字的按钮会把左边的摘要挤成
 * 三四行，英文尤甚。两份都在，按容器宽度只显示其中一份 —— 不用量宽度，也没有
 * 「先画宽的、量完再换窄的」那一下闪；藏起来的那份不进读屏、不进 Tab 顺序。
 * 主操作（新建）始终写字。
 */
function HeaderAction({
  icon,
  label,
  pending = false,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <>
      <Button variant="outline" size="sm" pending={pending} className="@max-3xl/page:hidden" onClick={onClick}>
        {!pending && icon}
        {label}
      </Button>
      <Tip text={label}>
        <Button
          variant="outline"
          size="icon-sm"
          pending={pending}
          aria-label={label}
          className="hidden @max-3xl/page:inline-flex"
          onClick={onClick}
        >
          {!pending && icon}
        </Button>
      </Tip>
    </>
  );
}

/** 摘要里的一项：可选的状态点，加一句带数字的话。样子和 `SummaryItem` 一样 */
function Fact({ lead, children }: { lead?: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {lead}
      <span>{children}</span>
    </span>
  );
}

/** 摘要里的数：前景色、等宽，变化时走过去 */
function Num({ value, format }: { value: number; format?: (n: number) => ReactNode }) {
  return <AnimatedNumber value={value} format={format} className="font-medium text-foreground" />;
}

/**
 * 价目表标签顶上的几条：默认价目表读不到状态、上一次更新失败、最近有请求无法计价。
 * 都是持续成立的事，用横幅，不用吐司。读不到状态和「上游」标签读不到统计一样是
 * 琥珀：列表照常能用，只是少了几个数。
 */
function PricingNotices({
  ov,
  status,
  updating,
  onUpdate,
  onSetPrices,
}: {
  ov: Overview;
  status: Resource<PricingStatus>;
  updating: boolean;
  onUpdate: () => void;
  onSetPrices: (prefill: { models: string[]; usedBy: string[] }) => void;
}) {
  const t = useText(upstreamsPageText);
  const c = useText(commonText);
  const s = status.data;
  const unpriced = s && s.unpriced_recent > 0 ? s : null;
  return (
    <>
      <Banner
        show={status.error !== undefined && s === undefined}
        layout="inline"
        tone="warning"
        title={t.statusFailed}
        actions={
          <Button variant="outline" size="sm" pending={status.loading} onClick={() => void status.reload()}>
            {c.retry}
          </Button>
        }
      >
        {status.error !== undefined ? errorText(status.error) : null}
      </Banner>
      {/*
        更新失败时仍按上一次拉到的价格计价（琥珀）；**一次都没拉到过**才是真坏了 ——
        那时按量计费的请求全都无法计价（红）
      */}
      <Banner
        show={!!s?.error}
        layout="inline"
        tone={s?.source === "empty" ? "error" : "warning"}
        title={t.updateFailedTitle}
        actions={
          <Button variant="outline" size="sm" pending={updating} onClick={onUpdate}>
            {c.retry}
          </Button>
        }
      >
        {s?.error ? coreText(s.error) : null}
      </Banner>
      <Banner
        show={unpriced !== null}
        layout="inline"
        tone="warning"
        title={unpriced ? t.unpricedTitle(unpriced.unpriced_recent) : null}
        actions={
          unpriced && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onSetPrices({
                  models: [...new Set(unpriced.unpriced_models.map((u) => u.model))],
                  // 只预选还在用默认价目表的上游。已选了自定义价目表的，改用新表
                  // 会连带改掉它其余模型的价格 —— 那一家留给用户自己决定
                  usedBy: [...new Set(unpriced.unpriced_models.map((u) => u.provider))].filter((n) =>
                    ov.providers.some((p) => p.name === n && !p.pricing),
                  ),
                })
              }
            >
              {t.setPrices}
            </Button>
          )
        }
      >
        {unpriced && (
          <>
            {t.unpricedModels}{" "}
            {unpriced.unpriced_models.slice(0, 4).map((u, i) => (
              <span key={`${u.provider}/${u.model}`}>
                {i > 0 && t.listSep}
                <span className="font-mono">{u.model}</span>
                {t.provider(u.provider)}
              </span>
            ))}
            {unpriced.unpriced_models.length > 4 && t.more(unpriced.unpriced_models.length, 4)}
            {t.unpricedEnd}
          </>
        )}
      </Banner>
    </>
  );
}
