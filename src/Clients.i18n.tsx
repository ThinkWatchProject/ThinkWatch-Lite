import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 句中要套一层组件（悬浮说明）的那一段 */
type Wrap = (text: string) => ReactNode;

/** 英文的单复数：`count(3, "client", "clients")` 是 `3 clients` */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * 客户端接管页的文案。
 *
 * `.tsx`：几句话中间嵌着地址或路径（`<code>`），而它们在中英文句子里的
 * 位置不同 —— 片段由组件画好传进来，放在哪儿由句子自己决定。
 */
export const clientsText = messages(
  {
    scanning: "扫描中…",
    intro: (base: ReactNode) => (
      <>接管后，这些客户端将指向 {base}。仅修改端点与密钥两个字段，其余配置保持不变，可随时还原。</>
    ),

    // 全部还原
    restoreAllWarning: (n: number) => `${n} 个客户端将还原，其请求将立即不再经过 ThinkWatch。`,
    restoredAll: (n: number) => `已还原 ${n} 个客户端`,
    restoreFailed: (failures: { client: string; detail: string }[]) =>
      `${failures.length} 个客户端还原失败：` + failures.map((r) => `${r.client}（${r.detail}）`).join("；"),
    confirmRestoreAll: "确认全部还原",
    restoreAll: "全部还原",

    // 一个都没装
    noneTitle: "未检测到已支持的客户端",
    runOnce: (tip: Wrap) => <>如已安装 Claude Code、Codex 或 Gemini CLI，{tip("请先运行一次")}。</>,
    runOnceTip: "需先运行一次以生成其配置文件，之后返回此页。未生成配置文件时无法判断其指向。",
    manualEndpoint: (base: ReactNode) => <>也可手动将客户端的端点设为 {base}。</>,

    notDetected: (n: number) => `未检测到的客户端（${n}）`,
    notFound: (name: string, path: ReactNode) => <>{name}：未找到 {path}</>,
    manual: "需手动配置的客户端",

    // 一个客户端
    verified: "已验证 · 已收到请求",
    waiting: "已接管 · 等待首个请求",
    notConnected: "未接管",
    checkChain: "检查配置链",
    diagnose: "诊断未生效原因",
    restore: "还原",
    connectMenu: "接管…",
    symlink: (path: string) => `（${path} 是符号链接）`,
    pointsTo: (endpoint: string) => `当前指向 ${endpoint}`,
    /** 前面有一个「⚠ 」 */
    shadowed: (source: string) => `${source} 优先级更高，可能覆盖此处的设置`,
    silent: "接管已超过五分钟，仍未收到请求。可点击「诊断未生效原因」进行检查。",

    // 接管前的确认
    planTitle: (restore: boolean, name: string) => `${restore ? "还原" : "接管"} ${name}`,
    modifies: (path: ReactNode) => <>将修改 {path}</>,
    noop: "配置已是目标状态，无需修改。",
    /** 字段路径前面的动作，自带空格 */
    removeField: "删除 ",
    setField: "设置 ",
    backup: "写入前将完整备份原文件，除上述字段外不做任何改动。",
    secretMasked: "（差异中的密钥已遮盖，实际写入的是 config.yaml 中的密钥原文。）",
    confirmConnect: "确认接管",

    // 接管完成
    doneTitle: "已写入配置",
    modified: (path: ReactNode) => <>已修改 {path}</>,
    backedUp: (path: ReactNode) => <>原文件已备份至 {path}</>,
    provenByRequest: "收到真实请求后，方可确认配置已生效。",

    whyTitle: "配置链诊断",
  },
  {
    scanning: "Scanning…",
    intro: (base: ReactNode) => (
      <>
        Once connected, these clients point to {base}. Only the endpoint and key fields are changed; the rest of the
        configuration is left as it is, and each client can be restored at any time.
      </>
    ),

    // 和两个按钮排在一行、不收缩：要和中文差不多长，不然把左边那段说明挤窄
    restoreAllWarning: (n: number) =>
      `${count(n, "client", "clients")} will be restored and bypass ThinkWatch immediately.`,
    restoredAll: (n: number) => `${count(n, "client", "clients")} restored`,
    restoreFailed: (failures: { client: string; detail: string }[]) =>
      `${count(failures.length, "client", "clients")} could not be restored: ` +
      failures.map((r) => `${r.client} (${r.detail})`).join("; "),
    // 确认那一步已经有一句说明和「取消」，按钮只写动作本身
    confirmRestoreAll: "Restore all",
    restoreAll: "Restore all",

    noneTitle: "No supported clients detected",
    runOnce: (tip: Wrap) => <>If Claude Code, Codex or Gemini CLI is installed, {tip("run it once first")}.</>,
    runOnceTip:
      "Running a client once creates its configuration file; then return to this page. Without a configuration file, where the client points cannot be determined.",
    manualEndpoint: (base: ReactNode) => <>The client's endpoint can also be set to {base} manually.</>,

    notDetected: (n: number) => `Clients not detected (${n})`,
    notFound: (name: string, path: ReactNode) => (
      <>
        {name}: {path} not found
      </>
    ),
    manual: "Clients requiring manual configuration",

    verified: "Verified · Requests received",
    waiting: "Connected · Waiting for first request",
    notConnected: "Not connected",
    checkChain: "Check config chain",
    diagnose: "Troubleshoot",
    restore: "Restore",
    connectMenu: "Connect…",
    symlink: (path: string) => `(${path} is a symbolic link)`,
    pointsTo: (endpoint: string) => `Currently points to ${endpoint}`,
    shadowed: (source: string) => `${source} takes precedence and may override the settings here`,
    silent:
      "Connected more than five minutes ago, but no requests have been received. Click “Troubleshoot” to check.",

    planTitle: (restore: boolean, name: string) => `${restore ? "Restore" : "Connect"} ${name}`,
    modifies: (path: ReactNode) => <>Modifies {path}</>,
    noop: "The configuration is already in the target state; nothing needs to change.",
    removeField: "Remove ",
    setField: "Set ",
    backup: "The original file is backed up in full before writing; nothing but the fields above is changed.",
    // 接在上一句后面：英文两句之间要一个空格，中文不要
    secretMasked: " (The key is masked in the diff; the key actually written is the original one from config.yaml.)",
    confirmConnect: "Connect",

    doneTitle: "Configuration written",
    modified: (path: ReactNode) => <>Modified {path}</>,
    backedUp: (path: ReactNode) => <>Original file backed up to {path}</>,
    provenByRequest: "Only a real request can confirm that the configuration has taken effect.",

    whyTitle: "Config chain diagnosis",
  },
);
