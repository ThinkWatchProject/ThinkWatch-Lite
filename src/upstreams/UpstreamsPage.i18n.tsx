import type { ReactNode } from "react";
import { messages } from "@/i18n";

/**
 * 页头摘要里的几项写成「带一个数的句子」：数字是传进来的节点（会走动的
 * `AnimatedNumber`），语序由各语言自己定 —— 中文「24 小时 234 次请求」，
 * 英文「234 requests in 24 h」。
 */
export const upstreamsPageText = messages(
  {
    title: "上游",
    hero: {
      upstreams: (n: ReactNode, _count: number) => <>{n} 个上游</>,
      healthy: (n: ReactNode) => <>{n} 正常</>,
      attention: (n: ReactNode) => <>{n} 需处理</>,
      disabled: (n: ReactNode) => <>{n} 已停用</>,
      requests: (n: ReactNode, _count: number) => <>24 小时 {n} 次请求</>,
      cost: (n: ReactNode) => <>费用 {n}</>,
    },
    modelsFailed: (name: string) => `${name} 的模型列表获取失败`,
    modelsFetched: (name: string, n: number) => `${name}：已获取 ${n} 个模型`,
    pricesUpdated: (changed: number) => `默认价目表已更新，${changed} 个模型的价格有变化`,
    pricesCurrent: "默认价目表已是最新",
    tabs: { upstreams: "上游", proxies: "代理", pricing: "价目表" },
    linkTest: "链路测速",
    speedTest: "推理测速",
    newUpstream: "新建上游",
    checkAll: "检测全部",
    newProxy: "新建代理",
    autoUpdate: "自动更新",
    updateNow: "立即更新",
    newSheet: "新建价目表",
    noUpstreams: "尚无上游",
    noUpstreamsDesc:
      "上游是网关转发请求的目标服务。新建上游并填写接口地址与凭据后，客户端请求即可经网关发出。",
    noProxies: "尚无代理",
    noProxiesDesc: "上游默认直连。需要经代理访问的上游，先新建代理，再在上游的连接设置中选择它。",
    statsFailed: "24 小时统计读取失败",
    statusFailed: "默认价目表状态读取失败",
    updateFailedTitle: "默认价目表更新失败",
    unpricedTitle: (n: number) => `最近 7 天有 ${n.toLocaleString()} 次请求无法计价`,
    unpricedModels: "涉及模型",
    listSep: "、",
    provider: (name: string) => `（${name}）`,
    /** `shown`：前面已经列出的个数。中文说总数，英文说还剩几个 */
    more: (total: number, _shown: number) => ` 等 ${total} 项`,
    unpricedEnd: "，相关费用未计入统计。",
    setPrices: "设置价格",
    disabledToast: (name: string) => `已停用上游 ${name}`,
    enabledToast: (name: string) => `已启用上游 ${name}`,
    saved: (name: string) => `已保存 ${name}`,
    /** 交给删除对话框、嵌在句子中间的名词 */
    what: { upstream: "上游", proxy: "代理", sheet: "价目表" },
    upstreamGone: "删除后，此上游的地址、凭据与设置将从配置文件中移除，可在版本历史中恢复。",
    proxyGone: "删除后，此代理的地址与认证信息将从配置文件中移除，可在版本历史中恢复。",
    sheetGone: "删除后，此价目表的倍率与模型覆盖将从配置文件中移除，可在版本历史中恢复。",
  },
  {
    title: "Upstreams",
    hero: {
      upstreams: (n: ReactNode, count: number) => <>{n} {count === 1 ? "upstream" : "upstreams"}</>,
      healthy: (n: ReactNode) => <>{n} healthy</>,
      attention: (n: ReactNode) => <>{n} need attention</>,
      disabled: (n: ReactNode) => <>{n} disabled</>,
      requests: (n: ReactNode, count: number) => <>{n} {count === 1 ? "request" : "requests"} in 24 h</>,
      cost: (n: ReactNode) => <>Cost {n}</>,
    },
    modelsFailed: (name: string) => `Could not fetch the model list for ${name}`,
    modelsFetched: (name: string, n: number) => `${name}: ${n === 1 ? "1 model" : `${n} models`} fetched`,
    pricesUpdated: (changed: number) =>
      changed === 1
        ? "Default price sheet updated; 1 model's price changed"
        : `Default price sheet updated; ${changed} models' prices changed`,
    pricesCurrent: "Default price sheet is up to date",
    tabs: { upstreams: "Upstreams", proxies: "Proxies", pricing: "Price sheets" },
    linkTest: "Connection test",
    speedTest: "Inference test",
    newUpstream: "New upstream",
    checkAll: "Check all",
    newProxy: "New proxy",
    autoUpdate: "Auto-update",
    updateNow: "Update now",
    newSheet: "New price sheet",
    noUpstreams: "No upstreams",
    noUpstreamsDesc:
      "An upstream is a service the gateway forwards requests to. Once one is created with a base URL and credentials, client requests go out through the gateway.",
    noProxies: "No proxies",
    noProxiesDesc:
      "Upstreams connect directly by default. For an upstream that must be reached through a proxy, create the proxy first, then select it in the upstream's connection settings.",
    statsFailed: "Could not load the 24-hour statistics",
    statusFailed: "Could not load the default price sheet's status",
    updateFailedTitle: "The default price sheet could not be updated",
    unpricedTitle: (n: number) =>
      n === 1
        ? "1 request in the last 7 days was unpriced"
        : `${n.toLocaleString()} requests in the last 7 days were unpriced`,
    unpricedModels: "Affected models:",
    listSep: ", ",
    provider: (name: string) => ` (${name})`,
    more: (total: number, shown: number) => ` and ${total - shown} more`,
    unpricedEnd: ". Their cost is not included in the statistics.",
    setPrices: "Set prices",
    disabledToast: (name: string) => `Upstream ${name} disabled`,
    enabledToast: (name: string) => `Upstream ${name} enabled`,
    saved: (name: string) => `${name} saved`,
    what: { upstream: "upstream", proxy: "proxy", sheet: "price sheet" },
    upstreamGone:
      "Deleting removes this upstream's address, credentials and settings from the config file. They can be restored from version history.",
    proxyGone:
      "Deleting removes this proxy's address and authentication details from the config file. They can be restored from version history.",
    sheetGone:
      "Deleting removes this price sheet's multiplier and model overrides from the config file. They can be restored from version history.",
  },
);
