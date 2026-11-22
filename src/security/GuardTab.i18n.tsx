import { messages } from "@/i18n";
import type { Guard, GuardMode } from "@/types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export const guardTabText = messages(
  {
    /**
     * 状态选择右边那一句：当前状态下命中之后怎样。「开启」各项一样（按每条规则的动作）；
     * 「监控」说清记录、通知、内容不变
     */
    now: {
      enforce: "开启：命中内容按各条规则设定的动作处理。",
      observe: {
        redact: "监控：命中内容记入日志并发出通知，请求不作修改。",
        inspect_tools: "监控：命中的工具调用记入日志并发出通知，照常返回客户端。",
        content: "监控：命中内容记入日志并发出通知，请求与回答不作修改。",
      },
      off: "关闭：不检查，不记录。",
    } as { enforce: string; observe: Record<Guard, string>; off: string },
    ruleCount: (on: number, all: number) => `已启用 ${on} 条，共 ${all} 条。`,
    /** 规则表上方的检索框 */
    search: "检索规则",
    noMatch: "无匹配的规则",
    test: "测试…",
    newRule: "新建规则",
    enabled: "启用",
    rule: "规则",
    match: "匹配内容",
    /** 内容规则查哪一边 */
    scope: "检查对象",
    /** 规则在「开启」状态下做什么 */
    action: "动作",
    /** 组标题：「隐藏字符 · 3 条 · 已开 2 条 · 最近 7 天命中 5 次」 */
    groupCount: (all: number, on: number) => `${all} 条 · 已开 ${on} 条`,
    groupHits: (n: number) => `最近 7 天命中 ${n} 次`,
    /** 行内的动作选择，给读屏 */
    actionFor: (name: string) => `「${name}」的动作`,
    /** 动作为「替换」时，行内选项写出换成什么 */
    replaceWith: (text: string) => `替换为 ${text}`,
    turnOn: "启用",
    turnOff: "停用",
    copyAsCustom: "复制为自定义规则",
    actionsFor: (name: string) => `${name} 的操作`,
    toggleFor: (name: string) => `启用「${name}」`,
    modeFor: (guard: string) => `${guard}的状态`,
  },
  {
    now: {
      enforce: "On: matches are handled by the action set on each rule.",
      observe: {
        redact: "Monitor: matches are recorded in the log and notified; requests are not changed.",
        inspect_tools:
          "Monitor: matching tool calls are recorded in the log and notified, and are returned to the client as usual.",
        content: "Monitor: matches are recorded in the log and notified; requests and answers are not changed.",
      },
      off: "Off: nothing is checked or recorded.",
    },
    ruleCount: (on: number, all: number) => `${on} of ${plural(all, "rule", "rules")} on.`,
    search: "Search rules",
    noMatch: "No matching rules",
    test: "Test…",
    newRule: "New rule",
    enabled: "On",
    rule: "Rule",
    match: "Match",
    scope: "Checks",
    action: "Action",
    groupCount: (all: number, on: number) => `${plural(all, "rule", "rules")} · ${on} on`,
    groupHits: (n: number) => `${plural(n, "match", "matches")} in the last 7 days`,
    actionFor: (name: string) => `Action for “${name}”`,
    replaceWith: (text: string) => `Replace with ${text}`,
    turnOn: "Turn on",
    turnOff: "Turn off",
    copyAsCustom: "Copy as a custom rule",
    actionsFor: (name: string) => `Actions for ${name}`,
    toggleFor: (name: string) => `Turn on “${name}”`,
    modeFor: (guard: string) => `${guard} state`,
  },
  {
    "zh-Hant": {
      now: {
        enforce: "開啟：命中內容按各條規則設定的動作處理。",
        observe: {
          redact: "監控：命中內容記入日誌併發出通知，請求不作修改。",
          inspect_tools: "監控：命中的工具呼叫記入日誌併發出通知，照常返回用戶端。",
          content: "監控：命中內容記入日誌併發出通知，請求與回答不作修改。",
        },
        off: "關閉：不檢查，不記錄。",
      } as {
        enforce: string;
        observe: Record<Guard, string>;
        off: string;
      },
      ruleCount: (on: number, all: number) => `已啟用 ${on} 條，共 ${all} 條。`,
      search: "檢索規則",
      noMatch: "無匹配的規則",
      test: "測試…",
      newRule: "新建規則",
      enabled: "啟用",
      rule: "規則",
      match: "匹配內容",
      scope: "檢查物件",
      action: "動作",
      groupCount: (all: number, on: number) => `${all} 條 · 已開 ${on} 條`,
      actionFor: (name: string) => `「${name}」的動作`,
      replaceWith: (text: string) => `替換為 ${text}`,
      turnOn: "啟用",
      copyAsCustom: "複製為自定義規則",
      toggleFor: (name: string) => `啟用「${name}」`,
      modeFor: (guard: string) => `${guard}的狀態`,
    },
    ko: {
      rule: "규칙",
    },
    es: {
      now: {
        enforce: "Activar: las coincidencias son manejadas por la acción establecida en cada regla.",
        observe: {
          redact: "Monitor: las coincidencias se registran en el registro y se notifican; las solicitudes no se modifican.",
          inspect_tools: "Monitor: las llamadas de herramientas coincidentes se registran en el registro y se notifican, y se devuelven al cliente como de costumbre.",
          content: "Monitor: las coincidencias se registran en el registro y se notifican; las solicitudes y respuestas no se modifican.",
        },
        off: "Desactivado: no se comprueba ni se registra nada.",
      },
      ruleCount: (on: number, all: number) => `${on} de ${plural(all, "regla", "normas")} en adelante.`,
      search: "Reglas de búsqueda",
      noMatch: "No hay reglas coincidentes",
      test: "Prueba…",
      newRule: "Nueva regla",
      enabled: "Activar",
      rule: "Regla",
      match: "Coincidencia",
      scope: "Comprobaciones",
      action: "Medidas adoptadas",
      groupCount: (all: number, on: number) => `${plural(all, "regla", "normas")} · ${on}`,
      groupHits: (n: number) => `${plural(n, "igualar", "coincidencias")} en los últimos 7 días`,
      actionFor: (name: string) => `Acción para “${name}”`,
      replaceWith: (text: string) => `Sustitúyase por ${text}`,
      turnOn: "Activar",
      turnOff: "Apague",
      copyAsCustom: "Copiar como regla personalizada",
      actionsFor: (name: string) => `Acciones en relación con ${name}`,
      toggleFor: (name: string) => `Activar “${name}”`,
      modeFor: (guard: string) => `${guard} estado`,
    },
  },
);

/** 「开启」「监控」「关闭」下那一句 */
export function nowText(t: typeof guardTabText.zh, guard: Guard, mode: GuardMode): string {
  return mode === "observe" ? t.now.observe[guard] : t.now[mode];
}
