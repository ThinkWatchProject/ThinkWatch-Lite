import type { Dialect, TranscriptMessage, TranscriptPart, TranscriptRole } from "@/types";

/**
 * 一个请求的请求体和回答，按客户端的格式读成对话里的一块一块（请求详情「内容 › 解析」）。
 *
 * **和 core 读会话对话的是同一套读法**（tw-store 的 `transcript::read` 和 `transcript::answer`，
 * 流的部分照 tw-dialect 各家的流解析器）：取哪个字段、哪些块算「其他」、空的文字块不算，
 * 都照那边。core 没有「一个请求读成对话」的端点，而在跑的请求的回答是一段一段到的 —— 要边收
 * 边读，只能在这一侧读。
 *
 * **回答是增量读的**（`AnswerReader`）：每来一段只读新的那一截，读过的块不再碰。一个几 MB 的
 * 回答，每一帧都整段重读一遍就是平方级的。
 */

/** 客户端说得出的四种格式（Converse 只在上游那一边） */
export type ClientDialect = Exclude<Dialect, "bedrock">;

/**
 * 客户端用的是哪种格式。**按路径认**，和网关进门时一样：`/v1/messages` 是 Anthropic，
 * `/chat/completions` 是 Chat，`/responses` 是 Responses，`:generateContent` 这些是 Gemini。
 * 转换过格式的请求，记录里写着客户端那一边（`translated.from`），以它为准。认不出是 null
 */
export function dialectOf(path: string, from?: Dialect | null): ClientDialect | null {
  if (from && from !== "bedrock") return from;
  const p = path.split("?")[0] ?? "";
  if (/\/messages$/.test(p)) return "anthropic";
  if (/\/chat\/completions$/.test(p)) return "openai-chat";
  if (/\/responses(\/compact)?$/.test(p)) return "openai-responses";
  if (/:(stream)?[gG]enerateContent$/.test(p) || /\/models\/[^/]+:/.test(p)) return "gemini";
  return null;
}

// ───────────────────────────────────────────────────────── 小工具

type Json = unknown;
type Obj = Record<string, Json>;

const isObj = (v: Json): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: Json, key: string): string | undefined => {
  if (!isObj(v)) return undefined;
  const x = v[key];
  return typeof x === "string" ? x : undefined;
};
const arr = (v: Json, key: string): Json[] => {
  if (!isObj(v)) return [];
  const x = v[key];
  return Array.isArray(x) ? x : [];
};
const get = (v: Json, key: string): Json => (isObj(v) ? v[key] : undefined);
const kindOf = (v: Json): string => str(v, "type") ?? "unknown";
const num = (v: Json, key: string): number | undefined => {
  const x = get(v, key);
  return typeof x === "number" ? x : undefined;
};

function parse(text: string): Json | undefined {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return undefined;
  }
}

/** `string | [{type: "text", text}]` 形状的内容里的字，几段之间换行 */
function textOf(v: Json): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v))
    return v
      .map((p) => str(p, "text"))
      .filter((t): t is string => t !== undefined)
      .join("\n");
  return "";
}

/** base64 解出来有多少字节 */
function base64Len(data: string): number {
  const d = data.trimEnd();
  let pad = 0;
  for (let i = d.length - 1; i >= 0 && d[i] === "="; i--) pad++;
  return Math.max(0, Math.floor((d.length * 3) / 4) - pad);
}

type Part = TranscriptPart;
const text = (t: string, out: Part[]) => {
  if (t !== "") out.push({ kind: "text", text: t });
};
const other = (label: string): Part => ({ kind: "other", label });
const image = (media_type: string | null, bytes: number | null): Part => ({ kind: "image", media_type, bytes });
/** 函数工具的参数：模型写出来的 JSON 文本，空的当 `{}` */
const args = (s: string | undefined): string => (s === undefined || s.trim() === "" ? "{}" : s);
/** 已经是 JSON 的参数（Anthropic、Gemini） */
const jsonArgs = (v: Json): string => (v === undefined ? "{}" : JSON.stringify(v));

/** 一张以 URI 给的图片：`data:` URI 说得出类型和大小，网址说不出 */
function imageUri(uri: string): Part {
  const m = /^data:([^,]*),(.*)$/s.exec(uri);
  if (m) {
    const head = m[1] ?? "";
    const base64 = head.endsWith(";base64");
    const mime = base64 ? head.slice(0, -";base64".length) : (head.split(";")[0] ?? "");
    return image(mime || null, base64 ? base64Len(m[2] ?? "") : null);
  }
  return image(null, null);
}

// ───────────────────────────────────────────────────────── 请求

/** 一个请求体里要看的东西 */
export interface ReadRequest {
  /** 系统提示，几段之间空一行。没有是 null */
  system: string | null;
  /** 声明的工具，按名字 */
  tools: string[];
  messages: TranscriptMessage[];
}

/**
 * 按客户端的格式读请求体。**读不成 JSON 的是 null**（只存了开头的那种）；是 JSON 但不是对话
 * 的（数 token 的请求）读出来是空的，不算读不懂
 */
export function readRequest(dialect: ClientDialect, body: string): ReadRequest | null {
  const v = parse(body);
  if (!isObj(v)) return null;
  switch (dialect) {
    case "anthropic":
      return anthropicRequest(v);
    case "openai-chat":
      return chatRequest(v);
    case "openai-responses":
      return responsesRequest(v);
    case "gemini":
      return geminiRequest(v);
  }
}

const joinSystem = (parts: string[]): string | null => (parts.length === 0 ? null : parts.join("\n\n"));

function anthropicRequest(v: Obj): ReadRequest {
  const system: string[] = [];
  const s = v.system;
  if (typeof s === "string") system.push(s);
  else if (Array.isArray(s)) for (const b of s) if (str(b, "text") !== undefined) system.push(str(b, "text")!);
  return {
    system: joinSystem(system),
    tools: arr(v, "tools").map((t) => str(t, "name") ?? kindOf(t)),
    messages: arr(v, "messages").map(anthropicMessage),
  };
}

function anthropicMessage(m: Json): TranscriptMessage {
  const parts: Part[] = [];
  const c = get(m, "content");
  let onlyResults = false;
  if (typeof c === "string") text(c, parts);
  else if (Array.isArray(c)) {
    onlyResults = c.length > 0 && c.every((b) => str(b, "type") === "tool_result");
    anthropicBlocks(c, parts);
  }
  const r = str(m, "role");
  const role: TranscriptRole =
    r === "assistant" ? "assistant" : r === "system" ? "system" : onlyResults ? "tool" : "user";
  return { role, parts };
}

/** 一串内容块：消息的 `content`，也是整包回答的 `content` */
function anthropicBlocks(blocks: Json[], out: Part[]) {
  for (const b of blocks) {
    switch (kindOf(b)) {
      case "text":
        text(str(b, "text") ?? "", out);
        break;
      case "thinking":
        out.push({ kind: "thinking", text: str(b, "thinking") ?? "" });
        break;
      case "redacted_thinking":
        out.push({ kind: "thinking", text: "" });
        break;
      case "tool_use":
        out.push({ kind: "tool_call", id: str(b, "id") ?? "", name: str(b, "name") ?? "", input: jsonArgs(get(b, "input")) });
        break;
      case "tool_result":
        anthropicResult(b, out);
        break;
      case "image":
        out.push(anthropicImage(b));
        break;
      default:
        out.push(other(kindOf(b)));
    }
  }
}

function anthropicImage(b: Json): Part {
  const src = get(b, "source");
  if (str(src, "type") === "base64") return image(str(src, "media_type") ?? null, base64Len(str(src, "data") ?? ""));
  return image(null, null);
}

/** 工具结果：里面的字连起来成一块，图片和别的块跟在它后面 */
function anthropicResult(b: Json, out: Part[]) {
  const extra: Part[] = [];
  const c = get(b, "content");
  let t = "";
  if (typeof c === "string") t = c;
  else if (Array.isArray(c)) {
    const texts: string[] = [];
    for (const i of c) {
      const k = kindOf(i);
      if (k === "text") texts.push(str(i, "text") ?? "");
      else if (k === "image") extra.push(anthropicImage(i));
      else extra.push(other(k));
    }
    t = texts.join("\n");
  }
  out.push({ kind: "tool_result", call_id: str(b, "tool_use_id") ?? "", text: t, is_error: get(b, "is_error") === true });
  out.push(...extra);
}

function chatRequest(v: Obj): ReadRequest {
  const system: string[] = [];
  const messages: TranscriptMessage[] = [];
  // 开头连着的 system、developer 消息就是系统提示；对话中途的照原位置留着
  let leading = true;
  for (const m of arr(v, "messages")) {
    const role = str(m, "role") ?? "";
    if (leading && (role === "system" || role === "developer")) {
      system.push(textOf(get(m, "content")));
      continue;
    }
    leading = false;
    messages.push(chatMessage(m));
  }
  return {
    system: joinSystem(system),
    tools: arr(v, "tools").map((t) => str(get(t, "function"), "name") ?? str(get(t, "custom"), "name") ?? kindOf(t)),
    messages,
  };
}

function chatMessage(m: Json): TranscriptMessage {
  const content = get(m, "content");
  switch (str(m, "role") ?? "") {
    case "system":
    case "developer": {
      const parts: Part[] = [];
      text(textOf(content), parts);
      return { role: "system", parts };
    }
    case "assistant":
      return { role: "assistant", parts: chatAssistant(m) };
    case "tool":
      return {
        role: "tool",
        parts: [{ kind: "tool_result", call_id: str(m, "tool_call_id") ?? "", text: textOf(content), is_error: false }],
      };
    case "function":
      return {
        role: "tool",
        parts: [{ kind: "tool_result", call_id: str(m, "name") ?? "", text: textOf(content), is_error: false }],
      };
    default: {
      const parts: Part[] = [];
      if (typeof content === "string") text(content, parts);
      else if (Array.isArray(content))
        for (const p of content) {
          const k = kindOf(p);
          if (k === "text") text(str(p, "text") ?? "", parts);
          else if (k === "image_url") {
            const i = get(p, "image_url");
            const url = typeof i === "string" ? i : str(i, "url");
            parts.push(url === undefined ? image(null, null) : imageUri(url));
          } else parts.push(other(k));
        }
      return { role: "user", parts };
    }
  }
}

/** 助手消息：请求里的历史，也是整包回答的 `choices[0].message` */
function chatAssistant(m: Json): Part[] {
  const parts: Part[] = [];
  // DeepSeek、Kimi、GLM 这些的推理字段（OpenRouter 叫 `reasoning`）
  const r = str(m, "reasoning_content") || str(m, "reasoning");
  if (r) parts.push({ kind: "thinking", text: r });
  const c = get(m, "content");
  if (typeof c === "string") text(c, parts);
  else if (Array.isArray(c))
    for (const p of c) {
      const t = str(p, "text") ?? str(p, "refusal");
      if (t !== undefined) text(t, parts);
      else parts.push(other(kindOf(p)));
    }
  const refusal = str(m, "refusal");
  if (refusal !== undefined) text(refusal, parts);
  for (const c2 of arr(m, "tool_calls")) {
    const id = str(c2, "id") ?? "";
    if (str(c2, "type") === "custom") {
      const x = get(c2, "custom");
      parts.push({ kind: "tool_call", id, name: str(x, "name") ?? "", input: str(x, "input") ?? "" });
    } else {
      const f = get(c2, "function");
      parts.push({ kind: "tool_call", id, name: str(f, "name") ?? "", input: args(str(f, "arguments")) });
    }
  }
  const fc = get(m, "function_call");
  if (fc !== undefined && fc !== null)
    parts.push({ kind: "tool_call", id: "", name: str(fc, "name") ?? "", input: args(str(fc, "arguments")) });
  const audio = get(m, "audio");
  if (audio !== undefined && audio !== null) parts.push(other("audio"));
  return parts;
}

function responsesRequest(v: Obj): ReadRequest {
  const system: string[] = [];
  const ins = v.instructions;
  if (typeof ins === "string") system.push(ins);
  else if (Array.isArray(ins)) system.push(textOf(ins));
  const messages: TranscriptMessage[] = [];
  const input = v.input;
  if (typeof input === "string") {
    const parts: Part[] = [];
    text(input, parts);
    messages.push({ role: "user", parts });
  } else if (Array.isArray(input)) {
    let leading = true;
    for (const it of input) {
      // 工具声明（Responses Lite 写在 input 里），和顶层的 `tools` 一样不算对话
      if (str(it, "type") === "additional_tools") continue;
      const role = str(it, "role");
      if (leading && (str(it, "type") ?? "message") === "message" && (role === "system" || role === "developer")) {
        system.push(textOf(get(it, "content")));
        continue;
      }
      leading = false;
      messages.push(responsesItem(it));
    }
  }
  const tools = arr(v, "tools").map((t) => {
    const name = str(t, "name");
    const ns = str(t, "namespace");
    return name ? (ns ? `${ns}.${name}` : name) : kindOf(t);
  });
  return { system: joinSystem(system), tools, messages };
}

/** 一个输入项：请求里的历史，也是整包回答的 `output` 里的一项 */
function responsesItem(it: Json): TranscriptMessage {
  const kind = str(it, "type") ?? "message";
  const one = (role: TranscriptRole, p: Part): TranscriptMessage => ({ role, parts: [p] });
  switch (kind) {
    case "message": {
      const r = str(it, "role");
      const role: TranscriptRole = r === "assistant" ? "assistant" : r === "system" || r === "developer" ? "system" : "user";
      const parts: Part[] = [];
      const c = get(it, "content");
      if (typeof c === "string") text(c, parts);
      else if (Array.isArray(c)) responsesParts(c, parts);
      return { role, parts };
    }
    case "reasoning": {
      const texts = (key: string) =>
        arr(it, key)
          .map((x) => str(x, "text"))
          .filter((t): t is string => t !== undefined);
      // 推理原文优先，没有就是摘要；几段之间空一行
      let t = texts("content");
      if (t.length === 0) t = texts("summary");
      return one("assistant", { kind: "thinking", text: t.join("\n\n") });
    }
    case "function_call":
    case "custom_tool_call": {
      const name = str(it, "name") ?? "";
      const ns = str(it, "namespace");
      return one("assistant", {
        kind: "tool_call",
        id: str(it, "call_id") ?? "",
        name: ns ? `${ns}.${name}` : name,
        input: kind === "function_call" ? args(str(it, "arguments")) : (str(it, "input") ?? ""),
      });
    }
    case "function_call_output":
    case "custom_tool_call_output":
    case "local_shell_call_output": {
      const extra: Part[] = [];
      const o = get(it, "output");
      let t = "";
      if (typeof o === "string") t = o;
      else if (Array.isArray(o)) {
        const texts: string[] = [];
        for (const p of o) {
          const k = kindOf(p);
          if (k === "input_text" || k === "output_text") texts.push(str(p, "text") ?? "");
          else if (k === "input_image") extra.push(responsesImage(p));
          else extra.push(other(k));
        }
        t = texts.join("\n");
      }
      return {
        role: "tool",
        parts: [{ kind: "tool_result", call_id: str(it, "call_id") ?? "", text: t, is_error: false }, ...extra],
      };
    }
    // 压缩过的前文：位置像一条系统消息，内容只有服务方读得懂
    case "compaction":
      return one("system", other(kind));
    default:
      if (kind.endsWith("_output")) return one("tool", other(kind));
      if (kind.endsWith("_call") || kind === "mcp_list_tools" || kind === "mcp_approval_request")
        return one("assistant", other(kind));
      return one("user", other(kind));
  }
}

function responsesParts(parts: Json[], out: Part[]) {
  for (const p of parts) {
    const k = kindOf(p);
    if (k === "input_text" || k === "output_text") text(str(p, "text") ?? "", out);
    else if (k === "refusal") text(str(p, "refusal") ?? "", out);
    else if (k === "input_image") out.push(responsesImage(p));
    else out.push(other(k));
  }
}

function responsesImage(p: Json): Part {
  const u = str(p, "image_url");
  return u !== undefined ? imageUri(u) : image(null, null);
}

/** 按驼峰名取字段，取不到再试下划线写法：Gemini 的 REST 接口两种都收 */
function field(v: Json, camel: string): Json {
  const x = get(v, camel);
  if (x !== undefined) return x;
  return get(v, camel.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
}
const fstr = (v: Json, camel: string): string | undefined => {
  const x = field(v, camel);
  return typeof x === "string" ? x : undefined;
};

function geminiRequest(v: Obj): ReadRequest {
  const system: string[] = [];
  const s = field(v, "systemInstruction");
  if (typeof s === "string") system.push(s);
  else if (s !== undefined) system.push(textOf(get(s, "parts")));
  const tools: string[] = [];
  for (const t of arr(v, "tools")) {
    const decls = field(t, "functionDeclarations");
    if (Array.isArray(decls)) for (const d of decls) tools.push(str(d, "name") ?? "");
    else if (isObj(t)) tools.push(...Object.keys(t));
  }
  return {
    system: joinSystem(system),
    tools,
    messages: arr(v, "contents").map((c) => {
      const parts = arr(c, "parts");
      const out: Part[] = [];
      geminiParts(parts, out);
      const r = str(c, "role");
      const role: TranscriptRole =
        r === "model"
          ? "assistant"
          : r === "function"
            ? "tool"
            : r === "system"
              ? "system"
              : parts.length > 0 && parts.every((p) => field(p, "functionResponse") !== undefined)
                ? "tool"
                : "user";
      return { role, parts: out };
    }),
  };
}

/** 一串 part：请求里的一条消息，也是回答里候选的 `content.parts` */
function geminiParts(parts: Json[], out: Part[]) {
  for (const p of parts) {
    const t = fstr(p, "text");
    if (t !== undefined) {
      if (get(p, "thought") === true) out.push({ kind: "thinking", text: t });
      else text(t, out);
      continue;
    }
    const blob = field(p, "inlineData");
    if (blob !== undefined) {
      const mime = fstr(blob, "mimeType") ?? "";
      out.push(mime.startsWith("image/") ? image(mime, base64Len(fstr(blob, "data") ?? "")) : other("inlineData"));
      continue;
    }
    const file = field(p, "fileData");
    if (file !== undefined) {
      const mime = fstr(file, "mimeType") ?? "";
      out.push(mime.startsWith("image/") ? image(mime, null) : other("fileData"));
      continue;
    }
    const call = field(p, "functionCall");
    if (call !== undefined) {
      const name = fstr(call, "name") ?? "";
      out.push({ kind: "tool_call", id: fstr(call, "id") ?? name, name, input: jsonArgs(get(call, "args")) });
      continue;
    }
    const resp = field(p, "functionResponse");
    if (resp !== undefined) {
      const name = fstr(resp, "name") ?? "";
      const body = get(resp, "response");
      out.push({
        kind: "tool_result",
        call_id: fstr(resp, "id") ?? name,
        text: geminiResponseText(body),
        is_error: get(body, "error") !== undefined && get(body, "output") === undefined,
      });
      continue;
    }
    if (field(p, "executableCode") !== undefined) out.push(other("executableCode"));
    else if (field(p, "codeExecutionResult") !== undefined) out.push(other("codeExecutionResult"));
  }
}

/** 函数结果写成字：只有一项 `output`（或 `result`、`content`、`error`）且是字符串的取那个字符串 */
function geminiResponseText(v: Json): string {
  if (isObj(v)) {
    const keys = Object.keys(v);
    if (keys.length === 1) {
      for (const k of ["output", "result", "content", "error"]) {
        const x = v[k];
        if (typeof x === "string") return x;
      }
    }
  }
  if (typeof v === "string") return v;
  if (v === undefined || v === null) return "";
  return JSON.stringify(v);
}

// ───────────────────────────────────────────────────────── 回答

/** 读回答时攒着的一块，会接着长 */
type Growing =
  | { kind: "text"; text: string }
  | { kind: "thinking"; text: string }
  | { kind: "tool_call"; id: string; name: string; input: string }
  | { kind: "fixed"; part: Part };

type BlockKind = { kind: "text" } | { kind: "thinking" } | { kind: "tool_call"; id: string; name: string };
type Delta = { kind: "text" | "thinking" | "tool_input"; text: string } | { kind: "signature" };

/**
 * 流里的事件拼回一块一块（core 的 `Assembly`）。块按第一次出现的先后排。
 *
 * **交出去的是不变的对象**：没长的块交出去的还是上一次那一个，界面按对象比较就知道只有正在
 * 长的那一块要重画。
 */
class Assembly {
  private items: Growing[] = [];
  /** 每一块改过几次。交出去的那一份按它判断要不要换新的 */
  private versions: number[] = [];
  private shown: { version: number; part: Part }[] = [];
  /** 块号 → 在 `items` 里的位置 */
  private at = new Map<number, number>();
  recognized = false;

  start(index: number, kind: BlockKind) {
    this.recognized = true;
    this.at.set(index, this.items.length);
    this.add(kind.kind === "tool_call" ? { kind: "tool_call", id: kind.id, name: kind.name, input: "" } : { kind: kind.kind, text: "" });
  }

  delta(index: number, d: Delta) {
    this.recognized = true;
    const i = this.at.get(index);
    if (i !== undefined && this.append(i, d)) return;
    // 没报开始的块：第一段增量到了就算开了一块
    this.at.set(index, this.items.length);
    if (d.kind === "signature") this.add({ kind: "thinking", text: "" });
    else if (d.kind === "tool_input") this.add({ kind: "tool_call", id: "", name: "", input: d.text });
    else this.add({ kind: d.kind, text: d.text });
  }

  /**
   * 解析器不认、另外认出来的一块（服务端工具、图片）。**之后的字另起一块**：解析器那边的
   * 文字块可能还开着，接回前面那块的话，字就跑到这一块前头去了
   */
  push(part: Part) {
    this.recognized = true;
    this.add({ kind: "fixed", part });
    for (const [k, i] of this.at) {
      const it = this.items[i]!;
      if (it.kind === "text" || it.kind === "thinking") this.at.delete(k);
    }
  }

  private add(g: Growing) {
    this.items.push(g);
    this.versions.push(0);
  }

  private append(i: number, d: Delta): boolean {
    const it = this.items[i]!;
    if (d.kind === "signature") return it.kind === "thinking";
    if ((it.kind === "text" && d.kind === "text") || (it.kind === "thinking" && d.kind === "thinking")) it.text += d.text;
    else if (it.kind === "tool_call" && d.kind === "tool_input") it.input += d.text;
    else return false;
    this.versions[i]! += 1;
    return true;
  }

  /**
   * 此刻的几块。`done`：读完了，没有参数的调用写成 `{}`（和 core 一样）。
   *
   * **空的文字块留着**（core 读完会去掉）：块的位置就是界面上的位置，读完时少一块，后面的块就
   * 挪了位，展开着的思考会变成别的块。界面不画空的那几块
   */
  parts(done: boolean): Part[] {
    const out: Part[] = [];
    this.items.forEach((it, i) => {
      const v = this.versions[i]!;
      let s = this.shown[i];
      if (!s || s.version !== v) {
        s = { version: v, part: it.kind === "fixed" ? it.part : { ...it } };
        this.shown[i] = s;
      }
      const p = s.part;
      if (done && p.kind === "tool_call" && p.input.trim() === "") {
        out.push({ ...p, input: "{}" });
        return;
      }
      out.push(p);
    });
    return out;
  }
}

/** 一帧 SSE：`event:` 和 `data:`（几行连起来） */
interface Frame {
  event: string | null;
  data: string;
}

/** 一帧（不含结尾的空行）读成字段。只有注释的是 null */
function frame(raw: string): Frame | null {
  let event: string | null = null;
  const data: string[] = [];
  for (const line0 of raw.split("\n")) {
    const line = line0.endsWith("\r") ? line0.slice(0, -1) : line0;
    if (line.startsWith(":")) continue;
    const c = line.indexOf(":");
    const name = c < 0 ? line : line.slice(0, c);
    let value = c < 0 ? "" : line.slice(c + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (name === "event") event = value;
    else if (name === "data") data.push(value);
  }
  if (event === null && data.length === 0) return null;
  return { event, data: data.join("\n") };
}

/** 第一个空行：它前面是一帧，`[1]` 是空行本身多长 */
function frameEnd(s: string, from: number): [number, number] | null {
  const a = s.indexOf("\n\n", from);
  const b = s.indexOf("\r\n\r\n", from);
  if (a < 0 && b < 0) return null;
  if (b >= 0 && (a < 0 || b < a)) return [b, 4];
  return [a, 2];
}

/** 一家的流怎么读：一帧进来，往拼装里报块的开始和增量 */
interface StreamParser {
  frame(f: Frame, asm: Assembly): void;
}

function anthropicStream(): StreamParser {
  const skipped = new Set<number>();
  return {
    frame(f, asm) {
      const v = parse(f.data);
      if (!isObj(v)) return;
      const kind = str(v, "type") ?? f.event ?? "";
      const index = num(v, "index") ?? 0;
      if (kind === "content_block_start") {
        const b = get(v, "content_block");
        const t = str(b, "type");
        if (t === "text") asm.start(index, { kind: "text" });
        else if (t === "thinking" || t === "redacted_thinking") asm.start(index, { kind: "thinking" });
        else if (t === "tool_use") asm.start(index, { kind: "tool_call", id: str(b, "id") ?? "", name: str(b, "name") ?? "" });
        else {
          // 服务端工具的调用和结果、MCP……：解析器跳过，这里记成「其他」
          skipped.add(index);
          asm.push(other(t ?? "unknown"));
          return;
        }
        // 有的兼容实现把内容直接放在开始帧里，不再发增量
        if (t === "text" && str(b, "text")) asm.delta(index, { kind: "text", text: str(b, "text")! });
        if (t === "thinking" && str(b, "thinking")) asm.delta(index, { kind: "thinking", text: str(b, "thinking")! });
        const input = get(b, "input");
        if (t === "tool_use" && isObj(input) && Object.keys(input).length > 0)
          asm.delta(index, { kind: "tool_input", text: JSON.stringify(input) });
      } else if (kind === "content_block_delta" && !skipped.has(index)) {
        const d = get(v, "delta");
        switch (str(d, "type")) {
          case "text_delta":
            asm.delta(index, { kind: "text", text: str(d, "text") ?? "" });
            break;
          case "thinking_delta":
            asm.delta(index, { kind: "thinking", text: str(d, "thinking") ?? "" });
            break;
          case "signature_delta":
            asm.delta(index, { kind: "signature" });
            break;
          case "input_json_delta":
            asm.delta(index, { kind: "tool_input", text: str(d, "partial_json") ?? "" });
            break;
        }
      }
    },
  };
}

/** 一次只开着一块的那几家（Chat、Gemini）：要的那一块开着就用它，否则开一块新的 */
class OneOpen {
  private next = 0;
  open: { index: number; key: string } | null = null;
  ensure(key: string, kind: BlockKind, asm: Assembly): number {
    if (this.open && this.open.key === key) return this.open.index;
    const index = this.next++;
    asm.start(index, kind);
    this.open = { index, key };
    return index;
  }
  close() {
    this.open = null;
  }
  fresh(kind: BlockKind, asm: Assembly): number {
    const index = this.next++;
    asm.start(index, kind);
    this.open = null;
    return index;
  }
}

function chatStream(): StreamParser {
  const blocks = new OneOpen();
  const tools = new Map<number, number>();
  return {
    frame(f, asm) {
      const data = f.data.trim();
      if (data === "[DONE]") return;
      const v = parse(data);
      if (!isObj(v) || v.error !== undefined) return;
      const choice = arr(v, "choices")[0];
      if (choice === undefined) return;
      const delta = get(choice, "delta");
      const r = str(delta, "reasoning_content") || str(delta, "reasoning");
      if (r) asm.delta(blocks.ensure("thinking", { kind: "thinking" }, asm), { kind: "thinking", text: r });
      for (const key of ["content", "refusal"]) {
        const t = str(delta, key);
        if (t) asm.delta(blocks.ensure("text", { kind: "text" }, asm), { kind: "text", text: t });
      }
      for (const c of arr(delta, "tool_calls")) {
        const k = num(c, "index") ?? 0;
        const fn = get(c, "function");
        let index = tools.get(k);
        if (index !== undefined) {
          // 已经结束的调用又来了片段：没有办法重新打开，丢掉
          if (blocks.open?.index !== index) continue;
        } else {
          index = blocks.ensure(`tool:${k}`, { kind: "tool_call", id: str(c, "id") ?? "", name: str(fn, "name") ?? "" }, asm);
          tools.set(k, index);
        }
        const a = str(fn, "arguments");
        if (a) asm.delta(index, { kind: "tool_input", text: a });
      }
    },
  };
}

function responsesStream(): StreamParser {
  let next = 0;
  /** 输出项号 → 它的块 */
  const items = new Map<number, { kind: "message" | "reasoning" | "call"; block: number | null; gotDelta: boolean; summary?: number }>();
  /** (输出项号, 内容号) → 文字块，和关没关 */
  const texts = new Map<string, { index: number; closed: boolean }>();
  const open = (kind: BlockKind, asm: Assembly) => {
    const index = next++;
    asm.start(index, kind);
    return index;
  };
  const textBlock = (oi: number, ci: number, asm: Assembly): number | null => {
    const t = texts.get(`${oi}:${ci}`);
    if (t) return t.closed ? null : t.index;
    const index = open({ kind: "text" }, asm);
    texts.set(`${oi}:${ci}`, { index, closed: false });
    return index;
  };
  const closeText = (oi: number, ci: number) => {
    const t = texts.get(`${oi}:${ci}`);
    if (t) t.closed = true;
  };
  return {
    frame(f, asm) {
      const v = parse(f.data);
      if (!isObj(v)) return;
      const kind = str(v, "type") ?? f.event ?? "";
      const oi = num(v, "output_index") ?? 0;
      const ci = num(v, "content_index") ?? 0;
      const delta = str(v, "delta") ?? "";
      switch (kind) {
        case "response.output_item.added": {
          const it = get(v, "item");
          const t = str(it, "type");
          if (t === "message") items.set(oi, { kind: "message", block: null, gotDelta: false });
          else if (t === "reasoning") items.set(oi, { kind: "reasoning", block: open({ kind: "thinking" }, asm), gotDelta: false });
          else if (t === "function_call" || t === "custom_tool_call") {
            const ns = str(it, "namespace");
            const name = str(it, "name") ?? "";
            const block = open({ kind: "tool_call", id: str(it, "call_id") ?? "", name: ns ? `${ns}.${name}` : name }, asm);
            const first = str(it, t === "function_call" ? "arguments" : "input") ?? "";
            if (first) asm.delta(block, { kind: "tool_input", text: first });
            items.set(oi, { kind: "call", block, gotDelta: first !== "" });
          } else asm.push(other(t ?? "unknown")); // 托管工具的调用：web_search_call、image_generation_call……
          break;
        }
        case "response.content_part.added": {
          const t = str(get(v, "part"), "type");
          if (t === "output_text" || t === "refusal") textBlock(oi, ci, asm);
          break;
        }
        case "response.output_text.delta":
        case "response.refusal.delta": {
          const index = textBlock(oi, ci, asm);
          if (index !== null && delta) asm.delta(index, { kind: "text", text: delta });
          break;
        }
        case "response.output_text.done":
        case "response.refusal.done":
        case "response.content_part.done":
          closeText(oi, ci);
          break;
        case "response.reasoning_summary_text.delta":
        case "response.reasoning_text.delta": {
          const it = items.get(oi);
          if (!it || it.kind !== "reasoning" || it.block === null) break;
          const si = num(v, "summary_index");
          // 多段摘要之间空一行
          if (si !== undefined && it.summary !== undefined && si !== it.summary)
            asm.delta(it.block, { kind: "thinking", text: "\n\n" });
          if (si !== undefined) it.summary = si;
          it.gotDelta = true;
          asm.delta(it.block, { kind: "thinking", text: delta });
          break;
        }
        case "response.function_call_arguments.delta":
        case "response.custom_tool_call_input.delta": {
          const it = items.get(oi);
          if (it && it.kind === "call" && it.block !== null) {
            it.gotDelta = true;
            asm.delta(it.block, { kind: "tool_input", text: delta });
          }
          break;
        }
        case "response.output_item.done": {
          const done = get(v, "item");
          const it = items.get(oi);
          if (!it) break;
          items.delete(oi);
          if (it.kind === "message") {
            const seen = [...texts.keys()].some((k) => k.startsWith(`${oi}:`));
            for (const [k, t] of texts) if (k.startsWith(`${oi}:`)) t.closed = true;
            // 没有增量、只在完成时给了全文的实现
            if (!seen)
              arr(done, "content").forEach((part, c) => {
                const t = str(part, "text") ?? str(part, "refusal");
                const index = t !== undefined ? textBlock(oi, c, asm) : null;
                if (index !== null && t) asm.delta(index, { kind: "text", text: t });
                closeText(oi, c);
              });
          } else if (it.block !== null && !it.gotDelta) {
            if (it.kind === "reasoning") {
              const take = (key: string) =>
                arr(done, key)
                  .map((x) => str(x, "text"))
                  .filter((t): t is string => t !== undefined);
              const t = (take("content").length > 0 ? take("content") : take("summary")).join("\n\n");
              if (t) asm.delta(it.block, { kind: "thinking", text: t });
            } else {
              const whole = str(done, "arguments") ?? str(done, "input") ?? "";
              if (whole) asm.delta(it.block, { kind: "tool_input", text: whole });
            }
          }
          break;
        }
      }
    },
  };
}

/** Gemini 的一帧（SSE 的一帧，或者 JSON 数组里的一个元素） */
function geminiChunk(v: Json, blocks: OneOpen, asm: Assembly) {
  if (!isObj(v) || v.error !== undefined) return;
  const parts = arr(get(arr(v, "candidates")[0], "content"), "parts");
  for (const p of parts) {
    const t = fstr(p, "text");
    if (t !== undefined) {
      const thought = get(p, "thought") === true;
      const index = blocks.ensure(thought ? "thinking" : "text", { kind: thought ? "thinking" : "text" }, asm);
      if (t) asm.delta(index, { kind: thought ? "thinking" : "text", text: t });
      continue;
    }
    const call = field(p, "functionCall");
    if (call !== undefined) {
      const index = blocks.fresh({ kind: "tool_call", id: str(call, "id") ?? "", name: str(call, "name") ?? "" }, asm);
      asm.delta(index, { kind: "tool_input", text: JSON.stringify(get(call, "args") ?? {}) });
      continue;
    }
    // 图片、代码执行：解析器不认，这里认
    const extra: Part[] = [];
    geminiParts([p], extra);
    for (const x of extra) if (x.kind === "image" || x.kind === "other") {
      asm.push(x);
      blocks.close();
    }
  }
}

function geminiStream(): StreamParser {
  const blocks = new OneOpen();
  return {
    frame(f, asm) {
      const v = parse(f.data);
      if (v !== undefined) geminiChunk(v, blocks, asm);
    },
  };
}

/** 整包的回答（不是流的）。JSON 都解析不了的（截断了的）什么都读不出来 */
function wholeAnswer(dialect: ClientDialect, v: Json): { parts: Part[]; recognized: boolean } {
  const parts: Part[] = [];
  if (!isObj(v)) return { parts, recognized: false };
  const says = (key: string, prefix: string) => (str(v, key) ?? "").startsWith(prefix);
  switch (dialect) {
    case "anthropic": {
      const c = v.content;
      if (Array.isArray(c)) anthropicBlocks(c, parts);
      return { parts, recognized: c !== undefined || says("type", "message") };
    }
    case "openai-chat": {
      const m = get(arr(v, "choices")[0], "message");
      if (m !== undefined) parts.push(...chatAssistant(m));
      return { parts, recognized: v.choices !== undefined || says("object", "chat.completion") };
    }
    case "openai-responses":
      for (const it of arr(v, "output")) parts.push(...responsesItem(it).parts);
      return { parts, recognized: v.output !== undefined || says("object", "response") };
    case "gemini":
      geminiParts(arr(get(arr(v, "candidates")[0], "content"), "parts"), parts);
      return { parts, recognized: ["candidates", "promptFeedback", "usageMetadata"].some((k) => v[k] !== undefined) };
  }
}

/**
 * 一份回答，一段一段读（`push`）。**按开头的字分**：`{` 是整包，Gemini 的 `[` 是逐步写出的
 * JSON 数组，别的是 SSE 的流 —— 不看请求要没要流（上游只给流、客户端要整包的时候，存下来的
 * 是流）。
 *
 * 流里读过的帧不再读：每次只切新来的那一截。整包的回答一次到齐，齐了才读得成。
 */
export class AnswerReader {
  private asm = new Assembly();
  private mode: "unknown" | "whole" | "array" | "sse" = "unknown";
  /** 还没切成帧的那一截（流），或者到此为止的全文（整包） */
  private rest = "";
  private parser: StreamParser;
  /** Gemini 数组：扫到哪儿了、嵌了几层、在不在字符串里 */
  private scan = { started: false, pos: 0, depth: 0, inString: false, escape: false, start: -1 };
  private gemini = new OneOpen();
  private whole: { parts: Part[]; recognized: boolean } | null = null;
  private wholeAt = -1;

  constructor(private dialect: ClientDialect) {
    this.parser =
      dialect === "anthropic"
        ? anthropicStream()
        : dialect === "openai-chat"
          ? chatStream()
          : dialect === "openai-responses"
            ? responsesStream()
            : geminiStream();
  }

  /** 认出了这家格式的回答没有 */
  get recognized(): boolean {
    return this.mode === "whole" ? (this.wholeOf()?.recognized ?? false) : this.asm.recognized;
  }

  push(text: string) {
    if (text === "") return;
    if (this.mode === "unknown") {
      this.rest += text;
      const first = /\S/.exec(this.rest)?.[0];
      if (first === undefined) return;
      this.mode = first === "{" ? "whole" : first === "[" && this.dialect === "gemini" ? "array" : "sse";
      const all = this.rest;
      this.rest = "";
      this.push(all);
      return;
    }
    if (this.mode === "whole") {
      this.rest += text;
      return;
    }
    if (this.mode === "array") {
      this.rest += text;
      this.scanArray();
      return;
    }
    this.rest += text;
    let from = 0;
    for (let end = frameEnd(this.rest, 0); end; end = frameEnd(this.rest, from)) {
      const f = frame(this.rest.slice(from, end[0]));
      from = end[0] + end[1];
      if (f) this.parser.frame(f, this.asm);
    }
    if (from > 0) this.rest = this.rest.slice(from);
  }

  /** 此刻读出来的几块。`done`：回答收齐了（最后半帧没有空行也读进来） */
  parts(done = false): Part[] {
    if (this.mode === "whole") return this.wholeOf()?.parts ?? [];
    if (done && this.mode === "sse" && this.rest.trim() !== "") {
      const f = frame(this.rest);
      this.rest = "";
      if (f) this.parser.frame(f, this.asm);
    }
    return this.asm.parts(done);
  }

  private wholeOf() {
    if (this.wholeAt !== this.rest.length) {
      this.wholeAt = this.rest.length;
      const v = parse(this.rest);
      this.whole = v === undefined ? null : wholeAnswer(this.dialect, v);
    }
    return this.whole;
  }

  /** Gemini 数组里凑齐了的元素一个一个读。截断了的读到最后一个完整的元素 */
  private scanArray() {
    const st = this.scan;
    const s = this.rest;
    if (!st.started) {
      const open = s.indexOf("[");
      if (open < 0) return;
      st.started = true;
      st.pos = open + 1;
    }
    let consumed = 0;
    for (let i = st.pos; i < s.length; i++) {
      const c = s[i]!;
      if (st.inString) {
        if (st.escape) st.escape = false;
        else if (c === "\\") st.escape = true;
        else if (c === '"') st.inString = false;
        continue;
      }
      if (c === '"') st.inString = true;
      else if (c === "{" || c === "[") {
        if (st.depth === 0) st.start = i;
        st.depth++;
      } else if ((c === "}" || c === "]") && st.depth > 0) {
        st.depth--;
        if (st.depth === 0 && st.start >= 0) {
          const v = parse(s.slice(st.start, i + 1));
          if (v !== undefined) geminiChunk(v, this.gemini, this.asm);
          st.start = -1;
          consumed = i + 1;
        }
      }
    }
    st.pos = s.length;
    // 读过的元素丢掉，留下没读完的那一截
    if (consumed > 0) {
      this.rest = s.slice(consumed);
      st.pos -= consumed;
      if (st.start >= 0) st.start -= consumed;
    }
  }
}
