import { describe, expect, it } from "vitest";
import { fixText } from "./repair";

describe("fixText", () => {
  it("says what a value goes back to", () => {
    expect(
      fixText({ kind: "unknown_value", field: "client_probes.titling", line: 48, value: "passthrough", now: "forward" }),
    ).toBe("client_probes.titling：passthrough 改为默认值 forward");
  });

  it("still says something when the default is not a single value", () => {
    expect(fixText({ kind: "unknown_value", field: "security.mode", line: 3, value: "strict", now: null })).toBe(
      "security.mode：删除 strict，改用默认值",
    );
  });

  it("names an unknown field it removes", () => {
    expect(fixText({ kind: "unknown_field", field: "retention.body_dayz", line: 53, value: "3", now: null })).toBe(
      "删除不认识的字段 retention.body_dayz",
    );
  });
});
