import { useSyncExternalStore } from "react";

/**
 * 界面语言。
 *
 * **用哪种语言由 Rust 侧决定**（设置里选过的优先，否则跟随系统），在页面
 * 加载之前注入成 `window.__TW_LANG__`。这里只负责照着用、以及在设置里换了
 * 语言之后让界面跟着换。
 *
 * 文案不写在组件里，写在旁边的 `*.i18n.ts(x)`：
 *
 *   export const fooText = messages(
 *     { title: "用量概览", failed: (n: number) => `${n} 次失败` },
 *     { title: "Usage", failed: (n: number) => `${n} failed` },
 *   );
 *
 * 组件里 `const t = useText(fooText)`，然后 `t.title`、`t.failed(3)`。
 * **英文那一份的形状由中文那一份决定**：少一条、多一条、参数对不上，都是
 * 编译错误 —— 漏翻不会等到有人看见那一屏才发现。
 */
export type Lang = "zh" | "en";

declare global {
  interface Window {
    /** Rust 侧在页面加载之前注入的语言 */
    __TW_LANG__?: Lang;
  }
}

/** 语言自己的名字。**不翻译**：找「English」的人未必认得「英文」两个字 */
export const LANG_NAMES: Record<Lang, string> = {
  zh: "简体中文",
  en: "English",
};

function initial(): Lang {
  const injected = typeof window === "undefined" ? undefined : window.__TW_LANG__;
  if (injected === "zh" || injected === "en") return injected;
  // 不在应用里（浏览器直接打开、隔离预览）时，按浏览器的语言
  const nav = typeof navigator === "undefined" ? "" : navigator.language;
  return /^zh\b/i.test(nav) ? "zh" : "en";
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/** `<html lang>`：读屏和浏览器的断行、字体选择都看它 */
function tagOf(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : "en";
}

export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = tagOf(next);
  for (const f of listeners) f();
}

if (typeof document !== "undefined") document.documentElement.lang = tagOf(current);

function subscribe(f: () => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}

/** 现在的语言。**换语言时用到它的组件会重画**，不用刷新整个窗口 */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

/** 一组文案的中英两份 */
export type Messages<T> = { readonly zh: T; readonly en: T };

/**
 * 定义一组文案。第二个参数必须和第一个同形：键一样、函数的参数一样。
 */
export function messages<T extends object>(zh: T, en: NoInfer<T>): Messages<T> {
  return { zh, en };
}

/** 组件里取文案 */
export function useText<T>(m: Messages<T>): T {
  return m[useLang()];
}

/**
 * 组件以外取文案（名称表、格式化函数）。
 *
 * **按调用那一刻的语言取。**所以只能在渲染过程里调用 —— 存进模块级的
 * 常量里，换了语言它也不会跟着换。
 */
export function textOf<T>(m: Messages<T>): T {
  return m[current];
}
