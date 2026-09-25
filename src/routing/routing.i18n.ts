import { messages } from "@/i18n";
import type { HitSpan } from "./useRouteHits";

/** 英文的列举：`a`、`a and b`、`a, b, and c`。中文用顿号连，用不到它 */
export function andList(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/** 命中数说的那一段（`HitSpan`）：「7 天」「5 小时」「12 分钟」 */
export function spanZh({ n, unit }: HitSpan): string {
  return `${n} ${unit === "day" ? "天" : unit === "hour" ? "小时" : "分钟"}`;
}

/** 同上，英文：「7 days」「1 hour」 */
export function spanEn({ n, unit }: HitSpan): string {
  return n === 1 ? `1 ${unit}` : `${n.toLocaleString()} ${unit}s`;
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
    /**
     * 命中数：一列数的表头、一次都没命中、一条路由走了多少请求。`span` 是这些数说的
     * 那一段 —— 通常是 7 天，记录开始得晚时是记录开始以来的那一段
     */
    hitsIn: (span: HitSpan) => `${spanZh(span)}命中`,
    noHits: "未命中",
    requestsIn: (span: HitSpan, n: number) => `${spanZh(span)} ${n.toLocaleString()} 次请求`,
    noRequestsIn: (span: HitSpan) => `${spanZh(span)}内无请求`,
    /** 这段时间一条请求记录都没有：表头说一次，不逐条标「未命中」 */
    noRecords: "尚无请求记录",
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
    hitsIn: ({ n, unit }: HitSpan) => `${n}-${unit} hits`,
    noHits: "No hits",
    requestsIn: (span: HitSpan, n: number) =>
      `${n === 1 ? "1 request" : `${n.toLocaleString()} requests`} in ${spanEn(span)}`,
    noRequestsIn: (span: HitSpan) => `No requests in ${spanEn(span)}`,
    noRecords: "No requests recorded yet",
    listSep: ", ",
    clauseSep: " · ",
  },
);
