import { describe, expect, it } from "vitest";
import { abortable } from "./abort";

describe("能不能中止", () => {
  it("只有在跑的、不在 WebSocket 连接上的", () => {
    expect(abortable({ state: "in_flight" })).toBe(true);
    expect(abortable({ state: "in_flight", ws: true })).toBe(false);
    for (const state of ["done", "failed", "cancelled"] as const) expect(abortable({ state })).toBe(false);
  });
});
