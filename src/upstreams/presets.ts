import { textOf } from "@/i18n";
import type { Billing, Protocol, ZaiFamily } from "@/types";
import { presetsText } from "./presets.i18n";

/**
 * 新建上游时的「服务类型」。
 *
 * 预设只填三样：名称、接口地址、接口协议（本地服务再加一个「不计费」）。
 * **地址不含 `/v1`** —— 网关把客户端请求的路径原样接在后面，写成
 * `…/v1` 会拼出 `…/v1/v1/messages`。
 */
export interface Preset {
  id: string;
  label: string;
  name: string;
  baseUrl: string;
  /** 空字符串 = 自动识别 */
  protocol: Protocol | "";
  billing?: Billing;
}

/** 要翻译的名称写成 getter：每次读取都按当时的语言取 */
export const CUSTOM: Preset = {
  id: "custom",
  get label() {
    return textOf(presetsText).custom;
  },
  name: "",
  baseUrl: "",
  protocol: "",
};

/**
 * 「ChatGPT 账号」在服务类型里的取值。**它不是一份预设**：选中它之后走的是登录，
 * 地址、协议和凭据都由 core 在登录成功时写入
 */
export const CHATGPT = "chatgpt-login";

/**
 * 「Z.ai 账号」在服务类型里的取值。**它不是一份预设**：选中它之后走的是登录，
 * 密钥由 core 在登录成功时写入
 */
export const ZAI = "zai-login";

/**
 * 两家账号登录后会用的接口地址。
 *
 * **地址由 core 决定**，这里的两份只用来在登录对话框里显示「请求会发往哪里」，
 * 以及认出「这个名字上已有的上游正是这一家」——换句话说，它错了也只是显示错，
 * 登录本身不受影响。
 */
export const ZAI_ENDPOINTS: Record<ZaiFamily, string> = {
  zai: "https://api.z.ai/api/anthropic",
  bigmodel: "https://open.bigmodel.cn/api/anthropic",
};

export const PRESETS: Preset[] = [
  {
    id: "anthropic",
    label: "Anthropic",
    name: "anthropic",
    baseUrl: "https://api.anthropic.com",
    protocol: "anthropic",
  },
  {
    id: "openai",
    label: "OpenAI",
    name: "openai",
    baseUrl: "https://api.openai.com",
    protocol: "openai-chat",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    protocol: "gemini",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    name: "deepseek",
    baseUrl: "https://api.deepseek.com/anthropic",
    protocol: "anthropic",
  },
  {
    id: "ollama",
    get label() {
      return textOf(presetsText).ollama;
    },
    name: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    protocol: "openai-chat",
    billing: "free",
  },
];

export function presetById(id: string): Preset {
  return PRESETS.find((p) => p.id === id) ?? CUSTOM;
}

/** 从地址猜一个名称：`https://api.relay-hk.example/v1` → `relay-hk` */
export function nameFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname;
    const parts = host.replace(/^api\./, "").split(".");
    return parts[0] || "";
  } catch {
    return "";
  }
}
