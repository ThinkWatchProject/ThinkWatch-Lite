/**
 * 分享一个上游（规格 8.2）：按它的配置拼一份导入链接的提议（`ImportProposal`），交给 Rust 写成
 * 链接（`share_import_link`，生成与解析同在 `import_link.rs`）。
 *
 * **拼的是接收方的新建对话框要的那一份**：服务类型、认证方式、站点照这个上游认出来的填（认不出、
 * 或者它的地址、协议不是那种服务的写法，就按「自定义」），和那种服务新建时缺省一样的不写。
 * 密钥、请求头、AWS 凭据、OAuth 凭据由「包含密钥」决定；`${变量名}`、出站代理、别名、路由、
 * 停用状态、AWS profile、账号登录的凭据一律不写，写明不包含什么。
 *
 * 写不进链接的值（链接不收的字符）由 Rust 指出是哪一项，这里去掉那一项再写一次（`dropParam`）。
 */
import type {
  ImportAuth,
  ImportProposal,
  ImportService,
  ImportSheet,
  ImportSpec,
  ModelRow,
  PriceSheetInput,
  Protocol,
  ProviderView,
} from "@/types";
import { bedrockRegionOf } from "./labels";
import { presetById, zaiSiteOf, type Preset } from "./presets";
import { formFromView, type UpstreamForm } from "./upstreamForm";

/** 链接里的四种协议（`import_link::LINK_PROTOCOLS`） */
const LINK_PROTOCOLS: readonly Protocol[] = ["anthropic", "openai-chat", "openai-responses", "gemini"];

/** 地址由这种服务自己定、链接给的得一模一样的那几种（`Address::Own`） */
const OWN_ADDRESS = new Set(["anthropic", "openai", "gemini", "deepseek", "openrouter"]);

/** 分享时要从别处取的两样：这家的模型（手写的规格）、它用的自定义价目表 */
export interface ShareExtra {
  models: readonly ModelRow[] | null;
  sheet: PriceSheetInput | null;
}

/** 有、却没写进链接的东西（对话框底下「不包含」那一句） */
export type Left =
  | "secrets"
  | "env"
  | "login"
  | "awsProfile"
  | "proxy"
  | "routes"
  | "disabled"
  | "tiers";

export interface Shared {
  proposal: ImportProposal;
  left: Left[];
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, "");
const isEnv = (v: string | null | undefined) => !!v && v.includes("${");

/** 这种服务收不收这个上游的地址、协议、认证方式；不收就按「自定义」 */
function fits(preset: Preset, f: UpstreamForm, auth: ImportAuth): boolean {
  if (!(preset.auth as string[]).includes(auth)) return false;
  const url = trimUrl(f.baseUrl);
  if (OWN_ADDRESS.has(preset.id) && url !== preset.baseUrl) return false;
  if (preset.id === "zai" && auth !== "account" && zaiSiteOf(url) === null) return false;
  if (preset.key === "none" && f.key.trim() !== "") return false;
  const proto = f.protocol;
  if (proto === "") return true;
  const choices = preset.protocols;
  if (choices === "all") return LINK_PROTOCOLS.includes(proto);
  if (Array.isArray(choices)) return choices.includes(proto);
  return proto === preset.protocol;
}

/** 这家的模型里手写过的规格（来源是 `manual` 的那几格） */
function manualSpecs(rows: readonly ModelRow[] | null): ImportSpec[] {
  const out: ImportSpec[] = [];
  for (const r of rows ?? []) {
    const spec: ImportSpec = {
      model: r.id,
      context_window: r.context_window_source === "manual" ? (r.context_window ?? null) : null,
      max_output_tokens: r.max_output_tokens_source === "manual" ? (r.max_output_tokens ?? null) : null,
      reasoning: r.reasoning_source === "manual" ? (r.reasoning ?? null) : null,
      image_input: r.image_input_source === "manual" ? (r.image_input ?? null) : null,
    };
    if (spec.context_window != null || spec.max_output_tokens != null || spec.reasoning != null || spec.image_input != null) {
      out.push(spec);
    }
  }
  return out;
}

/** 自定义价目表写成链接里的新价目表。分档价（200K 以上）链接写不了 */
function sheetOf(s: PriceSheetInput | null): { sheet: ImportSheet | null; tiers: boolean } {
  if (!s) return { sheet: null, tiers: false };
  const entries = Object.entries(s.models);
  const tiers = entries.some(([, p]) => p.input_above_200k != null || p.output_above_200k != null);
  const prices = entries.map(([model, p]) => ({
    model,
    input: p.input,
    output: p.output,
    cache_read: p.cache_read,
    cache_write_5m: p.cache_write_5m,
    cache_write_1h: p.cache_write_1h,
  }));
  if (s.multiplier === 1 && prices.length === 0) return { sheet: null, tiers };
  return { sheet: { multiplier: s.multiplier, prices }, tiers };
}

/** 按一个上游的配置拼导入链接的提议。`secrets`：「包含密钥」 */
export function shareProposal(p: ProviderView, extra: ShareExtra, secrets: boolean): Shared {
  const f = formFromView(p);
  const left = new Set<Left>();
  const chatgpt = p.protocol === "chatgpt";
  let auth: ImportAuth;
  if (chatgpt || f.authMode === "account") {
    auth = "account";
    left.add("login");
  } else if (f.authMode === "aws-profile") {
    auth = "key";
    left.add("awsProfile");
  } else {
    auth = f.authMode;
  }
  let service = (chatgpt ? "openai" : f.preset) as ImportService;
  if (!chatgpt && auth !== "account" && !fits(presetById(service), f, auth)) service = "custom";
  if (service === "custom" && (auth === "aws-keys" || auth === "account")) auth = "key";
  const preset = presetById(service);
  const url = trimUrl(f.baseUrl);

  // 凭据。不含密钥、写的是 `${变量名}`：不写，认证方式退回 API 密钥（接收方自己填）
  let key: string | null = null;
  let oauth: ImportProposal["oauth"] = null;
  let aws: ImportProposal["aws"] = null;
  if (auth === "key" && preset.key !== "none" && f.key.trim() !== "") {
    if (!secrets) left.add("secrets");
    else if (isEnv(f.key)) left.add("env");
    else key = f.key.trim();
  } else if (auth === "oauth") {
    const fields = [f.oauthEndpoint, f.oauthRefresh, f.oauthClientId, f.oauthClientSecret];
    if (!secrets) left.add("secrets");
    else if (fields.some(isEnv)) left.add("env");
    else {
      oauth = {
        endpoint: f.oauthEndpoint.trim(),
        refresh: f.oauthRefresh.trim(),
        client_id: f.oauthClientId.trim() || null,
        client_secret: f.oauthClientSecret.trim() || null,
      };
    }
    if (!oauth) auth = "key";
  } else if (auth === "aws-keys") {
    const fields = [f.awsKeyId, f.awsSecret, f.awsToken];
    if (!secrets) left.add("secrets");
    else if (fields.some(isEnv)) left.add("env");
    else {
      aws = {
        access_key_id: f.awsKeyId.trim(),
        secret_access_key: f.awsSecret.trim(),
        session_token: f.awsToken.trim() || null,
      };
    }
    if (!aws) auth = "key";
  }

  // 地址：服务自己定的不写（Z.ai / BigModel 写站点，标准 Bedrock 地址写区域，本机缺省的 Ollama 不写）
  const standardRegion = service === "bedrock" ? bedrockRegionOf(url) : null;
  let base_url: string | null = null;
  if (auth !== "account" && !OWN_ADDRESS.has(service) && service !== "zai") {
    if (service === "bedrock") base_url = standardRegion ? null : url;
    else if (service === "ollama") base_url = url === preset.baseUrl ? null : url;
    else base_url = url;
  }
  const site =
    service !== "zai" ? null : auth === "account" ? (p.signed_in ?? f.zaiFamily) : (zaiSiteOf(url) ?? f.zaiFamily);
  const region =
    service !== "bedrock"
      ? null
      : (standardRegion ?? (auth === "aws-keys" ? f.awsRegion.trim() || null : null));

  // 协议：这种服务定了的不写，和它缺省的一样不写
  const protocol: Protocol | null =
    auth === "account" ||
    f.protocol === "" ||
    f.protocol === preset.protocol ||
    !preset.protocols ||
    !LINK_PROTOCOLS.includes(f.protocol)
      ? null
      : f.protocol;

  const headers = f.headers
    .map((h) => ({ name: h.name.trim(), value: h.value.trim() }))
    .filter((h) => h.name !== "" && h.value !== "");
  if (headers.length > 0 && !secrets) left.add("secrets");
  if (headers.length > 0 && secrets && headers.some((h) => isEnv(h.value))) left.add("env");
  const shareHeaders = secrets && auth !== "account" && !headers.some((h) => isEnv(h.value)) ? headers : [];

  const billing = p.billing === (preset.billing ?? "per-token") ? null : p.billing;
  const perToken = (billing ?? preset.billing ?? "per-token") === "per-token";
  const { sheet, tiers } = perToken ? sheetOf(extra.sheet) : { sheet: null, tiers: false };
  if (tiers) left.add("tiers");

  if (p.proxy !== "direct") left.add("proxy");
  if (p.references.length > 0) left.add("routes");
  if (p.disabled) left.add("disabled");

  return {
    proposal: {
      service,
      auth,
      site,
      name: p.name,
      base_url,
      protocol,
      key,
      oauth,
      region,
      aws,
      headers: shareHeaders,
      client_identity: auth !== "account" && f.forwardClientIdentity && preset.clientIdentity === true,
      concurrency: auth === "account" ? null : (p.max_concurrent ?? null),
      // 用量上限和并发上限一样：登录账号的链接不带（接收方登录时由 core 建上游）
      limits:
        auth === "account"
          ? []
          : p.limits.map((l) => ({ per: l.per, every: l.every, measure: l.measure, max: l.max, cache_reads: l.cache_reads })),
      balance: service === "custom" && p.balance_setting !== "auto" ? p.balance_setting : null,
      models: p.models,
      models_only: p.models_only && p.models_only.length > 0 ? p.models_only : null,
      specs: manualSpecs(extra.models),
      billing,
      price_sheet: sheet,
    },
    left: [...left],
  };
}

/**
 * 去掉链接写不进的那一项（Rust 说的参数名），再试一次。地址、服务类型去不掉（去掉就不是这个
 * 上游了）：交回 null
 */
export function dropParam(p: ImportProposal, param: string): ImportProposal | null {
  switch (param) {
    case "name":
      return { ...p, name: null };
    case "protocol":
      return { ...p, protocol: null };
    case "site":
      return { ...p, site: null };
    case "key":
      return { ...p, key: null };
    case "auth":
    case "oauth_endpoint":
    case "oauth_refresh":
    case "oauth_client_id":
    case "oauth_client_secret":
    case "aws_access_key_id":
    case "aws_secret_access_key":
    case "aws_session_token":
      return p.auth === "account" ? null : { ...p, auth: "key", oauth: null, aws: null };
    case "region":
      return { ...p, region: null };
    case "headers":
      return { ...p, headers: [] };
    case "client_identity":
      return { ...p, client_identity: false };
    case "concurrency":
      return { ...p, concurrency: null };
    case "limits":
      return { ...p, limits: [] };
    case "balance":
      return { ...p, balance: null };
    case "models":
      return { ...p, models: [] };
    case "models_only":
      return { ...p, models_only: null };
    case "specs":
      return { ...p, specs: [] };
    case "billing":
      return { ...p, billing: null };
    case "price_multiplier":
    case "prices":
      return { ...p, price_sheet: null };
    default:
      return null;
  }
}

/** 链接里写了什么（对话框底下「包含」那一句的几项），按接收方看到的那一份算 */
export type Carried =
  | { kind: "address" }
  | { kind: "protocol" }
  | { kind: "key" }
  | { kind: "headers"; n: number }
  | { kind: "oauth" }
  | { kind: "aws" }
  | { kind: "models"; n: number }
  | { kind: "scope" }
  | { kind: "specs"; n: number }
  | { kind: "prices"; n: number }
  | { kind: "multiplier" }
  | { kind: "billing" }
  | { kind: "balance" }
  | { kind: "concurrency" }
  | { kind: "limits"; n: number }
  | { kind: "identity" }
  | { kind: "login" };

export function carried(p: ImportProposal): Carried[] {
  const out: Carried[] = [];
  const preset = presetById(p.service);
  if (p.auth === "account") out.push({ kind: "login" });
  // 地址：写在链接里的，或者这种服务自己的（接收方的对话框照样填上）
  if (p.auth !== "account") out.push({ kind: "address" });
  if (p.protocol) out.push({ kind: "protocol" });
  if (p.key) out.push({ kind: "key" });
  if (p.headers.length > 0) out.push({ kind: "headers", n: p.headers.length });
  if (p.oauth) out.push({ kind: "oauth" });
  if (p.aws) out.push({ kind: "aws" });
  if (p.models.length > 0) out.push({ kind: "models", n: p.models.length });
  if (p.models_only) out.push({ kind: "scope" });
  if (p.specs.length > 0) out.push({ kind: "specs", n: p.specs.length });
  if (p.price_sheet && p.price_sheet.prices.length > 0) out.push({ kind: "prices", n: p.price_sheet.prices.length });
  if (p.price_sheet && p.price_sheet.multiplier !== 1) out.push({ kind: "multiplier" });
  if (p.billing) out.push({ kind: "billing" });
  if (p.balance || preset.balance) out.push({ kind: "balance" });
  if (p.concurrency != null) out.push({ kind: "concurrency" });
  if (p.limits.length > 0) out.push({ kind: "limits", n: p.limits.length });
  if (p.client_identity) out.push({ kind: "identity" });
  return out;
}
