import { EditorState, type ChangeSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { byteOffsetAt, docPosOf, dominantEnd, lineEndsOf, mapEnds, textOf } from "./lineEnds";

/**
 * 编辑器那一侧的样子：CodeMirror 按默认规则拆行（和 YamlEditor 一样，不设
 * `lineSeparator`），行尾另记。`edit` 做一次改动，返回接回去的文本。
 */
function editor(text: string) {
  let state = EditorState.create({ doc: text });
  let ends = lineEndsOf(text);
  const fallback = dominantEnd(ends);
  return {
    get state() {
      return state;
    },
    get ends() {
      return ends;
    },
    text: () => textOf(state.doc, ends),
    edit(changes: ChangeSpec) {
      const tr = state.update({ changes });
      ends = mapEnds(ends, tr.changes, tr.startState.doc, fallback);
      state = tr.state;
      return textOf(state.doc, ends);
    },
  };
}

const CRLF = "version: 1\r\nclients:\r\n  - name: 默认\r\n    key: tw-aaa\r\n";

describe("CRLF 的配置文件在编辑器里逐字节不变", () => {
  it("打开之后原样交回去 —— 不会一打开就是「有未保存的修改」", () => {
    const e = editor(CRLF);
    // 以前交回去的是 `doc.toString()`，每一行都少了 \r
    expect(e.text()).toBe(CRLF);
    expect(e.state.doc.toString()).not.toBe(CRLF);
  });

  it("加一行：新行也是 CRLF，别的行不动", () => {
    const e = editor(CRLF);
    const at = e.state.doc.line(4).to;
    expect(e.edit({ from: at, insert: "\n    route: 长上下文" })).toBe(
      "version: 1\r\nclients:\r\n  - name: 默认\r\n    key: tw-aaa\r\n    route: 长上下文\r\n",
    );
  });

  it("粘贴进来的 LF 文本按文件的换行符接", () => {
    const e = editor(CRLF);
    const at = e.state.doc.line(3).from;
    expect(e.edit({ from: at, insert: "  - name: a\n    key: tw-b\n" })).toBe(
      "version: 1\r\nclients:\r\n  - name: a\r\n    key: tw-b\r\n  - name: 默认\r\n    key: tw-aaa\r\n",
    );
  });

  it("跨行删除只拿掉删到的那几个换行", () => {
    const e = editor(CRLF);
    // 删掉第 2 行末尾到第 4 行开头：`clients:` 和 `    key` 之间的两个换行连同中间那一行
    expect(e.edit({ from: e.state.doc.line(2).to, to: e.state.doc.line(4).from })).toBe(
      "version: 1\r\nclients:    key: tw-aaa\r\n",
    );
  });

  it("一次改动里有好几处（多光标）也各自对得上", () => {
    const e = editor(CRLF);
    const l1 = e.state.doc.line(1);
    const l3 = e.state.doc.line(3);
    expect(
      e.edit([
        { from: l1.to, insert: "\n# 注释" },
        { from: l3.from, to: l3.to, insert: "  - name: 新\n    route: r" },
      ]),
    ).toBe("version: 1\r\n# 注释\r\nclients:\r\n  - name: 新\r\n    route: r\r\n    key: tw-aaa\r\n");
  });
});

describe("换行符混着的文件", () => {
  // core 按表单改一份 CRLF 的文件时，新加的那一行是 LF
  const MIXED = "a: 1\r\nb: 2\r\nc: 3\nd: 4\r\n";

  it("原样交回去", () => {
    expect(editor(MIXED).text()).toBe(MIXED);
  });

  it("没动过的换行保持原样；新添的用最多的那一种", () => {
    const e = editor(MIXED);
    const at = e.state.doc.line(4).to;
    expect(e.edit({ from: at, insert: "\ne: 5" })).toBe("a: 1\r\nb: 2\r\nc: 3\nd: 4\r\ne: 5\r\n");
  });

  it("最多的那一种：一样多、一个都没有时用 LF", () => {
    expect(dominantEnd(lineEndsOf("a\r\nb\r\nc\n"))).toBe("\r\n");
    expect(dominantEnd(lineEndsOf("a\r\nb\nc"))).toBe("\n");
    expect(dominantEnd(lineEndsOf("a\nb\nc\r\n"))).toBe("\n");
    expect(dominantEnd(lineEndsOf("a\rb\rc"))).toBe("\r");
    expect(dominantEnd(lineEndsOf("a"))).toBe("\n");
  });

  it("单独的 \\r 和 CodeMirror 一样算一个换行", () => {
    const text = "a\rb\r\nc\n";
    const e = editor(text);
    expect(e.state.doc.lines).toBe(lineEndsOf(text).length + 1);
    expect(e.text()).toBe(text);
  });
});

describe("字节偏移（ConfigAt 的 offset）", () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it("\\r\\n 算两个字节，中文一个字三个字节", () => {
    const e = editor(CRLF);
    // 光标停在第 4 行的 `key` 上
    const line = e.state.doc.line(4);
    const pos = line.from + 4;
    const expected = bytes(CRLF.slice(0, CRLF.indexOf("key")));
    expect(byteOffsetAt(e.state.doc, e.ends, pos)).toBe(expected);
    // 以前按 `\n` 算：前面有三个换行，差三个字节
    expect(bytes(e.state.doc.sliceString(0, pos))).toBe(expected - 3);
  });

  it("混着的文件里每个换行按它自己的长度算", () => {
    const text = "a: 甲\r\nb: 乙\nc: 丙\r\nd: 丁";
    const e = editor(text);
    for (let n = 1; n <= e.state.doc.lines; n++) {
      const line = e.state.doc.line(n);
      const at = text.indexOf(line.text);
      expect(byteOffsetAt(e.state.doc, e.ends, line.from + 3), `第 ${n} 行`).toBe(bytes(text.slice(0, at + 3)));
    }
  });
});

describe("文件原文里的下标换成编辑器里的位置（定位选中的区间）", () => {
  it("前面每有一个 \\r\\n 就少一格", () => {
    const e = editor(CRLF);
    const at = CRLF.indexOf("  - name");
    expect(docPosOf(CRLF, at)).toBe(e.state.doc.line(3).from);
    expect(docPosOf(CRLF, CRLF.length)).toBe(e.state.doc.length);
    expect(docPosOf(CRLF, 0)).toBe(0);
  });

  it("LF 的文件不变", () => {
    const text = CRLF.replaceAll("\r\n", "\n");
    expect(docPosOf(text, text.indexOf("  - name"))).toBe(text.indexOf("  - name"));
  });
});
