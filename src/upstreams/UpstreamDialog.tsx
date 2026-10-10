import { useEffect, useMemo, useState } from "react";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { latestOnly } from "@/lib/latestOnly";
import type {
  BedrockDraft,
  Overview,
  ProviderPreview,
  ProviderTestResult,
  ProviderView,
  ResolvedPrice,
  SheetRef,
} from "@/types";
import { api } from "./api";
import { BillingSection } from "./BillingSection";
import { ChatgptAccountSection } from "./ChatgptAccountSection";
import { ConnectionSection } from "./ConnectionSection";
import { coreText, errorText, plain, protocolLabel, shortUrl } from "./labels";
import { useManualEntry } from "./ManualModelInput";
import { addToList, unionModels } from "./manualModels";
import { ModelsSection, catalogOf, type ModelCatalog } from "./ModelsSection";
import { DialogError, ProviderTile, StepNav } from "./parts";
import { CHATGPT, ZAI, presetById } from "./presets";
import { PresetTile, ServiceSection } from "./ServiceSection";
import { PriceSheetDialog } from "./PriceSheetDialog";
import { ProxyDialog } from "./ProxyDialog";
import { upstreamDialogText } from "./UpstreamDialog.i18n";
import {
  applyPreset,
  blankForm,
  connectionChanged,
  connectionMissing,
  describeModelList,
  formFromDraft,
  formFromView,
  inScope,
  modelsMissing,
  toInput,
  withManualAdded,
  type UpstreamForm,
} from "./upstreamForm";

export type Section = "service" | "connection" | "account" | "models" | "billing";

/** 编辑时的分节。服务类型是新建时定的，编辑不再换 */
const SECTIONS: Section[] = ["connection", "models", "billing"];

/**
 * 新建的分步：先选服务类型，点一格就进「连接」。
 *
 * 选定的类型决定后面怎么填（账号登录整个让位，Bedrock 的凭据另一套），所以单独一步
 * 放在最前；它只是一次点击，没有「下一步」。
 */
const CREATE_SECTIONS: Section[] = ["service", "connection", "models", "billing"];

/**
 * ChatGPT 账号上游的分节。
 *
 * **没有「连接」**：地址、协议、凭据由登录决定 —— 把这些摆成可填的表单，等于
 * 邀请用户去改一个改了就坏的东西。**有「计费」**：订阅账号也按价目表算费用，
 * 选哪张价目表、要不要记成不计费，和别的上游一样由用户定。
 */
const ACCOUNT_SECTIONS: Section[] = ["account", "models", "billing"];

export type UpstreamDialogMode =
  /** `draft`：按客户端原来直连 Bedrock 时的设置预填（接管确认框里的「新建 Bedrock 上游」） */
  | { kind: "create"; draft?: BedrockDraft }
  | { kind: "edit"; name: string; section?: Section };

/**
 * 新建与编辑上游。
 *
 * **新建分步走**（服务类型、连接、模型、计费，后两步都有默认值）；**编辑按节
 * 随意切换**，「保存」一次提交所有分节的改动 —— core 那边是一次写入、一个
 * 配置版本。取消不写入任何东西。
 */
export function UpstreamDialog({
  mode,
  ov,
  configVersion,
  onClose,
  onSaved,
  onChanged,
  onChatgptLogin,
  onZaiLogin,
}: {
  mode: UpstreamDialogMode;
  ov: Overview;
  /** 概览里的配置版本。**只取打开那一刻的**（见 `base`） */
  configVersion: string;
  onClose: () => void;
  onSaved: (name: string) => void;
  /** 对话框里新建了代理或价目表：外面要重新读概览 */
  onChanged: () => void;
  /** 改用 ChatGPT 账号登录：这张表单让位给登录对话框。带上名字就是给它换一次凭据 */
  onChatgptLogin: (relogin?: { name: string; proxy: string }) => void;
  /** 改用 Z.ai / BigModel 账号登录：同样让位给登录对话框 */
  onZaiLogin: () => void;
}) {
  const t = useText(upstreamDialogText);
  const c = useText(commonText);
  const editing: ProviderView | null =
    mode.kind === "edit" ? (ov.providers.find((p) => p.name === mode.name) ?? null) : null;
  const taken = ov.providers.map((p) => p.name);
  const [form, setForm] = useState<UpstreamForm>(() =>
    editing
      ? formFromView(editing)
      : mode.kind === "create" && mode.draft
        ? formFromDraft(mode.draft, taken)
        : blankForm(),
  );
  /**
   * 保存时带的版本号：**表单填进来的那一版**，不是保存那一刻的。
   *
   * 开着对话框的时候配置可能被改过（另一个窗口、直接改文件、core 换了令牌）。带着
   * 保存那一刻的版本号，core 的冲突检查永远通过，旧表单就把那些改动悄悄盖掉了；带着
   * 打开时的，core 回一个版本冲突，原因写在对话框里。在这里新建的代理、新建或删掉的
   * 价目表是这一次编辑自己写的：写完接着用它回的版本。
   */
  const [base, setBase] = useState(configVersion);
  const set = (patch: Partial<UpstreamForm>) => setForm((f) => ({ ...f, ...patch }));
  // ChatGPT 账号是登录来的，编辑它的那一套分节也不一样
  const account = editing?.protocol === "chatgpt";
  /** 登的是哪个账号。core 从凭据的令牌里读，和列表那一行是同一份 */
  const email = editing?.oauth?.account?.email;
  const sections = (editing ? (account ? ACCOUNT_SECTIONS : SECTIONS) : CREATE_SECTIONS).map((id) => ({
    id,
    label: t.sections[id],
  }));
  // 按客户端原来的 Bedrock 设置新建：类型已经定了，直接落到「连接」
  const drafted = mode.kind === "create" && mode.draft != null;
  const [section, setSection] = useState<Section>(() => {
    if (mode.kind !== "edit") return drafted ? "connection" : "service";
    const own = account ? ACCOUNT_SECTIONS : SECTIONS;
    // 账号上游没有「连接」这一节，出站连接（代理）在「账号」那一节里：从删代理的对话框
    // 点「查看」过来时落到那里。**不在这一套里的节一律不画** —— 画出来的是这种上游
    // 不该有的地址、协议、凭据表单，改了就坏
    const want = account && mode.section === "connection" ? "account" : mode.section;
    return want && own.includes(want) ? want : own[0]!;
  });
  const [visited, setVisited] = useState<Set<Section>>(
    () => new Set<Section>(drafted ? ["service", "connection"] : ["service"]),
  );

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

  /**
   * 连接信息一改，之前的检测结果就不再对应表单里的这一家。
   *
   * **编辑时也一样**：显示着「连接正常」的时候改了密钥、地址、协议或代理，那句话说的
   * 已经不是现在这一份了。还没回来的那次检测，回来了也不要 —— 它测的是改之前的那一份
   * （`tests`）。新建时模型列表也是检测带进来的，一起作废；编辑时那是已保存的清单，留着
   */
  const connectionKey = JSON.stringify([
    form.baseUrl,
    form.protocol,
    form.authMode,
    form.key,
    form.headers.map((h) => [h.name, h.value]),
    form.oauthRefresh,
    form.oauthEndpoint,
    form.oauthAccess,
    form.awsKeyId,
    form.awsSecret,
    form.awsToken,
    form.awsProfile,
    form.awsRegion,
    form.proxy,
  ]);
  const [tests] = useState(latestOnly);
  useEffect(() => {
    tests.drop();
    setTest(null);
    setTesting(false);
    if (!editing) setCatalog(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionKey]);

  // 编辑：读已保存的模型清单。**跟着概览里这一家的获取状态重读** —— 打开对话框
  // 时后台可能正在问，问完了这里要跟着变，不该再让人点一次刷新。
  // 连接信息改过时不读：那时的清单对应表单里的新值，是「检测连接」带进来的
  const modelsTick = editing ? `${editing.model_checked_at_ms ?? ""}|${editing.model_fetching}` : "";
  useEffect(() => {
    if (!editing || connectionChanged(form, editing)) return;
    let alive = true;
    api
      .providerModels(editing.name)
      .then((v) => {
        if (alive) setCatalog(catalogOf(v));
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setCatalogLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsTick]);

  /** 上游列出的接上手动添加的（表单里的，没保存的改动也算）：启用范围、价格、计费都按这一份 */
  const listed = catalog?.listed;
  const models = useMemo(
    () => unionModels(listed ?? [], form.manualModels).map((m) => m.id),
    [listed, form.manualModels],
  );
  const enabledModels = useMemo(() => models.filter((m) => inScope(form, m)), [models, form]);

  /**
   * 「模型」一节手动添加的输入框。**放在这里而不是那一节里**：切到别的分节，那一节就卸掉了，
   * 而保存时输入框里没按回车的也要先加上（见 `save`）。加进表单的手动清单，指定了启用范围
   * 时一并勾上（`withManualAdded`）
   */
  const entry = useManualEntry((raw) => {
    const r = addToList(raw, { list: form.manualModels, listed: listed ?? [] });
    const patch = withManualAdded(form, r.added);
    if (r.added.length > 0) set(patch);
    return { rest: r.rest, problem: r.problem, patch };
  });

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
    const current = tests.start();
    setTesting(true);
    try {
      const r = await api.testProvider({
        provider: toInput(form),
        current: editing?.name,
      });
      // 回来时表单已经改了，或者又点了一次：这个结果不算（finally 里也不收转圈）
      if (!current()) return;
      setTest(r);
      setCatalog(
        r.ok && r.models.kind === "listed"
          ? { source: "discovered", status: "listed", listed: r.models.models, checkedAtMs: Date.now() }
          : {
              // 没拿到清单（连接失败，或上游不提供列表接口）。手动添加的照样在表单里
              source: "none",
              status: r.ok ? "no_list" : "failed",
              listed: [],
              checkedAtMs: Date.now(),
              error: plain(r.ok ? describeModelList(r.models) : t.connectionFailed(r.error ? coreText(r.error) : t.unknownError)),
            },
      );
    } catch (e) {
      if (!current()) return;
      const error = errorText(e);
      setTest({ ok: false, protocol: null, latency_ms: 0, models: { kind: "empty" }, error: plain(error) });
      setCatalog({
        source: "none",
        status: "failed",
        listed: [],
        checkedAtMs: Date.now(),
        error: plain(t.connectionFailed(error)),
      });
    } finally {
      if (current()) setTesting(false);
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
      setCatalog(catalogOf(await api.refreshProviderModels(editing.name)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }

  /** 第一步选了一种服务类型：账号登录让位给登录对话框，预设填进表单并进到「连接」 */
  function pickService(id: string) {
    if (id === CHATGPT) {
      onChatgptLogin();
      return;
    }
    if (id === ZAI) {
      onZaiLogin();
      return;
    }
    setForm((f) => applyPreset(f, id, taken));
    go("connection");
  }

  const missing =
    section === "connection"
      ? connectionMissing(form, editing?.name ?? null, taken)
      : section === "models"
        ? modelsMissing(form)
        : null;
  const blocking = connectionMissing(form, editing?.name ?? null, taken) ?? modelsMissing(form);

  async function save() {
    // 手动添加的输入框里还有没按回车的：先加上；写错了就不存，回到「模型」一节，毛病在那里说
    const added = entry.commit(true);
    if (added?.problem) {
      go("models");
      return;
    }
    const f = added ? { ...form, ...added.patch } : form;
    setSaving(true);
    setError(null);
    try {
      const save = {
        provider: toInput(f),
        base_version: base,
      };
      if (editing) await api.updateProvider(editing.name, save);
      else await api.createProvider(save);
      onSaved(f.name);
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
  const index = sections.findIndex((s) => s.id === section);

  if (mode.kind === "edit" && !editing) {
    // 保存期间被别处删掉了
    return null;
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/*
        固定高度：切换分节时对话框不跳动，内容在中间滚动。点到对话框外面不关 ——
        填了一半的表单不该因为一次误点丢掉；Esc、×、取消照常
      */}
      <DialogContent
        className="flex h-[min(88vh,680px)] flex-col gap-4 sm:max-w-[900px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-row items-center gap-3">
          {/* 新建：第一步还没选，标题旁没有标志；选定之后每一步都带着 */}
          {editing ? (
            <ProviderTile p={editing} />
          ) : (
            section !== "service" && <PresetTile preset={presetById(form.preset)} />
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="tw-title">{editing ? t.titleEdit : t.titleNew}</DialogTitle>
            {editing ? (
              <DialogDescription className="truncate">
                <span className="font-mono text-foreground">{editing.name}</span> ·{" "}
                {protocolLabel(editing.protocol)}
                {/*
                  账号上游的地址是登录给的，改不了，写出来只是噪声：那一格和列表里一样写
                  登的是哪个账号
                */}
                {account ? email && ` · ${email}` : ` · ${shortUrl(editing.base_url)}`}
              </DialogDescription>
            ) : (
              // 第一步选定的服务类型，之后每一步都看得见；还没选时写这一步要做什么
              <DialogDescription className="truncate">
                {section === "service" ? t.pickService : presetById(form.preset).label}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>

        <StepNav
          steps={sections}
          current={section}
          done={editing ? undefined : visited}
          onPick={go}
        />

        <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4 pb-1">
          {section === "account" && editing && (
            <ChatgptAccountSection
              form={form}
              set={set}
              editing={editing}
              ov={ov}
              onRelogin={() => onChatgptLogin({ name: editing.name, proxy: editing.proxy })}
            />
          )}
          {section === "service" && (
            <ServiceSection
              // 表单从「自定义」起步，但还没点过就不标选中；退回来时标着上次选的
              value={visited.has("connection") ? form.preset : null}
              onPick={pickService}
              onChatgptLogin={() => onChatgptLogin()}
              onZaiLogin={onZaiLogin}
            />
          )}
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
              entry={entry}
              prices={prices}
              perToken={form.billing === "per-token"}
              sheetLabel={form.pricing ? t.namedSheet(form.pricing) : t.defaultSheet}
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
        </div>

        <DialogError error={error} />

        <DialogFooter className="items-center">
          {editing ? (
            <>
              {blocking && <span className="mr-auto tw-label text-muted-foreground">{blocking}</span>}
              <Button variant="outline" onClick={onClose}>
                {c.cancel}
              </Button>
              <Button onClick={save} pending={saving} disabled={blocking != null}>
                {c.save}
              </Button>
            </>
          ) : (
            <>
              {/* 分步走时「取消」放最左，「上一步 / 下一步」成组放右边 */}
              <Button variant="outline" className="sm:mr-auto" onClick={onClose}>
                {c.cancel}
              </Button>
              {missing && <span className="tw-label text-muted-foreground">{missing}</span>}
              {index > 0 && (
                <Button variant="outline" onClick={() => go(sections[index - 1]!.id)}>
                  {t.back}
                </Button>
              )}
              {/* 第一步点一格就往下走，没有「下一步」 */}
              {section === "service" ? null : index < sections.length - 1 ? (
                <Button onClick={() => go(sections[index + 1]!.id)} disabled={missing != null}>
                  {t.next}
                </Button>
              ) : (
                <Button onClick={save} pending={saving} disabled={blocking != null}>
                  {t.create}
                </Button>
              )}
            </>
          )}
        </DialogFooter>

        {nested?.kind === "proxy" && (
          <ProxyDialog
            mode={{ kind: "create" }}
            ov={ov}
            configVersion={base}
            onClose={() => setNested(null)}
            onSaved={(name, version) => {
              setNested(null);
              set({ proxy: name });
              setBase(version);
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
            configVersion={base}
            context={{ models: enabledModels, protocol: form.protocol || preview?.protocol || null }}
            onClose={() => setNested(null)}
            onSaved={(name, version) => {
              setNested(null);
              set({ pricing: name });
              setBase(version);
              onChanged();
            }}
            // 在这里删掉了一张价目表：对话框关上，表单里选着它的话退回默认的那张 ——
            // 留着一个已经不存在的名字，保存这个上游只会得到「没有这张价目表」
            onDeleted={(version) => {
              if (nested.name && form.pricing === nested.name) set({ pricing: "" });
              setNested(null);
              setBase(version);
              onChanged();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
