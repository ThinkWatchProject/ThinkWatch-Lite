import type { ReactNode } from "react";
import { messages } from "@/i18n";

/** 英文的单复数 */
const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n.toLocaleString()} ${many}`);

/**
 * 一次命中的详情：安全日志里点开一行、请求详情「时间线」里点开一条防护记录，看到的同一块。
 */
export const hitDetailText = messages(
  {
    /** 左边一列的标签 */
    locations: "位置",
    rule: "规则",
    outcome: "处置",
    request: "请求",
    session: "会话",
    /** 命中在请求还是回答里、一共几处。`where` 是「请求」「回答」 */
    total: (where: string, n: number) => `${where}中共 ${n.toLocaleString()} 处`,
    /** 超出上限、没有列出的那些 */
    more: (n: number) => `另有 ${n.toLocaleString()} 处未列出`,
    /** 只先列前几处，其余的收着 */
    showAll: (n: number) => `展开全部（共 ${n.toLocaleString()} 处）`,
    /** 长的参数、回复先显示开头 */
    showAllText: "展开全部",
    collapse: "折叠",
    /** 内置规则由哪一版 core 定义 */
    builtinOf: (version: string) => `core ${version} 内置`,
    /** 仅记录：命中的内容原样经过 */
    recorded: {
      request: "命中的内容照常发往上游，未做改动。",
      response: "命中的内容照常返回客户端，未做改动。",
    },
    /** 已替换：发往上游的内容里换成了哪几个占位符 */
    replacedWith: "发往上游的内容中替换为",
    /** 已切断：被切断的那个工具调用 */
    cutCall: (tool: string) => `被切断的 ${tool} 调用，参数如下`,
    /** 参数超过上限时只留了开头 */
    truncated: "参数超过 4 KiB，仅保留开头部分。",
    /** 切断之后客户端收到的那一句 */
    clientNotice: "客户端收到的提示",
    /** 已拒绝 */
    notSent: "请求未发往上游。",
    clientReply: "客户端收到的回复",
    /** 已删除：发出（或返回）之前删去了几段 */
    stripped: {
      request: (n: number) => `删除 ${n.toLocaleString()} 处：命中内容在发往上游之前删除。`,
      response: (n: number) => `删除 ${n.toLocaleString()} 处：命中内容在返回客户端之前删除。`,
    },
    /** 内容过滤的「替换」：几处换成了规则指定的文字 */
    replacedText: {
      request: (n: number, text: ReactNode) => (
        <>
          替换 {n.toLocaleString()} 处：命中内容在发往上游之前替换为 {text}，不可还原。
        </>
      ),
      response: (n: number, text: ReactNode) => (
        <>
          替换 {n.toLocaleString()} 处：命中内容在返回客户端之前替换为 {text}，不可还原。
        </>
      ),
    },
    /** 实际发给上游的模型名（和客户端要的不同时） */
    sentModel: (model: string) => `发往上游的模型为 ${model}`,
    openRequest: (id: number) => `打开请求 #${id}`,
    openSession: "查看会话",
  },
  {
    locations: "Location",
    rule: "Rule",
    outcome: "Action",
    request: "Request",
    session: "Session",
    total: (where: string, n: number) => `${count(n, "match", "matches")} in the ${where.toLowerCase()}`,
    more: (n: number) => `${count(n, "more match", "more matches")} not listed`,
    showAll: (n: number) => `Show all (${n.toLocaleString()})`,
    showAllText: "Show all",
    collapse: "Collapse",
    builtinOf: (version: string) => `Built into core ${version}`,
    recorded: {
      request: "The matched content was sent to the upstream unchanged.",
      response: "The matched content was returned to the client unchanged.",
    },
    replacedWith: "Replaced in what was sent to the upstream with",
    cutCall: (tool: string) => `The ${tool} call that was cut off, with its arguments`,
    truncated: "The arguments exceed 4 KiB; only the beginning is kept.",
    clientNotice: "Notice the client received",
    notSent: "The request was not sent to the upstream.",
    clientReply: "Reply the client received",
    stripped: {
      request: (n: number) =>
        `${count(n, "matched segment was", "matched segments were")} deleted before the request was sent.`,
      response: (n: number) =>
        `${count(n, "matched segment was", "matched segments were")} deleted before the answer reached the client.`,
    },
    replacedText: {
      request: (n: number, text: ReactNode) => (
        <>
          {count(n, "matched segment was", "matched segments were")} replaced with {text} before the request was sent; this
          cannot be restored.
        </>
      ),
      response: (n: number, text: ReactNode) => (
        <>
          {count(n, "matched segment was", "matched segments were")} replaced with {text} before the answer reached the
          client; this cannot be restored.
        </>
      ),
    },
    sentModel: (model: string) => `sent to the upstream as ${model}`,
    openRequest: (id: number) => `Open request #${id}`,
    openSession: "View session",
  },
  {
    "zh-Hant": {
      rule: "規則",
      outcome: "處置",
      request: "請求",
      session: "會話",
      total: (where: string, n: number) => `${where}中共 ${n.toLocaleString()} 處`,
      more: (n: number) => `另有 ${n.toLocaleString()} 處未列出`,
      showAll: (n: number) => `展開全部（共 ${n.toLocaleString()} 處）`,
      showAllText: "展開全部",
      collapse: "摺疊",
      builtinOf: (version: string) => `core ${version} 內建`,
      recorded: {
        request: "命中的內容照常發往上游，未做改動。",
        response: "命中的內容照常返回用戶端，未做改動。",
      },
      replacedWith: "發往上游的內容中替換為",
      cutCall: (tool: string) => `被切斷的 ${tool} 呼叫，引數如下`,
      truncated: "引數超過 4 KiB，僅保留開頭部分。",
      clientNotice: "用戶端收到的提示",
      notSent: "請求未發往上游。",
      clientReply: "用戶端收到的回覆",
      stripped: {
        request: (n: number) => `刪除 ${n.toLocaleString()} 處：命中內容在發往上游之前刪除。`,
        response: (n: number) => `刪除 ${n.toLocaleString()} 處：命中內容在返回用戶端之前刪除。`,
      },
      replacedText: {
        request: (n: number, text: ReactNode) => (<>
         替換 {n.toLocaleString()} 處：命中內容在發往上游之前替換為 {text}，不可還原。
        </>),
        response: (n: number, text: ReactNode) => (<>
         替換 {n.toLocaleString()} 處：命中內容在返回用戶端之前替換為 {text}，不可還原。
        </>),
      },
      sentModel: (model: string) => `發往上游的模型為 ${model}`,
      openRequest: (id: number) => `開啟請求 #${id}`,
      openSession: "檢視會話",
    },
    ko: {
      locations: "위치",
      rule: "규칙",
      request: "요청",
    },
    es: {
      locations: "Ubicación",
      rule: "Regla",
      outcome: "Medidas adoptadas",
      request: "Solicitud",
      session: "Sesión",
      total: (where: string, n: number) => `${count(n, "igualar", "coincidencias")} en el ${where.toLowerCase()}`,
      more: (n: number) => `${count(n, "más coincidencia", "más coincidencias")} no incluido en la lista`,
      showAll: (n: number) => `Mostrar todo (${n.toLocaleString()})`,
      showAllText: "Mostrar todo",
      collapse: "Colapso",
      builtinOf: (version: string) => `Construido en el núcleo ${version}`,
      recorded: {
        request: "El contenido emparejado se envió al principio sin cambios.",
        response: "El contenido emparejado fue devuelto al cliente sin cambios.",
      },
      replacedWith: "Reemplazado en lo que se envió a la corriente",
      cutCall: (tool: string) => `La ${tool} llamada que fue cortada, con sus argumentos`,
      truncated: "Los argumentos superan los 4 KiB; sólo se mantiene el principio.",
      clientNotice: "Aviso recibido por el cliente",
      notSent: "La solicitud no se envió a las del proveedor.",
      clientReply: "Respuesta recibida por el cliente",
      stripped: {
        request: (n: number) => `${count(n, "el segmento correspondiente fue", "los segmentos emparejados fueron")} Suprimida antes de que se enviara la solicitud.`,
        response: (n: number) => `${count(n, "el segmento correspondiente fue", "los segmentos emparejados fueron")} eliminado antes de que la respuesta llegara al cliente.`,
      },
      replacedText: {
        request: (n: number, text: ReactNode) => (<>
         {count(n, "el segmento correspondiente fue", "los segmentos emparejados fueron")} sustituido por {text} before the request was sent; this
         cannot be restored.
        </>),
        response: (n: number, text: ReactNode) => (<>
         {count(n, "el segmento correspondiente fue", "los segmentos emparejados fueron")} sustituido por {text} before the answer reached the
         client; this cannot be restored.
        </>),
      },
      sentModel: (model: string) => `enviado a la parte anterior como ${model}`,
      openRequest: (id: number) => `Abrir petición #${id}`,
      openSession: "Ver sesión",
    },
  },
);
