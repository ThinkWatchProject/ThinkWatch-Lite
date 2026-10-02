import type {
  Transcript,
  TranscriptGap,
  TranscriptMessage,
  TranscriptPart,
  TranscriptRole,
  TranscriptTurn,
  TurnView,
} from "@/types";

/**
 * 会话「对话」那一页的纯逻辑：把 core 给的一轮一轮排成要画的样子。界面在 `Conversation.tsx`。
 */

export type ToolCall = Extract<TranscriptPart, { kind: "tool_call" }>;
export type ToolResult = Extract<TranscriptPart, { kind: "tool_result" }>;

/** 一轮的 id 怎么比：对话里是字符串，`TurnView` 里是数 */
export const idKey = (id: string | number): string => String(id);

/**
 * 会话详情的轮次按请求 id 排成表，对话的每一轮用自己的 id 来找（`idKey`）。**两边的 id
 * 类型不一样**：`TranscriptTurn.id` 是字符串，`TurnView.id` 是数。直接拿数当键的话，
 * 一轮也对不上，轮次头上就没有时刻、模型和费用。
 */
export function viewsById(turns: readonly TurnView[]): Map<string, TurnView> {
  return new Map(turns.map((v) => [idKey(v.id), v]));
}

/**
 * core 说没有这次会话：它的轮次还一轮都没落库（第一轮还在跑）。会话详情和对话都这样答，
 * 这不是读取失败。
 */
export function unrecorded(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "control.session_not_found";
}

/** 这一轮的结局，和会话瀑布同一套说法 */
export type Outcome = "done" | "failed" | "cancelled";

export function outcomeOf(v: TurnView | undefined): Outcome {
  if (!v) return "done";
  return v.error ? "failed" : v.cancelled ? "cancelled" : "done";
}

/** 打开请求详情用的 id：库里那一轮的，没有就按对话里的那个读 */
export function requestIdOf(id: string, v: TurnView | undefined): number | null {
  if (v) return v.id;
  const n = Number(id);
  return id.trim() !== "" && Number.isSafeInteger(n) ? n : null;
}

/** 只有空白的正文不画：画出来是一个空段落 */
export function visibleParts(parts: readonly TranscriptPart[]): TranscriptPart[] {
  return parts.filter((p) => p.kind !== "text" || p.text.trim() !== "");
}

/**
 * 画出来的一块：一个角色说的几段，或者几条工具结果。
 *
 * **工具结果单独成块，不跟着消息的角色走。**Anthropic 把结果放在 `user` 消息里，OpenAI
 * 放在 `tool` 消息里 —— 都标成「用户」的话，读的人会以为那是人打的字。结果那一行自己
 * 写着是谁的结果（「Read 的结果」），所以块上不再标角色。
 *
 * 相邻的、同一个角色的几段并成一块：一条消息里的几段，或者连着的两条同角色消息。
 */
export type Block =
  | { kind: "said"; role: TranscriptRole; parts: TranscriptPart[] }
  | { kind: "results"; parts: ToolResult[] };

export function blocksOf(messages: readonly TranscriptMessage[]): Block[] {
  const out: Block[] = [];
  for (const m of messages) {
    for (const p of visibleParts(m.parts)) {
      const last = out[out.length - 1];
      if (p.kind === "tool_result") {
        if (last?.kind === "results") last.parts.push(p);
        else out.push({ kind: "results", parts: [p] });
      } else if (last?.kind === "said" && last.role === m.role) {
        last.parts.push(p);
      } else {
        out.push({ kind: "said", role: m.role, parts: [p] });
      }
    }
  }
  return out;
}

/**
 * 历史重新开始的那一轮（`restart`），`input` 是它带着的整段历史。**收起的是模型上一次
 * 开口为止的那一段**，之后的才是这一轮新加的：工具结果、用户新说的话。
 *
 * 按最后一条助手消息切，不按「最后一条消息」切：OpenAI 的格式里几条工具结果是几条
 * 消息，只留最后一条会漏掉前面的。历史里一条助手消息都没有（压缩成了一段摘要）时
 * 不收起：那一段本身就是这一轮的输入。
 */
export function splitRestart(input: readonly TranscriptMessage[]): {
  earlier: TranscriptMessage[];
  latest: TranscriptMessage[];
} {
  let last = -1;
  input.forEach((m, i) => {
    if (m.role === "assistant") last = i;
  });
  return { earlier: input.slice(0, last + 1), latest: input.slice(last + 1) };
}

/**
 * 每个工具调用的 id 对应的工具名。结果那一行写「Read 的结果」靠它：结果里只有调用的
 * id，调用在上一轮的回答里（历史重新开始的那一轮，也可能在它自己带着的历史里）。
 */
export function toolNames(turns: readonly TranscriptTurn[]): Map<string, string> {
  const names = new Map<string, string>();
  const add = (parts: readonly TranscriptPart[]) => {
    for (const p of parts) if (p.kind === "tool_call") names.set(p.id, p.name);
  };
  for (const t of turns) {
    for (const m of t.input) add(m.parts);
    add(t.output);
  }
  return names;
}

/**
 * 这一轮没有对话内容：不生成回答的调用（数 token、压缩上下文）—— 没有新消息、没有回答、
 * 也没有缺口。界面上只画一行头，不画「什么都没有」的正文。
 */
export function quiet(t: TranscriptTurn): boolean {
  return (
    !t.restart &&
    t.system_changed === null &&
    t.gaps.length === 0 &&
    visibleParts(t.output).length === 0 &&
    t.input.every((m) => visibleParts(m.parts).length === 0)
  );
}

const DAY_MS = 86_400_000;

/**
 * 一轮的正文为什么不在。core 只说缺了（`request_missing`、`response_missing`），不说为什么，
 * 而两种原因是两种说法：
 *
 * · `expired`：早于报文的保留期限（`retention.body_days`），按期删除了。
 * · `unkept`：期限之内也没有，是没有保留下来 —— 报文超出总量上限时从最早的一天删起，不等
 *   期限；写盘跟不上时 core 宁可丢下也不让请求等；期限改长之前删掉的也回不来。这些说
 *   「已超过保留期限」是错的。
 */
export type Missing = "expired" | "unkept";

/**
 * 按这一轮的时刻（`TurnView.at_ms`）和报文的保留天数判断。**有一样不知道就不下结论**（会话
 * 详情里还没有这一轮、概览没有取到）：「未保留」在两种情况下都成立，「已超过保留期限」不一定。
 */
export function missingWhy(at: number | null, bodyDays: number | null, now: number): Missing {
  return at !== null && bodyDays !== null && now - at > bodyDays * DAY_MS ? "expired" : "unkept";
}

/** 这一轮什么都显示不出来：请求和响应的正文都不在 */
export function lost(t: TranscriptTurn): boolean {
  return (
    t.gaps.includes("request_missing") &&
    t.gaps.includes("response_missing") &&
    t.input.length === 0 &&
    t.output.length === 0 &&
    t.system_changed === null
  );
}

/**
 * 要画的一项：一轮，或者连着好几轮什么都显示不出来 —— 那几轮并成一行。
 *
 * 保留期限按时间算，跨过界线的会话前面一截全是空的：一轮一个「已超过保留期限」，
 * 几十行一模一样的话把能看的那几轮挤到了后面。只有一轮的不并：单独一轮照样有它的头。
 * **原因不同的不并**（`why`，见 `Missing`）：一行只说一种原因。
 *
 * `n` 是第几轮，从 1 数起。对话里的轮次和会话详情的是同一批、同一个顺序，所以和
 * 「每轮费用」里的序号对得上。
 */
export type Item =
  | { kind: "turn"; turn: TranscriptTurn; n: number }
  | { kind: "lost"; from: number; to: number; why: Missing; key: string };

export function items(turns: readonly TranscriptTurn[], why: (t: TranscriptTurn) => Missing): Item[] {
  const out: Item[] = [];
  let i = 0;
  while (i < turns.length) {
    const first = turns[i]!;
    const reason = lost(first) ? why(first) : null;
    let j = i + 1;
    while (reason !== null && j < turns.length && lost(turns[j]!) && why(turns[j]!) === reason) j++;
    if (reason !== null && j - i >= 2) {
      out.push({ kind: "lost", from: i + 1, to: j, why: reason, key: `lost:${first.id}` });
      i = j;
    } else {
      out.push({ kind: "turn", turn: first, n: i + 1 });
      i++;
    }
  }
  return out;
}

/**
 * 整次会话什么都显示不出来时，说哪一种原因：每一轮都过了保留期限才说过了期限，否则说
 * 未保留。不是整次都这样的是 `null`。
 */
export function allLost(turns: readonly TranscriptTurn[], why: (t: TranscriptTurn) => Missing): Missing | null {
  if (turns.length === 0 || !turns.every(lost)) return null;
  return turns.every((t) => why(t) === "expired") ? "expired" : "unkept";
}

/**
 * 一轮里显示不出来的部分，写成哪几句话、写在哪儿（请求的写在输入前面，响应的写在
 * 回答后面）。
 *
 * · 正文不在的，按 `why` 说已超过保留期限还是未保留（见 `Missing`）。请求和响应都不在，
 *   并成一句。
 * · **失败的、客户端先断开的，说的是结局，不是缺口**：没有响应是因为根本没有，不是
 *   正文没有留下 —— 写失败的原因。回答写了一半就断的，也要在那一半后面说一句，不然
 *   读起来像是模型话说到一半自己停了。
 */
export type Note =
  | "expired"
  | "unkept"
  | "request_expired"
  | "request_unkept"
  | "request_truncated"
  | "response_expired"
  | "response_unkept"
  | "response_failed"
  | "response_cancelled"
  | "response_truncated"
  | "response_unreadable";

export function notesOf(t: TranscriptTurn, outcome: Outcome, why: Missing): { request: Note[]; response: Note[] } {
  const has = (g: TranscriptGap) => t.gaps.includes(g);
  const expired = why === "expired";
  if (has("request_missing") && has("response_missing")) return { request: [expired ? "expired" : "unkept"], response: [] };
  const request: Note[] = [];
  if (has("request_missing")) request.push(expired ? "request_expired" : "request_unkept");
  if (has("request_truncated")) request.push("request_truncated");
  const response: Note[] = [];
  if (outcome === "failed") response.push("response_failed");
  else if (outcome === "cancelled") response.push("response_cancelled");
  else if (has("response_missing")) response.push(expired ? "response_expired" : "response_unkept");
  if (has("response_truncated")) response.push("response_truncated");
  if (has("response_unreadable")) response.push("response_unreadable");
  return { request, response };
}

/**
 * 工具调用收起时那一行的提要。**参数里第一个非空的字符串**：多半就是那个最说明问题的值
 * —— 路径、命令、搜索词。不按工具名挑字段：工具是客户端自己定义的，挑不完。字符串数组
 * （OpenAI 的 shell 把命令拆成几段）连成一行。都没有就把 JSON 压成一行。
 *
 * 只看开头一截：Write 的参数里是整个文件，没必要整段处理。
 */
export function argsPreview(input: string, max = 160): string {
  let v: unknown;
  try {
    v = JSON.parse(input);
  } catch {
    return oneLine(input, max);
  }
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const values = Object.values(v);
    if (values.length === 0) return "";
    for (const x of values) {
      if (typeof x === "string" && x.trim() !== "") return oneLine(x, max);
      if (Array.isArray(x) && x.length > 0 && x.every((s) => typeof s === "string")) return oneLine(x.join(" "), max);
    }
  }
  return oneLine(JSON.stringify(v), max);
}

function oneLine(s: string, max: number): string {
  const flat = s.slice(0, max * 4).replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * 长文本先显示开头。返回开头那一截；不用截就返回 `null`。
 *
 * **超过上限一半以上才截**：只多出几行的也收起来，点开看到的就是那几行，白点一下。
 * 截的时候按字数和行数取短的那个；切在一行中间时，往回退到最近的换行（不退太远）。
 */
export function clip(text: string, limit: { chars: number; lines: number }): string | null {
  const lineCap = Math.ceil(limit.lines * 1.5);
  if (text.length <= limit.chars * 1.5 && !hasMoreLines(text, lineCap)) return null;
  let end = Math.min(text.length, limit.chars);
  // 第 `lines` 行的行尾
  let at = -1;
  for (let i = 0; i < limit.lines; i++) {
    at = text.indexOf("\n", at + 1);
    if (at < 0 || at >= end) break;
    if (i === limit.lines - 1) end = at;
  }
  const nl = text.lastIndexOf("\n", end);
  if (end < text.length && text.charAt(end) !== "\n" && nl > end * 0.7) end = nl;
  // 不把一个字拆成两半（代理对）
  const c = text.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

/** 换行多于 `n` 个。数到 `n` 就停：一个几 MB 的结果不用整段数完 */
function hasMoreLines(text: string, n: number): boolean {
  let at = -1;
  for (let i = 0; i <= n; i++) {
    at = text.indexOf("\n", at + 1);
    if (at < 0) return false;
  }
  return true;
}

/**
 * 一轮的指纹，用来判断重新取回来的这一轮是不是还是原来那一份。
 *
 * **落了库的一轮不会改写**：会变的只有「还在不在、全不全」—— 过了保留期限，内容没了、
 * 缺口多了；历史重新开始、系统提示是否变了，是相对上一条可读的那一轮说的，前面的轮次
 * 没了它也会跟着变。所以比这几样和各段的长度，不逐字比正文。
 */
function signature(t: TranscriptTurn): string {
  let parts = 0;
  let size = 0;
  const count = (ps: readonly TranscriptPart[]) => {
    for (const p of ps) {
      parts += 1;
      size += partSize(p);
    }
  };
  for (const m of t.input) count(m.parts);
  count(t.output);
  return [t.restart ? 1 : 0, t.system_changed?.length ?? -1, t.gaps.join(","), t.input.length, parts, size].join("|");
}

function partSize(p: TranscriptPart): number {
  switch (p.kind) {
    case "text":
    case "thinking":
      return p.text.length;
    case "tool_call":
      return p.name.length + p.input.length;
    case "tool_result":
      return p.text.length + (p.is_error ? 1 : 0);
    case "image":
      return p.bytes ?? 0;
    case "other":
      return p.label.length;
  }
}

/**
 * 重新取回来的对话里，**没变的轮次换回原来那个对象**。
 *
 * 会话还在进行时，每落一轮就重取一次整段对话；回来的每一轮都是新对象，按引用比较的
 * 话几百轮一起重画，而真正新的只有末尾那一轮。整段都没变就返回原来那一份。
 */
export function keepTurns(prev: Transcript | undefined, next: Transcript): Transcript {
  if (!prev || prev.session !== next.session) return next;
  const old = new Map(prev.turns.map((t) => [t.id, t]));
  let same = prev.system === next.system && prev.turns.length === next.turns.length;
  const turns = next.turns.map((t, i) => {
    const o = old.get(t.id);
    if (o && signature(o) === signature(t)) {
      if (prev.turns[i] !== o) same = false;
      return o;
    }
    same = false;
    return t;
  });
  return same ? prev : { ...next, turns };
}
