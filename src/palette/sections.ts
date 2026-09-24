import type { Messages } from "@/i18n";
import type { SettingsSection } from "@/nav";
import { configText } from "@/Config.i18n";
import { languageText } from "@/Language.i18n";
import { appearanceText } from "@/Appearance.i18n";
import { menubarSettingsText } from "@/MenubarSettings.i18n";
import { updateText } from "@/Update.i18n";
import { noticeSettingsText } from "@/NoticeSettings.i18n";
import { listenText } from "@/settings/ListenSection.i18n";
import { retentionText } from "@/settings/RetentionSection.i18n";
import { connText } from "@/connection/connection.i18n";

/**
 * 设置页的各节，按页面上的顺序。
 *
 * **标题直接取各节自己的词表**，不在这里另写一份：命令面板里的「语言」和设置页上那
 * 一节的标题永远是同一个词，找那一节时按标题的字找也找得到（见 `revealSection`）。
 *
 * · `core`：改的是 core 的配置（config.yaml），没连上 core 时那一节不画。
 * · `local`：只在连本机时有（诊断包生成在本机的数据目录里）。
 */
interface SectionDef {
  id: SettingsSection;
  title: Messages<string>;
  core?: boolean;
  local?: boolean;
}

const pick = <T,>(m: Messages<T>, get: (t: T) => string): Messages<string> => ({ zh: get(m.zh), en: get(m.en) });

export const SETTINGS_SECTIONS: readonly SectionDef[] = [
  { id: "connections", title: pick(connText, (t) => t.title) },
  { id: "language", title: pick(languageText, (t) => t.title) },
  { id: "appearance", title: pick(appearanceText, (t) => t.title) },
  { id: "menubar", title: pick(menubarSettingsText, (t) => t.title) },
  { id: "autostart", title: pick(configText, (t) => t.autostartTitle) },
  { id: "listen", title: pick(listenText, (t) => t.title), core: true },
  { id: "retention", title: pick(retentionText, (t) => t.title), core: true },
  { id: "updates", title: pick(updateText, (t) => t.title) },
  { id: "notices", title: pick(noticeSettingsText, (t) => t.title) },
  { id: "about", title: pick(configText, (t) => t.aboutTitle) },
  { id: "diagnostics", title: pick(configText, (t) => t.diagnosticsTitle), local: true },
  { id: "uninstall", title: pick(configText, (t) => t.uninstallTitle) },
];

/** 某一节现在的标题（当前语言） */
export function sectionTitle(id: SettingsSection, lang: "zh" | "en"): string | undefined {
  return SETTINGS_SECTIONS.find((s) => s.id === id)?.title[lang];
}
