/**
 * 「在配置文件中定位」：在 config.yaml 的原文里找到某一段下叫某个名字的那一项。
 *
 * **名字只在自己那一段里才唯一。**密钥、路由、策略组、上游各是一张表，同名是常事：
 * 一把叫 `codex` 的密钥用着一条叫 `codex` 的路由，路由里还有一条叫 `gemini` 的规则
 * 挨着叫 `gemini` 的上游。以前全文找第一个 `name: X`，点路由的「定位」选中的是
 * 那把密钥；`name: code` 还会停在 `name: codex` 上。所以先找到顶层的那一段，只看
 * 它的直接成员，名字按整个值比（引号里的写法也认）。
 *
 * 不是 YAML 解析器，只认配置里的块式写法（`- name: X`，名字不在第一行也行，`- {name: X}`
 * 也行）。**认不出就不猜**：那一段在，选中它的标题行；那一段都没有，就什么都不选。
 * 选错一项比不选更糟 —— 用户会以为改的是这一项。
 */

/** 配置里按名字列出来的几张表：顶层的键 */
export type ConfigSection = "clients" | "providers" | "proxies" | "groups" | "routes";

/** 打开配置文件时要选中的那一项 */
export interface ConfigFocus {
  section: ConfigSection;
  name: string;
}

interface Line {
  start: number;
  /** 这一行的内容到哪儿为止（不含换行符） */
  end: number;
  /** 下一行从哪儿开始（含换行符） */
  next: number;
  text: string;
}

function linesOf(text: string): Line[] {
  const out: Line[] = [];
  const re = /\r\n?|\n/g;
  let start = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ start, end: m.index, next: m.index + m[0].length, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  out.push({ start, end: text.length, next: text.length, text: text.slice(start) });
  // 文件开头的 BOM 不算缩进
  out[0]!.text = out[0]!.text.replace(/^﻿/, "");
  return out;
}

const indentOf = (s: string) => s.length - s.trimStart().length;
const blank = (s: string) => s.trim() === "";
const comment = (s: string) => s.trimStart().startsWith("#");
/** 序列里的一项：`-` 后面是空格或行尾（`---` 不是） */
const DASH = /^(\s*)-(?:(\s+)(.*))?$/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** `key:`、`"key":`、`'key':`，后面是值 */
const keyRe = (key: string) => new RegExp(`^(?:${escape(key)}|"${escape(key)}"|'${escape(key)}')\\s*:(?:\\s+(.*))?$`);
const NAME = keyRe("name");

/**
 * 块里写的一个标量的值：`X`、`"X"`、`'X'`，后面可以跟注释。认不出（跨行、没收尾的
 * 引号）是 null
 */
function scalarOf(raw: string): string | null {
  const s = raw.trim();
  const quote = s[0];
  if (quote === '"' || quote === "'") {
    let out = "";
    let i = 1;
    for (; i < s.length; i++) {
      const c = s[i]!;
      if (quote === '"' && c === "\\" && i + 1 < s.length) {
        const n = s[++i]!;
        out += n === "n" ? "\n" : n === "t" ? "\t" : n;
        continue;
      }
      if (c === quote) {
        // 单引号里两个单引号是一个
        if (quote === "'" && s[i + 1] === "'") {
          out += "'";
          i += 1;
          continue;
        }
        break;
      }
      out += c;
    }
    if (i >= s.length) return null;
    const rest = s.slice(i + 1).trim();
    return rest === "" || rest.startsWith("#") ? out : null;
  }
  // 不带引号的：` #` 起是注释
  const hash = s.search(/\s#/);
  return (hash >= 0 ? s.slice(0, hash) : s).trim();
}

/** `{name: X, …}` 这种写在一行里的一项，它的 name */
function flowNameOf(s: string): string | null {
  const m = /(?:^\{|,)\s*(?:name|"name"|'name')\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^,}]*)/.exec(s.trim());
  return m ? scalarOf(m[1]!) : null;
}

/**
 * `section` 那一段下叫 `name` 的那一项在 `text` 里的区间：字符下标，从那一项的 `-`
 * 所在行的行首，到它最后一行（不算末尾的空行）的换行符之后。
 *
 * 那一段里找不到这一项：选中那一段的标题行。连那一段都没有：null。
 */
export function locateEntry(text: string, { section, name }: ConfigFocus): [number, number] | null {
  const lines = linesOf(text);
  const header = keyRe(section);
  const h = lines.findIndex((l) => indentOf(l.text) === 0 && header.test(l.text.trimEnd()));
  if (h < 0) return null;
  const headerOnly: [number, number] = [lines[h]!.start, lines[h]!.next];
  // 标题行上直接写了值（`routes: [...]`、`routes: []`）：没有块式的成员可找
  const inline = header.exec(lines[h]!.text.trimEnd())?.[1];
  if (inline !== undefined && !inline.startsWith("#")) return headerOnly;

  // 这一段到下一个顶层的键为止。顶格的 `- ` 还是这一段的成员（YAML 允许序列不缩进），
  // 顶格的注释不算结束
  let end = lines.length;
  for (let i = h + 1; i < lines.length; i++) {
    const s = lines[i]!.text;
    if (blank(s) || comment(s) || indentOf(s) > 0 || DASH.test(s)) continue;
    end = i;
    break;
  }

  // 成员的 `-` 在第几列：以第一个成员为准
  const first = lines.slice(h + 1, end).findIndex((l) => !blank(l.text) && !comment(l.text));
  if (first < 0) return headerOnly;
  const firstDash = DASH.exec(lines[h + 1 + first]!.text);
  if (!firstDash) return headerOnly;
  const col = firstDash[1]!.length;

  for (let i = h + 1 + first; i < end; ) {
    const dash = DASH.exec(lines[i]!.text);
    if (!dash || dash[1]!.length !== col) {
      i += 1;
      continue;
    }
    // 这一项到下一个缩进不超过 `-` 的非空行为止（下一项、它前面的注释、下一段）
    let stop = i + 1;
    while (stop < end && (blank(lines[stop]!.text) || indentOf(lines[stop]!.text) > col)) stop += 1;
    if (nameOfItem(lines, i, stop, dash) === name) {
      let last = stop - 1;
      while (last > i && blank(lines[last]!.text)) last -= 1;
      return [lines[i]!.start, lines[last]!.next];
    }
    i = stop;
  }
  return headerOnly;
}

/** 从第 `at` 行起、到 `stop` 之前的这一项，它自己的 `name`（不是它里面更深一层的） */
function nameOfItem(lines: Line[], at: number, stop: number, dash: RegExpExecArray): string | null {
  const rest = dash[3] ?? "";
  if (rest.startsWith("{")) return flowNameOf(rest);
  const onDash = NAME.exec(rest.trimEnd());
  if (onDash) return onDash[1] === undefined ? null : scalarOf(onDash[1]);
  // 这一项的键从第几列起：`- ` 后面那一列；`-` 单独一行时看下一行
  let col = dash[1]!.length + 1 + (dash[2]?.length ?? 0);
  if (rest === "") {
    const next = lines.slice(at + 1, stop).find((l) => !blank(l.text) && !comment(l.text));
    if (!next) return null;
    col = indentOf(next.text);
  }
  for (let i = at + 1; i < stop; i++) {
    const s = lines[i]!.text;
    if (indentOf(s) !== col) continue;
    const m = NAME.exec(s.trim());
    if (m) return m[1] === undefined ? null : scalarOf(m[1]);
  }
  return null;
}
