/**
 * 手写的模型规格（上下文窗口、输出上限）：从 `ModelRow` 读出手写的那几项、格子里的数
 * 写得对不对。**先后只在 core 定**（`tw_config::model_specs::resolve`）：这里只认 core
 * 标的来源，不自己比大小。
 */
import type { ModelRow } from "@/types";

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

/** 这个模型此刻手写的两项，格子里的写法。没手写的那一项是空的 */
export function manualOf(m: ModelRow): { context: string; output: string } {
  return {
    context: m.context_window_source === "manual" && m.context_window != null ? String(m.context_window) : "",
    output: m.max_output_tokens_source === "manual" && m.max_output_tokens != null ? String(m.max_output_tokens) : "",
  };
}

/** 这个模型在这一家有手写的规格 */
export function hasManual(m: ModelRow): boolean {
  return m.context_window_source === "manual" || m.max_output_tokens_source === "manual";
}
