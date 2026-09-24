import { messages } from "@/i18n";
import { andList } from "./routing.i18n";

export const routeDialogText = messages(
  {
    catchAllName: "兜底",
    insertAbove: "在上方插入…",
    duplicate: "复制",
    moveUp: "上移",
    moveDown: "下移",
    editTitle: (name: string) => `编辑路由「${name}」`,
    duplicateTitle: "复制路由",
    intro: "请求自上而下逐条匹配，第一条命中的转发或拒绝规则决定去向。",
    keys: "使用此路由的密钥",
    defaultKeys: "未指定路由的密钥使用默认路由。",
    allAssigned: "所有密钥均已指定其他路由",
    keyMoves: (joining: string[], leaving: string[]) =>
      [
        joining.length ? `${joining.join("、")} 将改用此路由` : "",
        leaving.length ? `${leaving.join("、")} 将改用默认路由` : "",
      ]
        .filter(Boolean)
        .join("；") + "。",
    usesRoute: (name: string) => `当前使用路由「${name}」`,
    usesDefault: "当前使用默认路由",
    rules: "规则",
    rule: "规则",
    conditions: "条件",
    onMatch: "命中后",
    dragRule: (name: string) => `拖动调整规则「${name}」的位置`,
    noEffect: "不会生效",
    phaseTwo: "选定上游后",
    ruleActions: (name: string) => `规则「${name}」的操作`,
    noRules: "尚无规则",
    shadowed: (names: string[]) =>
      `${names.map((n) => `「${n}」`).join("、")}位于兜底规则之后，转发与拒绝不会生效。`,
    liftShadowed: "移至兜底规则之前",
    noCatchAll: "尚无兜底规则。未命中任何规则的请求将返回错误。",
    addCatchAll: "添加兜底规则",
    untitled: "新路由",
    conditionJoin: " 且 ",
  },
  {
    catchAllName: "Catch-all",
    insertAbove: "Insert above…",
    duplicate: "Duplicate",
    moveUp: "Move up",
    moveDown: "Move down",
    editTitle: (name: string) => `Edit route “${name}”`,
    duplicateTitle: "Duplicate route",
    intro:
      "Requests are matched against the rules from top to bottom; the first matching forward or deny rule decides the destination.",
    keys: "Keys using this route",
    defaultKeys: "Keys without an assigned route use the default route.",
    allAssigned: "All keys are assigned to other routes",
    keyMoves: (joining: string[], leaving: string[]) =>
      [
        joining.length ? `${andList(joining)} will switch to this route` : "",
        leaving.length ? `${andList(leaving)} will switch to the default route` : "",
      ]
        .filter(Boolean)
        .join("; ") + ".",
    usesRoute: (name: string) => `Currently uses route “${name}”`,
    usesDefault: "Currently uses the default route",
    rules: "Rules",
    rule: "Rule",
    conditions: "Conditions",
    onMatch: "On match",
    dragRule: (name: string) => `Drag to reorder rule “${name}”`,
    noEffect: "No effect",
    phaseTwo: "After selection",
    ruleActions: (name: string) => `Actions for rule “${name}”`,
    noRules: "No rules yet",
    shadowed: (names: string[]) => {
      const list = andList(names.map((n) => `“${n}”`));
      return names.length === 1
        ? `${list} is after the catch-all rule, so it never forwards or denies.`
        : `${list} are after the catch-all rule, so they never forward or deny.`;
    },
    liftShadowed: "Move above the catch-all rule",
    noCatchAll: "No catch-all rule yet. Requests that match no rule will return an error.",
    addCatchAll: "Add catch-all rule",
    untitled: "Untitled",
    conditionJoin: " and ",
  },
);
