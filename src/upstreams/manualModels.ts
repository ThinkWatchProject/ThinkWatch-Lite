/**
 * 手动添加的模型：上游能服务、却没有列进模型列表的模型（配置里这一家的 `models`）。
 * core 把它们和上游列出的合在一起，一样出现在客户端的模型列表里、一样路由到这家。
 *
 * 这里是添加对话框当场校验的那几条，和 core 的 `check_manual_models` 是同一套：
 * 不空、不带通配、不超过 `MANUAL_MODEL_MAX` 个字符、不重复。另外两条是界面自己的：
 * 已经手动添加过的、上游已经列出的，加了也不改变什么，当场说。
 */

/** 一个模型 ID 最多多少个字符，和 core 的 `MANUAL_MODEL_MAX` 一致 */
export const MANUAL_MODEL_MAX = 256;

/** 一条输入的毛病。`id` 是出毛病的那一个 */
export type ManualProblem =
  | { kind: "blank" }
  | { kind: "wildcard"; id: string }
  | { kind: "tooLong"; id: string }
  | { kind: "duplicate"; id: string }
  | { kind: "added"; id: string }
  | { kind: "listed"; id: string };

/**
 * 输入框里的一段字拆成模型 ID：按空白和逗号分开。**一次粘贴几个**是常事（从文档里抄一串），
 * 而模型 ID 里没有空白和逗号。
 */
export function splitIds(raw: string): string[] {
  return raw
    .split(/[\s,，]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 把输入里的模型加进待添加的名单。写得对的照样加进去；有毛病的留在输入框里，说第一个
 * 毛病。全是空白（按了回车却什么都没写）也说一声。
 *
 * - `drafts`：这次已经要添加的；
 * - `manual`：之前手动添加过的；
 * - `listed`：上游自己列出的。
 */
export function addIds(
  raw: string,
  ctx: { drafts: readonly string[]; manual: readonly string[]; listed: readonly string[] },
): { drafts: string[]; rest: string; problem: ManualProblem | null } {
  const ids = splitIds(raw);
  if (ids.length === 0) return { drafts: [...ctx.drafts], rest: "", problem: { kind: "blank" } };
  const drafts = [...ctx.drafts];
  const rest: string[] = [];
  let problem: ManualProblem | null = null;
  for (const id of ids) {
    const p = problemOf(id, drafts, ctx);
    if (p) {
      rest.push(id);
      problem ??= p;
    } else {
      drafts.push(id);
    }
  }
  return { drafts, rest: rest.join(" "), problem };
}

function problemOf(
  id: string,
  drafts: readonly string[],
  ctx: { manual: readonly string[]; listed: readonly string[] },
): ManualProblem | null {
  if ([...id].length > MANUAL_MODEL_MAX) return { kind: "tooLong", id };
  if (/[*?]/.test(id)) return { kind: "wildcard", id };
  if (drafts.includes(id)) return { kind: "duplicate", id };
  if (ctx.manual.includes(id)) return { kind: "added", id };
  if (ctx.listed.includes(id)) return { kind: "listed", id };
  return null;
}
