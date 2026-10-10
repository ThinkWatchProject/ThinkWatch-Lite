import { useEffect, useMemo, useRef, useState } from "react";
import { Input } from "@/ui/input";
import { Banner } from "@/ui/banner";
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
  ZaiFamily,
} from "@/types";
import { useAccountLogin, type AccountLogin, type LoginAccount } from "./accountLogin";
import { AccountLine, AccountPanel, AccountSummary } from "./AccountPanel";
import { api } from "./api";
import { BillingSection } from "./BillingSection";
import { ChatgptAccountSection } from "./ChatgptAccountSection";
import {
  AuthField,
  CheckButton,
  CheckSummary,
  ConnectionSection,
  ProxyField,
  SiteField,
  type ZaiAccount,
} from "./ConnectionSection";
import { coreText, errorText, planLabel, plain, protocolLabel, shortUrl } from "./labels";
import { useManualEntry } from "./ManualModelInput";
import { addToList, unionModels } from "./manualModels";
import { ModelsSection, catalogOf, type ModelCatalog } from "./ModelsSection";
import { DialogError, FormItem, ProviderTile, StepNav } from "./parts";
import { CUSTOM, ZAI_ENDPOINTS, accountKind, presetById } from "./presets";
import type { Relogin } from "./ReloginDialog";
import { PresetTile, ServiceSearch, ServiceSection } from "./ServiceSection";
import { PriceSheetDialog } from "./PriceSheetDialog";
import { ProxyDialog } from "./ProxyDialog";
import { upstreamDialogText } from "./UpstreamDialog.i18n";
import {
  applyPreset,
  authModeOf,
  blankForm,
  connectionChanged,
  connectionMissing,
  describeModelList,
  fieldRules,
  formFromDraft,
  formFromView,
  inScope,
  modelsMissing,
  retarget,
  siteLocked,
  toInput,
  withAuth,
  withManualAdded,
  withSite,
  type AuthMode,
  type UpstreamForm,
} from "./upstreamForm";

export type Section = "service" | "connection" | "account" | "models" | "billing";

/** 编辑时的分节。服务类型是新建时定的，编辑不再换 */
const SECTIONS: Section[] = ["connection", "models", "billing"];

/**
 * 新建的分步：先选服务类型，点一格就进「连接」。
 *
 * 选定的类型决定后面怎么填（问哪几项、认证方式有哪几种、账号登录整个让位），所以单独
 * 一步放在最前；它只是一次点击，没有「下一步」。登录账号时第二步叫「账号」。
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

/** 登录账号建出来的上游：登录时选的服务类型和站点（之后表单换成了那个上游的定义）、登上的账号 */
interface SignedIn {
  preset: string;
  family: ZaiFamily;
  provider: string;
  account: LoginAccount | null;
}

/**
 * 新建与编辑上游。
 *
 * **新建分步走**（服务类型、连接、模型、计费，后两步都有默认值）；**编辑按节
 * 随意切换**，「保存」一次提交所有分节的改动 —— core 那边是一次写入、一个
 * 配置版本。取消不写入任何东西。
 *
 * **一屏放下**：默认窗口（1100×720）里每一步都不出整页的滚动条，只有长列表（模型表、价格表）
 * 在自己的框里滚。窗口再小时中间那一块可以滚。
 *
 * **新建时点「下一步」就检测连接**：按钮转圈，通过了进「模型」，结果写在那一步顶上；没通过就
 * 留在这一步，底部一条红色横幅说原因，给「重试」和「仍然继续」—— 有的上游不接受检测却能用，
 * 有的没有模型列表。编辑时没有「下一步」，「检测连接」照旧是一个按钮。
 *
 * **登录账号（ChatGPT、Z.ai / BigModel）在第二步里完成**：登录成功时 core 已经把上游
 * 写进配置，直接进「模型」，顶上写登的是哪个账号；之后的「模型」「计费」两步改的就是这个
 * 上游，走编辑那条路，最后一步「完成」只在有改动时写一次。登录之后回不到第一步：上游已经
 * 建好了。
 */
export function UpstreamDialog({
  mode,
  ov,
  configVersion,
  onClose,
  onSaved,
  onChanged,
  onRelogin,
}: {
  mode: UpstreamDialogMode;
  ov: Overview;
  /** 概览里的配置版本。**只取打开那一刻的**（见 `base`） */
  configVersion: string;
  onClose: () => void;
  onSaved: (name: string) => void;
  /** 对话框里新建了代理或价目表、登录建出了上游：外面要重新读概览 */
  onChanged: () => void;
  /**
   * 给已有的账号上游换一次凭据：ChatGPT 账号「账号」一节里的重新登录，Z.ai / BigModel 上游
   * 登录账号换一把密钥，新建时登录之后回到「账号」一步点的重新登录。这张表单让位给重新登录
   * 的对话框
   */
  onRelogin: (relogin: Relogin) => void;
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
   * 价目表是这一次编辑自己写的：写完接着用它回的版本。登录建出的上游同理：表单换成它的
   * 那一刻，版本也换成那一版
   */
  const [base, setBase] = useState(configVersion);
  /** 改表单。编辑时改了地址或协议，按改过的重新认是哪一种服务（`retarget`） */
  const set = (patch: Partial<UpstreamForm>) => setForm((f) => retarget({ ...f, ...patch }));

  /** 登录账号建出来的上游。之后两步改的是它 */
  const [signedIn, setSignedIn] = useState<SignedIn | null>(null);
  /** 正在改的那个已有的上游：编辑的那一个，或者登录刚建出来的那一个（概览读到它之后） */
  const saved: ProviderView | null =
    editing ?? (signedIn ? (ov.providers.find((p) => p.name === signedIn.provider) ?? null) : null);
  /** 表单是从哪个上游填进来的。登录之后要等概览里有了它、换掉表单，之后两步才能往下走 */
  const [adoptedFrom, setAdoptedFrom] = useState<string | null>(editing?.name ?? null);
  const ready = saved != null && adoptedFrom === saved.name;

  const login = useAccountLogin(accountKind(signedIn?.preset ?? form.preset) ?? "chatgpt", (provider, account) => {
    setSignedIn({ preset: form.preset, family: form.zaiFamily, provider, account });
    // 上游已经在配置里了：直接进「模型」。概览重读之后才有它的定义，那之前模型表先占着位
    setCatalogLoading(true);
    enter("models");
    onChanged();
  });

  // ChatGPT 账号是登录来的，编辑它的那一套分节也不一样
  const account = editing?.protocol === "chatgpt";
  /** 登的是哪个账号。core 从凭据的令牌里读，和列表那一行是同一份 */
  const email = editing?.oauth?.account?.email;
  /** 新建时第二步是登录账号：那一步叫「账号」 */
  const signingIn = mode.kind === "create" && (signedIn != null || authModeOf(form) === "account");
  /** 那一节叫「账号」：新建时登录账号，编辑 Z.ai / BigModel 上游时认证方式是账号登录 */
  const accountStep = signingIn || (editing != null && authModeOf(form) === "account");
  const sections = (editing ? (account ? ACCOUNT_SECTIONS : SECTIONS) : CREATE_SECTIONS).map((id) => ({
    id,
    label: id === "connection" && accountStep ? t.sections.account : t.sections[id],
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
  /** 此刻在哪一步。检测回来时用：人已经退回别的步了，就不再替他往下走 */
  const here = useRef(section);
  here.current = section;
  const [visited, setVisited] = useState<Set<Section>>(
    () => new Set<Section>(drafted ? ["service", "connection"] : ["service"]),
  );
  /** 第一步的搜索框。放在这里：它画在步骤条右边，不在那一节里 */
  const [query, setQuery] = useState("");

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

  /**
   * 登录建出的上游进了概览：表单换成它的定义（之后两步改它、「完成」时按编辑交回），
   * 版本换成这一版，模型清单按它去读
   */
  useEffect(() => {
    if (!signedIn || adoptedFrom === signedIn.provider) return;
    const p = ov.providers.find((x) => x.name === signedIn.provider);
    if (!p) return;
    setForm(formFromView(p));
    setBase(ov.config_version);
    setCatalogLoading(true);
    setAdoptedFrom(p.name);
  }, [signedIn, adoptedFrom, ov]);

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
    if (!saved) setCatalog(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionKey]);

  // 编辑：读已保存的模型清单。**跟着概览里这一家的获取状态重读** —— 打开对话框
  // 时后台可能正在问，问完了这里要跟着变，不该再让人点一次刷新。
  // 连接信息改过时不读：那时的清单对应表单里的新值，是「检测连接」带进来的
  const modelsTick = saved ? `${saved.model_checked_at_ms ?? ""}|${saved.model_fetching}` : "";
  useEffect(() => {
    if (!saved || !ready || connectionChanged(form, saved)) return;
    let alive = true;
    api
      .providerModels(saved.name)
      .then((v) => {
        if (alive) setCatalog(catalogOf(v));
      })
      .catch((e) => alive && setError(errorText(e)))
      .finally(() => alive && setCatalogLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsTick, ready]);

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

  /**
   * 按表单里的这一份检测一次。交回结果；回来时表单已经改了、或者又检测了一次，交回 null
   * （这个结果不算，也不往下走）
   */
  async function runTest(): Promise<ProviderTestResult | null> {
    const current = tests.start();
    setTesting(true);
    try {
      const r = await api.testProvider({
        provider: toInput(form),
        current: saved?.name,
      });
      // 回来时表单已经改了，或者又点了一次：这个结果不算（finally 里也不收转圈）
      if (!current()) return null;
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
      return r;
    } catch (e) {
      if (!current()) return null;
      const error = errorText(e);
      const r: ProviderTestResult = {
        ok: false,
        protocol: null,
        latency_ms: 0,
        models: { kind: "empty" },
        error: plain(error),
        balance: null,
      };
      setTest(r);
      setCatalog({
        source: "none",
        status: "failed",
        listed: [],
        checkedAtMs: Date.now(),
        error: plain(t.connectionFailed(error)),
      });
      return r;
    } finally {
      if (current()) setTesting(false);
    }
  }

  async function refreshModels() {
    // 连接信息改过：按表单里的新值去问；没改过：让 core 刷新已保存的那一家
    if (!saved || connectionChanged(form, saved)) {
      await runTest();
      return;
    }
    setRefreshing(true);
    try {
      setCatalog(catalogOf(await api.refreshProviderModels(saved.name)));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRefreshing(false);
    }
  }

  /** 第一步选了一种服务类型：预设填进表单，进到下一步 */
  function pickService(id: string) {
    setForm((f) => applyPreset(f, id, taken));
    enter("connection");
  }

  const original = saved?.name ?? null;
  const missing =
    section === "connection"
      ? signedIn
        ? ready
          ? null
          : t.signingIn
        : connectionMissing(form, original, taken)
      : section === "models"
        ? modelsMissing(form)
        : null;
  const blocking = connectionMissing(form, original, taken) ?? modelsMissing(form);

  async function save() {
    // 手动添加的输入框里还有没按回车的：先加上；写错了就不存，回到「模型」一节，毛病在那里说
    const added = entry.commit(true);
    if (added?.problem) {
      enter("models");
      return;
    }
    const f = added ? { ...form, ...added.patch } : form;
    // 登录建出的上游：「模型」「计费」两步没改过什么就不再写一次
    if (signedIn && saved && !editing && JSON.stringify(toInput(f)) === JSON.stringify(toInput(formFromView(saved)))) {
      onSaved(saved.name);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const save = {
        provider: toInput(f),
        base_version: base,
      };
      if (saved) await api.updateProvider(saved.name, save);
      else await api.createProvider(save);
      onSaved(f.name);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  /** 到某一步，记成走过 */
  function enter(to: Section) {
    setSection(to);
    setVisited((v) => new Set([...v, to]));
  }

  /**
   * 新建时从「连接」往后走都先检测（「下一步」、点步骤条上后面的步、「重试」）：检测过、
   * 通过了的直接走；通过了才走，没通过就留在这一步，底部说原因。检测回来时人已经退回
   * 别的步了，就不再替他往下走
   */
  async function checkThen(to: Section) {
    if (test?.ok) {
      enter(to);
      return;
    }
    const r = await runTest();
    if (r?.ok && here.current === "connection") enter(to);
  }

  /** 新建、不登录账号时，「连接」这一步往后走要先检测 */
  const checksOnNext = !editing && !signingIn && section === "connection";
  function go(to: Section) {
    const ahead = sections.findIndex((s) => s.id === to) > sections.findIndex((s) => s.id === section);
    if (checksOnNext && ahead) void checkThen(to);
    else enter(to);
  }
  const index = sections.findIndex((s) => s.id === section);
  const next = sections[index + 1]?.id;
  /** 新建时点「下一步」检测没通过：底部那一条。重试的时候留着，「重试」转圈 */
  const checkFailed = checksOnNext && test != null && !test.ok ? test : null;

  /**
   * 回不去的几步：登录进行中别的步都不能去（表单让位给了登录）；登录之后回不到第一步 ——
   * 上游已经建好了，换服务类型就是另一个上游
   */
  const locked = new Set<Section>(
    login.waiting ? CREATE_SECTIONS.filter((s) => s !== "connection") : signedIn ? ["service"] : [],
  );

  if (mode.kind === "edit" && !editing) {
    // 保存期间被别处删掉了
    return null;
  }

  /** 标题旁的服务类型：登录之后是登录时选的那一格 */
  const service = presetById(signedIn?.preset ?? form.preset);

  /**
   * 编辑 Z.ai / BigModel 的上游：认证方式是账号登录时，登录（或重新登录）换一把密钥。core 只在
   * 同名、同一边的标准地址上这样替换，所以只给能登录的那一边（`site`：登录过的那一边，或者
   * 打开时就在那一边的标准地址上）。表单里没保存的改动不带过去
   */
  const site = editing && form.preset === "zai" ? (form.saved?.site ?? null) : null;
  const zaiAccount: ZaiAccount | undefined =
    editing && site
      ? {
          family: site,
          signedIn: form.saved?.signedIn != null,
          onSignIn: () => onRelogin({ kind: "zai", name: editing.name, proxy: editing.proxy, family: site }),
        }
      : undefined;

  /** 登上的账号：登录时 core 给的；没有的话，ChatGPT 账号看上游的定义里记的 */
  const signedAccount: LoginAccount | null = signedIn
    ? (signedIn.account ??
      (saved?.oauth?.account
        ? { who: saved.oauth.account.email ?? null, plan: planLabel(saved.oauth.account.plan) }
        : null))
    : null;
  /** 「模型」一步顶上那一行：新建时登录的账号，或者点「下一步」检测通过的结果 */
  const modelsHead =
    mode.kind !== "create" ? undefined : signedIn ? (
      <AccountSummary
        kind={accountKind(signedIn.preset) ?? "chatgpt"}
        provider={signedIn.provider}
        account={signedAccount}
        family={signedIn.preset === "zai" ? signedIn.family : null}
      />
    ) : test?.ok ? (
      <CheckSummary result={test} />
    ) : undefined;
  /** 新建走到模型、计费时标题旁带上名称 */
  const named = mode.kind === "create" && (section === "models" || section === "billing") && form.name.trim() !== "";

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      {/*
        固定高度：切换分节时对话框不跳动；默认窗口里每一步都放得下，只有长列表在自己的框里
        滚，窗口更小时中间那一块滚。点到对话框外面不关 —— 填了一半的表单不该因为一次误点
        丢掉；Esc、×、取消照常。登录进行中关掉就是放弃这一次登录（`useAccountLogin` 卸载时取消）
      */}
      <DialogContent
        className="flex h-[min(88vh,760px)] flex-col gap-4 sm:max-w-[900px]"
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="flex-row items-center gap-3">
          {/* 新建：第一步还没选，标题旁没有标志；选定之后每一步都带着 */}
          {editing ? (
            // 认出来的服务：和新建时第二步一样带它的标志。没有固定地址的三种按服务画（企业网关是
            // 应用自己的标志），别的按这个上游实际的地址画（BigModel 那一边是智谱的标志）
            ["thinkwatch", "sub2api", "newapi"].includes(service.id) ? (
              <PresetTile preset={service} />
            ) : (
              <ProviderTile p={editing} />
            )
          ) : (
            section !== "service" && <PresetTile preset={service} />
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle className="tw-title">{editing ? t.titleEdit : t.titleNew}</DialogTitle>
            {editing && !account && service.id !== CUSTOM.id ? (
              // 认出来的服务：名字和服务类型，和新建时一样；地址、协议在表单里
              <DialogDescription className="truncate">
                <span className="font-mono text-foreground">{editing.name}</span> · {service.label}
              </DialogDescription>
            ) : editing ? (
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
                {section === "service" ? (
                  t.pickService
                ) : (
                  <>
                    {service.label}
                    {named && (
                      <>
                        {" · "}
                        <span className="font-mono text-foreground">{form.name.trim()}</span>
                      </>
                    )}
                  </>
                )}
              </DialogDescription>
            )}
          </div>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-4">
          <StepNav
            steps={sections}
            current={section}
            done={editing ? undefined : visited}
            locked={locked}
            onPick={go}
          />
          {section === "service" && (
            <div className="ml-auto">
              <ServiceSearch value={query} onChange={setQuery} />
            </div>
          )}
        </div>

        <div data-slot="upstream-dialog-body" className="-mx-4 flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-1">
          {section === "account" && editing && (
            <ChatgptAccountSection
              form={form}
              set={set}
              editing={editing}
              ov={ov}
              onRelogin={() => onRelogin({ kind: "chatgpt", name: editing.name, proxy: editing.proxy, family: "zai" })}
            />
          )}
          {section === "service" && (
            <ServiceSection
              // 表单从「自定义」起步，但还没点过就不标选中；退回来时标着上次选的
              value={visited.has("connection") ? form.preset : null}
              query={query}
              onPick={pickService}
            />
          )}
          {section === "connection" && (
            <div className="flex flex-col gap-3.5">
              <ConnectionHead
                form={form}
                signedIn={signedIn}
                frozen={login.waiting || signedIn != null}
                siteFrozen={siteLocked(form)}
                onAuth={(m) => setForm((f) => retarget(withAuth(f, m, taken)))}
                onSite={(family) => setForm((f) => retarget(withSite(f, family, taken)))}
              />
              {signingIn ? (
                <AccountStep
                  form={form}
                  set={set}
                  ov={ov}
                  login={login}
                  frozen={login.waiting || signedIn != null}
                  family={signedIn?.family ?? form.zaiFamily}
                  onNewProxy={() => setNested({ kind: "proxy" })}
                  signedIn={signedIn}
                  account={signedAccount}
                  onRelogin={() =>
                    signedIn &&
                    onRelogin({
                      kind: accountKind(signedIn.preset) ?? "chatgpt",
                      name: signedIn.provider,
                      proxy: saved?.proxy ?? form.proxy,
                      family: signedIn.family,
                    })
                  }
                />
              ) : (
                <ConnectionSection
                  form={form}
                  set={set}
                  editing={editing}
                  ov={ov}
                  preview={preview}
                  onNewProxy={() => setNested({ kind: "proxy" })}
                  account={zaiAccount}
                />
              )}
            </div>
          )}
          {section === "models" && (
            <ModelsSection
              head={modelsHead}
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
              originalName={original}
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

        {/*
          点「下一步」检测没通过：留在这一步，说 core 给的原因。「重试」再检测一次，「仍然继续」
          不检测往下走 —— 有的上游拒绝检测却能用，有的没有模型列表
        */}
        <Banner
          show={checkFailed != null}
          layout="inline"
          tone="error"
          title={t.checkFailed}
          actions={
            <>
              <Button variant="outline" size="sm" pending={testing} onClick={() => next && void checkThen(next)}>
                {c.retry}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => next && enter(next)}>
                {t.continueAnyway}
              </Button>
            </>
          }
        >
          <span className="select-text break-words">
            {checkFailed?.error ? coreText(checkFailed.error) : t.unknownError}
          </span>
        </Banner>

        <DialogError error={error} />

        <DialogFooter className="items-center">
          {editing ? (
            <>
              {/* 「检测连接」只在连接这一节，结果接在它右边 */}
              {section === "connection" ? (
                <CheckButton testing={testing} test={test} onTest={() => void runTest()} />
              ) : (
                <span className="flex-1" />
              )}
              {blocking && <span className="tw-label text-muted-foreground">{blocking}</span>}
              <Button variant="outline" onClick={onClose}>
                {c.cancel}
              </Button>
              <Button onClick={save} pending={saving} disabled={blocking != null}>
                {c.save}
              </Button>
            </>
          ) : (
            <>
              {/*
                分步走时「取消」放最左，「上一步 / 下一步」成组放右边。登录进行中左边那个是
                「取消登录」：回到登录之前，对话框留着。登录之后第二步没有「取消」—— 上游
                已经建好了，左边说清这一点；关掉对话框（×、Esc）不撤销登录
              */}
              {section === "connection" && signedIn ? (
                <span className="tw-label text-muted-foreground sm:mr-auto">{t.createdNote}</span>
              ) : login.waiting ? (
                <Button variant="outline" className="sm:mr-auto" onClick={() => void login.cancel()}>
                  {t.cancelSignIn}
                </Button>
              ) : (
                <Button variant="outline" className="sm:mr-auto" onClick={onClose}>
                  {c.cancel}
                </Button>
              )}
              {missing && <span className="tw-label text-muted-foreground">{missing}</span>}
              {index > 0 && !(section === "connection" && signedIn) && (
                <Button
                  variant="outline"
                  disabled={login.waiting}
                  onClick={() => enter(sections[index - 1]!.id)}
                >
                  {t.back}
                </Button>
              )}
              {/* 第一步点一格就往下走，没有「下一步」 */}
              {section === "service" ? null : next ? (
                <Button
                  onClick={() => go(next)}
                  pending={checksOnNext && testing}
                  disabled={missing != null}
                >
                  {t.next}
                </Button>
              ) : (
                <Button onClick={save} pending={saving} disabled={blocking != null}>
                  {signedIn ? t.finish : t.create}
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

/**
 * 第二步顶上：认证方式（这种服务有几种时）和 Z.ai / BigModel 的站点，两样都有时并排、各占
 * 一半。登录进行中和登录之后定住不能改 —— 登录用的就是这几样，上游已经按它们建好了。编辑时
 * 站点跟着账号走（`siteLocked`）：登录换来的密钥、要登录的账号都在那一边
 */
function ConnectionHead({
  form,
  signedIn,
  frozen,
  siteFrozen,
  onAuth,
  onSite,
}: {
  form: UpstreamForm;
  signedIn: SignedIn | null;
  frozen: boolean;
  siteFrozen: boolean;
  onAuth: (mode: AuthMode) => void;
  onSite: (family: ZaiFamily) => void;
}) {
  // 登录之后表单换成了那个上游的定义：这一行照登录时的样子画
  const shown: UpstreamForm = signedIn
    ? {
        ...form,
        preset: signedIn.preset,
        authMode: "account",
        zaiFamily: signedIn.family,
        baseUrl: ZAI_ENDPOINTS[signedIn.family],
        saved: null,
      }
    : form;
  const rules = fieldRules(shown);
  const auth = rules.auth.length > 1;
  if (!auth && !rules.site) return null;
  return (
    <div className={rules.site ? "grid grid-cols-2 gap-4" : undefined}>
      {auth && <AuthField form={shown} options={rules.auth} onChange={onAuth} disabled={frozen} />}
      {rules.site && <SiteField value={shown.zaiFamily} onChange={onSite} disabled={frozen || siteFrozen} />}
    </div>
  );
}

/**
 * 「账号」一步：名称和出站代理（和 API 密钥时同一行、同一个位置），下面是登录那一块；登录
 * 之后再回到这一步，那一块换成一行已登录的账号和「重新登录」。
 *
 * 名称的检查按 core 的规矩：ChatGPT 账号不能和已有的上游重名；Z.ai / BigModel 同名、
 * 同一个站点的上游是给它换一把密钥，写明是替换，不算重名。
 */
function AccountStep({
  form,
  set,
  ov,
  login,
  frozen,
  family,
  onNewProxy,
  signedIn,
  account,
  onRelogin,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  ov: Overview;
  login: AccountLogin;
  frozen: boolean;
  family: ZaiFamily;
  onNewProxy: () => void;
  signedIn: SignedIn | null;
  account: LoginAccount | null;
  onRelogin: () => void;
}) {
  const t = useText(upstreamDialogText);
  const name = form.name.trim();
  const existing = login.phase.at === "idle" && !signedIn ? ov.providers.find((p) => p.name === name) : undefined;
  const replaces =
    login.kind === "zai" &&
    existing != null &&
    existing.base_url.replace(/\/+$/, "") === ZAI_ENDPOINTS[family].replace(/\/+$/, "");
  const taken = existing != null && !replaces;
  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-2 gap-4">
        <FormItem label={t.name} htmlFor="up-name">
          <Input
            id="up-name"
            className="font-mono"
            value={form.name}
            disabled={frozen}
            aria-invalid={taken || undefined}
            onChange={(e) => set({ name: e.target.value })}
          />
          {taken && <p className="tw-label text-destructive">{t.nameTaken}</p>}
          {replaces && <p className="tw-label text-muted-foreground">{t.nameReplaces}</p>}
        </FormItem>
        <ProxyField
          ov={ov}
          value={form.proxy}
          onChange={(proxy) => set({ proxy })}
          onNewProxy={onNewProxy}
          disabled={frozen}
        />
      </div>
      {signedIn ? (
        <AccountLine
          kind={login.kind}
          account={account}
          family={signedIn.preset === "zai" ? signedIn.family : null}
          onRelogin={onRelogin}
        />
      ) : (
        <AccountPanel
          login={login}
          params={{ name: form.name, proxy: form.proxy, family }}
          blocked={name === "" || taken}
        />
      )}
    </div>
  );
}
