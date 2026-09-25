// 各处 mock 共用的：时间单位、带种子的随机数、core 形状的句子、按语言二选一
import type { Msg } from "@/types";
import { NOW } from "../boot";
import { P } from "./params";

export { NOW };
export const SEC = 1_000;
export const MIN = 60 * SEC;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

/** 带种子的随机数（mulberry32）：同一张图每次拍出来都一样 */
export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * core（或应用的 Rust 侧）发来的一句话：`code` 是契约，`text` 是英文原句。
 *
 * **两样都照源码抄**，不自己写。中文界面按 `code` 查 `src/i18n/core.zh.json`，英文界面
 * 直接显示 `text` —— 手写一句「差不多」的，拍出来的图就在替 core 说它没说过的话。
 */
export const msg = (code: string, text: string, args: Record<string, string> = {}): Msg => ({ code, args, text });

/** 本来就是一句话的示例数据（用户起的名字、对话内容）：按界面语言二选一 */
export const L = <A>(zh: A, en: A): A => (P.lang === "en" ? en : zh);

export const clone = <T>(x: T): T => structuredClone(x);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
