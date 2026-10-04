import { describe, expect, it } from "vitest";
import { trouble } from "./trouble";

describe("trouble: core exited in safe mode too", () => {
  it("says it cannot start and gives core's own words, with a retry", () => {
    const t = trouble("exited:已有 twcore 实例正在运行（pid 7）。", 0);
    expect(t.what).toBe("core 无法启动");
    expect(t.next).toBe("已有 twcore 实例正在运行（pid 7）。");
    expect(t.retry).toBe(true);
    expect(t.bad).toBe(true);
  });

  it("treats safe mode with the control plane up like safe mode", () => {
    expect(trouble("safe_mode:4242", 0).what).toBe(trouble("safe_mode", 0).what);
  });
});
