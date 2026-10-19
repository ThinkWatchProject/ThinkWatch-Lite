/**
 * 上游对话框的表单：从视图回填、转成交给 core 的输入、判断能不能往下走。
 *
 * **回填的是配置里写的原样**（地址、密钥、请求头），保存交回整份定义。只有 OAuth
 * 凭据没改时交「保持原样」：网关随时会换发 token、把新的 refresh token 写回，
 * 回填的那一把可能已经作废了。
 *
 * Bedrock 上游的凭据有三种：API 密钥（走 `key`），写在这里的访问密钥，或者从 AWS 的
 * profile 读访问密钥（后两种都在 `aws` 里）。
 *
 * 新建时第一步选的服务类型（`preset`）决定这张表单问什么：认证方式有哪几种、协议给不给
 * 选、要不要密钥、余额从哪里读（见 `presets.ts`）。编辑时没有预设，按「自定义」那一张。
 */
import { textOf } from "@/i18n";
import type {
  AwsKeys,
  BalanceSetting,
  BedrockDraft,
  Billing,
  HeaderInput,
  ImportProposal,
  ModelList,
  OAuthChange,
  OnProxyFail,
  PriceFields,
  PriceSheetInput,
  Protocol,
  ProviderInput,
  ProviderView,
  ZaiFamily,
} from "@/types";
import { globMatch } from "./glob";
import { bedrockRegionOf, bedrockUrl } from "./labels";
import {
  CHATGPT_HOST,
  CUSTOM,
  ZAI_ENDPOINTS,
  nameFromUrl,
  presetById,
  serviceOf,
  zaiSiteOf,
  type AuthMode,
} from "./presets";
import { upstreamFormText } from "./upstreamForm.i18n";

export type { AuthMode } from "./presets";

/** 请求头表里的一行 */
export interface HeaderRow {
  /** 只给列表渲染用，不发给 core */
  id: number;
  name: string;
  value: string;
}

let nextRow = 0;

export function headerRow(name = "", value = ""): HeaderRow {
  return { id: nextRow++, name, value };
}

/** OAuth 凭据里表单编辑的那几项 */
interface OAuthFields {
  endpoint: string;
  refresh: string;
  clientId: string;
  clientSecret: string;
}

/**
 * 编辑时打开那一刻配置里已经写着的几样。**写着的值一律显示**：哪怕它不在认出来的这种服务的
 * 规矩里（官方地址的上游配了 OAuth、本机的 Ollama 写了密钥），那一项照「自定义」的样子摆出来，
 * 不藏（`fieldRules`）。按打开时的定，不按正在改的 —— 改着改着那一栏自己消失是不行的
 */
export interface SavedTraits {
  authMode: AuthMode;
  protocol: Protocol | "";
  key: boolean;
  clientIdentity: boolean;
  /** 地址不是 Z.ai / BigModel 的标准地址 */
  otherUrl: boolean;
  /** 密钥是登录哪一边的账号换来的（配置里的 `signed_in:`）。手填的是 null */
  signedIn: ZaiFamily | null;
  /**
   * 登录账号能换这个上游的密钥的那一边：登录过的那一边，或者地址正是哪一边的标准地址。
   * 都不是（别的服务、别的地址）是 null —— core 只在同名、同一边的标准地址上换密钥
   */
  site: ZaiFamily | null;
  /**
   * 打开时认成「自定义」：「余额来源」那一栏一直在。改成 Sub2API 这类来源之后会认成那一种
   * 服务（`retarget`），那一栏不能跟着消失
   */
  balance: boolean;
}

/**
 * 导入链接带来的新价目表（`ImportSheet`）：计费一步里预先选着，「创建」时先建它、上游用它。
 * 在对话框里改的只是这一份草稿，创建之前不写配置
 */
export interface NewSheet {
  /** 价目表名称。null = 跟着上游的名称 */
  name: string | null;
  multiplier: number;
  models: Record<string, PriceFields>;
  /** 计费一步里选的是它（而不是默认价目表或已有的一张） */
  chosen: boolean;
}

export interface UpstreamForm {
  /**
   * 服务类型：新建时第一步选的那一格；编辑时按已保存的上游认出来的（`serviceOf`），
   * 改了地址跟着重认（`retarget`）
   */
  preset: string;
  /** Z.ai / BigModel 那一格选的站点：定了地址（API 密钥）或登录哪一边（账号） */
  zaiFamily: ZaiFamily;
  name: string;
  baseUrl: string;
  /** 空 = 自动识别 */
  protocol: Protocol | "";
  authMode: AuthMode;
  /** API 密钥，可以写 `${变量名}`。空 = 没有密钥 */
  key: string;
  headers: HeaderRow[];
  /** 编辑时回填的 OAuth 凭据。表单里这几项和它一样，就交「保持原样」 */
  oauthSaved: OAuthFields | null;
  oauthRefresh: string;
  oauthEndpoint: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthAccess: string;
  /** Bedrock 的访问密钥，可以写 `${变量名}` */
  awsKeyId: string;
  awsSecret: string;
  /** 会话令牌：临时凭证才有。空 = 没有 */
  awsToken: string;
  /** AWS 凭证文件里的 profile 名 */
  awsProfile: string;
  /** 签名用的区域。标准地址不用写（从地址读）；VPC 端点、代理这些地址要写 */
  awsRegion: string;
  /** 把客户端自己的 User-Agent 和身份信息发给这家。只给按客户端放行的上游打开 */
  forwardClientIdentity: boolean;
  proxy: string;
  onProxyFail: OnProxyFail;
  /**
   * 手动添加的模型（配置里这一家的 `models`）：上游能服务、却没列进模型列表的。不论上游给不给
   * 清单都算这家提供，和上游列出的合在一起
   */
  manualModels: string[];
  scope: "all" | "some";
  /** 指定范围：模型 ID 或通配规则 */
  scopeList: string[];
  /** 按量计费按价目表算（订阅账号也是），不计费记 $0 */
  billing: Billing;
  /** 空 = 默认价目表 */
  pricing: string;
  /** 同时最多发给这家几个请求，1 到 1000。空 = 不限 */
  maxConcurrent: string;
  disabled: boolean;
  /**
   * 配置里的 `balance:`。编辑时照原样回填、原样交回 —— 不交就是 `auto`，保存一次就把
   * 「不读」或者写明的来源改没了。新建时空着，按第一步选的服务类型写（`toInput`）
   */
  balance: BalanceSetting | null;
  /** 编辑时打开那一刻写着的几样；新建是 null */
  saved: SavedTraits | null;
  /** 导入链接带来的新价目表。没有是 null */
  newSheet: NewSheet | null;
}

/**
 * 预设和地址推出来的名称。**已被占用就加序号**（`anthropic-2`）—— 同一个服务
 * 配两个账号是常见用法，不该让人先撞上一次「名称已被使用」。
 */
export function freeName(base: string, taken: string[]): string {
  if (base === "" || !taken.includes(base)) return base;
  for (let i = 2; ; i++) {
    const name = `${base}-${i}`;
    if (!taken.includes(name)) return name;
  }
}

/**
 * 这张表单此刻默认叫什么：预设的名字；登录 ChatGPT 账号是 `chatgpt`，Z.ai / BigModel 按
 * 站点（和 core 登录时不给名字的叫法一样）。没有固定地址的（中转、自建网关）是空的，跟着
 * 地址猜
 */
export function defaultName(f: Pick<UpstreamForm, "preset" | "authMode" | "zaiFamily">): string {
  if (f.preset === "zai") return f.zaiFamily;
  if (f.preset === "openai" && f.authMode === "account") return "chatgpt";
  return presetById(f.preset).name;
}

/**
 * 名称是不是还没人动过：空的、还是这张表单默认的那个，或者是跟着地址猜的那个。动过的
 * 名称换服务类型、换认证方式、换站点时都留着
 */
function untouchedName(f: UpstreamForm, taken: string[]): boolean {
  const n = f.name;
  return n === "" || n === freeName(defaultName(f), taken) || n === freeName(nameFromUrl(f.baseUrl), taken);
}

/** 跟着改过的那几项重新起名：没动过的换成新的默认名，动过的留着 */
function renamed(prev: UpstreamForm, next: UpstreamForm, taken: string[]): string {
  return untouchedName(prev, taken) ? freeName(defaultName(next), taken) : prev.name;
}

/**
 * 新建的第一步选了一种服务类型：预设填进表单。
 *
 * 名称只在没被手动改过时跟着换；地址、协议、计费一律按预设 —— 这一步就是用来定这几样
 * 的。「自定义」清空地址和协议，交给人填。认证方式这一格没有的，换成它的第一种。
 */
export function applyPreset(form: UpstreamForm, id: string, taken: string[]): UpstreamForm {
  const next = presetById(id);
  const out: UpstreamForm = {
    ...form,
    preset: next.id,
    baseUrl: next.id === "zai" ? ZAI_ENDPOINTS[form.zaiFamily] : next.baseUrl,
    protocol: next.protocol,
    billing: next.billing ?? "per-token",
    authMode: next.auth.includes(form.authMode) ? form.authMode : next.auth[0]!,
    // 余额从哪里读只有「自定义」由人选，别的服务按这一格定（`toInput`）
    balance: next.id === CUSTOM.id ? form.balance : null,
  };
  return { ...out, name: renamed(form, out, taken) };
}

/**
 * 换认证方式。名称没动过就跟着换：OpenAI 用 API 密钥默认叫 `openai`，登录 ChatGPT
 * 账号默认叫 `chatgpt`。
 *
 * **编辑时名称不动**；Z.ai / BigModel 的上游换成账号登录，站点回到能登录的那一边（`site`）——
 * 登录换的是那一边账号的密钥
 */
export function withAuth(form: UpstreamForm, authMode: AuthMode, taken: string[]): UpstreamForm {
  const out = { ...form, authMode };
  const site = form.saved?.site;
  if (!form.saved) return { ...out, name: renamed(form, out, taken) };
  if (authMode !== "account" || form.preset !== "zai" || !site) return out;
  return {
    ...out,
    zaiFamily: site,
    baseUrl: zaiSiteOf(form.baseUrl) === site ? form.baseUrl : ZAI_ENDPOINTS[site],
  };
}

/** Z.ai / BigModel 换站点：地址跟着换，名称没动过也跟着换 */
export function withSite(form: UpstreamForm, zaiFamily: ZaiFamily, taken: string[]): UpstreamForm {
  const out = {
    ...form,
    zaiFamily,
    baseUrl: form.preset === "zai" ? ZAI_ENDPOINTS[zaiFamily] : form.baseUrl,
  };
  return { ...out, name: renamed(form, out, taken) };
}

/** Bedrock 的三种认证方式 */
const BEDROCK_AUTH: AuthMode[] = ["key", "aws-keys", "aws-profile"];

/**
 * 这张表单能选的认证方式，按服务实际有的。「自定义」是 API 密钥和 OAuth，地址是 Bedrock 的
 * 就是 Bedrock 那三种。只有一种时界面上不显示那一行。
 *
 * **编辑时**：OpenAI 没有登录账号这一项（ChatGPT 账号是另一个上游，不是编辑这一个）；
 * Z.ai / BigModel 有 —— 登录换来的是这个上游的一把新密钥，前提是它在能登录的那一边（`site`）。
 * 已保存的认证方式不在这种服务的规矩里时（官方地址配了 OAuth），给「自定义」那几种，写着的
 * 那一种照样在
 */
export function authOptions(
  f: Pick<UpstreamForm, "preset" | "protocol" | "baseUrl"> & { saved?: SavedTraits | null },
): AuthMode[] {
  const p = presetById(f.preset);
  const generic = isBedrock(f) ? BEDROCK_AUTH : CUSTOM.auth;
  if (p.id === CUSTOM.id) return generic;
  if (!f.saved) return p.auth;
  const keepAccount = p.id === "zai" && f.saved.site !== null;
  const own: AuthMode[] = p.auth.filter((m) => m !== "account" || keepAccount);
  return own.includes(f.saved.authMode) ? own : generic;
}

/**
 * 编辑时用的是登录账号换来的那把密钥：认证方式是账号登录，打开时配置里就记着是登录换来的。
 * 这时密钥那一栏的位置上是登录状态和「重新登录」
 */
export function signedInKey(f: UpstreamForm): boolean {
  return f.saved?.signedIn != null && authModeOf(f) === "account";
}

/**
 * Z.ai / BigModel 的站点能不能换。编辑时，登录换来的密钥属于那一边，换成账号登录时登的也是
 * 那一边（`withAuth`）：都不能换
 */
export function siteLocked(f: UpstreamForm): boolean {
  return f.saved != null && (f.saved.signedIn != null || authModeOf(f) === "account");
}

/** 这张表单显示哪几项。见 `fieldRules` */
export interface FieldRules {
  /** 能选的认证方式。只有一种时不显示那一行 */
  auth: AuthMode[];
  /** Z.ai / BigModel 的站点那一行：地址是两个标准地址之一 */
  site: boolean;
  /** 接口地址那一栏 */
  url: boolean;
  /** 接口协议：null 不显示（这种服务只有一种、而且就是它）；`all` 全部外加自动识别 */
  protocols: Protocol[] | "all" | null;
  /** API 密钥那一栏（认证方式是 API 密钥时） */
  key: boolean;
  /** 「转发客户端身份」 */
  clientIdentity: boolean;
  /** 「余额来源」：只有「自定义」（编辑时打开那一刻是「自定义」的也算） */
  balance: boolean;
}

/**
 * 地址自动识别出的协议，和 core 认的是同一套（`Provider::guess_protocol`）：ChatGPT 的后端、
 * 标准 Bedrock 地址、Anthropic、Gemini、OpenAI 的官方地址。别的认不出
 */
export function guessProtocol(url: string): Protocol | "" {
  const u = url.toLowerCase();
  if (u.includes("chatgpt.com/backend-api")) return "chatgpt";
  if (bedrockRegionOf(url.trim()) !== null) return "bedrock";
  if (u.includes("api.anthropic.com")) return "anthropic";
  if (u.includes("generativelanguage.googleapis.com")) return "gemini";
  if (u.includes("api.openai.com")) return "openai-chat";
  return "";
}

/**
 * 这张表单显示哪几项：**不问这种服务已经定了的事**（选了那一格，或者编辑时认出来的那一种），
 * **也不藏写着的值**。新建和编辑同一套规矩，编辑时多一条：打开时配置里写着、却不在这种服务的
 * 规矩里的那一项，照「自定义」的样子显示（`saved`）。
 *
 * · 协议：这种服务只有一种、写着的（或地址认出来的）正是它，不显示；有得选的只在那几种里选；
 *   写着的不在其中，给全部。
 * · 地址：Z.ai / BigModel 由站点定，标准地址时不显示；别的服务一律显示。
 * · 密钥：本机的 Ollama 不显示，写着密钥时照样显示。
 * · 转发客户端身份：只有中转站和自定义有；打开着的照样显示。
 */
export function fieldRules(f: UpstreamForm): FieldRules {
  const p = presetById(f.preset);
  const s = f.saved;
  const site = p.id === "zai" && zaiSiteOf(f.baseUrl) !== null;
  /** 这一个协议值算不算「就是这种服务定的那个」 */
  const fixedOk = (v: Protocol | "") => (v || guessProtocol(f.baseUrl)) === p.protocol;
  const listOk = (list: Protocol[], v: Protocol | "") => v !== "" && list.includes(v);
  let protocols: Protocol[] | "all" | null;
  if (!p.protocols) protocols = fixedOk(f.protocol) && (!s || fixedOk(s.protocol)) ? null : "all";
  else if (p.protocols === "all") protocols = "all";
  else protocols = listOk(p.protocols, f.protocol) && (!s || listOk(p.protocols, s.protocol)) ? p.protocols : "all";
  return {
    auth: authOptions(f),
    site,
    url: !p.fixedUrl || !site || !!s?.otherUrl,
    protocols,
    key: authModeOf(f) === "key" && (p.key !== "none" || !!s?.key),
    clientIdentity: !!p.clientIdentity || !!s?.clientIdentity,
    balance: p.id === CUSTOM.id || !!s?.balance,
  };
}

/**
 * 编辑时改了地址（或协议）：按改过的重新认是哪一种服务。官方地址改成了别的主机，从此就是
 * 「自定义」，问的也是完整的那一张。新建时服务类型是第一步选的，不重认
 */
export function retarget(f: UpstreamForm): UpstreamForm {
  if (!f.saved) return f;
  const r = serviceOf({ baseUrl: f.baseUrl, protocol: f.protocol, balance: f.balance, signedIn: f.saved.signedIn });
  return r.preset === f.preset && (r.preset !== "zai" || r.family === f.zaiFamily)
    ? f
    : { ...f, preset: r.preset, zaiFamily: r.preset === "zai" ? r.family : f.zaiFamily };
}

/**
 * 新建时的空表单。服务类型在第一步选，从「自定义」开始。Z.ai / BigModel 的站点默认是
 * BigModel（中国大陆）
 */
export function blankForm(): UpstreamForm {
  return {
    preset: CUSTOM.id,
    zaiFamily: "bigmodel",
    name: "",
    baseUrl: "",
    protocol: "",
    authMode: "key",
    key: "",
    headers: [],
    oauthSaved: null,
    oauthRefresh: "",
    oauthEndpoint: "",
    oauthClientId: "",
    oauthClientSecret: "",
    oauthAccess: "",
    awsKeyId: "",
    awsSecret: "",
    awsToken: "",
    awsProfile: "",
    awsRegion: "",
    forwardClientIdentity: false,
    proxy: "direct",
    onProxyFail: "fail",
    manualModels: [],
    scope: "all",
    scopeList: [],
    billing: "per-token",
    pricing: "",
    maxConcurrent: "",
    disabled: false,
    balance: null,
    saved: null,
    newSheet: null,
  };
}

/**
 * 按客户端原来直连 Bedrock 时的设置新建：接管确认框里「新建 Bedrock 上游」带过来的那一份
 * （`BedrockDraft`，tw-adopt 按客户端自己的找法算的）。
 *
 * 凭据是 `${变量名}` 或 profile 的名字，照原样填；没找到能用的就空着，由人来填。地址没给
 * 就是那个区域的标准地址，给了（VPC 端点、代理）区域另写。
 */
export function formFromDraft(d: BedrockDraft, taken: string[]): UpstreamForm {
  const baseUrl = d.base_url ?? bedrockUrl(d.region);
  const a = d.auth;
  return {
    ...blankForm(),
    preset: "bedrock",
    name: freeName("bedrock", taken),
    baseUrl,
    protocol: "bedrock",
    awsRegion: bedrockRegionOf(baseUrl) === null ? d.region : "",
    authMode: a.kind === "keys" ? "aws-keys" : a.kind === "profile" ? "aws-profile" : "key",
    key: a.kind === "key" ? a.key : "",
    awsKeyId: a.kind === "keys" ? a.access_key_id : "",
    awsSecret: a.kind === "keys" ? a.secret_access_key : "",
    awsToken: a.kind === "keys" ? (a.session_token ?? "") : "",
    awsProfile: a.kind === "profile" ? a.profile : "",
  };
}

export function formFromView(p: ProviderView): UpstreamForm {
  const protocol: Protocol | "" = p.protocol_explicit ? (p.protocol ?? "") : "";
  // 登录 Z.ai / BigModel 账号换来的密钥：认证方式是账号登录，不是手填的 API 密钥
  const authMode: AuthMode = p.oauth
    ? "oauth"
    : p.aws?.profile
      ? "aws-profile"
      : p.aws
        ? "aws-keys"
        : p.signed_in
          ? "account"
          : "key";
  const balance = p.balance_setting;
  // ChatGPT 账号认出来是「自定义」：它有自己的「账号」一节，不走连接那张表单
  const service = serviceOf({
    baseUrl: p.base_url,
    protocol: p.protocol === "chatgpt" ? "chatgpt" : protocol,
    balance,
    signedIn: p.signed_in,
  });
  return {
    preset: service.preset,
    zaiFamily: service.family,
    name: p.name,
    baseUrl: p.base_url,
    protocol,
    authMode,
    key: p.key ?? "",
    headers: (p.headers ?? []).map((h) => headerRow(h.name, h.value)),
    oauthSaved: p.oauth
      ? {
          endpoint: p.oauth.endpoint,
          refresh: p.oauth.refresh,
          clientId: p.oauth.client_id ?? "",
          clientSecret: p.oauth.client_secret ?? "",
        }
      : null,
    oauthRefresh: p.oauth?.refresh ?? "",
    oauthEndpoint: p.oauth?.endpoint ?? "",
    oauthClientId: p.oauth?.client_id ?? "",
    oauthClientSecret: p.oauth?.client_secret ?? "",
    oauthAccess: "",
    awsKeyId: p.aws?.access_key_id ?? "",
    awsSecret: p.aws?.secret_access_key ?? "",
    awsToken: p.aws?.session_token ?? "",
    awsProfile: p.aws?.profile ?? "",
    awsRegion: p.aws?.region ?? "",
    forwardClientIdentity: p.forward_client_identity,
    proxy: p.proxy,
    onProxyFail: p.on_proxy_fail,
    manualModels: p.models,
    scope: p.models_only ? "some" : "all",
    scopeList: p.models_only ?? [],
    billing: p.billing === "free" ? "free" : "per-token",
    pricing: p.pricing ?? "",
    maxConcurrent: p.max_concurrent != null ? String(p.max_concurrent) : "",
    disabled: p.disabled,
    balance,
    saved: {
      authMode,
      protocol,
      key: (p.key ?? "") !== "",
      clientIdentity: p.forward_client_identity,
      otherUrl: zaiSiteOf(p.base_url) === null,
      signedIn: p.signed_in,
      site: service.preset === "zai" ? (p.signed_in ?? zaiSiteOf(p.base_url)) : null,
      balance: service.preset === CUSTOM.id,
    },
    newSheet: null,
  };
}

/**
 * 按一条导入链接（`ImportProposal`，Rust 侧逐项校验过）新建：服务类型、认证方式、站点是链接
 * 选的，别的照链接填，链接没给的照这种服务新建时的样子填（地址、协议、计费方式、名称）。
 *
 * 名称没给时和新建时一样起：有固定名字的服务用它（登录 ChatGPT 账号是 `chatgpt`，Z.ai /
 * BigModel 按站点），没有的跟着地址猜，被占用就加序号。**链接给的名称被占用时照样填**：
 * 由人改一个，和手填一样
 */
export function formFromImport(p: ImportProposal, taken: string[]): UpstreamForm {
  const preset = presetById(p.service);
  const zaiFamily: ZaiFamily = p.site ?? "bigmodel";
  const baseUrl =
    p.base_url ??
    (p.service === "zai" ? ZAI_ENDPOINTS[zaiFamily] : p.service === "bedrock" && p.region ? bedrockUrl(p.region) : preset.baseUrl);
  const form: UpstreamForm = {
    ...blankForm(),
    preset: preset.id,
    zaiFamily,
    baseUrl,
    protocol: p.protocol ?? preset.protocol,
    authMode: p.auth,
    key: p.key ?? "",
    headers: p.headers.map((h) => headerRow(h.name, h.value)),
    oauthRefresh: p.oauth?.refresh ?? "",
    oauthEndpoint: p.oauth?.endpoint ?? "",
    oauthClientId: p.oauth?.client_id ?? "",
    oauthClientSecret: p.oauth?.client_secret ?? "",
    awsKeyId: p.aws?.access_key_id ?? "",
    awsSecret: p.aws?.secret_access_key ?? "",
    awsToken: p.aws?.session_token ?? "",
    // 标准地址的区域就在地址里；VPC 端点、代理这类地址签名用的区域另写
    awsRegion: p.region && bedrockRegionOf(baseUrl) === null ? p.region : "",
    forwardClientIdentity: p.client_identity,
    maxConcurrent: p.concurrency != null ? String(p.concurrency) : "",
    manualModels: p.models,
    scope: p.models_only ? "some" : "all",
    scopeList: p.models_only ?? [],
    billing: p.billing ?? preset.billing ?? "per-token",
    balance: p.balance,
    newSheet: p.price_sheet
      ? {
          name: null,
          multiplier: p.price_sheet.multiplier,
          models: Object.fromEntries(
            p.price_sheet.prices.map(({ model, ...price }) => [model, price satisfies PriceFields]),
          ),
          chosen: true,
        }
      : null,
  };
  return { ...form, name: p.name ?? freeName(defaultName(form) || nameFromUrl(baseUrl), taken) };
}

/**
 * 导入的对话框里第一步换了一种服务：预设照常填进来（`applyPreset`），链接里新的这种服务也收的
 * 几项留着 —— 没有固定地址时的地址、它能选的协议、链接写明的计费方式。余额从哪里读只有
 * 「自定义」收。别的（密钥、请求头、模型、价目表……）本来就留在表单里，这种服务不显示的那几栏
 * 不交给 core（`toInput`）
 */
export function withImportedService(prev: UpstreamForm, next: UpstreamForm, p: ImportProposal): UpstreamForm {
  const preset = presetById(next.preset);
  const protocols = preset.protocols;
  const protocolOk =
    prev.protocol !== "" && (protocols === "all" || (Array.isArray(protocols) && protocols.includes(prev.protocol)));
  return {
    ...next,
    baseUrl: preset.baseUrl === "" && prev.baseUrl.trim() !== "" ? prev.baseUrl : next.baseUrl,
    protocol: protocolOk ? prev.protocol : next.protocol,
    billing: p.billing ?? next.billing,
  };
}

/**
 * 导入的对话框顶上那一句说的主机：请求和密钥发往哪里（ASCII，IDN 是 punycode），OAuth 的
 * Token 端点在别的主机上时也写上。登录账号时是登录之后请求发往的那一边
 */
export function importHosts(f: UpstreamForm): string[] {
  const host = (u: string) => {
    try {
      return new URL(u.trim()).host;
    } catch {
      return "";
    }
  };
  const mode = authModeOf(f);
  const main =
    mode === "account" ? (f.preset === "openai" ? CHATGPT_HOST : host(ZAI_ENDPOINTS[f.zaiFamily])) : host(f.baseUrl);
  const out = main ? [main] : [];
  const token = mode === "oauth" ? host(f.oauthEndpoint) : "";
  if (token && !out.includes(token)) out.push(token);
  return out;
}

/**
 * 导入的对话框里，请求或者 OAuth 的 Token 端点走的是明文的 `http://`、又不是这台机器（链接
 * 只能给内网的这种地址，`import_link.rs` 的 `plain_http_ok`）：顶上那一句下面再说一句不加密
 */
export function importPlainText(f: UpstreamForm): boolean {
  const plain = (u: string) => {
    try {
      const x = new URL(u.trim());
      return x.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(x.hostname);
    } catch {
      return false;
    }
  };
  const mode = authModeOf(f);
  if (mode === "account") return false;
  return plain(f.baseUrl) || (mode === "oauth" && plain(f.oauthEndpoint));
}

/** 新价目表此刻叫什么：写过名称用它，没写跟着上游的名称 */
export function newSheetName(f: Pick<UpstreamForm, "newSheet" | "name">): string {
  return (f.newSheet?.name ?? f.name).trim();
}

/** 「创建」时要先建的那张新价目表：选着它、按量计费时才有 */
export function sheetToCreate(f: UpstreamForm): PriceSheetInput | null {
  const s = f.newSheet;
  if (!s?.chosen || f.billing !== "per-token") return null;
  return { name: newSheetName(f), multiplier: s.multiplier, models: s.models };
}

/** 新价目表缺什么：名称空着，或者已被占用（由人改一个，和上游重名一样） */
export function sheetMissing(f: UpstreamForm, sheets: readonly { name: string }[]): string | null {
  const s = sheetToCreate(f);
  if (!s) return null;
  const t = textOf(upstreamFormText);
  if (s.name === "") return t.sheetName;
  if (sheets.some((x) => x.name === s.name)) return t.sheetTaken(s.name);
  return null;
}

/**
 * 「设置价格」新建价目表时预填什么：要设价格的模型，**这个上游**（已在配置里时）—— 建好就由它
 * 使用，下次再设价格编辑的就是这一张，不会再新建；名称用上游的名字（没被占用时，占用了就留空
 * 由人起）。还没保存的上游不在配置里，用不了：留给对话框「保存」时选上
 */
export function sheetPrefill(
  models: string[],
  upstream: string | null,
  sheets: readonly { name: string }[],
): { models: string[]; usedBy: string[]; name?: string } {
  if (!upstream) return { models, usedBy: [] };
  return { models, usedBy: [upstream], name: sheets.some((s) => s.name === upstream) ? undefined : upstream };
}

/**
 * 这一家是 Bedrock：协议选的就是它，或者自动识别、地址是标准的 Bedrock 地址（core 按
 * 同一个规矩认）。**不等识别结果**：那是异步的，换地址的一瞬间会闪一下
 */
export function isBedrock(f: Pick<UpstreamForm, "protocol" | "baseUrl">): boolean {
  return f.protocol === "bedrock" || (f.protocol === "" && bedrockRegionOf(f.baseUrl) !== null);
}

/**
 * 实际生效的认证方式。换了协议之后原来那种不再适用（Bedrock 不收 OAuth，访问密钥
 * 只给 Bedrock），换了服务类型之后它没有的那种也不算：按 API 密钥算。**表单里填过的
 * 留着**，切回来还在
 */
export function authModeOf(f: UpstreamForm): AuthMode {
  return authOptions(f).includes(f.authMode) ? f.authMode : "key";
}

/** OAuth 凭据和回填的一样：保存时交「保持原样」，检测时用网关现有的 token */
export function oauthKept(f: UpstreamForm): boolean {
  const s = f.oauthSaved;
  return (
    s != null &&
    f.oauthEndpoint.trim() === s.endpoint &&
    f.oauthRefresh.trim() === s.refresh &&
    f.oauthClientId.trim() === s.clientId &&
    f.oauthClientSecret.trim() === s.clientSecret
  );
}

function headerInputs(f: UpstreamForm): HeaderInput[] {
  return f.headers
    .filter((r) => r.name.trim() !== "" || r.value.trim() !== "")
    .map((r) => ({ name: r.name.trim(), value: r.value.trim() }));
}

function oauthChange(f: UpstreamForm): OAuthChange {
  if (authModeOf(f) !== "oauth") return { mode: "none" };
  if (oauthKept(f)) return { mode: "keep" };
  return {
    mode: "set",
    refresh: f.oauthRefresh.trim(),
    endpoint: f.oauthEndpoint.trim(),
    client_id: f.oauthClientId.trim() || undefined,
    client_secret: f.oauthClientSecret.trim() || undefined,
    access: f.oauthAccess.trim() || undefined,
  };
}

/** 访问密钥或 profile。**只交当前这种认证方式的**：切走之后留在表单里的不算 */
function awsInput(f: UpstreamForm): AwsKeys | undefined {
  const region = f.awsRegion.trim() || undefined;
  const mode = authModeOf(f);
  if (mode === "aws-keys") {
    return {
      access_key_id: f.awsKeyId.trim(),
      secret_access_key: f.awsSecret.trim(),
      session_token: f.awsToken.trim() || undefined,
      region,
    };
  }
  if (mode === "aws-profile") return { profile: f.awsProfile.trim(), region };
  return undefined;
}

/**
 * 交给 core 的定义。**余额从哪里读**：「自定义」在高级设置里选（「余额来源」）；别的服务
 * 编辑时是配置里原来写的那个，原样交回，新建时由第一步选的服务类型定（Sub2API、New API、
 * ThinkWatch 企业网关），别的不给，就是自动。
 *
 * 编辑时认证方式是账号登录：密钥那一栏不显示，配置里的那把**原样交回** —— core 见密钥
 * 没变，就还记着它是登录换来的；不交就是把密钥删了
 */
export function toInput(f: UpstreamForm): ProviderInput {
  const balance = f.balance ?? presetById(f.preset).balance;
  const sendKey = fieldRules(f).key || (f.saved != null && authModeOf(f) === "account");
  return {
    name: f.name,
    base_url: f.baseUrl.trim(),
    ...(balance ? { balance } : {}),
    key: sendKey ? f.key.trim() || undefined : undefined,
    headers: headerInputs(f),
    oauth: oauthChange(f),
    aws: awsInput(f),
    protocol: f.protocol || undefined,
    // 这种服务不给开的不交：第一步换了服务类型，之前打开的那一项不跟过去
    forward_client_identity: f.forwardClientIdentity && fieldRules(f).clientIdentity,
    proxy: f.proxy,
    on_proxy_fail: f.onProxyFail,
    models: f.manualModels,
    models_only: f.scope === "some" ? f.scopeList : undefined,
    billing: f.billing,
    pricing: f.pricing || undefined,
    max_concurrent: concurrencyOf(f) ?? undefined,
    disabled: f.disabled,
  };
}

/**
 * 「高级设置」里的几项有没有不是默认值的：写了请求头、打开了转发客户端身份、代理不可用时
 * 改为直连、写了并发上限、「自定义」的余额来源不是自动识别。**有就自动展开** —— 收着的一节里
 * 藏着一项在起作用的设置，和没写一样看不见。只有名称或只有值的请求头也算：那一行正等着补全，
 * 保存按不下去
 */
export function advancedNonDefault(f: UpstreamForm): boolean {
  return (
    f.headers.some((h) => h.name.trim() !== "" || h.value.trim() !== "") ||
    f.forwardClientIdentity ||
    f.onProxyFail !== "fail" ||
    f.maxConcurrent.trim() !== "" ||
    (fieldRules(f).balance && (f.balance ?? "auto") !== "auto")
  );
}

/** 并发上限最多写多少（core 的 `MAX_PROVIDER_CONCURRENCY`） */
export const MAX_CONCURRENCY = 1000;

/** 格子里的并发上限：空是不限（`null`），写的不是 1 到 1000 的整数是 `undefined` */
export function concurrencyOf(f: UpstreamForm): number | null | undefined {
  const v = f.maxConcurrent.trim();
  if (v === "") return null;
  if (!/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 && n <= MAX_CONCURRENCY ? n : undefined;
}

/**
 * 连接信息和已保存的那一家比改过没有：地址、协议、凭据、请求头、出站代理。
 * 改过的话，模型列表要按表单里的新值去问。
 */
export function connectionChanged(f: UpstreamForm, p: ProviderView): boolean {
  const pick = (i: ProviderInput) =>
    JSON.stringify([i.base_url, i.protocol, i.key, i.headers, i.oauth, i.aws, i.proxy]);
  return pick(toInput(f)) !== pick(toInput(formFromView(p)));
}

/**
 * 连接这一节缺什么。**只查必填与重名** —— 写法对不对由 core 说。
 *
 * `original`：编辑时的原名，保持原名不算重名。
 */
export function connectionMissing(
  f: UpstreamForm,
  original: string | null,
  taken: string[],
): string | null {
  const t = textOf(upstreamFormText);
  const mode = authModeOf(f);
  // 登录账号：名称、重名由登录那一块自己查（Z.ai 同名同站点是换密钥，不算重名），
  // 上游在登录成功时由 core 写进配置。编辑时已经是登录换来的密钥，照常往下查；从 API 密钥
  // 换成账号登录的，要先登录
  if (mode === "account" && !f.saved?.signedIn) return t.signIn;
  const name = f.name.trim();
  if (name === "") return t.name;
  if (name !== original && taken.includes(name)) return t.nameTaken(name);
  if (f.baseUrl.trim() === "") return t.baseUrl;
  // core 不收的两种写法（`config.base_url_backslash`、`config.base_url_userinfo`）：在这里就说
  if (f.baseUrl.includes("\\")) return t.baseUrlBackslash;
  if (/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*@/i.test(f.baseUrl.trim())) return t.baseUrlUserinfo;
  // 新建时才要求：已保存的上游可能用自己写的请求头鉴权，编辑它不该被一个空的密钥栏拦住
  if (!f.saved && mode === "key" && presetById(f.preset).key === "required" && f.key.trim() === "") return t.key;
  if (
    mode === "oauth" &&
    !oauthKept(f) &&
    (f.oauthRefresh.trim() === "" || f.oauthEndpoint.trim() === "")
  )
    return t.oauth;
  if (mode === "aws-keys" && (f.awsKeyId.trim() === "" || f.awsSecret.trim() === "")) return t.accessKeys;
  if (mode === "aws-profile" && f.awsProfile.trim() === "") return t.profile;
  for (const r of f.headers) {
    const header = r.name.trim();
    if (header === "" && r.value.trim() === "") continue;
    if (header === "") return t.headerName;
    if (r.value.trim() === "") return t.headerValue(header);
  }
  if (concurrencyOf(f) === undefined) return t.concurrency;
  return null;
}

/** 这个模型在不在启用范围里。和 core 同一套通配规则 */
export function inScope(f: Pick<UpstreamForm, "scope" | "scopeList">, model: string): boolean {
  return f.scope === "all" || f.scopeList.some((p) => globMatch(p, model));
}

/**
 * 手动添加几个模型（已经查过写法，见 `addToList`）。
 *
 * **指定了启用范围时一并勾上。**手动添加就是为了用它：留在范围外面，加完了不生效，这一节里
 * 只多出一个没勾的格子，很容易看漏。勾上之后照样能取消。通配规则已经覆盖的不再写一遍；
 * 「全部模型」时本来就在范围里，留着的那份指定清单不动。
 */
export function withManualAdded(f: UpstreamForm, ids: readonly string[]): Partial<UpstreamForm> {
  const manualModels = [...f.manualModels, ...ids];
  if (f.scope !== "some") return { manualModels };
  const outside = ids.filter((id) => !inScope(f, id));
  return outside.length > 0 ? { manualModels, scopeList: [...f.scopeList, ...outside] } : { manualModels };
}

/**
 * 移除一个手动添加的模型。`listed`：上游自己也列了它 —— 那一行还在，只是不再标「手动」，
 * 启用范围不动。上游没列的，这一行就没了：启用范围里写着它的那一项也一起去掉，不然「指定
 * 模型」里看着还有一个勾，实际一个也没启用（通配规则不动，它们说的不止这一个）。
 */
export function withManualRemoved(f: UpstreamForm, id: string, listed: boolean): Partial<UpstreamForm> {
  const manualModels = f.manualModels.filter((m) => m !== id);
  if (listed) return { manualModels };
  return { manualModels, scopeList: f.scopeList.filter((p) => p !== id) };
}

export function modelsMissing(f: UpstreamForm): string | null {
  if (f.scope === "some" && f.scopeList.length === 0) return textOf(upstreamFormText).pickModel;
  return null;
}

/** 检测结果里模型列表那一段怎么说 */
export function describeModelList(m: ModelList): string {
  const t = textOf(upstreamFormText);
  switch (m.kind) {
    case "listed":
      return t.found(m.models.length);
    case "not_implemented":
      return t.notImplemented(m.status);
    case "unrecognized":
      return t.unrecognized;
    case "empty":
      return t.empty;
  }
}
