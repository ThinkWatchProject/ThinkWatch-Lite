import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginUpdate, PluginView } from "@/types";

/*
  `savePlugin` 走哪条路：网页那条（`UpdatePlugin`，经过 `call`），还是请 Rust 弹系统的确认框
  （`plugin_update_confirmed`，经过 `invoke`）。两样都换成记录调用的假的。
*/
const invoke = vi.fn();
const call = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/control", () => ({ call: (...a: unknown[]) => call(...a) }));

const { savePlugin } = await import("./native");

function plugin(over: Partial<PluginView> = {}): PluginView {
  return {
    id: "p",
    name: "p",
    description: null,
    enabled: false,
    on_error: "reject",
    permissions: ["system"],
    requests: ["conversation"],
    scope: { clients: [], models: [], upstreams: [] },
    reply_mode: "block",
    settings_schema: [],
    settings: {},
    sha256: "aa",
    status: { kind: "disabled" },
    stats: { calls: 0, changed: 0, rejected: 0, errors: 0, avg_cpu_us: 0, last_error: null },
    ...over,
  };
}

const update = (p: PluginView, over: Partial<PluginUpdate> = {}): PluginUpdate => ({
  enabled: p.enabled,
  on_error: p.on_error,
  scope: p.scope,
  settings: p.settings,
  base_version: "v1",
  ...over,
});

beforeEach(() => {
  invoke.mockReset();
  call.mockReset();
});

describe("保存插件", () => {
  it("别的插件照常走网页那条", async () => {
    call.mockResolvedValue({ version: "v2" });
    const p = plugin();
    expect(await savePlugin(p, update(p, { enabled: true }))).toEqual({ kind: "done", version: "v2" });
    expect(call).toHaveBeenCalledWith("UpdatePlugin", expect.objectContaining({ enabled: true }), "p");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("打开改得了工具调用的插件：直接请 Rust 弹确认框，取消照原样交回", async () => {
    invoke.mockResolvedValue({ kind: "cancelled" });
    const p = plugin({ permissions: ["messages", "reply_tool_calls"] });
    const next = update(p, { enabled: true });
    expect(await savePlugin(p, next)).toEqual({ kind: "cancelled" });
    expect(invoke).toHaveBeenCalledWith("plugin_update_confirmed", { req: { id: "p", update: next } });
    expect(call).not.toHaveBeenCalled();
  });

  it("读不出权限的插件按改得了工具调用算", async () => {
    invoke.mockResolvedValue({ kind: "done", version: "v3" });
    const p = plugin({ permissions: [] });
    expect(await savePlugin(p, update(p, { scope: { clients: ["codex"], models: [], upstreams: [] } }))).toEqual({
      kind: "done",
      version: "v3",
    });
    expect(call).not.toHaveBeenCalled();
  });

  it("只是停用、改出错时：网页那条就够", async () => {
    call.mockResolvedValue({ version: "v2" });
    const p = plugin({ enabled: true, permissions: ["reply_tool_calls"] });
    await savePlugin(p, update(p, { enabled: false, on_error: "skip" }));
    expect(call).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("core 说要点头的，同一份改动再请 Rust 走一遍确认", async () => {
    call.mockRejectedValue({ code: "control.plugin.needs_confirmation", args: { plugin: "p" }, text: "…" });
    invoke.mockResolvedValue({ kind: "done", version: "v4" });
    const p = plugin();
    const next = update(p, { enabled: true });
    expect(await savePlugin(p, next)).toEqual({ kind: "done", version: "v4" });
    expect(invoke).toHaveBeenCalledWith("plugin_update_confirmed", { req: { id: "p", update: next } });
  });

  it("别的失败照样抛出", async () => {
    const stale = { code: "control.config_stale", args: {}, text: "stale" };
    call.mockRejectedValue(stale);
    const p = plugin();
    await expect(savePlugin(p, update(p, { enabled: true }))).rejects.toBe(stale);
    expect(invoke).not.toHaveBeenCalled();
  });
});
