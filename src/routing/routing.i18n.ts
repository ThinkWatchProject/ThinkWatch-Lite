import { messages } from "@/i18n";

/** 英文的列举：`a`、`a and b`、`a, b, and c`。中文用顿号连，用不到它 */
export function andList(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** 路由页几个文件共用的词。**同一个说法只写一次** */
export const routingText = messages(
  {
    name: "名称",
    nameMissing: "填写名称",
    nameReserved: "名称不能以 __ 开头",
    nameTaken: (name: string) => `名称「${name}」已被使用`,
    copyName: (name: string) => `${name} 副本`,
    create: "创建",
    strategy: "策略",
    members: "成员",
    newRoute: "新建路由",
    newGroup: "新建策略组",
    addRule: "添加规则",
    dryRun: "试算",
    editMenu: "编辑…",
    duplicateMenu: "复制…",
    deleteMenu: "删除…",
    locate: "在配置文件中定位",
    showUpstreams: "前往上游页",
    actionsFor: (name: string) => `${name} 的操作`,
    setDefault: "设为默认路由",
    deny: "拒绝",
    continueMatching: "继续匹配",
    allRequests: "全部请求（兜底）",
    affectsCache: "影响 prompt cache",
    /** 最近几天的命中数：一列数的表头、一次都没命中、一条路由走了多少请求 */
    hitsIn: (days: number) => `${days} 天命中`,
    noHits: "未命中",
    requestsIn: (days: number, n: number) => `${days} 天 ${n.toLocaleString()} 次请求`,
    noRequestsIn: (days: number) => `${days} 天内无请求`,
    listSep: "、",
    /** 一行里并列的几件事 */
    clauseSep: " · ",
  },
  {
    name: "Name",
    nameMissing: "Enter a name",
    nameReserved: "Names cannot start with __",
    nameTaken: (name: string) => `The name “${name}” is already in use`,
    copyName: (name: string) => `${name} copy`,
    create: "Create",
    strategy: "Strategy",
    members: "Members",
    newRoute: "New route",
    newGroup: "New group",
    addRule: "Add rule",
    dryRun: "Dry run",
    editMenu: "Edit…",
    duplicateMenu: "Duplicate…",
    deleteMenu: "Delete…",
    locate: "Show in config file",
    showUpstreams: "Go to Upstreams",
    actionsFor: (name: string) => `Actions for ${name}`,
    setDefault: "Set as default route",
    deny: "Deny",
    continueMatching: "Continue matching",
    allRequests: "All requests (catch-all)",
    affectsCache: "Affects prompt cache",
    hitsIn: (days: number) => `${days}-day hits`,
    noHits: "No hits",
    requestsIn: (days: number, n: number) =>
      `${n === 1 ? "1 request" : `${n.toLocaleString()} requests`} in ${days === 1 ? "1 day" : `${days} days`}`,
    noRequestsIn: (days: number) => `No requests in ${days === 1 ? "1 day" : `${days} days`}`,
    listSep: ", ",
    clauseSep: " · ",
  },
);
