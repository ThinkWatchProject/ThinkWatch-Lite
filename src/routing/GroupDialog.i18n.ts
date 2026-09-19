import { messages } from "@/i18n";
import { andList } from "./routing.i18n";

export const groupDialogText = messages(
  {
    noMembers: "至少选择一个上游",
    editTitle: (name: string) => `编辑策略组「${name}」`,
    duplicateTitle: "复制策略组",
    referencedBy: (refs: { route: string; rule: string }[]) =>
      `被${refs.map((r) => `「${r.route} · ${r.rule}」`).join("、")}引用。`,
    intro: "规则可以转发至策略组，由策略决定使用其中哪个上游。",
    sticky: "会话粘滞",
    stickyOn: "同一会话固定使用同一上游，prompt cache 保持命中。",
    stickyOff: "长会话的 prompt cache 将频繁失效，费用上升。",
    selectedCount: (n: number) => `已选 ${n} 个`,
    noUpstreams: "尚无上游。",
    upstream: "上游",
    preferred: "优先使用",
    dragMember: (name: string) => `拖动调整 ${name} 的位置`,
    toggleMember: (on: boolean, name: string) => `${on ? "移出" : "加入"} ${name}`,
    disabledSuffix: " · 已停用",
    prefer: (name: string) => `优先使用 ${name}`,
    orderSelect: "拖动调整顺序。选定的上游不可用时，按顺序使用其余成员。",
    orderFallback: "拖动调整顺序：依次使用，前一个不可用时使用下一个。",
    orderOther: "拖动调整顺序。排序依据相同时按此顺序。",
  },
  {
    noMembers: "Select at least one upstream",
    editTitle: (name: string) => `Edit group “${name}”`,
    duplicateTitle: "Duplicate group",
    referencedBy: (refs: { route: string; rule: string }[]) =>
      `Referenced by ${andList(refs.map((r) => `“${r.route} · ${r.rule}”`))}.`,
    intro: "Rules can forward to a group, and its strategy decides which of its upstreams is used.",
    sticky: "Sticky sessions",
    stickyOn: "Each session stays on the same upstream, so prompt cache hits are preserved.",
    stickyOff: "The prompt cache of long sessions will be invalidated often, raising costs.",
    selectedCount: (n: number) => `${n} selected`,
    noUpstreams: "No upstreams yet.",
    upstream: "Upstream",
    preferred: "Preferred",
    dragMember: (name: string) => `Drag to reorder ${name}`,
    toggleMember: (on: boolean, name: string) => `${on ? "Remove" : "Add"} ${name}`,
    disabledSuffix: " · Disabled",
    prefer: (name: string) => `Prefer ${name}`,
    orderSelect: "Drag to reorder. When the selected upstream is unavailable, the other members are used in order.",
    orderFallback: "Drag to reorder: members are used in turn, moving to the next when one is unavailable.",
    orderOther: "Drag to reorder. Ties are broken by this order.",
  },
);
