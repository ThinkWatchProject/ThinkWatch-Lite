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
  protocol: string;
  billing?: string;
}

export const CUSTOM: Preset = {
  id: "custom",
  label: "自定义",
  name: "",
  baseUrl: "",
  protocol: "",
};

/**
 * 「ChatGPT 账号」在服务类型里的取值。**它不是一份预设**：选中它之后走的是登录，
 * 地址、协议和凭据都由 core 在登录成功时写入
 */
export const CHATGPT = "chatgpt-login";

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
    label: "Ollama（本地）",
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
