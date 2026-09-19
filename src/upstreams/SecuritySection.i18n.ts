import { messages } from "@/i18n";

export const securitySectionText = messages(
  {
    modes: { off: "关闭", observe: "观察", enforce: "拦截" },
    trust: "信任级别",
    auto: "自动识别",
    byUrl: "按接口地址识别。",
    trustDetected: (official: boolean) => `按接口地址识别，当前为${official ? "官方端点" : "非官方端点"}。`,
    official: "官方端点",
    officialDesc: "工具调用仅记录，不拦截。",
    unofficial: "非官方端点",
    unofficialDesc: "拦截高危工具调用，中危工具调用发出告警。",
    redact: "发送前脱敏",
    redactOfficial: "按接口地址识别，当前为官方端点，不脱敏。",
    redactUnofficial: "按接口地址识别，当前为非官方端点，对以下类别脱敏。",
    custom: "自定义",
    customDesc: "为此上游单独指定脱敏类别。不勾选任何类别即不脱敏。",
    status: (redact: string, tools: string) =>
      `出站脱敏当前为「${redact}」模式，工具调用审查当前为「${tools}」模式。「观察」模式只记录命中，不改变请求。`,
    goToGuard: "前往防护",
  },
  {
    modes: { off: "Off", observe: "Observe", enforce: "Enforce" },
    trust: "Trust level",
    auto: "Auto-detect",
    byUrl: "Detected from the base URL.",
    trustDetected: (official: boolean) =>
      `Detected from the base URL: currently ${official ? "an official" : "an unofficial"} endpoint.`,
    official: "Official endpoint",
    officialDesc: "Tool calls are only logged, never blocked.",
    unofficial: "Unofficial endpoint",
    unofficialDesc: "High-risk tool calls are blocked; medium-risk ones raise a warning.",
    redact: "Redaction before sending",
    redactOfficial: "Detected from the base URL: currently an official endpoint, so nothing is redacted.",
    redactUnofficial:
      "Detected from the base URL: currently an unofficial endpoint, so the categories below are redacted.",
    custom: "Custom",
    customDesc: "Redaction categories set for this upstream alone. With none checked, nothing is redacted.",
    status: (redact: string, tools: string) =>
      `Outbound redaction is in ${redact} mode and tool-call inspection in ${tools} mode. Observe mode records matches without changing requests.`,
    goToGuard: "Go to Protection",
  },
);
