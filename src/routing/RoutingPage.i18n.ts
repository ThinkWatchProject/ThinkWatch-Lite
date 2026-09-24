import { messages } from "@/i18n";

export const routingPageText = messages(
  {
    /** 和源列表里那一项同一个词 */
    title: "路由",
    noUpstreams: "尚无上游",
    noUpstreamsDesc: "路由规则将请求转发至上游或策略组。添加上游后，默认路由将请求依次转发至全部上游。",
    routes: "路由",
    groups: "策略组",
    probes: "辅助请求",
    // 页头摘要：数和单位分开给，数会走动
    routesUnit: (_n: number) => "条路由",
    rulesUnit: (_n: number) => "条规则",
    groupsUnit: (_n: number) => "个策略组",
    shadowedUnit: (_n: number) => "条规则不会生效",
    noCatchAllUnit: (_n: number) => "条路由无兜底规则",
    allInEffect: "规则均生效",
    /** 删除确认里接在「删除」后面的那个词 */
    group: "策略组",
    deleteGroupConsequence: "删除后，此策略组将从配置文件中移除，可在版本历史中恢复。",
    preferred: (group: string, provider: string) => `「${group}」优先使用 ${provider}`,
  },
  {
    title: "Routing",
    noUpstreams: "No upstreams yet",
    noUpstreamsDesc:
      "Routing rules forward requests to upstreams or groups. Once an upstream is added, the default route forwards requests to all upstreams in order.",
    routes: "Routes",
    groups: "Groups",
    probes: "Auxiliary",
    routesUnit: (n: number) => (n === 1 ? "route" : "routes"),
    rulesUnit: (n: number) => (n === 1 ? "rule" : "rules"),
    groupsUnit: (n: number) => (n === 1 ? "group" : "groups"),
    shadowedUnit: (n: number) => (n === 1 ? "rule has no effect" : "rules have no effect"),
    noCatchAllUnit: (n: number) => (n === 1 ? "route has no catch-all rule" : "routes have no catch-all rule"),
    allInEffect: "All rules in effect",
    group: "group",
    deleteGroupConsequence:
      "Once deleted, this group is removed from the config file. It can be restored from the version history.",
    preferred: (group: string, provider: string) => `“${group}” now prefers ${provider}`,
  },
);
