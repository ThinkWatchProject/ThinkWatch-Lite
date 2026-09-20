import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIcon, CircleAlertIcon, PlusIcon, RefreshCwIcon, ServerIcon, ZapIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { Switch } from "@/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/tabs";
import { useText } from "@/i18n";
import type { ChatgptUsage, Overview, PricingStatus } from "@/types";
import { api, type UpstreamStats } from "./api";
import { ChatgptLoginDialog } from "./ChatgptLoginDialog";
import { DeleteDialog, type Referrer } from "./DeleteDialog";
import { when } from "@/format";
import { errorText } from "./labels";
import { PriceSheetDialog, type PriceSheetDialogMode } from "./PriceSheetDialog";
import { PriceSheetTable } from "./PriceSheetTable";
import { ProxyDialog, type ProxyDialogMode } from "./ProxyDialog";
import { ProxyTable, type ProxyCheck } from "./ProxyTable";
import { LinkTestDialog, SpeedTestDialog, TestConnectionDialog } from "./TestDialogs";
import { UpstreamDialog, type UpstreamDialogMode } from "./UpstreamDialog";
import { formFromView, toInput } from "./upstreamForm";
import { upstreamsPageText } from "./UpstreamsPage.i18n";
import { UpstreamTable } from "./UpstreamTable";
import { plain } from "@/i18n/core.i18n";

export type UpstreamTab = "upstreams" | "proxies" | "pricing";

type DialogState =
  | null
  | { kind: "upstream"; mode: UpstreamDialogMode }
  /** `relogin`：给已有的 ChatGPT 账号换一次凭据，名称和出站方式沿用它的 */
  | { kind: "chatgpt-login"; relogin?: { name: string; proxy: string } }
  | { kind: "delete-upstream"; name: string }
  | { kind: "test"; name: string }
  | { kind: "link"; provider: string | null }
  | { kind: "speed"; provider: string | null }
  | { kind: "proxy"; mode: ProxyDialogMode }
  | { kind: "delete-proxy"; name: string }
  | { kind: "sheet"; mode: PriceSheetDialogMode }
  | { kind: "delete-sheet"; name: string };

const DAY_MS = 24 * 3_600_000;

/**
 * 上游页：上游、代理、价目表三个标签。
 *
 * 三者描述出站侧的三个方面 —— 请求发往哪个服务、经过哪条网络路径、按什么
 * 价格结算 —— 而代理和价目表只被上游引用，所以放在同一页里，引用关系在
 * 页内闭合。**列表只读**，新建与编辑都在对话框里完成，一次保存一个版本。
 */
export default function UpstreamsPage({
  ov,
  configVersion,
  initialTab = "upstreams",
  onChanged,
  onOpenConfigFile,
  onNavigate,
}: {
  ov: Overview;
  configVersion: string | null;
  initialTab?: UpstreamTab;
  /** 写入之后让外面立刻重读概览 */
  onChanged: () => void;
  /** 打开配置文件，并定位到这个名字 */
  onOpenConfigFile: (focus: string | null) => void;
  /** 跳到别的页（路由、防护） */
  onNavigate: (tab: string) => void;
}) {
  const t = useText(upstreamsPageText);
  const [tab, setTab] = useState<UpstreamTab>(initialTab);
  const [stats, setStats] = useState<UpstreamStats | null>(null);
  const [status, setStatus] = useState<PricingStatus | null>(null);
  const [checks, setChecks] = useState<Record<string, ProxyCheck>>({});
  const [dialog, setDialog] = useState<DialogState>(null);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const proxies = ov.proxies ?? [];

  const loadStats = useCallback(() => {
    api
      .upstreamStats(Date.now() - DAY_MS)
      .then(setStats)
      .catch(() => {
        // 统计拿不到时这几列显示「—」，列表照常可用
      });
  }, []);
  const loadStatus = useCallback(() => {
    api
      .pricingStatus()
      .then(setStatus)
      .catch((e) => toast.error(errorText(e)));
  }, []);

  useEffect(() => {
    loadStats();
    const t = setInterval(loadStats, 30_000);
    return () => clearInterval(t);
  }, [loadStats]);

  /**
   * 账号类上游：**打开这一页时问一次它自己。**
   *
   * 一次问答同时回答三件事：登的是哪个账号、什么套餐、额度还剩多少。
   * 这三件都不在配置里 —— 额度平时是跟着真实流量白捡的，所以刚启动、
   * 或者这个账号今天还没被用过时，不问就什么都没有。
   *
   * **每个上游只问一次。**问一次是一次真实调用；失败了也不再问 —— 连不上时
   * 三十秒重试一轮，只会把错误刷满日志。
   */
  const [accounts, setAccounts] = useState<Record<string, ChatgptUsage>>({});
  const askedUsage = useRef(new Set<string>());
  useEffect(() => {
    const fresh = ov.providers.filter(
      (p) => p.protocol === "chatgpt" && !p.disabled && !askedUsage.current.has(p.name),
    );
    if (fresh.length === 0) return;
    fresh.forEach((p) => askedUsage.current.add(p.name));
    void Promise.all(
      fresh.map((p) =>
        api
          .chatgptUsage(p.name)
          .then((u) => [p.name, u] as const)
          .catch(() => null),
      ),
    ).then((rs) => {
      const got = rs.filter((r) => r !== null);
      if (got.length === 0) return;
      setAccounts((a) => ({ ...a, ...Object.fromEntries(got) }));
      // 额度 core 那边也记下了，从它再读一遍，免得这里和它各存一份
      loadStats();
    });
  }, [ov.providers, loadStats]);
  useEffect(() => {
    loadStatus();
  }, [loadStatus, configVersion]);

  /**
   * **打开这一页时补问模型清单**：还没有的、没问到的、过期的。
   *
   * 不等、不管结果 —— core 立刻回话，答案随 `models_changed` 一家一家地到，
   * 概览跟着重读。一分钟内问过的它自己会跳过，来回切页面不会每次都打网络。
   * 以前要「编辑 → 模型 → 刷新」才看得到的东西，现在进页面就有。
   */
  useEffect(() => {
    api.refreshStaleModels().catch(() => {
      // 问不了（core 正在重启）就等后台那一轮，列表照常可用
    });
  }, []);

  const changed = () => {
    onChanged();
    loadStats();
  };

  async function toggle(name: string) {
    const p = ov.providers.find((x) => x.name === name);
    if (!p) return;
    try {
      await api.updateProvider(p.name, {
        provider: { ...toInput(formFromView(p), true), disabled: !p.disabled },
        base_version: configVersion ?? undefined,
      });
      changed();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function refreshModels(name: string) {
    try {
      const v = await api.refreshProviderModels(name);
      if (v.error) toast.error(t.modelsError(name, v.error));
      changed();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function testProxy(name: string) {
    const x = proxies.find((p) => p.name === name);
    if (!x) return;
    setChecks((c) => ({ ...c, [name]: { running: true } }));
    try {
      const result = await api.testProxy({
        proxy: { name: x.name, kind: x.kind, addr: x.addr, auth: { mode: "keep" } },
        current: x.name,
      });
      setChecks((c) => ({ ...c, [name]: { running: false, result } }));
    } catch (e) {
      setChecks((c) => ({
        ...c,
        [name]: {
          running: false,
          result: { target: name, ok: false, segments: [], total_ms: 0, error: plain(errorText(e)) },
        },
      }));
    }
  }

  async function testAllProxies() {
    // 逐个检测：并发时各自的握手耗时互相干扰
    for (const x of proxies) await testProxy(x.name);
  }

  async function refreshPrices() {
    setRefreshingPrices(true);
    try {
      const r = await api.refreshPricing();
      setStatus(r.status);
      toast.success(r.changed > 0 ? t.pricesUpdated(r.changed) : t.pricesCurrent);
    } catch (e) {
      toast.error(errorText(e));
      loadStatus();
    } finally {
      setRefreshingPrices(false);
    }
  }

  async function setAutoUpdate(on: boolean) {
    try {
      await api.setPriceAutoUpdate(on, configVersion);
      onChanged();
      loadStatus();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  const quotaSeen = (name: string) => !!stats?.quotas.some((q) => q.provider === name);

  return (
    <div className="flex flex-col gap-4 p-5">
      <Tabs value={tab} onValueChange={(v) => setTab(v as UpstreamTab)}>
        <div className="flex flex-wrap items-center gap-2">
          <TabsList>
            <TabsTrigger value="upstreams">
              {t.tabs.upstreams} <Count n={ov.providers.length} />
            </TabsTrigger>
            <TabsTrigger value="proxies">
              {t.tabs.proxies} <Count n={proxies.length} />
            </TabsTrigger>
            <TabsTrigger value="pricing">
              {t.tabs.pricing} <Count n={ov.price_sheets.length + 1} />
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          {tab === "upstreams" && ov.providers.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "link", provider: null })}>
                <ActivityIcon />
                {t.linkTest}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "speed", provider: null })}>
                <ZapIcon />
                {t.speedTest}
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: "upstream", mode: { kind: "create" } })}>
                <PlusIcon />
                {t.newUpstream}
              </Button>
            </>
          )}
          {tab === "proxies" && (
            <>
              {proxies.length > 0 && (
                <Button variant="outline" size="sm" onClick={testAllProxies}>
                  <ActivityIcon />
                  {t.checkAll}
                </Button>
              )}
              <Button size="sm" onClick={() => setDialog({ kind: "proxy", mode: { kind: "create" } })}>
                <PlusIcon />
                {t.newProxy}
              </Button>
            </>
          )}
          {tab === "pricing" && (
            <>
              <label className="flex items-center gap-2 tw-body">
                <Switch
                  checked={status?.auto_update ?? true}
                  disabled={!status}
                  onCheckedChange={setAutoUpdate}
                />
                {t.autoUpdate}
              </label>
              <Button variant="outline" size="sm" onClick={refreshPrices} disabled={refreshingPrices}>
                {refreshingPrices ? <Spinner /> : <RefreshCwIcon />}
                {t.updateNow}
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: "sheet", mode: { kind: "create" } })}>
                <PlusIcon />
                {t.newSheet}
              </Button>
            </>
          )}
        </div>

        <TabsContent value="upstreams" className="mt-2">
          {ov.providers.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ServerIcon />
                </EmptyMedia>
                <EmptyTitle>{t.noUpstreams}</EmptyTitle>
                <EmptyDescription>{t.noUpstreamsDesc}</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {/* 服务类型在新建对话框的第一栏里选，这里不再平铺一排预设 */}
                <Button size="sm" onClick={() => setDialog({ kind: "upstream", mode: { kind: "create" } })}>
                  <PlusIcon />
                  {t.newUpstream}
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <UpstreamTable
              ov={ov}
              stats={stats}
              accounts={accounts}
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
                toggle: (p) => void toggle(p.name),
                locate: (name) => onOpenConfigFile(name),
                remove: (name) => setDialog({ kind: "delete-upstream", name }),
              }}
            />
          )}
        </TabsContent>

        <TabsContent value="proxies" className="mt-2">
          {proxies.length === 0 ? (
            <Empty className="border border-dashed">
              <EmptyHeader>
                <EmptyTitle>{t.noProxies}</EmptyTitle>
                <EmptyDescription>{t.noProxiesDesc}</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ProxyTable
              proxies={proxies}
              checks={checks}
              onEdit={(name) => setDialog({ kind: "proxy", mode: { kind: "edit", name } })}
              onTest={(name) => void testProxy(name)}
              onRemove={(name) => setDialog({ kind: "delete-proxy", name })}
            />
          )}
        </TabsContent>

        <TabsContent value="pricing" className="mt-2 flex flex-col gap-3">
          {status && (
            <p className="tw-label text-muted-foreground">
              {t.dataDate(status.date || "—")}
              {status.checked_at_ms != null && ` · ${t.lastChecked(when(status.checked_at_ms))}`}
              {status.error && <span className="text-destructive"> · {t.updateFailed(status.error)}</span>}
            </p>
          )}
          {status && status.unpriced_recent > 0 && (
            <Alert variant="warning">
              <CircleAlertIcon />
              <AlertTitle>{t.unpricedTitle(status.unpriced_recent)}</AlertTitle>
              <AlertDescription>
                {t.unpricedModels}{" "}
                {status.unpriced_models.slice(0, 4).map((u, i) => (
                  <span key={`${u.provider}/${u.model}`}>
                    {i > 0 && t.listSep}
                    <span className="font-mono">{u.model}</span>
                    {t.provider(u.provider)}
                  </span>
                ))}
                {status.unpriced_models.length > 4 && t.more(status.unpriced_models.length, 4)}
                {t.unpricedEnd}
              </AlertDescription>
              <AlertAction>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDialog({
                      kind: "sheet",
                      mode: {
                        kind: "create",
                        prefill: {
                          models: [...new Set(status.unpriced_models.map((u) => u.model))],
                          // 只预选还在用默认价目表的上游。已选了自定义价目表的，改用新表
                          // 会连带改掉它其余模型的价格 —— 那一家留给用户自己决定
                          usedBy: [...new Set(status.unpriced_models.map((u) => u.provider))].filter((n) =>
                            ov.providers.some((p) => p.name === n && !p.pricing),
                          ),
                        },
                      },
                    })
                  }
                >
                  {t.setPrices}
                </Button>
              </AlertAction>
            </Alert>
          )}
          <PriceSheetTable
            ov={ov}
            status={status}
            onViewDefault={() => setDialog({ kind: "sheet", mode: { kind: "default" } })}
            onEdit={(name) => setDialog({ kind: "sheet", mode: { kind: "edit", name } })}
            onDuplicate={(name) => setDialog({ kind: "sheet", mode: { kind: "duplicate", from: name } })}
            onRemove={(name) => setDialog({ kind: "delete-sheet", name })}
          />
        </TabsContent>
      </Tabs>

      {dialog?.kind === "upstream" && (
        <UpstreamDialog
          mode={dialog.mode}
          ov={ov}
          configVersion={configVersion}
          quotaSeen={dialog.mode.kind === "edit" && quotaSeen(dialog.mode.name)}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            changed();
          }}
          onChanged={changed}
          onGoToGuard={() => {
            setDialog(null);
            onNavigate("guard");
          }}
          onChatgptLogin={(relogin) => setDialog({ kind: "chatgpt-login", relogin })}
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
            onNavigate("routing");
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
      {dialog?.kind === "test" && (
        <TestConnectionDialog ov={ov} name={dialog.name} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "link" && (
        <LinkTestDialog provider={dialog.provider} onClose={() => setDialog(null)} />
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
          onSaved={() => {
            setDialog(null);
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
          onSaved={() => {
            setDialog(null);
            changed();
            loadStatus();
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
    </div>
  );

  function showUpstream(r: Referrer, section: "connection" | "billing") {
    if (r.kind !== "upstream") return;
    setTab("upstreams");
    setDialog({ kind: "upstream", mode: { kind: "edit", name: r.name, section } });
  }
}

function Count({ n }: { n: number }) {
  return <span className="tw-label tabular-nums text-muted-foreground">{n}</span>;
}
