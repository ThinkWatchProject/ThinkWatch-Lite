import { getLang } from "@/i18n";
import { peek, useResource } from "@/lib/resource";
import type { Guard, SecurityDetail, SecurityKindView, SecurityRuleView } from "@/types";
import { api } from "./api";

/**
 * 规则目录：三项防护的规则表（`GET /security`），和安全页读的是同一份缓存。
 *
 * **规则的名字、说明、分组名只在 core 写一份**，中英文各一个字段（`name` / `name_zh`、
 * `why` / `why_zh`、`about` / `about_zh`，分组是 `kinds`）。界面不再自己存名称表。
 * 安全日志、流量页的徽标只带规则 id 和英文名，中文名按 id 到这里查。
 */
export const CATALOG_KEY = "security-detail";

/**
 * 用到规则名的地方挂上它：没取过就取一次，取到了重画。安全页之外（流量页的徽标、请求
 * 详情）也要挂，否则那里查不到中文名。
 */
export function useRuleCatalog(): SecurityDetail | undefined {
  return useResource<SecurityDetail>(CATALOG_KEY, () => api.detail()).data;
}

/** 渲染时查一下：规则表里的这一条。还没取到、或者规则已经没有了是 `undefined` */
export function catalogRule(guard: string, id: string): SecurityRuleView | undefined {
  const d = peek<SecurityDetail>(CATALOG_KEY);
  return d?.[guard as Guard]?.rules.find((r) => !r.custom && r.id === id);
}

/** 一项防护的分组。旧的 core 不给是 `undefined` */
export function catalogKinds(guard: Guard): SecurityKindView[] | undefined {
  return peek<SecurityDetail>(CATALOG_KEY)?.[guard]?.kinds;
}

/** 按界面语言取：中文界面用中文那一份，没有就退回英文 */
export function localized(en: string | undefined, zh: string | undefined): string {
  return (getLang() === "zh" && zh) || en || "";
}
