import { messages } from "@/i18n";

export const manualModelInputText = messages(
  {
    about: "添加上游能服务、但未列在其模型列表中的模型。",
    models: "模型 ID",
    placeholder: "例如 gpt-6-luna",
    enterToAdd: "回车添加",
    hint: "可添加多个，每项为一个确切的模型 ID。",
    blank: "模型 ID 不能为空。",
    wildcard: (id: string) => `「${id}」含有 * 或 ?。手动添加的模型须为确切的模型 ID，不支持通配。`,
    tooLong: (max: number) => `模型 ID 最多 ${max} 个字符。`,
    duplicate: (id: string) => `「${id}」已在待添加的模型中。`,
    added: (id: string) => `「${id}」已经手动添加过。`,
    listed: (id: string) => `上游的模型列表中已有「${id}」，无需添加。`,
    manualTag: "手动",
    manualOnlyTitle: "手动添加的模型，上游的模型列表中没有",
    manualListedTitle: "手动添加的模型，上游的模型列表中也有",
  },
  {
    about: "Add models the upstream serves but leaves out of its model list.",
    models: "Model IDs",
    placeholder: "e.g. gpt-6-luna",
    enterToAdd: "Enter to add",
    hint: "Add as many as needed, each an exact model ID.",
    blank: "A model ID cannot be empty.",
    wildcard: (id: string) =>
      `“${id}” contains * or ?. A model added by hand is an exact model ID; wildcards are not supported.`,
    tooLong: (max: number) => `A model ID is at most ${max} characters.`,
    duplicate: (id: string) => `“${id}” is already in the list to add.`,
    added: (id: string) => `“${id}” has already been added by hand.`,
    listed: (id: string) => `The upstream's model list already has “${id}”; there is no need to add it.`,
    manualTag: "Manual",
    manualOnlyTitle: "Added by hand; not in the upstream's model list",
    manualListedTitle: "Added by hand; also in the upstream's model list",
  },
);
