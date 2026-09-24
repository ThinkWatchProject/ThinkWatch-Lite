import { messages } from "@/i18n";

export const proxyTableText = messages(
  {
    proxy: "代理",
    usedBy: "使用上游",
    connectivity: "连通性",
    actionsColumn: "操作",
    edit: "编辑…",
    check: "检测代理",
    delete: "删除…",
    /** 名字下面那一行的最后一段：这个代理要用户名与密码 */
    withAuth: "需要认证",
    notUsed: "未被使用",
    actions: (name: string) => `${name} 的操作`,
    notChecked: "未检测",
    checking: "检测中",
    unreachable: "无法连接",
    ms: (n: number) => `${n.toLocaleString()} ms`,
  },
  {
    proxy: "Proxy",
    usedBy: "Used by",
    connectivity: "Connectivity",
    actionsColumn: "Actions",
    edit: "Edit…",
    check: "Check proxy",
    delete: "Delete…",
    withAuth: "requires authentication",
    notUsed: "Not in use",
    actions: (name: string) => `Actions for ${name}`,
    notChecked: "Not checked",
    checking: "Checking",
    unreachable: "Unreachable",
    ms: (n: number) => `${n.toLocaleString()} ms`,
  },
);
