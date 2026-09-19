import { messages } from "@/i18n";

export const routingPageText = messages(
  {
    noUpstreams: "尚无上游",
    noUpstreamsDesc: "路由规则将请求转发至上游或策略组。新建上游后，默认路由将请求依次转发至全部上游。",
    routes: "路由",
    groups: "策略组",
    /** 删除确认里接在「删除」后面的那个词 */
    group: "策略组",
    deleteGroupConsequence: "删除后，此策略组将从配置文件中移除，可在版本历史中恢复。",
  },
  {
    noUpstreams: "No upstreams yet",
    noUpstreamsDesc:
      "Routing rules forward requests to upstreams or groups. Once an upstream is added, the default route forwards requests to all upstreams in order.",
    routes: "Routes",
    groups: "Groups",
    group: "group",
    deleteGroupConsequence:
      "Once deleted, this group is removed from the config file. It can be restored from the version history.",
  },
);
