/**
 * 配置文件的换行符。
 *
 * **CodeMirror 只管行的内容，不管行尾。**它按 `\r\n`、`\r`、`\n` 任何一种拆行，
 * `doc.toString()` 一律用 `\n` 接回去 —— 于是一份 CRLF 的 config.yaml 一打开就是
 * 「有未保存的修改」，外面每改一次都弹「文件已被修改」，传给 core 的字节偏移每行
 * 少一个字节，保存时整份文件变成 LF。所以行尾另记一份：每一个换行原来是什么，
 * 交出去的文本就接回什么。
 *
 * 规则：**每个换行保留它在文件里的样子**；新添的换行（回车、粘贴进来的）用文件里
 * 最多的那一种，一样多时用 `\n`。纯 CRLF、纯 LF 的文件逐字节不变；混着的文件（core
 * 按表单改一份 CRLF 的文件时，新加的行是 LF）没动过的地方也不变，保存时不会被
 * 统一改写。撤销一次删行，删掉的那几个换行按新添的算。
 *
 * **不用 `EditorState.lineSeparator`。**设成 `\r\n` 之后 CodeMirror 只认 `\r\n`：粘贴
 * 进来的 LF 文本会留在同一行里面，混着的文件也没法逐字节还原；而 `doc.toString()`
 * 照样用 `\n` 接。
 *
 * 这里只用 CodeMirror 的类型，不引它的代码：配置文件对话框之外用不到它（见 ConfigText）。
 */
import type { ChangeSet, Text } from "@codemirror/state";

/** 和 CodeMirror 拆行的规则一样（`\r\n`、单独的 `\r`、`\n`） */
const BREAK = /\r\n?|\n/g;

/** 文本里的每一个换行符，按先后。第 i 个在第 i+1 行的末尾 */
export function lineEndsOf(text: string): string[] {
  return text.match(BREAK) ?? [];
}

/** 新添的换行用哪一种：文件里最多的那一种；一样多（包括一个换行都没有）时用 `\n` */
export function dominantEnd(ends: readonly string[]): string {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (const e of ends) {
    if (e === "\r\n") crlf += 1;
    else if (e === "\n") lf += 1;
    else cr += 1;
  }
  if (crlf > lf && crlf >= cr) return "\r\n";
  if (cr > lf && cr > crlf) return "\r";
  return "\n";
}

/**
 * 编辑器改了一次之后的行尾：改动覆盖到的换行拿掉，改动里新添的换行用 `fallback`。
 *
 * `before` 是改动之前的文档 —— `changes` 里的位置是按它算的。
 */
export function mapEnds(ends: readonly string[], changes: ChangeSet, before: Text, fallback: string): string[] {
  const edits: { from: number; to: number; added: number }[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    edits.push({ from: before.lineAt(fromA).number, to: before.lineAt(toA).number, added: inserted.lines - 1 });
  });
  const out = [...ends];
  // **从后往前改。**第 n 行末尾的换行是第 n-1 个：后面的改动先做，前面的下标就不会错位
  for (let i = edits.length - 1; i >= 0; i--) {
    const { from, to, added } = edits[i]!;
    out.splice(from - 1, to - from, ...Array.from({ length: added }, () => fallback));
  }
  return out;
}

/** 编辑器里的文档接回文件里的样子 */
export function textOf(doc: Text, ends: readonly string[]): string {
  const lines = doc.toJSON();
  return lines.map((line, i) => (i === 0 ? line : (ends[i - 1] ?? "\n") + line)).join("");
}

const utf8 = new TextEncoder();

/**
 * 编辑器里的位置 `pos` 是文件的第几个字节。
 *
 * **core 按字节切，换行符有几个字节就算几个。**`sliceString` 把每个换行算成一个
 * `\n`；`\r\n` 多出来的那一个字节在这里补上（单独的 `\r` 和 `\n` 一样是一个字节）。
 */
export function byteOffsetAt(doc: Text, ends: readonly string[], pos: number): number {
  const line = doc.lineAt(pos).number;
  let crlf = 0;
  for (let i = 0; i < line - 1; i++) if (ends[i] === "\r\n") crlf += 1;
  return utf8.encode(doc.sliceString(0, pos, "\n")).length + crlf;
}

/**
 * 文件文本里的第 `offset` 个字符（JS 字符串下标）在编辑器里是哪个位置。
 *
 * 编辑器里一个换行只占一格，`\r\n` 在字符串里却是两个字符：它前面每有一个完整的
 * `\r\n`，位置就往前挪一格。
 */
export function docPosOf(text: string, offset: number): number {
  let pos = offset;
  for (let i = text.indexOf("\r\n"); i >= 0 && i + 2 <= offset; i = text.indexOf("\r\n", i + 2)) pos -= 1;
  return pos;
}
