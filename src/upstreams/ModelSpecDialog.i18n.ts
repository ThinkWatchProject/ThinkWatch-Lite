import { messages } from "@/i18n";

export const modelSpecDialogText = messages(
  {
    title: "模型规格",
    desc: "价目表中没有此模型或数值有误时填写。留空的一项使用价目表。",
    contextWindow: "上下文窗口",
    maxOutput: "输出上限",
    fromTable: (n: string) => `价目表：${n}`,
    useTable: "使用价目表",
    notInTable: "价目表中没有",
    bad: "须为正整数，最大 4294967295。",
    removing: "保存后删除手动设置，两项都使用价目表。",
  },
  {
    title: "Model specs",
    desc: "For a model the price table lacks or gets wrong. A blank field uses the price table.",
    contextWindow: "Context window",
    maxOutput: "Max output",
    fromTable: (n: string) => `Price table: ${n}`,
    useTable: "Use the price table",
    notInTable: "Not in the price table",
    bad: "A whole number above 0, at most 4294967295.",
    removing: "Saving removes the manual values; both use the price table.",
  },
);
