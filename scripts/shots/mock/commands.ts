// 界面 invoke 的每一个 Tauri 命令（src-tauri/src/lib.rs 的 generate_handler!），外加 `call`
// —— 它按端点名转给 ./core.ts。
//
// 命令在 Rust 那边没有类型可查，**漏了一个不会编译失败**：未知的命令直接抛错，页面报错
// 会让截图程序停下来（见 capture.swift 的 consoleHook），不会拍出一张缺了一块的图。
import type { WebviewEndpoint } from "@/control";
import type { CoreStatus } from "@/types";
import { CORE, CHATGPT_WINDOWS } from "./core";
import { LOCAL_GATEWAY, status } from "./config";
import { IN_FLIGHT, costBy, dashboard, upstreamLatency } from "./traffic";
import { clientsResponse, mcpTargets, plan, scanReport } from "./clients";
import { NOTICES, APP_VERSION, SERVER, autostart, connView, langView, menubar, noticeMode, tested, themeView, updateView } from "./app";
import { P } from "./params";
import { DAY, HOUR, NOW, clone, msg } from "./util";

/** 连着远程时，状态、概览都是服务器那台 core 答的：它的网关绑在所有网卡上 */
const gatewayAddr = () => (P.remote ? SERVER.gateway_addr : LOCAL_GATEWAY);

export function coreStatus(): CoreStatus {
  return status(gatewayAddr(), IN_FLIGHT.length);
}

const refuse = (cmd: string): never => {
  throw msg("", `${cmd} is not available in screenshots.`);
};

export async function command(cmd: string, a: Record<string, unknown>): Promise<unknown> {
  if (cmd === "call") {
    const h = CORE[a.endpoint as WebviewEndpoint] as (req: unknown, params: string[]) => unknown;
    return h(a.req, (a.params as string[] | undefined) ?? []);
  }
  if (cmd.startsWith("plugin:")) return null;
  switch (cmd) {
    // ── 守护与连接
    case "core_state":
      return "running:48213";
    case "core_status":
      return coreStatus();
    case "reveal_main_window":
    case "retry_connection":
    case "pick_connection":
    case "picker_fit":
    case "update_fit":
    case "copy_key":
    case "copy_gateway_base":
    case "copy_client_endpoint":
    case "copy_chatgpt_code":
    case "reveal_client_config":
      return null;
    case "take_pending_view":
      return takeView();
    case "connections":
      return connView();
    case "test_connection":
      // 停一下再答，和真的握手一样先转一圈；场景等结果那一行出来之后才拍
      await new Promise((r) => setTimeout(r, 400));
      return tested();
    case "switch_preflight":
      return { count: 2, local_addr: LOCAL_GATEWAY };

    // ── 概览与用量（Rust 侧从 core 取齐了一起给）
    case "dashboard":
      return dashboard(Number(a.sinceMs ?? NOW - DAY), Number(a.bucketMs ?? HOUR));
    case "upstream_stats": {
      const since = Number(a.sinceMs ?? NOW - DAY);
      return {
        costs: costBy(since, (h) => h.provider || null),
        latency: upstreamLatency(since),
        quotas: [{ provider: "chatgpt", windows: CHATGPT_WINDOWS() }],
      };
    }
    case "key_usage":
      return costBy(Number(a.sinceMs ?? NOW - DAY), (h) => h.client);

    // ── 提醒
    case "notices_list":
      return clone(NOTICES);
    case "notice_mode":
      return noticeMode;

    // ── 设置
    case "app_info":
      return {
        version: APP_VERSION,
        identifier: "app.thinkwatch.lite",
        data_dir: "/Users/alex/.thinkwatch",
        core_bin: "/Applications/ThinkWatch Lite.app/Contents/Resources/twcore",
      };
    case "app_language":
      return langView();
    case "app_theme":
      return themeView();
    case "menubar_style":
      return menubar;
    case "autostart_enabled":
      return autostart;
    case "update_state":
      return updateView();
    case "update_pending":
      return null;
    case "gateway_base":
      return `http://${gatewayAddr()}`;

    // ── 这台机器上的客户端、MCP、扫描
    case "list_clients":
      return clientsResponse();
    case "plan_adopt":
      return plan(String(a.id), false);
    case "plan_restore":
      return plan(String(a.id), true);
    case "mcp_targets":
      return mcpTargets();
    case "scan_clients":
      return scanReport();
  }
  return refuse(cmd);
}

/** `?scene=` 的那一页，像 Rust 那边存着的待打开页面一样只交一次 */
let pending: string | null = P.page;
function takeView() {
  const v = pending;
  pending = null;
  return v;
}
