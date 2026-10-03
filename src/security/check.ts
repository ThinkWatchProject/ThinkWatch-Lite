/**
 * 规则对话框里两种写法的当场校验：码位、占位符名称。
 *
 * **保存时 core 还会再查一遍**，那一遍说了算；这里只是让写错的地方在敲完的那一刻就看得见，
 * 不用等点了保存再回来改。写法照接口约定：
 *
 * - 码位：若干项，用逗号、顿号或空白分隔；每项 `U+HEX` 或 `U+HEX-U+HEX`（短横线或 `–`，
 *   `u+` 不分大小写），十六进制 1–6 位，在 0–10FFFF 之内、不是代理区，起点不大于终点；
 *   最多 32 项。
 * - 占位符名称：大写字母开头，只有大写字母、数字和下划线，最多 24 个字符。
 */

/** 码位一次最多写几项 */
export const MAX_CODEPOINT_ITEMS = 32;

export type CodepointsProblem =
  /** 一项都没有（只有分隔符） */
  | { kind: "empty" }
  /** 这一项不是 `U+HEX` 或 `U+HEX–U+HEX` */
  | { kind: "syntax"; item: string }
  /** 超过 U+10FFFF */
  | { kind: "range"; item: string }
  /** 落在代理区（U+D800–U+DFFF） */
  | { kind: "surrogate"; item: string }
  /** 起点大于终点 */
  | { kind: "order"; item: string }
  /** 超过 32 项 */
  | { kind: "count" };

const ITEM = /^u\+([0-9a-f]{1,6})(?:[-–]u\+([0-9a-f]{1,6}))?$/i;
const SEPARATORS = /[\s,，、]+/;

/** 码位写得对不对。对的话是 `null`，不对的话是第一处错 */
export function checkCodepoints(text: string): CodepointsProblem | null {
  const items = text.split(SEPARATORS).filter((s) => s.length > 0);
  if (items.length === 0) return { kind: "empty" };
  if (items.length > MAX_CODEPOINT_ITEMS) return { kind: "count" };
  for (const item of items) {
    const m = ITEM.exec(item);
    if (!m) return { kind: "syntax", item };
    const from = parseInt(m[1]!, 16);
    const to = m[2] === undefined ? from : parseInt(m[2], 16);
    if (from > 0x10ffff || to > 0x10ffff) return { kind: "range", item };
    if (surrogate(from) || surrogate(to)) return { kind: "surrogate", item };
    if (from > to) return { kind: "order", item };
  }
  return null;
}

const surrogate = (n: number) => n >= 0xd800 && n <= 0xdfff;

const LABEL = /^[A-Z][A-Z0-9_]{0,23}$/;

/** 占位符名称写得对不对 */
export function labelOk(label: string): boolean {
  return LABEL.test(label);
}

/** 占位符名称不写时的那一个。**界面上显式填在框里**，不留空 */
export const DEFAULT_LABEL = "SECRET";

/** 第一个占位符长什么样：`<<TW_SECRET_1>>` */
export const placeholderOf = (label: string) => `<<TW_${label}_1>>`;
