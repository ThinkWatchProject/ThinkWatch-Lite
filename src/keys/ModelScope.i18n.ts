import { messages } from "@/i18n";

export const modelScopeText = messages(
  {
    scope: "可见模型",
    all: "全部",
    some: "指定范围",
    none: "无",
    allNote: (n: number) => `客户端能看到网关暴露的全部模型，共 ${n} 个。`,
    allNoteEmpty: "客户端能看到网关暴露的全部模型。",
    noneNote: "客户端的模型列表为空。多数客户端据此选择模型，实际等同于停用这把密钥。",
    patterns: "通配规则",
    patternsHint: "一条规则覆盖一组模型，上游新增同族模型时自动包含",
    patternPlaceholder: "例如 gpt-5*",
    patternAdd: "回车添加",
    patternHits: (n: number) => `命中 ${n} 个`,
    patternHitsUnknown: "尚无清单",
    patternRemove: (p: string) => `删除规则 ${p}`,
    /** 尚未取到任何上游的模型清单时，只能手填 */
    noCatalog: "尚未获取到任何上游的模型清单，因此只能手填规则。在上游页获取清单后，此处可直接勾选。",
    search: "搜索模型",
    counts: (visible: number, total: number) => `可见 ${visible} / 共 ${total}`,
    model: "模型",
    provider: "上游",
    providers: (ps: string[]) => ps.join("、"),
    source: "来源",
    byPattern: (p: string) => `由 ${p} 命中`,
    picked: "单独选中",
    rest: (n: number) => `其余 ${n} 个`,
    noMatch: "没有匹配的模型",
    /** 规则命中的行点不动，说明为什么 */
    lockedHint: (p: string) => `由 ${p} 命中，取消请修改该规则`,
  },
  {
    scope: "Visible models",
    all: "All",
    some: "Specific",
    none: "None",
    allNote: (n: number) =>
      n === 1
        ? "The client sees every model the gateway exposes: 1 in total."
        : `The client sees every model the gateway exposes: ${n} in total.`,
    allNoteEmpty: "The client sees every model the gateway exposes.",
    noneNote:
      "The client's model list is empty. Most clients choose a model from it, so this amounts to disabling the key.",
    patterns: "Patterns",
    patternsHint: "One pattern covers a group of models, including ones an upstream adds later",
    patternPlaceholder: "e.g. gpt-5*",
    patternAdd: "Enter to add",
    patternHits: (n: number) => (n === 1 ? "matches 1" : `matches ${n}`),
    patternHitsUnknown: "no catalogue yet",
    patternRemove: (p: string) => `Remove pattern ${p}`,
    noCatalog:
      "No upstream has reported a model catalogue yet, so patterns have to be typed by hand. Once one is fetched on the Upstreams page, models can be ticked here.",
    search: "Search models",
    counts: (visible: number, total: number) => `${visible} of ${total} visible`,
    model: "Model",
    provider: "Upstream",
    providers: (ps: string[]) => ps.join(", "),
    source: "From",
    byPattern: (p: string) => `matched by ${p}`,
    picked: "picked",
    rest: (n: number) => (n === 1 ? "1 more" : `${n} more`),
    noMatch: "No model matches",
    lockedHint: (p: string) => `Matched by ${p}; edit that pattern to drop it`,
  },
);
