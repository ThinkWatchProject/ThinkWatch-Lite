import { messages } from "@/i18n";

export const groupTableText = messages(
  {
    references: "引用",
    allUpstreams: "全部上游",
    builtin: "内置",
    listOrder: "按上游列表顺序",
    unreferenced: "未被引用",
    refSep: "；",
    prefer: "优先使用",
    preferredTag: "优先",
    noGroups: "尚无自定义策略组",
    noGroupsDesc: "规则可以转发至策略组，由策略决定使用其中哪个上游。",
  },
  {
    references: "Referenced by",
    allUpstreams: "All upstreams",
    builtin: "Built-in",
    listOrder: "In upstream list order",
    unreferenced: "Not referenced",
    refSep: "; ",
    prefer: "Preferred upstream",
    preferredTag: "Preferred",
    noGroups: "No custom groups yet",
    noGroupsDesc: "Rules can forward to a group, and its strategy decides which of its upstreams is used.",
  },
);
