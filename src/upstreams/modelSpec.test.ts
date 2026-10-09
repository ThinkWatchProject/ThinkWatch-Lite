import { describe, expect, it } from "vitest";
import type { ModelRow } from "@/types";
import { catalogOf } from "./ModelsSection";
import { MAX_SPEC_TOKENS, hasManual, isEmptySpec, manualOf, sameSpec, specOf, tokensOf } from "./modelSpec";

function row(patch: Partial<ModelRow> = {}): ModelRow {
  return { id: "glm-5-air", enabled: true, estimated: false, aliases: [], manual: false, listed: true, ...patch };
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
    expect(manualOf(both)).toEqual({ context: "1000000", output: "", reasoning: "table", imageInput: "table" });
    expect(hasManual(both)).toBe(true);
    const table = row({ context_window: 200_000, context_window_source: "price_table" });
    expect(manualOf(table)).toEqual({ context: "", output: "", reasoning: "table", imageInput: "table" });
    expect(hasManual(table)).toBe(false);
    expect(hasManual(row({ max_output_tokens: 16_384, max_output_tokens_source: "manual" }))).toBe(true);
    expect(hasManual(row())).toBe(false);
  });

  it("推理、图片输入：手写的回填成支持 / 不支持，价目表给的是「价目表」", () => {
    const m = row({
      reasoning: false,
      reasoning_source: "manual",
      image_input: true,
      image_input_source: "price_table",
    });
    expect(manualOf(m)).toMatchObject({ reasoning: "no", imageInput: "table" });
    expect(hasManual(m)).toBe(true);
    expect(manualOf(row({ image_input: true, image_input_source: "manual" })).imageInput).toBe("yes");
    expect(hasManual(row({ image_input: true, image_input_source: "manual" }))).toBe(true);
    expect(hasManual(row({ reasoning: true, reasoning_source: "price_table" }))).toBe(false);
  });

  it("表单 → 要存的四项：「价目表」和空格子是 null；数不对就不能存", () => {
    expect(specOf({ context: "128,000", output: "", reasoning: "yes", imageInput: "no" })).toEqual({
      context_window: 128_000,
      max_output_tokens: null,
      reasoning: true,
      image_input: false,
    });
    expect(specOf({ context: "128k", output: "", reasoning: "yes", imageInput: "table" })).toBeUndefined();
    // 回填再转回去，和 core 给的是同一份
    const m = row({
      context_window: 200_000,
      context_window_source: "price_table",
      max_output_tokens: 32_000,
      max_output_tokens_source: "manual",
      reasoning: true,
      reasoning_source: "manual",
    });
    expect(specOf(manualOf(m))).toEqual({
      context_window: null,
      max_output_tokens: 32_000,
      reasoning: true,
      image_input: null,
    });
  });

  it("四项都不写就是删掉；只要有一项写了就不是", () => {
    const empty = specOf({ context: "", output: " ", reasoning: "table", imageInput: "table" })!;
    expect(isEmptySpec(empty)).toBe(true);
    for (const f of [
      { context: "1", output: "", reasoning: "table", imageInput: "table" },
      { context: "", output: "", reasoning: "no", imageInput: "table" },
      { context: "", output: "", reasoning: "table", imageInput: "yes" },
    ] as const)
      expect(isEmptySpec(specOf(f)!)).toBe(false);
    // 千分位写法不同不算改了；是非项换了算
    const a = specOf({ context: "128,000", output: "", reasoning: "table", imageInput: "table" })!;
    expect(sameSpec(a, specOf({ context: "128000", output: "", reasoning: "table", imageInput: "table" })!)).toBe(true);
    expect(sameSpec(a, specOf({ context: "128000", output: "", reasoning: "no", imageInput: "table" })!)).toBe(false);
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
