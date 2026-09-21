/**
 * 上游对话框的表单：从视图回填、转成交给 core 的输入、判断能不能往下走。
 *
 * **编辑时地址和凭据默认「保持原样」。**视图里的密钥和敏感请求头是打过码的、
 * 地址也可能打了码，原样写回去会把码写进配置 —— 所以没改地址时地址不发，
 * 密钥和请求头的值留空表示沿用已保存的，OAuth 没点「更换」时沿用。
 */
import { textOf } from "@/i18n";
import type { HeaderInput, ModelList, OAuthChange, ProviderInput, ProviderView, SecretChange } from "@/types";
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

export interface UpstreamForm {
  preset: string;
  name: string;
  baseUrl: string;
  /** 编辑时改过地址没有。没改就保持原样 */
  baseUrlTouched: boolean;
  /** 空 = 自动识别 */
  protocol: string;
  authMode: AuthMode;
  /** 新填的 API 密钥 */
  key: string;
  /** 有已保存的密钥：`key` 留空时沿用 */
  keySaved: boolean;
  headers: HeaderRow[];
  /** 已保存的、值打过码的请求头名（小写）。这些行的值留空时沿用 */
  savedHeaders: string[];
  /** 有已保存的 OAuth 凭据、没点「更换」：整份沿用 */
  oauthSaved: boolean;
  oauthRefresh: string;
  oauthEndpoint: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthAccess: string;
  proxy: string;
  onProxyFail: string;
  /** 服务不提供模型列表时的手动清单 */
  manualModels: string[];
  scope: "all" | "some";
  /** 指定范围：模型 ID 或通配规则 */
  scopeList: string[];
  /** 空 = 自动识别 */
  billing: string;
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
    baseUrlTouched: true,
    protocol: "",
    authMode: "key",
    key: "",
    keySaved: false,
    headers: [],
    savedHeaders: [],
    oauthSaved: false,
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
    billing: "",
    pricing: "",
    disabled: false,
  };
}

export function formFromView(p: ProviderView): UpstreamForm {
  return {
    preset: "custom",
    name: p.name,
    baseUrl: p.base_url,
    baseUrlTouched: false,
    protocol: p.protocol_explicit ? (p.protocol ?? "") : "",
    authMode: p.oauth ? "oauth" : "key",
    // 环境变量名不是秘密，回填；打过码的密钥不回填
    key: p.key?.env ? `\${${p.key.env}}` : "",
    keySaved: p.key != null,
    headers: (p.headers ?? []).map((h) => headerRow(h.name, h.masked ? "" : h.value)),
    savedHeaders: (p.headers ?? []).filter((h) => h.masked).map((h) => h.name.toLowerCase()),
    oauthSaved: p.oauth != null,
    oauthRefresh: "",
    oauthEndpoint: p.oauth?.endpoint ?? "",
    oauthClientId: p.oauth?.client_id ?? "",
    oauthClientSecret: "",
    oauthAccess: "",
    proxy: p.proxy,
    onProxyFail: p.on_proxy_fail,
    manualModels: p.models,
    scope: p.models_only ? "some" : "all",
    scopeList: p.models_only ?? [],
    billing: p.billing ?? "",
    pricing: p.pricing ?? "",
    disabled: p.disabled,
  };
}

/** 这一行的值留空时沿用已保存的 */
export function keepsSavedValue(f: UpstreamForm, row: HeaderRow): boolean {
  return row.value.trim() === "" && f.savedHeaders.includes(row.name.trim().toLowerCase());
}

function keyChange(f: UpstreamForm): SecretChange {
  if (f.authMode === "oauth") return { mode: "none" };
  const key = f.key.trim();
  if (key !== "") return { mode: "set", value: key };
  return f.keySaved ? { mode: "keep" } : { mode: "none" };
}

function headerInputs(f: UpstreamForm): HeaderInput[] {
  return f.headers
    .filter((r) => r.name.trim() !== "" || r.value.trim() !== "")
    .map((r) => ({
      name: r.name.trim(),
      value: keepsSavedValue(f, r) ? undefined : r.value.trim(),
    }));
}

function oauthChange(f: UpstreamForm): OAuthChange {
  if (f.authMode === "key") return { mode: "none" };
  if (f.oauthSaved) return { mode: "keep" };
  return {
    mode: "set",
    refresh: f.oauthRefresh.trim(),
    endpoint: f.oauthEndpoint.trim(),
    client_id: f.oauthClientId.trim() || undefined,
    client_secret: f.oauthClientSecret.trim() || undefined,
    access: f.oauthAccess.trim() || undefined,
  };
}

/** `editing`：改的是已经保存的一家。没动过的地址不发 */
export function toInput(f: UpstreamForm, editing: boolean): ProviderInput {
  return {
    name: f.name,
    base_url: !editing || f.baseUrlTouched ? f.baseUrl.trim() : undefined,
    key: keyChange(f),
    headers: headerInputs(f),
    oauth: oauthChange(f),
    protocol: f.protocol || undefined,
    proxy: f.proxy,
    on_proxy_fail: f.onProxyFail,
    models: f.manualModels,
    models_only: f.scope === "some" ? f.scopeList : undefined,
    billing: f.billing || undefined,
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
  return pick(toInput(f, true)) !== pick(toInput(formFromView(p), true));
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
  const editing = original != null;
  const name = f.name.trim();
  if (name === "") return t.name;
  if (name !== original && taken.includes(name)) return t.nameTaken(name);
  if ((!editing || f.baseUrlTouched) && f.baseUrl.trim() === "") return t.baseUrl;
  if (
    f.authMode === "oauth" &&
    !f.oauthSaved &&
    (f.oauthRefresh.trim() === "" || f.oauthEndpoint.trim() === "")
  )
    return t.oauth;
  for (const r of f.headers) {
    const header = r.name.trim();
    if (header === "" && r.value.trim() === "") continue;
    if (header === "") return t.headerName;
    if (r.value.trim() === "" && !keepsSavedValue(f, r)) return t.headerValue(header);
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
