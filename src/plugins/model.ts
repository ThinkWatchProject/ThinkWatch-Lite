/**
 * 插件页的纯逻辑：权限分成请求和回答两头、处理哪几种请求、适用范围的通配、插件 ID、要不要
 * 在系统的确认框里点头、文本里看不见的字符。没有界面，测试在 `model.test.ts`。
 */
import type { HistoryRow, ManifestView, Permission, PluginScope, PluginView, RequestKind } from "@/types";

/** 插件申请的权限。**这张表的顺序就是界面上列权限的顺序**（和 core 的 `Permission::ALL` 一样） */
export const PERMISSIONS: readonly Permission[] = [
  "system",
  "messages",
  "tools",
  "params",
  "reply_text",
  "reply_tool_calls",
];

/** 改请求的那几项权限：有其中之一，插件就有请求钩子 */
const REQUEST_PERMISSIONS: readonly Permission[] = ["system", "messages", "tools", "params"];
/** 改回答的那两项 */
const REPLY_PERMISSIONS: readonly Permission[] = ["reply_text", "reply_tool_calls"];

export const touchesRequests = (perms: readonly Permission[]) => perms.some((p) => REQUEST_PERMISSIONS.includes(p));
export const touchesReplies = (perms: readonly Permission[]) => perms.some((p) => REPLY_PERMISSIONS.includes(p));

/** 几种请求，按 core 的 `RequestKind::ALL` 的顺序 */
export const REQUEST_KINDS: readonly RequestKind[] = ["conversation", "embeddings", "completions"];

/**
 * 除了对话还处理的那几种（「也处理：向量化、补全」），和对话本身在不在里面。**只处理对话的
 * （出厂就是这样）是 `null`**：那一行不必出现
 */
export function extraKinds(kinds: readonly RequestKind[]): { extra: RequestKind[]; withConversation: boolean } | null {
  const extra = REQUEST_KINDS.filter((k) => k !== "conversation" && kinds.includes(k));
  return extra.length > 0 ? { extra, withConversation: kinds.includes("conversation") } : null;
}

/**
 * core 那边读不出这个插件的 manifest（停用着、显示用的缓存又没有它）：名字就是 id，权限、
 * 设置项都是空的。**这时只画 id 和状态** —— 没有权限的标签，不是「没申请权限」，是不知道
 */
export const manifestUnknown = (p: Pick<PluginView, "permissions">) => p.permissions.length === 0;

/**
 * 改得了回答里的工具调用：权限里有 `reply_tool_calls`（改得了客户端要执行的命令），或者
 * **读不出权限**（空的、不知道 —— core 按改得了算）。
 */
export const holdsToolCalls = (perms: readonly Permission[] | null | undefined): boolean =>
  !perms || perms.length === 0 || perms.includes("reply_tool_calls");

/**
 * 两份 manifest 除了数据（出错时、适用范围、设置项的值）之外有没有不一样：名字、说明、
 * 权限、处理的请求种类、回答的方式、导出的钩子、设置项的键、类型和标签。**不一样就一定是
 * 改了代码**（core 的「只改了数据」要求这些全都一样）；一样的不一定没改代码 —— manifest
 * 以外的代码界面比不出来，交给 core 判断。
 */
export function shapeChanged(a: ManifestView, b: ManifestView): boolean {
  const set = (xs: readonly string[]) => [...new Set(xs)].sort().join("\n");
  const settings = (m: ManifestView) => JSON.stringify(m.settings_schema.map((s) => [s.key, s.kind, s.label]));
  return (
    a.name !== b.name ||
    (a.description ?? null) !== (b.description ?? null) ||
    set(a.permissions) !== set(b.permissions) ||
    set(a.requests) !== set(b.requests) ||
    a.reply_mode !== b.reply_mode ||
    a.hooks.request !== b.hooks.request ||
    a.hooks.reply_text !== b.hooks.reply_text ||
    a.hooks.tool_call !== b.hooks.tool_call ||
    settings(a) !== settings(b)
  );
}

/**
 * 保存时要不要**直接**请 Rust 弹系统的确认框（约定附录 4 §3）：插件改得了工具调用（原来的
 * 或者新的代码里），而这次要打开它，或者一定改了代码。
 *
 * 只有界面确定要点头时才直接去：省下一次注定被拒的请求。确定不了的（代码在 manifest 以外
 * 改了没有，界面看不出来）照常走网页那条 —— core 说要点头（403）再请 Rust，见 `write.ts`。
 */
export function saveAsks(x: {
  /** 确认过的那一版的权限。读不出来是 `null` */
  old: readonly Permission[] | null;
  /** 这次的代码的权限 */
  next: readonly Permission[] | null;
  turningOn: boolean;
  /** 一定改了代码（`shapeChanged`，或者确认过的那一版读不出来而代码不一样） */
  codeChanged: boolean;
}): boolean {
  return (holdsToolCalls(x.old) || holdsToolCalls(x.next)) && (x.turningOn || x.codeChanged);
}

/** 一条记录下来的请求发给上游的模型：路由规则改写过的，按回答的那一跳发出的名字 */
export function sentModel(r: { model: string; routing?: HistoryRow["routing"] }): string {
  const hops = r.routing?.attempts ?? [];
  return hops[hops.length - 1]?.model ?? r.model;
}

/** 适用范围的三项，按界面上的顺序 */
export const SCOPE_PARTS = ["clients", "models", "upstreams"] as const;
export type ScopePart = (typeof SCOPE_PARTS)[number];

/**
 * 一条通配规则对不对得上：`*` 是任意一段（可以为空），别的字符原样比。
 *
 * **只给界面用**：挑「最近哪几条请求在范围内」（试运行的候选），列出一条通配对得上的已知
 * 名字（适用范围的建议）。不决定插件跑不跑 —— 那是 core 的事，这里写错了顶多是候选的
 * 排序、建议的多少不对。
 */
export function globMatch(pattern: string, value: string): boolean {
  const parts = pattern.split("*");
  if (parts.length === 1) return pattern === value;
  const first = parts[0]!;
  const last = parts[parts.length - 1]!;
  if (!value.startsWith(first) || value.length < first.length + last.length || !value.endsWith(last)) return false;
  let at = first.length;
  const end = value.length - last.length;
  for (const mid of parts.slice(1, -1)) {
    if (mid === "") continue;
    const i = value.indexOf(mid, at);
    if (i < 0 || i + mid.length > end) return false;
    at = i + mid.length;
  }
  return true;
}

/** 一项名单（空 = 全部）对不对得上这几个值里的任何一个。不分大小写，和 core 一样 */
function partMatches(list: readonly string[], values: readonly (string | null | undefined)[]): boolean {
  if (list.length === 0) return true;
  return list.some((p) => values.some((v) => v != null && v !== "" && globMatch(p.toLowerCase(), v.toLowerCase())));
}

/**
 * 一条记录下来的请求在不在插件的适用范围里。客户端按密钥名和推测出的应用都比
 * （记录上两样都有，插件看到的 `ctx.client` 是其中之一）；模型按发给上游的那个比（路由
 * 改写过的按改写之后的），上游按回答的那一家比 —— 和 core 一样，请求和回答都按它。
 */
export function requestInScope(
  scope: PluginScope,
  r: { client: string; client_hint?: string | null; model: string; provider: string; routing?: HistoryRow["routing"] },
): boolean {
  return (
    partMatches(scope.clients, [r.client, r.client_hint]) &&
    partMatches(scope.models, [sentModel(r)]) &&
    partMatches(scope.upstreams, [r.provider])
  );
}

/** 插件文件的上限，和 core 一样 */
export const MAX_SOURCE = 1024 * 1024;

/** 插件 ID 的写法，和 core 一样：小写字母、数字、连字符，1 到 40 个 */
export const ID_RE = /^[a-z0-9-]{1,40}$/;

/** 不能当插件 ID 的词，和 core 一样：控制面上 `/plugins/` 底下固定的几个端点 */
export const RESERVED_IDS: readonly string[] = ["order", "inspect", "rewrite", "confirmed"];

/** 新插件的 ID 哪里不对：写法、保留词、和已有的重名。能用是 `null` */
export function idProblem(id: string, taken: readonly string[]): "bad" | "reserved" | "taken" | null {
  if (!ID_RE.test(id)) return "bad";
  if (RESERVED_IDS.includes(id)) return "reserved";
  if (taken.includes(id)) return "taken";
  return null;
}

/**
 * 新插件的 ID：先按文件名，再按插件名，都拼不出来就是 `plugin`；是保留词的接 `-plugin`（和
 * core 一样），和已有的重名就接 `-2`、`-3`。
 *
 * **默认值要写在输入框里**，不能留空让 core 去起：留空的话界面上看到的是一个空格子，
 * 装上之后配置里却是另一个名字。
 */
export function suggestId(name: string, fileName: string | null, taken: readonly string[]): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/\.m?js$/, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36)
      .replace(/-+$/, "");
  const found = (fileName && slug(fileName)) || slug(name) || "plugin";
  const base = RESERVED_IDS.includes(found) ? `${found}-plugin` : found;
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

/**
 * 读起来看不见、却会改变代码意思的字符：零宽字符、双向文本的控制符（「Trojan Source」
 * 那一类：让一段代码看起来和实际执行的不一样）、BOM。审核代码和对比改动时把它们
 * 标出来。
 */
export const INVISIBLE = /[\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/** 一段文字按看不见的字符切开：`{ text }` 原样画，`{ code }` 画成一个标记 */
export function splitInvisible(s: string): ({ text: string } | { code: string })[] {
  const out: ({ text: string } | { code: string })[] = [];
  let last = 0;
  for (const m of s.matchAll(INVISIBLE)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: s.slice(last, i) });
    out.push({ code: `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}` });
    last = i + m[0].length;
  }
  if (last < s.length || out.length === 0) out.push({ text: s.slice(last) });
  return out;
}

/** 平均 CPU 时间写成毫秒：一位小数，不到 0.1 毫秒另说 */
export function cpuMs(us: number): string | null {
  if (us < 100) return null;
  return (us / 1000).toLocaleString(undefined, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
}

/** SHA-256 的前 16 位，四个一组：对话框里和系统对话框里写的是同一段 */
export function shaPrefix(hex: string): string {
  return (hex.slice(0, 16).match(/.{1,4}/g) ?? []).join(" ");
}
