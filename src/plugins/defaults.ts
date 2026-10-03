/**
 * core 自带的默认插件在界面上的说法：名字、说明、设置项的标签。
 *
 * **表在 `src/i18n/plugin-defaults.json`**，Rust（系统的确认框、通知）读的是同一份：插件页上
 * 叫「指定回答语言」，确认框和通知里也得是这几个字。默认插件的 manifest 里名字、说明和标签
 * 都是英文：中文界面取表里的名字、说明和标签，英文界面只取标签。
 *
 * **按 id 认，manifest 的名字也得对得上**（core 发的那一个）：用户删掉默认插件之后自己装了
 * 一个、恰好用了同一个 id 的，照它自己写的显示 —— 不拿默认插件的说明替别人写的插件作保。
 *
 * 按调用那一刻的语言取，**只在渲染时调用**（和 `textOf` 一样）。
 */
import TABLE from "@/i18n/plugin-defaults.json";
import { getLang } from "@/i18n";
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

/** 插件叫什么。`id` 不知道（还没装上）就照它自己写的 */
export function pluginName(id: string | null | undefined, name: string): string {
  return wordsOf(id, name)?.name ?? name;
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
