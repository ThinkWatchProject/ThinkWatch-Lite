/**
 * 上游对话框的表单：从视图回填、转成交给 core 的输入、判断能不能往下走。
 *
 * **编辑时凭据和地址默认「保持原样」。**视图里的密钥只有来源、地址可能打了
 * 码，原样写回去会把码写进配置 —— 所以没点「更换」、没改地址时，这两样不发。
 */
import type { CredentialInput, ModelList, ProviderInput, ProviderView } from "@/types";
import { CUSTOM } from "./presets";

export type CredKind = "key" | "env" | "oauth";

export interface UpstreamForm {
  preset: string;
  name: string;
  baseUrl: string;
  /** 编辑时改过地址没有。没改就保持原样 */
  baseUrlTouched: boolean;
  /** 空 = 自动识别 */
  protocol: string;
  credKind: CredKind;
  /** 编辑时点过「更换」没有。没点就保持原来的凭据 */
  credTouched: boolean;
  key: string;
  envVar: string;
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
  /** 空 = 自动识别 */
  trust: string;
  redactMode: "auto" | "custom";
  redact: string[];
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
    credKind: "key",
    credTouched: true,
    key: "",
    envVar: "",
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
    trust: "",
    redactMode: "auto",
    redact: [],
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
    credKind: p.key_kind,
    credTouched: false,
    key: "",
    envVar: p.key_env ?? "",
    oauthRefresh: "",
    oauthEndpoint: p.oauth_endpoint ?? "",
    oauthClientId: p.oauth_client_id ?? "",
    oauthClientSecret: "",
    oauthAccess: "",
    proxy: p.proxy,
    onProxyFail: p.on_proxy_fail,
    manualModels: p.models,
    scope: p.models_only ? "some" : "all",
    scopeList: p.models_only ?? [],
    billing: p.billing ?? "",
    pricing: p.pricing ?? "",
    trust: p.trust_explicit ? p.trust : "",
    redactMode: p.redact_explicit ? "custom" : "auto",
    redact: p.redact,
    disabled: p.disabled,
  };
}

function credential(f: UpstreamForm): CredentialInput {
  switch (f.credKind) {
    case "key":
      return { kind: "key", value: f.key };
    case "env":
      return { kind: "env", var: f.envVar };
    case "oauth":
      return {
        kind: "oauth",
        refresh: f.oauthRefresh,
        endpoint: f.oauthEndpoint,
        client_id: f.oauthClientId || undefined,
        client_secret: f.oauthClientSecret || undefined,
        access: f.oauthAccess || undefined,
      };
  }
}

/** `editing`：改的是已经保存的一家。没动过的地址和凭据不发 */
export function toInput(f: UpstreamForm, editing: boolean): ProviderInput {
  return {
    name: f.name,
    base_url: !editing || f.baseUrlTouched ? f.baseUrl.trim() : undefined,
    key: !editing || f.credTouched ? credential(f) : undefined,
    protocol: f.protocol || undefined,
    proxy: f.proxy,
    on_proxy_fail: f.onProxyFail,
    models: f.manualModels,
    models_only: f.scope === "some" ? f.scopeList : undefined,
    billing: f.billing || undefined,
    trust: f.trust || undefined,
    redact: f.redactMode === "custom" ? f.redact : undefined,
    pricing: f.pricing || undefined,
    disabled: f.disabled,
  };
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
  const editing = original != null;
  const name = f.name.trim();
  if (name === "") return "填写名称";
  if (name !== original && taken.includes(name)) return `名称「${name}」已被其他上游使用`;
  if ((!editing || f.baseUrlTouched) && f.baseUrl.trim() === "") return "填写接口地址";
  if (!editing || f.credTouched) {
    if (f.credKind === "key" && f.key.trim() === "") return "填写 API 密钥";
    if (f.credKind === "env" && f.envVar.trim() === "") return "填写环境变量名";
    if (f.credKind === "oauth" && (f.oauthRefresh.trim() === "" || f.oauthEndpoint.trim() === ""))
      return "填写 Refresh Token 与 Token 端点";
  }
  return null;
}

export function modelsMissing(f: UpstreamForm): string | null {
  if (f.scope === "some" && f.scopeList.length === 0) return "至少选择一个模型";
  return null;
}

/** 检测结果里模型列表那一段怎么说 */
export function describeModelList(m: ModelList): string {
  switch (m.kind) {
    case "listed":
      return `发现 ${m.models.length} 个模型`;
    case "not_implemented":
      return `上游未提供模型列表接口（HTTP ${m.status}）`;
    case "unrecognized":
      return "模型列表格式无法识别";
    case "empty":
      return "模型列表为空";
  }
}
