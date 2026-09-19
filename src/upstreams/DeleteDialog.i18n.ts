import { messages } from "@/i18n";

/**
 * `what` 是调用方传进来的名词（「上游」「代理」「价目表」），按当前语言给：
 * 英文用小写的 upstream / proxy / price sheet，嵌在句子中间。
 */
export const deleteDialogText = messages(
  {
    title: (what: string, name: string) => `删除${what}「${name}」`,
    blockedTitle: (what: string, name: string) => `无法删除${what}「${name}」`,
    blocked: (what: string) => `以下配置引用了此${what}，解除引用后才能删除。`,
    show: "查看",
    upstream: (name: string) => `上游「${name}」`,
    rule: (route: string, rule: string) => `路由「${route}」· 规则「${rule}」`,
    condition: (route: string, rule: string) => `路由「${route}」· 规则「${rule}」的条件`,
    group: (group: string) => `策略组「${group}」`,
  },
  {
    title: (what: string, name: string) => `Delete ${what} “${name}”`,
    blockedTitle: (what: string, name: string) => `Cannot delete ${what} “${name}”`,
    blocked: (what: string) =>
      `This ${what} is referenced by the configuration below and can be deleted once those references are removed.`,
    show: "Show",
    upstream: (name: string) => `Upstream “${name}”`,
    rule: (route: string, rule: string) => `Route “${route}” · rule “${rule}”`,
    condition: (route: string, rule: string) => `Route “${route}” · condition of rule “${rule}”`,
    group: (group: string) => `Group “${group}”`,
  },
);
