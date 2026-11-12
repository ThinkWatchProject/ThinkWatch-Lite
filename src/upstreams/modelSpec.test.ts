import { describe, expect, it } from "vitest";
import type { ModelRow } from "@/types";
import { catalogOf } from "./ModelsSection";
import { MAX_SPEC_TOKENS, effortOf, toggleEffortLevel, hasManual, isEmptySpec, manualOf, sameSpec, specOf, tokensOf } from "./modelSpec";

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
    expect(manualOf(both)).toEqual({ context: "1000000", output: "", reasoning: "table", imageInput: "table", effort: effortOf(null) });
    expect(hasManual(both)).toBe(true);
    const table = row({ context_window: 200_000, context_window_source: "price_table" });
    expect(manualOf(table)).toEqual({ context: "", output: "", reasoning: "table", imageInput: "table", effort: effortOf(null) });
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
    expect(manualOf(m)).toMatchObject({ reasoning: "no", imageInput: "table", effort: effortOf(null) });
    expect(hasManual(m)).toBe(true);
    expect(manualOf(row({ image_input: true, image_input_source: "manual" })).imageInput).toBe("yes");
    expect(hasManual(row({ image_input: true, image_input_source: "manual" }))).toBe(true);
    expect(hasManual(row({ reasoning: true, reasoning_source: "price_table" }))).toBe(false);
  });

  it("表单 → 要存的四项：「价目表」和空格子是 null；数不对就不能存", () => {
    expect(specOf({ context: "128,000", output: "", reasoning: "yes", imageInput: "no", effort: effortOf(null) })).toEqual({
      context_window: 128_000,
      max_output_tokens: null,
      reasoning: true,
      image_input: false,
      reasoning_effort: { mode: "auto" },
    });
    expect(specOf({ context: "128k", output: "", reasoning: "yes", imageInput: "table", effort: effortOf(null) })).toBeUndefined();
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
      reasoning_effort: { mode: "auto" },
    });
  });

  it("四项都不写就是删掉；只要有一项写了就不是", () => {
    const empty = specOf({ context: "", output: " ", reasoning: "table", imageInput: "table", effort: effortOf(null) })!;
    expect(isEmptySpec(empty)).toBe(true);
    for (const f of [
      { context: "1", output: "", reasoning: "table", imageInput: "table", effort: effortOf(null) },
      { context: "", output: "", reasoning: "no", imageInput: "table", effort: effortOf(null) },
      { context: "", output: "", reasoning: "table", imageInput: "yes", effort: effortOf(null) },
    ] as const)
      expect(isEmptySpec(specOf(f)!)).toBe(false);
    // 千分位写法不同不算改了；是非项换了算
    const a = specOf({ context: "128,000", output: "", reasoning: "table", imageInput: "table", effort: effortOf(null) })!;
    expect(sameSpec(a, specOf({ context: "128000", output: "", reasoning: "table", imageInput: "table", effort: effortOf(null) })!)).toBe(true);
    expect(sameSpec(a, specOf({ context: "128000", output: "", reasoning: "no", imageInput: "table", effort: effortOf(null) })!)).toBe(false);
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


describe("推理档位覆盖", () => {
  const form = (effort = effortOf(null)) => ({ context: "", output: "", reasoning: "table" as const, imageInput: "table" as const, effort });

  it("自动发现的档位只作参考，不写成手动配置", () => {
    const m = row({ reasoning: true, reasoning_source: "upstream", reasoning_effort: { supported_levels: ["low", "high"], default_level: "high" }, reasoning_effort_source: "upstream" });
    expect(specOf(manualOf(m))?.reasoning_effort).toEqual({ mode: "auto" });
    expect(hasManual(m)).toBe(false);
  });

  it("手动原值回填时不固化自动默认值和由档位推导的推理支持", () => {
    const m = row({ reasoning: true, reasoning_source: "manual", manual_reasoning_effort: { supported_levels: ["high", "low"] }, reasoning_effort: { supported_levels: ["low", "high"], default_level: "low" }, reasoning_effort_source: "manual" });
    const saved = specOf(manualOf(m))!;
    expect(saved.reasoning).toBeNull();
    expect(saved.reasoning_effort).toEqual({ mode: "set", value: { supported_levels: ["low", "high"] } });
    expect(hasManual(m)).toBe(true);
    expect(isEmptySpec(saved)).toBe(false);
  });

  it("未知、明确不可调和手动档位分别保存，恢复自动会明确移除覆盖", () => {
    expect(specOf(form())?.reasoning_effort).toEqual({ mode: "auto" });
    const none = specOf(form(effortOf({ supported_levels: [] })))!;
    expect(none.reasoning_effort).toEqual({ mode: "set", value: { supported_levels: [] } });
    expect(isEmptySpec(none)).toBe(false);
    expect(sameSpec(none, specOf(form())!)).toBe(false);
    const manual = specOf(form(effortOf({ supported_levels: ["high"], default_level: "high" })))!;
    expect(manual.reasoning_effort).toEqual({ mode: "set", value: { supported_levels: ["high"], default_level: "high" } });
  });

  it("空手动列表、重复档位、无效默认值和关闭推理的矛盾配置不能保存", () => {
    for (const effort of [
      { mode: "manual" as const, levels: [], defaultLevel: "auto" as const },
      { mode: "manual" as const, levels: ["high", "high"] as ("high")[], defaultLevel: "auto" as const },
      { mode: "manual" as const, levels: ["low"] as ("low")[], defaultLevel: "high" as const },
    ]) expect(specOf(form(effort))).toBeUndefined();
    expect(specOf({ ...form(effortOf({ supported_levels: ["high"] })), reasoning: "no" })).toBeUndefined();
  });

  it("去掉默认档位时恢复自动选择，不留下已不支持的默认值", () => {
    expect(toggleEffortLevel(effortOf({ supported_levels: ["low", "high"], default_level: "high" }), "high"))
      .toEqual({ mode: "manual", levels: ["low"], defaultLevel: "auto" });
  });
});
