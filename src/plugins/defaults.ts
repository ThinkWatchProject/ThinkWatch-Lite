/**
 * core 自带的默认插件在界面上的说法：名字、说明、设置项的标签。
 *
 * **表在 `src/i18n/plugin-defaults.json`**，Rust（系统的确认框、通知、core 消息的中文）读的是
 * 同一份：插件页上叫「指定回答语言」，确认框、通知和报错里也得是这几个字。默认插件的
 * manifest 里名字、说明和标签都是英文：中文界面取表里的名字、说明和标签，英文界面只取标签。
 *
 * **按 id 认，manifest 的名字也得对得上**（core 发的那一个）：用户删掉默认插件之后自己装了
 * 一个、恰好用了同一个 id 的，照它自己写的显示 —— 不拿默认插件的说明替别人写的插件作保。
 *
 * **只有名字的，按名字认**：core 的消息里嵌着的插件名（`{plugin}`）不带 id，和 core 发的英文名
 * 一字不差的按默认插件的名字说（`pluginName`）。说明和设置项的标签一律要 id。
 *
 * 按调用那一刻的语言取，**只在渲染时调用**（和 `textOf` 一样）。
 */
import TABLE from "@/i18n/plugin-defaults.json";
import { getLang, type Lang } from "@/i18n";
import type { SettingSpecView } from "@/types";

interface Words {
  name?: string;
  description?: string;
  settings?: Record<string, string>;
}

interface Entry {
  id: string;
  manifest_name: string;
  zh: Words;
  en: Words;
}

const ENTRIES = (TABLE as unknown as { plugins: Entry[] }).plugins;

function wordsOf(id: string | null | undefined, name: string): Words | null {
  if (!id) return null;
  const e = ENTRIES.find((x) => x.id === id && x.manifest_name === name);
  return e ? e[getLang()] : null;
}

/**
 * 插件叫什么：界面上、core 的消息里（`{plugin}`）**都用这一个**。知道 id 的按 id 认（manifest
 * 的名字也得对得上）；只知道名字的按 core 发的英文名认，一字不差才算。别的照它自己写的。
 *
 * `lang` 默认是此刻的界面语言；按码说中文时（`zhOf`）传 `zh`。
 */
export function pluginName(id: string | null | undefined, name: string, lang: Lang = getLang()): string {
  const e = id ? ENTRIES.find((x) => x.id === id && x.manifest_name === name) : ENTRIES.find((x) => x.manifest_name === name);
  return e?.[lang].name ?? name;
}

/** 默认插件在这种语言里另起的名字（中文名）。按屏幕上的字搜索请求记录时用 */
export function localizedPluginNames(lang: Lang = getLang()): string[] {
  return ENTRIES.flatMap((e) => (e[lang].name ? [e[lang].name] : []));
}

/** 插件的说明 */
export function pluginDescription(p: { id: string; name: string; description: string | null }): string | null {
  return wordsOf(p.id, p.name)?.description ?? p.description;
}

/** 设置项换成界面语言的标签（默认插件），别的照 manifest */
export function localSchema(id: string | null | undefined, name: string, schema: SettingSpecView[]): SettingSpecView[] {
  const labels = wordsOf(id, name)?.settings;
  if (!labels) return schema;
  return schema.map((s) => ({ ...s, label: labels[s.key] ?? s.label }));
}
