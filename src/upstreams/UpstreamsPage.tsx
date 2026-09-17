import { useCallback, useEffect, useState } from "react";
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
import type { Overview, PricingStatus } from "@/types";
import { api, type UpstreamStats } from "./api";
import { ChatgptAccountDialog } from "./ChatgptAccountDialog";
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
import { UpstreamTable } from "./UpstreamTable";

export type UpstreamTab = "upstreams" | "proxies" | "pricing";

type DialogState =
  | null
  | { kind: "upstream"; mode: UpstreamDialogMode }
  | { kind: "chatgpt-login" }
  | { kind: "chatgpt-account"; name: string }
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
  useEffect(() => {
    loadStatus();
  }, [loadStatus, configVersion]);

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
      if (v.error) toast.error(`${name}：${v.error}`);
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
          result: { target: name, ok: false, segments: [], total_ms: 0, error: errorText(e) },
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
      toast.success(r.changed > 0 ? `默认价目表已更新，${r.changed} 个模型的价格有变化` : "默认价目表已是最新");
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
              上游 <Count n={ov.providers.length} />
            </TabsTrigger>
            <TabsTrigger value="proxies">
              代理 <Count n={proxies.length} />
            </TabsTrigger>
            <TabsTrigger value="pricing">
              价目表 <Count n={ov.price_sheets.length + 1} />
            </TabsTrigger>
          </TabsList>
          <div className="flex-1" />
          {tab === "upstreams" && ov.providers.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "link", provider: null })}>
                <ActivityIcon />
                链路测速
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDialog({ kind: "speed", provider: null })}>
                <ZapIcon />
                推理测速
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: "upstream", mode: { kind: "create" } })}>
                <PlusIcon />
                新建上游
              </Button>
            </>
          )}
          {tab === "proxies" && (
            <>
              {proxies.length > 0 && (
                <Button variant="outline" size="sm" onClick={testAllProxies}>
                  <ActivityIcon />
                  检测全部
                </Button>
              )}
              <Button size="sm" onClick={() => setDialog({ kind: "proxy", mode: { kind: "create" } })}>
                <PlusIcon />
                新建代理
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
                自动更新
              </label>
              <Button variant="outline" size="sm" onClick={refreshPrices} disabled={refreshingPrices}>
                {refreshingPrices ? <Spinner /> : <RefreshCwIcon />}
                立即更新
              </Button>
              <Button size="sm" onClick={() => setDialog({ kind: "sheet", mode: { kind: "create" } })}>
                <PlusIcon />
                新建价目表
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
                <EmptyTitle>尚无上游</EmptyTitle>
                <EmptyDescription>
                  上游是网关转发请求的目标服务。新建上游并填写接口地址与凭据后，客户端请求即可经网关发出。
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                {/* 服务类型在新建对话框的第一栏里选，这里不再平铺一排预设 */}
                <Button size="sm" onClick={() => setDialog({ kind: "upstream", mode: { kind: "create" } })}>
                  <PlusIcon />
                  新建上游
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <UpstreamTable
              ov={ov}
              stats={stats}
              actions={{
                edit: (name) => setDialog({ kind: "upstream", mode: { kind: "edit", name } }),
                test: (name) => setDialog({ kind: "test", name }),
                linkTest: (name) => setDialog({ kind: "link", provider: name }),
                speedTest: (name) => setDialog({ kind: "speed", provider: name }),
                refreshModels: (name) => void refreshModels(name),
                account: (name) => setDialog({ kind: "chatgpt-account", name }),
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
                <EmptyTitle>尚无代理</EmptyTitle>
                <EmptyDescription>
                  上游默认直连。需要经代理访问的上游，先新建代理，再在上游的连接设置中选择它。
                </EmptyDescription>
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
              默认价目表数据日期 {status.date || "—"}
              {status.checked_at_ms != null && ` · 最近检查 ${when(status.checked_at_ms)}`}
              {status.error && <span className="text-destructive"> · 更新失败：{status.error}</span>}
            </p>
          )}
          {status && status.unpriced_recent > 0 && (
            <Alert variant="warning">
              <CircleAlertIcon />
              <AlertTitle>最近 7 天有 {status.unpriced_recent.toLocaleString()} 次请求无法计价</AlertTitle>
              <AlertDescription>
                涉及模型{" "}
                {status.unpriced_models.slice(0, 4).map((u, i) => (
                  <span key={`${u.provider}/${u.model}`}>
                    {i > 0 && "、"}
                    <span className="font-mono">{u.model}</span>（{u.provider}）
                  </span>
                ))}
                {status.unpriced_models.length > 4 && ` 等 ${status.unpriced_models.length} 项`}
                ，相关费用未计入统计。
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
                  设置价格
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
          onChatgptLogin={() => setDialog({ kind: "chatgpt-login" })}
        />
      )}
      {dialog?.kind === "delete-upstream" && (
        <DeleteDialog
          what="上游"
          name={dialog.name}
          referrers={(ov.providers.find((p) => p.name === dialog.name)?.references ?? []).map((ref) => ({
            kind: "reference" as const,
            ref,
          }))}
          consequence="删除后，此上游的地址、凭据与设置将从配置文件中移除，可在版本历史中恢复。"
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
          onClose={() => setDialog(null)}
          onSaved={() => changed()}
        />
      )}
      {dialog?.kind === "chatgpt-account" && (
        <ChatgptAccountDialog name={dialog.name} onClose={() => setDialog(null)} />
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
          what="代理"
          name={dialog.name}
          referrers={(proxies.find((x) => x.name === dialog.name)?.used_by ?? []).map((name) => ({
            kind: "upstream" as const,
            name,
          }))}
          consequence="删除后，此代理的地址与认证信息将从配置文件中移除，可在版本历史中恢复。"
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
          what="价目表"
          name={dialog.name}
          referrers={(ov.price_sheets.find((s) => s.name === dialog.name)?.used_by ?? []).map((name) => ({
            kind: "upstream" as const,
            name,
          }))}
          consequence="删除后，此价目表的倍率与模型覆盖将从配置文件中移除，可在版本历史中恢复。"
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
