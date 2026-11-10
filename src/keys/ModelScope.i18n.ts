import { messages } from "@/i18n";

export const modelScopeText = messages(
  {
    scope: "可用模型",
    all: "全部",
    some: "指定范围",
    none: "无",
    allNote: (n: number) => `允许请求全部 ${n} 个模型。客户端列表可按别名设置隐藏原名。`,
    allNoteEmpty: "允许请求网关提供的全部模型。",
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
    counts: (visible: number, total: number) => `已允许 ${visible} / 共 ${total}`,
    model: "模型",
    hiddenFromClients: "客户端列表已隐藏",
    provider: "上游",
    providers: (ps: string[]) => ps.join("、"),
    source: "来源",
    byPattern: (p: string) => `由 ${p} 命中`,
    picked: "单独选中",
    /** 别名随它列表里的某个模型一起可见 */
    inherited: (m: string) => `随 ${m} 放行`,
    aliasOf: (models: string[]) => `别名，指向 ${models.join("、")}`,
    /** 表格下面一句：继承只从上游模型名到别名 */
    aliasRule: "范围里有某个上游模型，指向它的别名也一起放行；只选别名，不会放行原名。",
    rest: (n: number) => `其余 ${n} 个`,
    noMatch: "没有匹配的模型",
    /** 规则命中的行点不动，说明为什么 */
    lockedHint: (p: string) => `由 ${p} 命中，取消请修改该规则`,
    inheritedHint: (m: string) => `随 ${m} 放行，${m} 不在范围里时才可单独取消`,
  },
  {
    scope: "Allowed models",
    all: "All",
    some: "Specific",
    none: "None",
    allNote: (n: number) =>
      n === 1
        ? "All models are allowed: 1 in total. Alias settings may hide original names from client lists."
        : `All ${n} models are allowed. Alias settings may hide original names from client lists.`,
    allNoteEmpty: "All models offered by the gateway are allowed.",
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
    counts: (visible: number, total: number) => `${visible} of ${total} allowed`,
    model: "Model",
    hiddenFromClients: "Hidden from client lists",
    provider: "Upstream",
    providers: (ps: string[]) => ps.join(", "),
    source: "From",
    byPattern: (p: string) => `matched by ${p}`,
    picked: "picked",
    inherited: (m: string) => `allowed with ${m}`,
    aliasOf: (models: string[]) => `Alias for ${models.join(", ")}`,
    aliasRule:
      "Granting an original model also allows aliases that list it. Picking only an alias does not allow its original names.",
    rest: (n: number) => (n === 1 ? "1 more" : `${n} more`),
    noMatch: "No model matches",
    lockedHint: (p: string) => `Matched by ${p}; edit that pattern to drop it`,
    inheritedHint: (m: string) => `Allowed with ${m}; it can be dropped on its own once ${m} is out of scope`,
  },
);
