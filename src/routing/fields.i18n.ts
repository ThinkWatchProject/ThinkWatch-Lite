import { messages } from "@/i18n";

export const fieldsText = messages(
  {
    modelName: "模型名",
    noMatch: "无匹配项，可直接输入完整模型名",
    alias: "别名",
    providers: (ps: readonly string[]) => ps.join("、"),
  },
  {
    modelName: "Model name",
    noMatch: "No matching model; any full model name can be entered",
    alias: "alias",
    providers: (ps: readonly string[]) => ps.join(", "),
  },
);
