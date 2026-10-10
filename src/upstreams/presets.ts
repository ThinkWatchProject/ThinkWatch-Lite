import { textOf } from "@/i18n";
import type { BalanceSetting, Billing, Protocol, ZaiFamily } from "@/types";
import { presetsText } from "./presets.i18n";

/**
 * 认证方式。`aws-keys` / `aws-profile` 只给 Bedrock；`account` 是登录账号（OpenAI 的
 * ChatGPT 账号、Z.ai / BigModel 的账号）—— 登录由 core 写配置。编辑时只有 Z.ai / BigModel
 * 有它：登录换来的是这个上游的一把新密钥
 */
export type AuthMode = "key" | "oauth" | "aws-keys" | "aws-profile" | "account";

/** 服务类型那一步的三组 */
export type PresetGroup = "vendor" | "platform" | "local";

/**
 * 新建上游时的「服务类型」。
 *
 * **选了哪一格，就不再问这一格已经定了的事**：地址、协议、认证方式、余额从哪里读。
 * 只有一种协议的不给选协议，只有一种认证方式的不显示认证方式那一行，地址由这一格
 * （或站点）定了的不显示地址。编辑时没有预设，表单是完整的一张。
 *
 * **地址不含 `/v1`** —— 网关把客户端请求的路径原样接在后面（`/v1/chat/completions`），
 * 写成 `…/v1` 也会被认出来、只留一段，但预设里不写，和服务商文档给的 Base URL 一致。
 * Amazon Bedrock 的地址按区域生成，选了它之后表单里换区域就换地址。
 */
export interface Preset {
  id: string;
  label: string;
  /** 那一格的第二行 */
  desc: string;
  group: PresetGroup;
  /**
   * 按名称和说明之外还能搜到它的词（「ChatGPT」找到 OpenAI）。界面语言里的叫法（「智谱」）
   * 在词表里，见 `presetAliases`
   */
  keywords: string[];
  /** 默认的上游名。空 = 跟着地址猜（没有固定地址的中转、自建网关） */
  name: string;
  baseUrl: string;
  /** 空字符串 = 自动识别 */
  protocol: Protocol | "";
  /**
   * 协议给不给选、能选哪几种。不给 = 这一格定了；`all` = 全部，外加自动识别
   */
  protocols?: Protocol[] | "all";
  billing?: Billing;
  /**
   * 实际有的认证方式，第一个是默认。只有一种时不显示那一行。
   *
   * 中转平台和企业网关只发 API 密钥：OAuth 只给「自定义」—— 那几种服务的密钥就是一把
   * 字符串，多给一种认证方式只会让人以为要去配它
   */
  auth: AuthMode[];
  /** 要不要 API 密钥：`required` 没有就不能往下走，`none` 不显示那一栏 */
  key: "required" | "optional" | "none";
  /** 地址由这一格定了，不显示地址那一栏（Z.ai 按站点定） */
  fixedUrl?: boolean;
  /** 「转发客户端身份」给不给开：只有中转站和自定义会只接受特定客户端 */
  clientIdentity?: boolean;
  /**
   * 余额从哪里读。不写 = 自动：官方地址（OpenRouter、DeepSeek、Moonshot）和企业网关 core
   * 自己认得出；中转平台在任意地址上，由这一格写明
   */
  balance?: BalanceSetting;
}

/** 要翻译的名称、说明写成 getter：每次读取都按当时的语言取 */
const tx = () => textOf(presetsText);

export const CUSTOM: Preset = {
  id: "custom",
  get label() {
    return tx().custom;
  },
  get desc() {
    return tx().desc.custom;
  },
  group: "local",
  keywords: ["openai compatible", "anthropic compatible", "relay"],
  name: "",
  baseUrl: "",
  protocol: "",
  protocols: "all",
  auth: ["key", "oauth"],
  key: "optional",
  clientIdentity: true,
};

/**
 * 两家账号登录后会用的接口地址，也是用 API 密钥接入 Z.ai / BigModel 时的地址。
 *
 * **账号登录的地址由 core 决定**，这里的两份在登录时只用来认出「这个名字上已有的上游
 * 正是这一家」—— 换句话说，它错了也只是认错，登录本身不受影响。
 */
export const ZAI_ENDPOINTS: Record<ZaiFamily, string> = {
  zai: "https://api.z.ai/api/anthropic",
  bigmodel: "https://open.bigmodel.cn/api/anthropic",
};

export const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    get desc() {
      return tx().desc.anthropic;
    },
    group: "vendor",
    keywords: ["claude"],
    name: "anthropic",
    baseUrl: "https://api.anthropic.com",
    protocol: "anthropic",
    auth: ["key"],
    key: "required",
  },
  {
    id: "openai",
    label: "OpenAI",
    get desc() {
      return tx().desc.openai;
    },
    group: "vendor",
    keywords: ["chatgpt", "gpt", "codex"],
    name: "openai",
    baseUrl: "https://api.openai.com",
    protocol: "openai-chat",
    protocols: ["openai-chat", "openai-responses"],
    auth: ["key", "account"],
    key: "required",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    get desc() {
      return tx().desc.gemini;
    },
    group: "vendor",
    keywords: ["google"],
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    protocol: "gemini",
    auth: ["key"],
    key: "required",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    get desc() {
      return tx().desc.deepseek;
    },
    group: "vendor",
    keywords: [],
    name: "deepseek",
    baseUrl: "https://api.deepseek.com/anthropic",
    protocol: "anthropic",
    auth: ["key"],
    key: "required",
  },
  {
    id: "zai",
    label: "Z.ai / BigModel",
    get desc() {
      return tx().desc.zai;
    },
    group: "vendor",
    keywords: ["glm", "zhipu", "bigmodel"],
    name: "zai",
    baseUrl: ZAI_ENDPOINTS.zai,
    protocol: "anthropic",
    auth: ["key", "account"],
    key: "required",
    fixedUrl: true,
  },
  {
    id: "bedrock",
    label: "Amazon Bedrock",
    get desc() {
      return tx().desc.bedrock;
    },
    group: "platform",
    keywords: ["aws", "amazon"],
    name: "bedrock",
    baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    protocol: "bedrock",
    auth: ["key", "aws-keys", "aws-profile"],
    key: "required",
  },
  {
    // 网关把 `/v1/chat/completions`、`/v1/models` 接在地址后面：`…/api/v1/…` 正是 OpenRouter 的接口
    id: "openrouter",
    label: "OpenRouter",
    get desc() {
      return tx().desc.openrouter;
    },
    group: "platform",
    keywords: [],
    name: "openrouter",
    baseUrl: "https://openrouter.ai/api",
    protocol: "openai-chat",
    auth: ["key"],
    key: "required",
  },
  {
    // 企业网关同时接受各家的接口格式：按客户端发来的格式原样转发
    id: "thinkwatch",
    label: "ThinkWatch",
    get desc() {
      return tx().desc.thinkwatch;
    },
    group: "platform",
    keywords: ["enterprise", "gateway"],
    name: "",
    baseUrl: "",
    protocol: "",
    auth: ["key"],
    key: "required",
    balance: "thinkwatch",
  },
  {
    id: "sub2api",
    label: "Sub2API",
    get desc() {
      return tx().desc.relay;
    },
    group: "platform",
    keywords: ["relay"],
    name: "",
    baseUrl: "",
    protocol: "",
    protocols: "all",
    auth: ["key"],
    key: "required",
    clientIdentity: true,
    balance: "sub2api",
  },
  {
    id: "newapi",
    label: "New API / One API",
    get desc() {
      return tx().desc.relay;
    },
    group: "platform",
    keywords: ["one api", "oneapi", "relay"],
    name: "",
    baseUrl: "",
    protocol: "",
    protocols: "all",
    auth: ["key"],
    key: "required",
    clientIdentity: true,
    balance: "newapi",
  },
  {
    id: "ollama",
    label: "Ollama",
    get desc() {
      return tx().desc.ollama;
    },
    group: "local",
    keywords: ["local"],
    name: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    protocol: "openai-chat",
    billing: "free",
    auth: ["key"],
    key: "none",
  },
  CUSTOM,
];

/** 界面语言里还能搜到这一格的叫法 */
export function presetAliases(id: string): readonly string[] {
  const all: Record<string, readonly string[]> = tx().aliases;
  return all[id] ?? [];
}

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? CUSTOM;
}

/** 这一格的认证方式里有没有登录账号，是哪一种 */
export function accountKind(id: string): "chatgpt" | "zai" | null {
  if (id === "openai") return "chatgpt";
  if (id === "zai") return "zai";
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url.trim()).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Z.ai / BigModel 的哪一个站点：地址正是那一边的标准地址（末尾的 `/` 不算）。别的地址是 null */
export function zaiSiteOf(url: string): ZaiFamily | null {
  const u = url.trim().replace(/\/+$/, "");
  if (u === ZAI_ENDPOINTS.zai) return "zai";
  if (u === ZAI_ENDPOINTS.bigmodel) return "bigmodel";
  return null;
}

/** 官方地址 → 服务类型。只认主机：路径不一样（别的接口、别的版本）照样是这一家 */
const HOSTS: Record<string, string> = {
  "api.anthropic.com": "anthropic",
  "api.openai.com": "openai",
  "generativelanguage.googleapis.com": "gemini",
  "api.deepseek.com": "deepseek",
  "openrouter.ai": "openrouter",
  "api.z.ai": "zai",
  "open.bigmodel.cn": "zai",
};

/**
 * 已保存的上游是哪一种服务：编辑时按它定问哪几项（和新建时选了那一格一样）。
 *
 * **官方地址按主机认**；Bedrock 也认协议（VPC 端点、代理的地址认不出来）；本机的 Ollama 认
 * 11434 端口。中转平台和企业网关在任意地址上，按配置里写明的余额来源认。别的一律是「自定义」，
 * ChatGPT 账号也是 —— 它有自己的「账号」一节，不走这张表单。
 *
 * **登录 Z.ai / BigModel 账号换来的密钥**（配置里的 `signed_in:`）不看地址：它就是那一边的
 * 账号登录。
 *
 * `family`：Z.ai / BigModel 是哪一边（登录的那一边，否则看主机），别的服务是 `zai`（用不到）。
 */
export function serviceOf(u: {
  baseUrl: string;
  /** 配置里写明的协议；没写是空 */
  protocol: Protocol | "" | null;
  balance: BalanceSetting | null;
  /** 密钥是登录哪一边的账号换来的。手填的是空 */
  signedIn?: ZaiFamily | null;
}): { preset: string; family: ZaiFamily } {
  if (u.signedIn) return { preset: "zai", family: u.signedIn };
  const host = hostOf(u.baseUrl);
  const family: ZaiFamily = host === "open.bigmodel.cn" ? "bigmodel" : "zai";
  const at = (preset: string) => ({ preset, family });
  if (u.protocol === "chatgpt" || host === "chatgpt.com") return at(CUSTOM.id);
  const byHost = HOSTS[host];
  if (byHost) return at(byHost);
  if (u.protocol === "bedrock" || /^bedrock-runtime(-fips)?\.[a-z0-9-]+\.amazonaws\.com$/.test(host)) {
    return at("bedrock");
  }
  try {
    if (new URL(u.baseUrl.trim()).port === "11434") return at("ollama");
  } catch {
    // 地址写错了：下面按自定义
  }
  if (u.balance === "sub2api" || u.balance === "newapi" || u.balance === "thinkwatch") return at(u.balance);
  return at(CUSTOM.id);
}

/** 从地址猜一个名称：`https://api.relay-hk.example/v1` → `relay-hk` */
export function nameFromUrl(url: string): string {
  const parts = hostOf(url).replace(/^api\./, "").split(".");
  return parts[0] || "";
}
