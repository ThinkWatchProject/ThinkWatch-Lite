import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ZOOM_STEPS } from "@/settings/api";
import { zoomStep } from "./keys";

describe("界面大小", () => {
  it("= 和 + 放大，- 缩小，0 回到 100%，别的键不算", () => {
    expect(zoomStep("=")).toBe("in");
    expect(zoomStep("+")).toBe("in");
    expect(zoomStep("-")).toBe("out");
    expect(zoomStep("0")).toBe("reset");
    expect(zoomStep("1")).toBeNull();
    expect(zoomStep("_")).toBeNull();
    expect(zoomStep("k")).toBeNull();
  });

  /** 设置页的几档和 Rust 认的几档是同一组：多一档的话，选了存不进去 */
  it("设置页的几档和 src-tauri/src/zoom.rs 的 STEPS 一致", () => {
    const src = readFileSync("src-tauri/src/zoom.rs", "utf8");
    const m = /pub const STEPS: \[u16; \d+\] = \[([^\]]+)\]/.exec(src);
    expect(m).not.toBeNull();
    const rust = m![1]!.split(",").map((s) => Number(s.trim()));
    expect([...ZOOM_STEPS]).toEqual(rust);
  });
});
