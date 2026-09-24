import type { Messages } from "@/i18n";
import { isMac } from "@/platform";
import { generalText } from "@/settings/GeneralSection.i18n";
import { settingsText } from "@/settings/SettingsPage.i18n";
import { listenText } from "@/settings/ListenSection.i18n";
import { retentionText } from "@/settings/RetentionSection.i18n";
import { connText } from "@/connection/connection.i18n";

/**
 * 命令面板里能搜到的设置，按设置页上的顺序。选中一项是
 * `nav.open("settings", { section: id })`，**滚到哪儿由设置页自己决定**（它在
 * `useNavParams("settings", …)` 里收 `section`）。
 *
 * **标题直接取各节自己的词表**，不在这里另写一份：命令面板里的「语言」和设置页上那
 * 一节的标题永远是同一个词，设置页按标题的字就找得到那一节（见 nav.tsx 的
 * `revealSection`）。
 *
 * **设置页改版时一起改这里**：一项是一件用户会去搜的设置（语言、外观、端口……），
 * `id` 是设置页认得的那一节。几件设置并进同一节时，它们照样各占一项，`id` 都指向
 * 那一节 —— 搜「深色」要找得到外观，哪怕外观已经是「通用」里的一行。
 *
 * · `core`：改的是 core 的配置（config.yaml），没连上 core 时那一节不画。
 * · `local`：只在连本机时有（诊断包生成在本机的数据目录里）。
 *
 * 设置页上一节（`SettingsGroup`）或一行（`SettingsRow` 的 `anchor`）的锚点就是这里的
 * `id`：语言、外观、菜单栏、开机启动、提醒是「通用」里的几行，更新、诊断包是「关于」
 * 里的几行，其余各是一节（见 settings/kit.tsx 的 `jump`）。
 */
export type SettingsSection =
  | "connections"
  | "language"
  | "appearance"
  | "menubar"
  | "autostart"
  | "listen"
  | "retention"
  | "updates"
  | "notices"
  | "about"
  | "diagnostics"
  | "uninstall";

interface SectionDef {
  id: SettingsSection;
  title: Messages<string>;
  core?: boolean;
  local?: boolean;
}

const pick = <T,>(m: Messages<T>, get: (t: T) => string): Messages<string> => ({ zh: get(m.zh), en: get(m.en) });

export const SETTINGS_SECTIONS: readonly SectionDef[] = [
  { id: "connections", title: pick(connText, (t) => t.title) },
  { id: "language", title: pick(generalText, (t) => t.language) },
  { id: "appearance", title: pick(generalText, (t) => t.appearance) },
  // 只有 macOS 有菜单栏这一行（别处的通知区放不下两行数字）
  ...(isMac ? [{ id: "menubar" as const, title: pick(generalText, (t) => t.menubar) }] : []),
  { id: "autostart", title: pick(generalText, (t) => t.autostart) },
  { id: "notices", title: pick(generalText, (t) => t.notices) },
  { id: "listen", title: pick(listenText, (t) => t.title), core: true },
  { id: "retention", title: pick(retentionText, (t) => t.title), core: true },
  { id: "about", title: pick(settingsText, (t) => t.about) },
  { id: "updates", title: pick(settingsText, (t) => t.updates) },
  { id: "diagnostics", title: pick(settingsText, (t) => t.diagnostics), local: true },
  { id: "uninstall", title: pick(settingsText, (t) => t.uninstallTitle) },
];

/** 某一节现在的标题（当前语言）。不是这里列的节时是 `undefined` */
export function sectionTitle(id: string, lang: "zh" | "en"): string | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id)?.title[lang];
}
