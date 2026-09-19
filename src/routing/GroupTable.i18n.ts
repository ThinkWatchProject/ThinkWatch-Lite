import { messages } from "@/i18n";

export const groupTableText = messages(
  {
    references: "引用",
    allUpstreams: "全部上游",
    builtin: "内置",
    listOrder: "按上游列表顺序",
    preferredIs: (name: string) => `优先使用 ${name}`,
    unreferenced: "未被引用",
    refSep: "；",
    prefer: "优先使用",
  },
  {
    references: "Referenced by",
    allUpstreams: "All upstreams",
    builtin: "Built-in",
    listOrder: "In upstream list order",
    preferredIs: (name: string) => `Preferred: ${name}`,
    unreferenced: "Not referenced",
    refSep: "; ",
    prefer: "Preferred upstream",
  },
);
