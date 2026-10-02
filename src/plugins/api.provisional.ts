/**
 * PROVISIONAL —— 插件的控制面类型，照 v1 约定（plugins-contract §6）手写。
 *
 * **core 发版之前只能这样。**生成的 `src/generated/tw-api.ts` 里还没有这些端点和类型
 * （那份文件由钉着的 core 生成，不手改）。插件页、流量表的徽标、请求详情都只从这里
 * 取插件的类型和调用，所以接上正式版是一次小的替换：
 *
 * 1. 升级 core 钉点、重新生成 `tw-api.ts`（`UPDATE_TS=1 cargo test … --test ts_bindings`）。
 * 2. 这里的类型换成 `@/types` 里生成的同名类型；`pluginCall(…)` 换成 `call(…)`；
 *    `src/control.ts` 里的 `Provisional` 和那个 `Exclude` 删掉。
 * 3. `pluginChangedOf` / `pluginsOf` 换成直接读字段（`h.plugin_changed`、`d.plugins`、
 *    `d.request_after_plugins`），`PLUGIN_FAILED` 换成字面的 `"plugin_failed"`。
 * 4. 三个原生确认命令（`plugin_install` 等）的请求与回执类型留在这里或挪进
 *    `src-tauri/src/wire.rs` 生成；Rust 那边的替换见 `src-tauri/src/plugins/wire.rs`。
 * 5. 删掉这个文件，跑 `pnpm typecheck` 看有没有漏掉的引用。
 */
import { invoke } from "@tauri-apps/api/core";
import type { BodyView, ConfigWritten, CoreEvent, HistoryRow, RequestDetail } from "@/types";

// ─────────────────────────────────────────────── 约定里的类型（§6）

/** 插件申请的权限。**这张表的顺序就是界面上列权限的顺序** */
export type Permission = "system" | "messages" | "tools" | "params" | "reply_text" | "reply_tool_calls";
export const PERMISSIONS: readonly Permission[] = [
  "system",
  "messages",
  "tools",
  "params",
  "reply_text",
  "reply_tool_calls",
];

/** 插件出错（或文件变了、加载不了）时：拒绝这次请求，还是跳过这个插件 */
export type OnError = "reject" | "skip";
/** 改回答文字的方式：一段到齐再改，还是随流式输出逐段改 */
export type ReplyMode = "block" | "stream";

/** 生效的适用范围。每一项是带 `*` 的通配；**空的就是全部**（约定如此，界面上写明「全部」） */
export interface PluginScope {
  clients: string[];
  models: string[];
  upstreams: string[];
}

export interface SettingSpecView {
  key: string;
  kind: "string" | "number" | "boolean";
  /** 插件自己写的标签。**只按纯文本显示** */
  label: string;
  default: unknown;
}

export type PluginStatus = { kind: "ok" } | { kind: "disabled" } | { kind: "changed" } | { kind: "error"; message: string };

/** core 启动以来的统计，在内存里 */
export interface PluginStats {
  calls: number;
  changed: number;
  rejected: number;
  errors: number;
  avg_cpu_us: number;
  last_error?: { at_ms: number; message: string } | null;
}

export interface PluginView {
  id: string;
  /** 插件自己起的名字。**只按纯文本显示** */
  name: string;
  description?: string | null;
  enabled: boolean;
  on_error: OnError;
  permissions: Permission[];
  scope: PluginScope;
  reply_mode: ReplyMode;
  settings_schema: SettingSpecView[];
  settings: Record<string, unknown>;
  /** 确认过的那份文件的 SHA-256（十六进制） */
  sha256: string;
  status: PluginStatus;
  stats: PluginStats;
}

export interface ManifestView {
  name: string;
  description?: string | null;
  permissions: Permission[];
  scope: PluginScope;
  reply_mode: ReplyMode;
  settings_schema: SettingSpecView[];
  hooks: { request: boolean; reply_text: boolean; tool_call: boolean };
}

/** 读一份代码的结果，不写任何东西 */
export interface PluginInspection {
  manifest?: ManifestView | null;
  sha256: string;
  /** 语法或清单的错误。行列从 1 数 */
  error?: { message: string; line?: number | null; column?: number | null } | null;
}

export type PluginOutcome = "unchanged" | "changed" | "rejected" | "error" | "skipped";
export type PluginHook = "request" | "reply";

/** 一次请求上一个插件的一次运行（请求详情的时间线） */
export interface PluginRunView {
  plugin_id: string;
  plugin_name: string;
  hook: PluginHook;
  outcome: PluginOutcome;
  error?: string | null;
  cpu_us: number;
}

export interface PluginSourceView {
  approved: string;
  approved_sha256: string;
  /** 文件现在的内容。读不到（被删、被移走）时没有 */
  current?: string | null;
  current_sha256?: string | null;
}

/** 试运行一侧（请求或回答）：改之前、改之后（排好版的 JSON，密钥已替换），和结果 */
export interface TrialSide {
  before: string;
  after: string;
  outcome: PluginOutcome;
}

export type PluginLogLevel = "log" | "info" | "warn" | "error";

export interface PluginLogEntry {
  at_ms: number;
  request_id?: string | null;
  hook: PluginHook;
  level: PluginLogLevel | (string & {});
  /** 插件写的日志。**只按纯文本显示** */
  text: string;
}

export interface PluginTrialResult {
  request?: TrialSide | null;
  reply?: TrialSide | null;
  logs: PluginLogEntry[];
  error?: string | null;
}

export interface PluginUpdate {
  enabled: boolean;
  on_error: OnError;
  scope: PluginScope;
  settings: Record<string, unknown>;
  base_version?: string | null;
}

/** 请求与响应，按端点名。**不含**三个要原生确认的端点（见下面的命令） */
export type PluginEndpoints = {
  Plugins: { req: null; res: PluginView[] };
  PluginInspect: { req: { source: string }; res: PluginInspection };
  UpdatePlugin: { req: PluginUpdate; res: ConfigWritten };
  PluginSourceDiff: { req: null; res: PluginSourceView };
  DeletePlugin: { req: { base_version?: string | null }; res: ConfigWritten };
  ReorderPlugins: { req: { ids: string[]; base_version?: string | null }; res: ConfigWritten };
  TrialPlugin: { req: { request_id: number }; res: PluginTrialResult };
  PluginLogs: { req: null; res: PluginLogEntry[] };
};
export type PluginEndpoint = keyof PluginEndpoints;

/** 路径参数的个数，和 Rust 那边的 `plugins::wire` 一致 */
type ParamsOf<N extends PluginEndpoint> = N extends
  | "UpdatePlugin"
  | "PluginSourceDiff"
  | "DeletePlugin"
  | "TrialPlugin"
  | "PluginLogs"
  ? [id: string]
  : [];

/** 和 `call` 同一条路（Rust 的 `call` 命令，白名单里有这几个），只是类型取自这里 */
export function pluginCall<N extends PluginEndpoint>(
  endpoint: N,
  req: PluginEndpoints[N]["req"],
  ...params: ParamsOf<N>
): Promise<PluginEndpoints[N]["res"]> {
  return invoke<PluginEndpoints[N]["res"]>("call", { endpoint, params: params.map(String), req });
}

// ─────────────────────────────────────────────── 要原生确认的三步（I12）
//
// 安装、更换代码、确认文件变更**不在网页的白名单里**。网页只能请 Rust 去做：Rust 自己
// 再读一遍代码（不信网页给的清单），在系统原生对话框里写明插件名、权限和 SHA-256，
// 用户点了才写配置。用户在原生对话框里取消不是失败：回执是 `cancelled`。

/** 安装时的选择。**清单不在里面**：权限、名字由 Rust 那边重新读代码得到 */
export interface PluginInstall {
  source: string;
  id?: string | null;
  enabled: boolean;
  on_error: OnError;
  scope: PluginScope;
  settings: Record<string, unknown>;
  base_version?: string | null;
}

export type PluginWrite = { kind: "done"; version: string } | { kind: "cancelled" };

export const installPlugin = (req: PluginInstall) => invoke<PluginWrite>("plugin_install", { req });

export const replacePluginSource = (req: { id: string; source: string; base_version?: string | null }) =>
  invoke<PluginWrite>("plugin_replace_source", { req });

export const approvePluginFile = (req: { id: string; base_version?: string | null }) =>
  invoke<PluginWrite>("plugin_approve", { req });

// ─────────────────────────────────────────────── 别处多出来的字段

/** 流量表那一行：插件改写过这次请求或回答（`HistoryRow.plugin_changed`） */
export function pluginChangedOf(h: HistoryRow): boolean {
  return (h as HistoryRow & { plugin_changed?: boolean }).plugin_changed === true;
}

/** 请求详情里插件的那两样：每一次运行，和插件改写之后的请求体 */
export function pluginsOf(d: RequestDetail): { runs: PluginRunView[]; after: BodyView | null } {
  const x = d as RequestDetail & { plugins?: PluginRunView[]; request_after_plugins?: BodyView | null };
  return { runs: x.plugins ?? [], after: x.request_after_plugins ?? null };
}

/** 插件运行出错的事件（`plugin_failed`）。进系统通知的那一路在 Rust 侧（`notices`） */
export const PLUGIN_FAILED = "plugin_failed" as CoreEvent["kind"];
