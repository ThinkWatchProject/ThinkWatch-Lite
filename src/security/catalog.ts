import { peek, useResource } from "@/lib/resource";
import type { Guard, SecurityDetail, SecurityKindView, SecurityRuleView } from "@/types";
import { api } from "./api";

/**
 * 规则目录：三项防护的规则表（`GET /security`），和安全页读的是同一份缓存。
 *
 * Core 给规则和分组的英文原文。Lite 按防护类型、规则 ID 和分组 slug 查译文。
 */
export const CATALOG_KEY = "security-detail";

/**
 * 用到实时规则目录的地方挂上它。界面词表本身不依赖这次读取。
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
