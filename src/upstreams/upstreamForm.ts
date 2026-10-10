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
  BedrockDraft,
  Billing,
  HeaderInput,
  ModelList,
  OAuthChange,
  OnProxyFail,
  Protocol,
  ProviderInput,
  ProviderView,
  ZaiFamily,
} from "@/types";
import { globMatch } from "./glob";
import { bedrockRegionOf, bedrockUrl } from "./labels";
import { CUSTOM, ZAI_ENDPOINTS, nameFromUrl, presetById, type AuthMode } from "./presets";
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

export interface UpstreamForm {
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
  };
  return { ...out, name: renamed(form, out, taken) };
}

/**
 * 换认证方式。名称没动过就跟着换：OpenAI 用 API 密钥默认叫 `openai`，登录 ChatGPT
 * 账号默认叫 `chatgpt`
 */
export function withAuth(form: UpstreamForm, authMode: AuthMode, taken: string[]): UpstreamForm {
  const out = { ...form, authMode };
  return { ...out, name: renamed(form, out, taken) };
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
 * 这张表单能选的认证方式，按服务实际有的。「自定义」（编辑时也按它）是 API 密钥和 OAuth，
 * 地址是 Bedrock 的就是 Bedrock 那三种。只有一种时界面上不显示那一行
 */
export function authOptions(f: Pick<UpstreamForm, "preset" | "protocol" | "baseUrl">): AuthMode[] {
  const p = presetById(f.preset);
  if (p.id === CUSTOM.id) return isBedrock(f) ? BEDROCK_AUTH : CUSTOM.auth;
  return p.auth;
}

/** 新建时的空表单。服务类型在第一步选，从「自定义」开始 */
export function blankForm(): UpstreamForm {
  return {
    preset: CUSTOM.id,
    zaiFamily: "zai",
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
  return {
    preset: "custom",
    zaiFamily: "zai",
    name: p.name,
    baseUrl: p.base_url,
    protocol: p.protocol_explicit ? (p.protocol ?? "") : "",
    authMode: p.oauth ? "oauth" : p.aws?.profile ? "aws-profile" : p.aws ? "aws-keys" : "key",
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
  };
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
 * 交给 core 的定义。**余额从哪里读由第一步选的服务类型定**（Sub2API、New API、ThinkWatch
 * 企业网关），不给就是自动：按地址认，认不出来探测一次。界面上没有选余额来源的地方
 */
export function toInput(f: UpstreamForm): ProviderInput {
  const balance = presetById(f.preset).balance;
  return {
    name: f.name,
    base_url: f.baseUrl.trim(),
    ...(balance ? { balance } : {}),
    key: authModeOf(f) === "key" && presetById(f.preset).key !== "none" ? f.key.trim() || undefined : undefined,
    headers: headerInputs(f),
    oauth: oauthChange(f),
    aws: awsInput(f),
    protocol: f.protocol || undefined,
    forward_client_identity: f.forwardClientIdentity,
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
  // 上游在登录成功时由 core 写进配置
  if (mode === "account") return t.signIn;
  const name = f.name.trim();
  if (name === "") return t.name;
  if (name !== original && taken.includes(name)) return t.nameTaken(name);
  if (f.baseUrl.trim() === "") return t.baseUrl;
  if (mode === "key" && presetById(f.preset).key === "required" && f.key.trim() === "") return t.key;
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
