/**
 * 上游对话框的表单：从视图回填、转成交给 core 的输入、判断能不能往下走。
 *
 * **回填的是配置里写的原样**（地址、密钥、请求头），保存交回整份定义。只有 OAuth
 * 凭据没改时交「保持原样」：网关随时会换发 token、把新的 refresh token 写回，
 * 回填的那一把可能已经作废了。
 */
import { textOf } from "@/i18n";
import type {
  Billing,
  HeaderInput,
  ModelList,
  OAuthChange,
  OnProxyFail,
  Protocol,
  ProviderInput,
  ProviderView,
} from "@/types";
import { CUSTOM } from "./presets";
import { upstreamFormText } from "./upstreamForm.i18n";

export type AuthMode = "key" | "oauth";

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
  proxy: string;
  onProxyFail: OnProxyFail;
  /** 服务不提供模型列表时的手动清单 */
  manualModels: string[];
  scope: "all" | "some";
  /** 指定范围：模型 ID 或通配规则 */
  scopeList: string[];
  /** 按量计费按价目表算（订阅账号也是），不计费记 $0 */
  billing: Billing;
  /** 空 = 默认价目表 */
  pricing: string;
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

/** 新建时的空表单。服务类型从「自定义」开始，在对话框里选 */
export function blankForm(): UpstreamForm {
  return {
    preset: CUSTOM.id,
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
    proxy: "direct",
    onProxyFail: "fail",
    manualModels: [],
    scope: "all",
    scopeList: [],
    billing: "per-token",
    pricing: "",
    disabled: false,
  };
}

export function formFromView(p: ProviderView): UpstreamForm {
  return {
    preset: "custom",
    name: p.name,
    baseUrl: p.base_url,
    protocol: p.protocol_explicit ? (p.protocol ?? "") : "",
    authMode: p.oauth ? "oauth" : "key",
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
    proxy: p.proxy,
    onProxyFail: p.on_proxy_fail,
    manualModels: p.models,
    scope: p.models_only ? "some" : "all",
    scopeList: p.models_only ?? [],
    billing: p.billing === "free" ? "free" : "per-token",
    pricing: p.pricing ?? "",
    disabled: p.disabled,
  };
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
  if (f.authMode === "key") return { mode: "none" };
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

export function toInput(f: UpstreamForm): ProviderInput {
  return {
    name: f.name,
    base_url: f.baseUrl.trim(),
    key: f.authMode === "key" ? f.key.trim() || undefined : undefined,
    headers: headerInputs(f),
    oauth: oauthChange(f),
    protocol: f.protocol || undefined,
    proxy: f.proxy,
    on_proxy_fail: f.onProxyFail,
    models: f.manualModels,
    models_only: f.scope === "some" ? f.scopeList : undefined,
    billing: f.billing,
    pricing: f.pricing || undefined,
    disabled: f.disabled,
  };
}

/**
 * 连接信息和已保存的那一家比改过没有：地址、协议、凭据、请求头、出站代理。
 * 改过的话，模型列表要按表单里的新值去问。
 */
export function connectionChanged(f: UpstreamForm, p: ProviderView): boolean {
  const pick = (i: ProviderInput) =>
    JSON.stringify([i.base_url, i.protocol, i.key, i.headers, i.oauth, i.proxy]);
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
  const name = f.name.trim();
  if (name === "") return t.name;
  if (name !== original && taken.includes(name)) return t.nameTaken(name);
  if (f.baseUrl.trim() === "") return t.baseUrl;
  if (
    f.authMode === "oauth" &&
    !oauthKept(f) &&
    (f.oauthRefresh.trim() === "" || f.oauthEndpoint.trim() === "")
  )
    return t.oauth;
  for (const r of f.headers) {
    const header = r.name.trim();
    if (header === "" && r.value.trim() === "") continue;
    if (header === "") return t.headerName;
    if (r.value.trim() === "") return t.headerValue(header);
  }
  return null;
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
