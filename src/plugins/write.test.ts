import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestView, PluginView } from "@/types";

/*
  插件的写入走哪条路：网页那条（`CreatePlugin`、`SavePlugin`、`ApprovePluginFile`，经过 `call`），
  还是请 Rust 弹系统的确认框（`plugin_install_confirmed` 等，经过 `invoke`）。两样都换成记录
  调用的假的。
*/
const invoke = vi.fn();
const call = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/control", () => ({ call: (...a: unknown[]) => call(...a) }));

const { approvePlugin, installPlugin, savePlugin, setEnabled } = await import("./write");

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
    sha256: "aa",
    status: { kind: "disabled" },
    stats: { calls: 0, changed: 0, rejected: 0, errors: 0, avg_cpu_us: 0, last_error: null },
    ...over,
  };
}

function manifest(over: Partial<ManifestView> = {}): ManifestView {
  return {
    name: "p",
    description: null,
    permissions: ["system"],
    requests: ["conversation"],
    scope: { clients: [], models: [], upstreams: [] },
    reply_mode: "block",
    on_error: "reject",
    settings_schema: [],
    hooks: { request: true, reply_text: false, tool_call: false },
    ...over,
  };
}

const NEEDS = { code: "control.plugin.needs_confirmation", args: { plugin: "p" }, text: "…" };
const TOOLS = ["messages", "reply_tool_calls"] as const;

beforeEach(() => {
  invoke.mockReset();
  call.mockReset();
});

describe("装插件", () => {
  const req = { source: "src", id: "p", enabled: true, base_version: "v1" };

  it("改得了工具调用的：直接请 Rust，一个确认框", async () => {
    invoke.mockResolvedValue({ kind: "done", version: "v2" });
    expect(await installPlugin(req, manifest({ permissions: [...TOOLS] }))).toEqual({ kind: "done", version: "v2" });
    expect(invoke).toHaveBeenCalledWith("plugin_install_confirmed", { req });
    expect(call).not.toHaveBeenCalled();
  });

  it("别的走网页那条，不问", async () => {
    call.mockResolvedValue({ version: "v2" });
    expect(await installPlugin(req, manifest())).toEqual({ kind: "done", version: "v2" });
    expect(call).toHaveBeenCalledWith("CreatePlugin", req);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("core 说要点头的，同一份请求再请 Rust", async () => {
    call.mockRejectedValue(NEEDS);
    invoke.mockResolvedValue({ kind: "cancelled" });
    expect(await installPlugin(req, manifest())).toEqual({ kind: "cancelled" });
    expect(invoke).toHaveBeenCalledWith("plugin_install_confirmed", { req });
  });
});

describe("保存插件", () => {
  const req = { id: "p", source: "src", enabled: true, base_version: "v1" };

  it("界面确定要点头的：直接请 Rust", async () => {
    invoke.mockResolvedValue({ kind: "done", version: "v3" });
    expect(await savePlugin(req, true)).toEqual({ kind: "done", version: "v3" });
    expect(invoke).toHaveBeenCalledWith("plugin_save_confirmed", { req });
    expect(call).not.toHaveBeenCalled();
  });

  it("别的走网页那条：代码和开关在请求里，ID 在路径上", async () => {
    call.mockResolvedValue({ version: "v2" });
    expect(await savePlugin(req, false)).toEqual({ kind: "done", version: "v2" });
    expect(call).toHaveBeenCalledWith("SavePlugin", { source: "src", enabled: true, base_version: "v1" }, "p");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("界面判断不了的（代码在 manifest 以外改了）：core 说要点头再请 Rust，不必再按一次", async () => {
    call.mockRejectedValue(NEEDS);
    invoke.mockResolvedValue({ kind: "done", version: "v4" });
    expect(await savePlugin(req, false)).toEqual({ kind: "done", version: "v4" });
    expect(invoke).toHaveBeenCalledWith("plugin_save_confirmed", { req });
  });

  it("别的失败照样抛出", async () => {
    const stale = { code: "control.config_stale", args: {}, text: "stale" };
    call.mockRejectedValue(stale);
    await expect(savePlugin(req, false)).rejects.toBe(stale);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("批准改过的文件", () => {
  it("原来的或改过的文件改得了工具调用：直接请 Rust", async () => {
    invoke.mockResolvedValue({ kind: "done", version: "v2" });
    await approvePlugin(plugin({ permissions: [...TOOLS] }), "bb", manifest(), "v1");
    await approvePlugin(plugin(), "bb", manifest({ permissions: [...TOOLS] }), "v1");
    // 改过的文件读不出来：按改得了算
    await approvePlugin(plugin(), "bb", null, "v1");
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(invoke).toHaveBeenCalledWith("plugin_approve_confirmed", { req: { id: "p", base_version: "v1" } });
    expect(call).not.toHaveBeenCalled();
  });

  it("别的走网页那条，带看过的那一份的哈希", async () => {
    call.mockResolvedValue({ version: "v2" });
    expect(await approvePlugin(plugin(), "bb", manifest(), "v1")).toEqual({ kind: "done", version: "v2" });
    expect(call).toHaveBeenCalledWith("ApprovePluginFile", { sha256: "bb", base_version: "v1" }, "p");
  });
});

describe("拨开关", () => {
  const source = { approved: "approved", approved_sha256: "aa", current: "approved", current_sha256: "aa" };

  it("开关和确认过的代码一起交；打开改得了工具调用的直接请 Rust", async () => {
    call.mockResolvedValueOnce(source);
    invoke.mockResolvedValue({ kind: "done", version: "v2" });
    await setEnabled(plugin({ permissions: [...TOOLS] }), true, false, "v1");
    expect(call).toHaveBeenCalledWith("PluginSourceDiff", null, "p");
    expect(invoke).toHaveBeenCalledWith("plugin_save_confirmed", {
      req: { id: "p", source: "approved", enabled: true, base_version: "v1" },
    });
  });

  it("停用、打开别的插件：网页那条", async () => {
    call.mockResolvedValueOnce(source).mockResolvedValueOnce({ version: "v2" });
    await setEnabled(plugin({ permissions: [...TOOLS], enabled: true }), false, true, "v1");
    expect(call).toHaveBeenLastCalledWith("SavePlugin", { source: "approved", enabled: false, base_version: "v1" }, "p");
    call.mockResolvedValueOnce(source).mockResolvedValueOnce({ version: "v3" });
    await setEnabled(plugin(), true, false, "v2");
    expect(call).toHaveBeenLastCalledWith("SavePlugin", { source: "approved", enabled: true, base_version: "v2" }, "p");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("底稿没了：磁盘上那一份的哈希对得上也行，都没有就报错", async () => {
    call.mockResolvedValueOnce({ ...source, approved: "" }).mockResolvedValueOnce({ version: "v2" });
    await setEnabled(plugin(), true, false, "v1");
    expect(call).toHaveBeenLastCalledWith("SavePlugin", { source: "approved", enabled: true, base_version: "v1" }, "p");
    call.mockResolvedValueOnce({ ...source, approved: "", current_sha256: "cc" });
    await expect(setEnabled(plugin(), true, false, "v1")).rejects.toMatchObject({ code: "" });
  });
});
