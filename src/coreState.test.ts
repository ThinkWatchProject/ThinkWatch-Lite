import { describe, expect, it } from "vitest";
import { controlUp, isRunning, parseCoreState } from "./coreState";

describe("core 状态字符串", () => {
  it("认得 Rust 那边说的每一种", () => {
    expect(parseCoreState("starting")).toEqual({ kind: "starting" });
    expect(parseCoreState("running:4242")).toEqual({ kind: "running", pid: 4242 });
    // 连着远程、连上了
    expect(parseCoreState("running:0")).toEqual({ kind: "running", pid: 0 });
    expect(parseCoreState("restarting:3:4000")).toEqual({ kind: "restarting", attempt: 3, inMs: 4000 });
    expect(parseCoreState("safe_mode")).toEqual({ kind: "safe_mode", pid: null });
    expect(parseCoreState("safe_mode:4242")).toEqual({ kind: "safe_mode", pid: 4242 });
    expect(parseCoreState("stopped")).toEqual({ kind: "stopped" });
    expect(parseCoreState("unlinked")).toEqual({ kind: "unlinked" });
  });

  it("原因里的冒号原样留着：只切第一个", () => {
    expect(parseCoreState("failed:无法运行 /x/twcore：没有执行权限")).toEqual({
      kind: "failed",
      reason: "无法运行 /x/twcore：没有执行权限",
    });
    expect(parseCoreState("exited:already running (pid: 7)")).toEqual({ kind: "exited", reason: "already running (pid: 7)" });
    expect(parseCoreState("missing:")).toEqual({ kind: "missing", reason: "" });
  });

  it("重启缺了几段时按第 1 次、马上算", () => {
    expect(parseCoreState("restarting:")).toEqual({ kind: "restarting", attempt: 1, inMs: 0 });
    expect(parseCoreState("restarting:0")).toEqual({ kind: "restarting", attempt: 0, inMs: 0 });
  });

  it("认不出的不当成在跑", () => {
    for (const raw of ["", "running", "starting:1", "bogus", "RUNNING:1"]) {
      const s = parseCoreState(raw);
      expect(s.kind).toBe("unknown");
      expect(isRunning(s)).toBe(false);
      expect(controlUp(s)).toBe(false);
    }
  });

  it("控制面答应了：在跑，或者安全模式里带着 pid", () => {
    expect(controlUp(parseCoreState("running:1"))).toBe(true);
    expect(controlUp(parseCoreState("safe_mode:1"))).toBe(true);
    expect(controlUp(parseCoreState("safe_mode"))).toBe(false);
    expect(controlUp(parseCoreState("restarting:1:1000"))).toBe(false);
    expect(isRunning(parseCoreState("safe_mode:1"))).toBe(false);
  });
});
