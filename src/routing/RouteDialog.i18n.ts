import { messages } from "@/i18n";
import { andList, spanEn, spanZh } from "./routing.i18n";
import type { HitSpan } from "./useRouteHits";

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
    hits: (span: HitSpan, n: number) => `${spanZh(span)}命中 ${n.toLocaleString()} 次`,
    noHits: (span: HitSpan) => `${spanZh(span)}内未命中`,
    ruleActions: (name: string) => `规则「${name}」的操作`,
    noRules: "尚无规则",
    shadowed: (names: string[]) =>
      `${names.map((n) => `「${n}」`).join("、")}位于兜底规则之后，转发与拒绝不会生效。`,
    liftShadowed: "移至兜底规则之前",
    noCatchAll: "尚无兜底规则。未命中任何规则的请求将返回错误。",
    addCatchAll: "添加兜底规则",
    untitled: "新路由",
    conditionJoin: " 且 ",
    alsoAliasesOf: (aliases: string[]) => `也匹配指向它的别名 ${aliases.join("、")}`,
    alsoAliases: (aliases: string[]) => `也匹配指向这些模型的别名 ${aliases.join("、")}`,
    backups: (list: string[]) => `备用 ${list.join("、")}`,
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
    hits: (span: HitSpan, n: number) => `${n === 1 ? "1 hit" : `${n.toLocaleString()} hits`} in ${spanEn(span)}`,
    noHits: (span: HitSpan) => `No hits in ${spanEn(span)}`,
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
    alsoAliasesOf: (aliases: string[]) =>
      `Also matches the ${aliases.length === 1 ? "alias that points" : "aliases that point"} to it: ${aliases.join(", ")}`,
    alsoAliases: (aliases: string[]) =>
      `Also matches the ${aliases.length === 1 ? "alias that points" : "aliases that point"} to these models: ${aliases.join(", ")}`,
    backups: (list: string[]) => `Backup: ${list.join(", ")}`,
  },
  {
    "zh-Hant": {
      duplicate: "複製",
      editTitle: (name: string) => `編輯路由「${name}」`,
      duplicateTitle: "複製路由",
      intro: "請求自上而下逐條匹配，第一條命中的轉發或拒絕規則決定去向。",
      keys: "使用此路由的金鑰",
      defaultKeys: "未指定路由的金鑰使用預設路由。",
      allAssigned: "所有金鑰均已指定其他路由",
      keyMoves: (joining: string[], leaving: string[]) => [
        joining.length ? `${joining.join("、")} 將改用此路由` : "",
        leaving.length ? `${leaving.join("、")} 將改用預設路由` : "",
      ]
        .filter(Boolean)
        .join("；") + "。",
      usesRoute: (name: string) => `當前使用路由「${name}」`,
      usesDefault: "當前使用預設路由",
      rules: "規則",
      rule: "規則",
      conditions: "條件",
      onMatch: "命中後",
      dragRule: (name: string) => `拖動調整規則「${name}」的位置`,
      noEffect: "不會生效",
      phaseTwo: "選定上游後",
      noHits: (span: HitSpan) => `${spanZh(span)}內未命中`,
      ruleActions: (name: string) => `規則「${name}」的操作`,
      noRules: "尚無規則",
      shadowed: (names: string[]) => `${names.map((n) => `「${n}」`).join("、")}位於兜底規則之後，轉發與拒絕不會生效。`,
      liftShadowed: "移至兜底規則之前",
      noCatchAll: "尚無兜底規則。未命中任何規則的請求將返回錯誤。",
      addCatchAll: "新增兜底規則",
      alsoAliasesOf: (aliases: string[]) => `也匹配指向它的別名 ${aliases.join("、")}`,
      alsoAliases: (aliases: string[]) => `也匹配指向這些模型的別名 ${aliases.join("、")}`,
      backups: (list: string[]) => `備用 ${list.join("、")}`,
    },
    ko: {
      rules: "규칙",
      rule: "규칙",
    },
    es: {
      catchAllName: "Atrapa todo",
      insertAbove: "Insertar arriba…",
      duplicate: "Duplicar",
      moveUp: "Subir",
      moveDown: "Bajar",
      editTitle: (name: string) => `Editar ruta “${name}”`,
      duplicateTitle: "Duplicar ruta",
      intro: "Las peticiones se comparan con las reglas de arriba a abajo; la primera regla de emparejamiento hacia adelante o negar decide el destino.",
      keys: "Teclas usando esta ruta",
      defaultKeys: "Las teclas sin una ruta asignada usan la ruta predeterminada.",
      allAssigned: "Todas las teclas se asignan a otras rutas",
      keyMoves: (joining: string[], leaving: string[]) => [
        joining.length ? `${andList(joining)} cambiará a esta ruta` : "",
        leaving.length ? `${andList(leaving)} cambiará a la ruta predeterminada` : "",
      ]
        .filter(Boolean)
        .join("; ") + ".",
      usesRoute: (name: string) => `Actualmente utiliza la ruta “${name}”`,
      usesDefault: "Actualmente utiliza la ruta predeterminada",
      rules: "Reglas",
      rule: "Regla",
      conditions: "Condiciones",
      onMatch: "En el partido",
      dragRule: (name: string) => `Arrastre para reordenar la regla “${name}”`,
      noEffect: "Sin efecto",
      phaseTwo: "Después de la selección",
      hits: (span: HitSpan, n: number) => `${n === 1 ? "1 pulsación" : `${n.toLocaleString()} hits`} en ${spanEn(span)}`,
      noHits: (span: HitSpan) => `No hay coincidencias en ${spanEn(span)}`,
      ruleActions: (name: string) => `Medidas relativas a la regla “${name}”`,
      noRules: "Todavía no hay reglas.",
      shadowed: (names: string[]) => {
        const list = andList(names.map((n) => `“${n}”`));
        return names.length === 1
          ? `${list} está detrás de la regla de la captura-todo, por lo que nunca se adelanta o niega.`
          : `${list} están detrás de la regla de la captura-todo, por lo que nunca avanzan o niegan.`;
      },
      liftShadowed: "Mover por encima de la regla de la captura-todo",
      noCatchAll: "Todavía no hay regla general. Las solicitudes que coincidan con ninguna regla devolverán un error.",
      addCatchAll: "Añadir regla general",
      untitled: "Sin título",
      conditionJoin: " y ",
      alsoAliasesOf: (aliases: string[]) => `También coincide con el ${aliases.length === 1 ? "alias que apunta" : "alias ese punto"}: ${aliases.join(", ")}`,
      alsoAliases: (aliases: string[]) => `También coincide con el ${aliases.length === 1 ? "alias que apunta" : "alias ese punto"} de estos modelos: ${aliases.join(", ")}`,
      backups: (list: string[]) => `Respaldo: ${list.join(", ")}`,
    },
  },
);
