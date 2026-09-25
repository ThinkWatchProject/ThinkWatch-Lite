// 界面 invoke 的每一个 Tauri 命令（src-tauri/src/lib.rs 的 generate_handler!），外加 `call`
// —— 它按端点名转给 ./core.ts。
//
// **每一条的回答都标着应用自己的类型**（界面在 `invoke<…>` 里写的那一个，多半来自
// src/generated/ 里生成的类型）：Rust 那边改了形状、重新生成了类型，这里就编译不过。
// `pnpm typecheck` 连这个目录一起查，所以 CI 上就拦下了，不用等到下次拍截图。
//
// 编译期查不到的两样，在运行时拦：界面调了这里没有的命令（直接抛错），或者没传这里要的
// 参数（`need`）。报错会让截图程序停下来（见 main.tsx 的 `track` 和 capture.swift 的
// consoleHook），不会拍出一张缺了一块的图。
import type { WebviewEndpoint } from "@/control";
import type { Notice } from "@/Notices";
import type { Adopted, ConnView, Tested } from "@/connection/api";
import type { AppInfo, LanguageView, MenubarStyle, NoticeMode, ThemeView } from "@/settings/api";
import type { Offer, UpdateView } from "@/updateFlow";
import type { UpstreamStats } from "@/upstreams/api";
import type { ClientsResponse, CoreStatus, Dashboard, KeyUsage, McpTargetView, PlanView, ScanReport } from "@/types";
import { CORE, CHATGPT_WINDOWS } from "./core";
import { LOCAL_GATEWAY, status } from "./config";
import { IN_FLIGHT, costBucketsBy, costBy, dashboard, upstreamLatency } from "./traffic";
import { clientsResponse, mcpTargets, plan, scanReport } from "./clients";
import { NOTICES, APP_VERSION, SERVER, autostart, connView, langView, menubar, noticeMode, tested, themeView, updateView } from "./app";
import { P } from "./params";
import { clone, msg } from "./util";

/** 连着远程时，状态、概览都是服务器那台 core 答的：它的网关绑在所有网卡上 */
const gatewayAddr = () => (P.remote ? SERVER.gateway_addr : LOCAL_GATEWAY);

export function coreStatus(): CoreStatus {
  return status(gatewayAddr(), IN_FLIGHT.length);
}

/** 一段时间的用量：起点和一格多宽，都由界面给（对齐到本地整点） */
interface Span {
  sinceMs: number;
  bucketMs: number;
}

/**
 * 截图答得上的命令：`[参数, 回答]`。参数是界面传的第二个参数，回答是界面读的类型。
 * 改配置、动这台机器上文件的命令不在这里 —— 截图只读不写，场景里点到了就是一条报错
 */
interface Commands {
  // 守护与连接
  core_state: [void, string];
  core_status: [void, CoreStatus];
  take_pending_view: [void, string | null];
  connections: [void, ConnView];
  test_connection: [void, Tested];
  switch_preflight: [void, Adopted];
  reveal_main_window: [void, void];
  retry_connection: [void, void];
  pick_connection: [void, void];
  picker_fit: [void, void];
  update_fit: [void, void];
  // 概览与用量（Rust 侧从 core 取齐了一起给）
  dashboard: [Span, Dashboard];
  upstream_stats: [Span, UpstreamStats];
  key_usage: [Span, KeyUsage];
  // 提醒
  notices_list: [void, Notice[]];
  notice_mode: [void, NoticeMode];
  // 设置
  app_info: [void, AppInfo];
  app_language: [void, LanguageView];
  app_theme: [void, ThemeView];
  menubar_style: [void, MenubarStyle];
  autostart_enabled: [void, boolean];
  update_state: [void, UpdateView];
  update_pending: [void, Offer | null];
  gateway_base: [void, string];
  // 这台机器上的客户端、MCP、扫描
  list_clients: [void, ClientsResponse];
  plan_adopt: [{ id: string; env?: string }, PlanView];
  plan_restore: [{ id: string; env?: string }, PlanView];
  mcp_targets: [void, McpTargetView[]];
  scan_clients: [void, ScanReport];
  copy_key: [void, void];
  copy_gateway_base: [void, void];
  copy_client_endpoint: [void, void];
  copy_chatgpt_code: [void, void];
  reveal_client_config: [void, void];
}

type Table = { [C in keyof Commands]: (a: Commands[C][0]) => Commands[C][1] | Promise<Commands[C][1]> };

/**
 * 界面该传的参数。**少了就报错，不按默认值答**：命令改了参数名，按默认值答出来的是
 * 一张算错了时间窗的图，而且不会有人发现
 */
function need<A extends object>(cmd: string, a: A, ...names: (keyof A & string)[]): A {
  for (const n of names) if (a[n] === undefined) throw new Error(`${cmd}: the interface did not pass \`${n}\``);
  return a;
}

const done = () => undefined;

const COMMANDS: Table = {
  core_state: () => "running:48213",
  core_status: coreStatus,
  take_pending_view: () => takeView(),
  connections: connView,
  // 停一下再答，和真的握手一样先转一圈；场景等结果那一行出来之后才拍
  test_connection: async () => {
    await new Promise((r) => setTimeout(r, 400));
    return tested();
  },
  switch_preflight: () => ({ count: 2, local_addr: LOCAL_GATEWAY }),
  reveal_main_window: done,
  retry_connection: done,
  pick_connection: done,
  picker_fit: done,
  update_fit: done,

  dashboard: (a) => {
    const { sinceMs, bucketMs } = need("dashboard", a, "sinceMs", "bucketMs");
    return dashboard(sinceMs, bucketMs);
  },
  upstream_stats: (a) => {
    const { sinceMs, bucketMs } = need("upstream_stats", a, "sinceMs", "bucketMs");
    return {
      costs: costBy(sinceMs, (h) => h.provider || null),
      latency: upstreamLatency(sinceMs),
      quotas: [{ provider: "chatgpt", windows: CHATGPT_WINDOWS() }],
      // Rust 侧把格宽压到不小于一分钟（upstreams.rs 的 `MIN_BUCKET_MS`）
      buckets: costBucketsBy(sinceMs, Math.max(60_000, bucketMs), (h) => h.provider),
    };
  },
  key_usage: (a) => {
    const { sinceMs, bucketMs } = need("key_usage", a, "sinceMs", "bucketMs");
    return {
      since_ms: sinceMs,
      bucket_ms: bucketMs,
      totals: costBy(sinceMs, (h) => h.client),
      buckets: costBucketsBy(sinceMs, bucketMs, (h) => h.client),
    };
  },

  notices_list: () => clone(NOTICES),
  notice_mode: () => noticeMode,

  app_info: () => ({
    version: APP_VERSION,
    identifier: "app.thinkwatch.lite",
    data_dir: "/Users/alex/.thinkwatch",
    core_bin: "/Applications/ThinkWatch Lite.app/Contents/Resources/twcore",
  }),
  app_language: langView,
  app_theme: themeView,
  menubar_style: () => menubar,
  autostart_enabled: () => autostart,
  update_state: updateView,
  update_pending: () => null,
  gateway_base: () => `http://${gatewayAddr()}`,

  list_clients: clientsResponse,
  plan_adopt: (a) => plan(need("plan_adopt", a, "id").id, false),
  plan_restore: (a) => plan(need("plan_restore", a, "id").id, true),
  mcp_targets: mcpTargets,
  scan_clients: scanReport,
  copy_key: done,
  copy_gateway_base: done,
  copy_client_endpoint: done,
  copy_chatgpt_code: done,
  reveal_client_config: done,
};

export async function command(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  if (cmd === "call") {
    const h = CORE[a.endpoint as WebviewEndpoint] as (req: unknown, params: string[]) => unknown;
    return h(a.req, (a.params as string[] | undefined) ?? []);
  }
  if (cmd.startsWith("plugin:")) return null;
  if (!Object.hasOwn(COMMANDS, cmd)) throw msg("", `${cmd} is not available in screenshots.`);
  return (COMMANDS[cmd as keyof Commands] as (a: unknown) => unknown)(a);
}

/** `?scene=` 的那一页，像 Rust 那边存着的待打开页面一样只交一次 */
let pending: string | null = P.page;
function takeView() {
  const v = pending;
  pending = null;
  return v;
}
