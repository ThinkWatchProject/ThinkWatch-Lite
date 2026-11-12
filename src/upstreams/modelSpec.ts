/** Manual overrides only. Core resolves upstream metadata, sources and protocol restrictions. */
import type { ModelRow, ModelSpecSave, ReasoningEffort, ReasoningLevel } from "@/types";

export const MAX_SPEC_TOKENS = 4_294_967_295;
export const REASONING_LEVELS: readonly ReasoningLevel[] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export function tokensOf(v: string): number | null | undefined {
  const s = v.replace(/[\s,_]/g, "");
  if (s === "") return null;
  if (!/^\d+$/.test(s)) return undefined;
  const n = Number(s);
  return n >= 1 && n <= MAX_SPEC_TOKENS ? n : undefined;
}

export type SpecFlag = "table" | "yes" | "no";
export type EffortMode = "auto" | "none" | "manual";
export type EffortForm = { mode: EffortMode; levels: ReasoningLevel[]; defaultLevel: ReasoningLevel | "auto" };
export type SpecForm = {
  context: string;
  output: string;
  reasoning: SpecFlag;
  imageInput: SpecFlag;
  effort: EffortForm;
};

export function effortOf(value: ReasoningEffort | null | undefined): EffortForm {
  return {
    mode: value == null ? "auto" : value.supported_levels.length === 0 ? "none" : "manual",
    levels: [...(value?.supported_levels ?? [])],
    defaultLevel: value?.default_level ?? "auto",
  };
}

export function toggleEffortLevel(form: EffortForm, level: ReasoningLevel): EffortForm {
  const levels = REASONING_LEVELS.filter((v) => v === level ? !form.levels.includes(v) : form.levels.includes(v));
  return { ...form, levels, defaultLevel: form.defaultLevel !== "auto" && !levels.includes(form.defaultLevel) ? "auto" : form.defaultLevel };
}

function flagOf(value: boolean | null | undefined): SpecFlag {
  return value == null ? "table" : value ? "yes" : "no";
}

function flagValue(f: SpecFlag): boolean | null {
  return f === "table" ? null : f === "yes";
}

export function manualOf(m: ModelRow): SpecForm {
  return {
    context: m.context_window_source === "manual" && m.context_window != null ? String(m.context_window) : "",
    output: m.max_output_tokens_source === "manual" && m.max_output_tokens != null ? String(m.max_output_tokens) : "",
    // Nonempty manual effort implies reasoning, but must not become a saved boolean override.
    reasoning: flagOf(m.manual_reasoning ?? (m.manual_reasoning_effort == null && m.reasoning_source === "manual" ? m.reasoning : null)),
    imageInput: flagOf(m.image_input_source === "manual" ? m.image_input : null),
    effort: effortOf(m.manual_reasoning_effort),
  };
}

export type SpecValues = Required<Pick<ModelSpecSave, "context_window" | "max_output_tokens" | "reasoning" | "image_input" | "reasoning_effort">>;

export function specOf(f: SpecForm): SpecValues | undefined {
  const context_window = tokensOf(f.context);
  const max_output_tokens = tokensOf(f.output);
  if (context_window === undefined || max_output_tokens === undefined) return undefined;
  const { mode, levels, defaultLevel } = f.effort;
  if (mode === "manual" && (
    f.reasoning === "no" || levels.length === 0 || new Set(levels).size !== levels.length ||
    levels.some((level) => !REASONING_LEVELS.includes(level)) ||
    (defaultLevel !== "auto" && !levels.includes(defaultLevel))
  )) return undefined;
  return {
    context_window, max_output_tokens, reasoning: flagValue(f.reasoning), image_input: flagValue(f.imageInput),
    reasoning_effort: mode === "auto" ? { mode: "auto" } : {
      mode: "set",
      value: {
        supported_levels: mode === "none" ? [] : REASONING_LEVELS.filter((level) => levels.includes(level)),
        ...(mode === "manual" && defaultLevel !== "auto" ? { default_level: defaultLevel } : {}),
      },
    },
  };
}

export function isEmptySpec(v: SpecValues): boolean {
  return v.context_window === null && v.max_output_tokens === null && v.reasoning === null && v.image_input === null && v.reasoning_effort.mode === "auto";
}

export function sameSpec(a: SpecValues, b: SpecValues): boolean {
  return a.context_window === b.context_window && a.max_output_tokens === b.max_output_tokens &&
    a.reasoning === b.reasoning && a.image_input === b.image_input &&
    JSON.stringify(a.reasoning_effort) === JSON.stringify(b.reasoning_effort);
}

export function hasManual(m: ModelRow): boolean {
  return m.context_window_source === "manual" || m.max_output_tokens_source === "manual" ||
    m.reasoning_source === "manual" || m.image_input_source === "manual" || m.manual_reasoning_effort != null;
}
