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
 * 文案的形状由第一份决定。日文可以逐步补齐，缺少的条目使用英文。
 */
export const LANG_NAMES = {
  zh: "简体中文",
  "zh-Hant": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  es: "Español",
} as const;
export type Lang = keyof typeof LANG_NAMES;
export const LANGUAGES: readonly Lang[] = Object.keys(LANG_NAMES) as Lang[];

declare global {
  interface Window {
    /** Rust 侧在页面加载之前注入的语言 */
    __TW_LANG__?: Lang;
  }
}

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && Object.hasOwn(LANG_NAMES, value);
}

export function preferredLanguage(tags: readonly string[]): Lang {
  for (const tag of tags) {
    const [language, scriptOrRegion] = tag.trim().toLowerCase().split(/[-_.@]/, 2);
    if (language === "zh" && ["hant", "tw", "hk", "mo"].includes(scriptOrRegion ?? "")) {
      return "zh-Hant";
    }
    if (isLang(language)) return language;
  }
  return "en";
}

function initial(): Lang {
  const injected = typeof window === "undefined" ? undefined : window.__TW_LANG__;
  if (isLang(injected)) return injected;
  // 不在应用里（浏览器直接打开、隔离预览）时，按浏览器的语言
  return typeof navigator === "undefined" ? "en" : preferredLanguage([...navigator.languages, navigator.language]);
}

let current: Lang = initial();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return current;
}

/** `<html lang>`：读屏和浏览器的断行、字体选择都看它 */
export function localeTag(lang: Lang): string {
  return lang === "zh" ? "zh-CN" : lang;
}

export function setLang(next: Lang) {
  if (next === current) return;
  current = next;
  if (typeof document !== "undefined") document.documentElement.lang = localeTag(next);
  for (const f of listeners) f();
}

if (typeof document !== "undefined") document.documentElement.lang = localeTag(current);

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

export type Messages<T> = Readonly<Record<Lang, T>>;
type Localizations<T> = Partial<Record<Exclude<Lang, "zh" | "en">, Partial<T>>>;

/**
 * 定义一组文案。未翻译的顶层条目使用英文，繁体中文使用简体中文。
 */
export function messages<T extends object>(zh: T, en: NoInfer<T>, locales: Localizations<NoInfer<T>> = {}): Messages<T> {
  return {
    zh,
    en,
    "zh-Hant": locales["zh-Hant"] ? { ...zh, ...locales["zh-Hant"] } : zh,
    ja: locales.ja ? { ...en, ...locales.ja } : en,
    ko: locales.ko ? { ...en, ...locales.ko } : en,
    es: locales.es ? { ...en, ...locales.es } : en,
  };
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
