import { describe, expect, it } from "vitest";
import type { ModelRow } from "@/types";
import { catalogOf } from "./ModelsSection";
import { MAX_SPEC_TOKENS, hasManual, manualOf, tokensOf } from "./modelSpec";

function row(patch: Partial<ModelRow> = {}): ModelRow {
  return { id: "glm-5-air", enabled: true, estimated: false, aliases: [], ...patch };
}

/** 手写的模型规格：格子里的数怎么认，哪几项是手写的 */
describe("模型规格", () => {
  it("空是不写（用价目表）；千分位照常认；0、小数、超出 u32 的不收", () => {
    expect(tokensOf("")).toBeNull();
    expect(tokensOf("  ")).toBeNull();
    expect(tokensOf("128000")).toBe(128_000);
    expect(tokensOf("128,000")).toBe(128_000);
    expect(tokensOf(" 1 000 000 ")).toBe(1_000_000);
    expect(tokensOf(String(MAX_SPEC_TOKENS))).toBe(MAX_SPEC_TOKENS);
    for (const bad of ["0", "1.5", "-3", "128k", String(MAX_SPEC_TOKENS + 1)]) expect(tokensOf(bad)).toBeUndefined();
  });

  it("只回填手写的那几项：来自价目表的数不进格子", () => {
    const both = row({
      context_window: 1_000_000,
      context_window_source: "manual",
      max_output_tokens: 64_000,
      max_output_tokens_source: "price_table",
    });
    expect(manualOf(both)).toEqual({ context: "1000000", output: "" });
    expect(hasManual(both)).toBe(true);
    const table = row({ context_window: 200_000, context_window_source: "price_table" });
    expect(manualOf(table)).toEqual({ context: "", output: "" });
    expect(hasManual(table)).toBe(false);
    expect(hasManual(row({ max_output_tokens: 16_384, max_output_tokens_source: "manual" }))).toBe(true);
    expect(hasManual(row())).toBe(false);
  });

  it("编辑对话框的模型一节：手写的上下文窗口和弹窗里是同一个数", () => {
    const c = catalogOf({
      provider: "relay",
      source: "discovered",
      status: "listed",
      fetching: false,
      models: [
        row({ id: "a", context_window: 128_000, context_window_source: "manual" }),
        row({ id: "b", context_window: 200_000, context_window_source: "price_table" }),
        row({ id: "c", max_output_tokens: 8_000, max_output_tokens_source: "manual" }),
      ],
    });
    expect(c.manualContext).toEqual({ a: 128_000 });
  });
});
