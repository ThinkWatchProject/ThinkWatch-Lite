/**
 * 插件页的纯逻辑：权限分成请求和回答两头、适用范围的通配、插件 ID、文本里看不见的字符。
 * 没有界面，测试在 `model.test.ts`。
 */
import type { Permission, PluginScope } from "./api.provisional";

/** 改请求的那几项权限：有其中之一，插件就有请求钩子 */
const REQUEST_PERMISSIONS: readonly Permission[] = ["system", "messages", "tools", "params"];
/** 改回答的那两项 */
const REPLY_PERMISSIONS: readonly Permission[] = ["reply_text", "reply_tool_calls"];

export const touchesRequests = (perms: readonly Permission[]) => perms.some((p) => REQUEST_PERMISSIONS.includes(p));
export const touchesReplies = (perms: readonly Permission[]) => perms.some((p) => REPLY_PERMISSIONS.includes(p));

/** 适用范围的三项，按界面上的顺序 */
export const SCOPE_PARTS = ["clients", "models", "upstreams"] as const;
export type ScopePart = (typeof SCOPE_PARTS)[number];

export const EMPTY_SCOPE: PluginScope = { clients: [], models: [], upstreams: [] };

/**
 * 一条通配规则对不对得上：`*` 是任意一段（可以为空），别的字符原样比。
 *
 * **只给界面挑「最近哪几条请求在范围内」用**（试运行的候选），不决定插件跑不跑 ——
 * 那是 core 的事，这里写错了顶多是候选的排序不对。
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

/** 一项名单（空 = 全部）对不对得上这几个值里的任何一个 */
function partMatches(list: readonly string[], values: readonly (string | null | undefined)[]): boolean {
  if (list.length === 0) return true;
  return list.some((p) => values.some((v) => v != null && v !== "" && globMatch(p, v)));
}

/**
 * 一条记录下来的请求在不在插件的适用范围里。客户端按密钥名和推测出的应用都比
 * （记录上两样都有，插件看到的 `ctx.client` 是其中之一）；上游只约束回答，
 * 试运行两头都跑，所以也比。
 */
export function requestInScope(
  scope: PluginScope,
  r: { client: string; client_hint?: string | null; model: string; provider: string },
): boolean {
  return (
    partMatches(scope.clients, [r.client, r.client_hint]) &&
    partMatches(scope.models, [r.model]) &&
    partMatches(scope.upstreams, [r.provider])
  );
}

/** 插件 ID 的写法，和 core 一样：小写字母、数字、连字符，1 到 40 个 */
export const ID_RE = /^[a-z0-9-]{1,40}$/;

/**
 * 新插件的 ID：先按文件名，再按插件名，都拼不出来就是 `plugin`，和已有的重名就接 `-2`、`-3`。
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
  const base = (fileName && slug(fileName)) || slug(name) || "plugin";
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
