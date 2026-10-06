/**
 * 手写的模型规格（上下文窗口、输出上限、推理、图片输入）：从 `ModelRow` 读出手写的那几项、
 * 格子里的数写得对不对、表单怎么变成要存的四项。**先后只在 core 定**
 * （`tw_config::model_specs::resolve`）：这里只认 core 标的来源，不自己比大小。
 */
import type { ModelRow, ModelSpecSave } from "@/types";

/** 一项最多写多少：core 存的是 `u32` */
export const MAX_SPEC_TOKENS = 4_294_967_295;

/**
 * 格子里的 token 数。空是不写（`null`，用价目表的）；写的不是 1 到 `u32` 上限的整数是
 * `undefined`。千分位的逗号、空格、下划线照常认：`128,000` 和 `128000` 是同一个数。
 */
export function tokensOf(v: string): number | null | undefined {
  const s = v.replace(/[\s,_]/g, "");
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= MAX_SPEC_TOKENS ? n : undefined;
}

/** 推理、图片输入这类是非项的三个选择：用价目表的、手写「支持」、手写「不支持」 */
export type SpecFlag = "table" | "yes" | "no";

/** 对话框里的四项。数是格子里的原文，是非项是选中的那一段 */
export type SpecForm = { context: string; output: string; reasoning: SpecFlag; imageInput: SpecFlag };

/** 手写的是非项在表单里的选择。没手写（来自价目表或不知道）就是「价目表」 */
function flagOf(value: boolean | null | undefined, source: ModelRow["reasoning_source"]): SpecFlag {
  if (source !== "manual" || value == null) return "table";
  return value ? "yes" : "no";
}

/** 选择 → 要存的值。「价目表」是不写（`null`） */
function flagValue(f: SpecFlag): boolean | null {
  return f === "table" ? null : f === "yes";
}

/** 这个模型此刻手写的几项，表单里的写法。没手写的数是空的、是非项是「价目表」 */
export function manualOf(m: ModelRow): SpecForm {
  return {
    context: m.context_window_source === "manual" && m.context_window != null ? String(m.context_window) : "",
    output: m.max_output_tokens_source === "manual" && m.max_output_tokens != null ? String(m.max_output_tokens) : "",
    reasoning: flagOf(m.reasoning, m.reasoning_source),
    imageInput: flagOf(m.image_input, m.image_input_source),
  };
}

/** 要存的四项。**四项都是 `null` 就是删掉手写的**，回到价目表 */
export type SpecValues = Required<Pick<ModelSpecSave, "context_window" | "max_output_tokens" | "reasoning" | "image_input">>;

/** 表单 → 要存的四项。数写得不对时是 `undefined`，不能存 */
export function specOf(f: SpecForm): SpecValues | undefined {
  const context_window = tokensOf(f.context);
  const max_output_tokens = tokensOf(f.output);
  if (context_window === undefined || max_output_tokens === undefined) return undefined;
  return { context_window, max_output_tokens, reasoning: flagValue(f.reasoning), image_input: flagValue(f.imageInput) };
}

/** 四项都不写：存下去就是删掉这个模型手写的规格 */
export function isEmptySpec(v: SpecValues): boolean {
  return v.context_window === null && v.max_output_tokens === null && v.reasoning === null && v.image_input === null;
}

/** 两份要存的四项是不是一样（格子里 `128,000` 和 `128000` 算一样） */
export function sameSpec(a: SpecValues, b: SpecValues): boolean {
  return (
    a.context_window === b.context_window &&
    a.max_output_tokens === b.max_output_tokens &&
    a.reasoning === b.reasoning &&
    a.image_input === b.image_input
  );
}

/** 这个模型在这一家有手写的规格 */
export function hasManual(m: ModelRow): boolean {
  return (
    m.context_window_source === "manual" ||
    m.max_output_tokens_source === "manual" ||
    m.reasoning_source === "manual" ||
    m.image_input_source === "manual"
  );
}
