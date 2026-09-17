import { useEffect, useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/ui/alert";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Spinner } from "@/ui/spinner";
import type {
  Overview,
  ProviderPreview,
  ProviderTestResult,
  ProviderView,
  ResolvedPrice,
  SheetRef,
} from "@/types";
import { api } from "./api";
import { BillingSection } from "./BillingSection";
import { ConnectionSection } from "./ConnectionSection";
import { errorText, protocolLabel, shortUrl } from "./labels";
import { ModelsSection, inScope, type ModelCatalog } from "./ModelsSection";
import { StepNav } from "./parts";
import { PriceSheetDialog } from "./PriceSheetDialog";
import { ProxyDialog } from "./ProxyDialog";
import { SecuritySection } from "./SecuritySection";
import {
  blankForm,
  connectionChanged,
  connectionMissing,
  describeModelList,
  formFromView,
  modelsMissing,
  toInput,
  type UpstreamForm,
} from "./upstreamForm";

export type Section = "connection" | "models" | "billing" | "security";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "connection", label: "连接" },
  { id: "models", label: "模型" },
  { id: "billing", label: "计费" },
  { id: "security", label: "安全" },
];

export type UpstreamDialogMode =
  | { kind: "create" }
  | { kind: "edit"; name: string; section?: Section };

/**
 * 新建与编辑上游。
 *
 * **新建分步走**（连接、模型、计费、安全，后三步都有默认值）；**编辑按节
 * 随意切换**，「保存」一次提交所有分节的改动 —— core 那边是一次写入、一个
 * 配置版本。取消不写入任何东西。
 */
export function UpstreamDialog({
  mode,
  ov,
  configVersion,
  quotaSeen,
  onClose,
  onSaved,
  onChanged,
  onGoToGuard,
}: {
  mode: UpstreamDialogMode;
  ov: Overview;
  configVersion: string | null;
  /** 这一家报过订阅额度。「自动识别」的计费方式据此判成订阅制 */
  quotaSeen: boolean;
  onClose: () => void;
  onSaved: (name: string) => void;
  /** 对话框里新建了代理或价目表：外面要重新读概览 */
  onChanged: () => void;
  onGoToGuard: () => void;
}) {
  const editing: ProviderView | null =
    mode.kind === "edit" ? (ov.providers.find((p) => p.name === mode.name) ?? null) : null;
  const taken = ov.providers.map((p) => p.name);
  const [form, setForm] = useState<UpstreamForm>(() =>
    editing ? formFromView(editing) : blankForm(),
  );
  const set = (patch: Partial<UpstreamForm>) => setForm((f) => ({ ...f, ...patch }));
  const [section, setSection] = useState<Section>(
    mode.kind === "edit" ? (mode.section ?? "connection") : "connection",
  );
  const [visited, setVisited] = useState<Set<Section>>(() => new Set(["connection"]));

  const [preview, setPreview] = useState<ProviderPreview | null>(null);
  const [test, setTest] = useState<ProviderTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(editing != null);
  const [refreshing, setRefreshing] = useState(false);
  const [prices, setPrices] = useState<Record<string, ResolvedPrice>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nested, setNested] = useState<
    | null
    | { kind: "proxy" }
    /** `name` 空 = 新建；`add` = 打开后为这几个模型各加一条覆盖 */
    | { kind: "sheet"; name: string | null; add?: string[] }
  >(null);

  // 「自动识别」此刻会判成什么、密钥放在哪个请求头。只看地址和选定的协议，不联网
  useEffect(() => {
    const url = form.baseUrl.trim();
    if (!url) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => {
      api
        .previewProvider(url, form.protocol || undefined)
        .then(setPreview)
        .catch(() => setPreview(null));
    }, 250);
    return () => clearTimeout(t);
  }, [form.baseUrl, form.protocol]);

  // 新建：连接信息一改，之前检测到的结果和模型列表就不再对应这一家
  const connectionKey = JSON.stringify([
    form.baseUrl,
    form.protocol,
    form.authMode,
    form.key,
    form.headers.map((h) => [h.name, h.value]),
    form.oauthRefresh,
    form.oauthEndpoint,
    form.oauthAccess,
    form.proxy,
  ]);
  useEffect(() => {
    if (editing) return;
    setTest(null);
    setCatalog(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionKey]);

  // 编辑：读已保存的模型清单
  useEffect(() => {
    if (!editing) return;
    let alive = true;
    api
      .providerModels(editing.name)
      .then((v) => {
        if (alive) setCatalog({ source: v.source, models: v.models.map((m) => m.id), checkedAtMs: v.checked_at_ms, error: v.error });
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setCatalogLoading(false));
    return () => {
      alive = false;
    };
    // 只在打开时读一次；之后的变化由「刷新模型列表」和「检测连接」带进来
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const models = catalog?.source === "discovered" ? catalog.models : form.manualModels;
  const enabledModels = useMemo(() => models.filter((m) => inScope(form, m)), [models, form]);

  // 按所选价目表查价。**界面不自己算** —— 覆盖、倍率、跨平台估算都在 core
  const sheetKey = form.pricing;
  const modelsKey = models.join("\n");
  useEffect(() => {
    if (models.length === 0) {
      setPrices({});
      return;
    }
    const sheet: SheetRef = sheetKey ? { kind: "named", name: sheetKey } : { kind: "default" };
    let alive = true;
    const t = setTimeout(() => {
      api
        .queryPrices({ sheet, models })
        .then((r) => {
          if (alive) setPrices(Object.fromEntries(r.items.map((i) => [i.model, i])));
        })
        // 刚新建的价目表还没进概览时会查不到，等概览更新后再查
        .catch(() => alive && setPrices({}));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetKey, modelsKey, ov.price_sheets]);

  async function runTest() {
    setTesting(true);
    try {
      const r = await api.testProvider({
        provider: toInput(form, editing != null),
        current: editing?.name,
      });
      setTest(r);
      setCatalog(
        r.ok && r.models.kind === "listed"
          ? { source: "discovered", models: r.models.models, checkedAtMs: Date.now() }
          : {
              // 没拿到清单（连接失败，或上游不提供列表接口）：手动清单兜底
              source: form.manualModels.length > 0 ? "manual" : "none",
              models: [],
              checkedAtMs: Date.now(),
              error: r.ok ? describeModelList(r.models) : `连接失败：${r.error ?? "未知错误"}`,
            },
      );
    } catch (e) {
      const error = errorText(e);
      setTest({ ok: false, protocol: null, latency_ms: 0, models: { kind: "empty" }, error });
      setCatalog({
        source: form.manualModels.length > 0 ? "manual" : "none",
        models: [],
        checkedAtMs: Date.now(),
        error: `连接失败：${error}`,
      });
    } finally {
      setTesting(false);
    }
  }

  async function refreshModels() {
    // 连接信息改过：按表单里的新值去问；没改过：让 core 刷新已保存的那一家
    if (!editing || connectionChanged(form, editing)) {
      await runTest();
      return;
    }
    setRefreshing(true);
    try {
      const v = await api.refreshProviderModels(editing.name);
      setCatalog({ source: v.source, models: v.models.map((m) => m.id), checkedAtMs: v.checked_at_ms, error: v.error });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }

  const missing =
    section === "connection"
      ? connectionMissing(form, editing?.name ?? null, taken)
      : section === "models"
        ? modelsMissing(form)
        : null;
  const blocking = connectionMissing(form, editing?.name ?? null, taken) ?? modelsMissing(form);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const save = {
        provider: toInput(form, editing != null),
        base_version: configVersion ?? undefined,
      };
      if (editing) await api.updateProvider(editing.name, save);
      else await api.createProvider(save);
      onSaved(form.name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  function go(to: Section) {
    setSection(to);
    setVisited((v) => new Set([...v, to]));
    // 新建时没检测过就到了模型这一步：替用户检测一次，这一步才有内容可选。检测不产生费用
    if (to === "models" && !editing && catalog == null && !testing) void runTest();
  }
  const index = SECTIONS.findIndex((s) => s.id === section);

  const autoBilling =
    editing && !editing.billing
      ? editing.billing_effective
      : quotaSeen
        ? "subscription"
        : "per-token";

  if (mode.kind === "edit" && !editing) {
    // 保存期间被别处删掉了
    return null;
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/* 固定高度：切换分节时对话框不跳动，内容在中间滚动 */}
      <DialogContent className="flex h-[min(88vh,680px)] flex-col gap-4 sm:max-w-[900px]">
        <DialogHeader>
          <DialogTitle className="tw-title">{editing ? "编辑上游" : "新建上游"}</DialogTitle>
          {editing ? (
            <DialogDescription>
              <span className="font-mono text-foreground">{editing.name}</span> ·{" "}
              {protocolLabel(editing.protocol)} · {shortUrl(editing.base_url)}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              填写连接信息，选择模型范围、计费方式与安全策略。
            </DialogDescription>
          )}
        </DialogHeader>

        <StepNav
          steps={SECTIONS}
          current={section}
          done={editing ? undefined : visited}
          onPick={go}
        />

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1">
          {section === "connection" && (
            <ConnectionSection
              form={form}
              set={set}
              editing={editing}
              ov={ov}
              preview={preview}
              testing={testing}
              test={test}
              onTest={runTest}
              onNewProxy={() => setNested({ kind: "proxy" })}
            />
          )}
          {section === "models" && (
            <ModelsSection
              form={form}
              set={set}
              catalog={catalog}
              prices={prices}
              perToken={(form.billing || autoBilling) === "per-token"}
              sheetLabel={form.pricing ? `价目表「${form.pricing}」` : "默认价目表"}
              loading={catalogLoading || (testing && catalog == null)}
              refreshing={refreshing || testing}
              onRefresh={refreshModels}
            />
          )}
          {section === "billing" && (
            <BillingSection
              form={form}
              set={set}
              ov={ov}
              autoBilling={autoBilling}
              originalName={editing?.name ?? null}
              models={enabledModels}
              prices={prices}
              onNewSheet={() => setNested({ kind: "sheet", name: null })}
              onEditSheet={(name) => setNested({ kind: "sheet", name })}
              onPriceModels={(models) =>
                setNested({ kind: "sheet", name: form.pricing || null, add: models })
              }
            />
          )}
          {section === "security" && (
            <SecuritySection
              form={form}
              set={set}
              ov={ov}
              preview={preview}
              onGoToGuard={onGoToGuard}
            />
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <DialogFooter className="items-center">
          {editing ? (
            <>
              {blocking && <span className="mr-auto tw-label text-muted-foreground">{blocking}</span>}
              <Button variant="outline" onClick={onClose}>
                取消
              </Button>
              <Button onClick={save} disabled={saving || blocking != null}>
                {saving && <Spinner />}
                保存
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" className="mr-auto" onClick={onClose}>
                取消
              </Button>
              {missing && <span className="tw-label text-muted-foreground">{missing}</span>}
              {index > 0 && (
                <Button variant="outline" onClick={() => go(SECTIONS[index - 1]!.id)}>
                  上一步
                </Button>
              )}
              {index < SECTIONS.length - 1 ? (
                <Button onClick={() => go(SECTIONS[index + 1]!.id)} disabled={missing != null}>
                  下一步
                </Button>
              ) : (
                <Button onClick={save} disabled={saving || blocking != null}>
                  {saving && <Spinner />}
                  创建
                </Button>
              )}
            </>
          )}
        </DialogFooter>

        {nested?.kind === "proxy" && (
          <ProxyDialog
            mode={{ kind: "create" }}
            ov={ov}
            configVersion={configVersion}
            onClose={() => setNested(null)}
            onSaved={(name) => {
              setNested(null);
              set({ proxy: name });
              onChanged();
            }}
          />
        )}
        {nested?.kind === "sheet" && (
          <PriceSheetDialog
            mode={
              nested.name
                ? { kind: "edit", name: nested.name, add: nested.add }
                : { kind: "create", prefill: nested.add ? { models: nested.add, usedBy: [] } : undefined }
            }
            ov={ov}
            configVersion={configVersion}
            context={{ models: enabledModels, protocol: form.protocol || preview?.protocol || null }}
            onClose={() => setNested(null)}
            onSaved={(name) => {
              setNested(null);
              set({ pricing: name });
              onChanged();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
