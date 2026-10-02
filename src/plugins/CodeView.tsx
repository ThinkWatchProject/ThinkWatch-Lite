import { useEffect, useRef } from "react";
import { EditorState, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, highlightSpecialChars, lineNumbers, type DecorationSet } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "./jsLanguage";

/**
 * 语法色走 CSS 变量，跟着深浅色切换（和配置文件编辑器同一套变量）。关键字用正文色加粗：
 * 审核时要读的是字符串和数据，不是关键字
 */
const highlight = HighlightStyle.define([
  { tag: t.keyword, color: "var(--code-key)", fontWeight: "600" },
  { tag: [t.propertyName], color: "var(--code-key)" },
  { tag: [t.string, t.special(t.string)], color: "var(--code-string)" },
  { tag: [t.number, t.atom, t.bool, t.null], color: "var(--code-atom)" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.punctuation, t.brace, t.operator], color: "var(--muted-foreground)" },
]);

/** 报错的那一行：换成一层浅红底 */
const setError = StateEffect.define<number | null>();
const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (!e.is(setError)) continue;
      if (e.value == null || e.value < 1 || e.value > tr.state.doc.lines) return Decoration.none;
      const b = new RangeSetBuilder<Decoration>();
      b.add(tr.state.doc.line(e.value).from, tr.state.doc.line(e.value).from, Decoration.line({ class: "cm-tw-error" }));
      return b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * 插件代码，只读。安装、更换代码、确认文件变更之前给人看全文的那一块。
 *
 * **长行折行。**审核时最常见的藏法是在一行末尾隔一大段空格再写一句：不折行的话那一句
 * 在横向滚动条的另一头。**看不见的字符画出来**：零宽字符和双向文本的控制符会让一段
 * 代码读起来和执行起来不一样（`highlightSpecialChars` 把它们画成红点，悬停是码位）。
 *
 * 按需加载（`lazy`），理由同配置文件编辑器：CodeMirror 只在这几个对话框里用。
 */
export default function CodeView({
  code,
  errorAt,
  maxHeight = 320,
}: {
  code: string;
  /** 报错的那一行（1 起），滚到那里并标出来 */
  errorAt?: number | null;
  maxHeight?: number;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          highlightSpecialChars({ addSpecialChars: /[\u200c\u200d\u202a-\u202c\u2060-\u2064\u2068]/ }),
          javascript,
          syntaxHighlighting(highlight),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          errorLine,
          EditorView.theme({
            "&": { fontSize: "12px", maxHeight: `${maxHeight}px`, backgroundColor: "transparent", color: "var(--foreground)" },
            ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              borderRight: "1px solid var(--border)",
            },
            ".cm-content": { cursor: "text" },
            "&.cm-focused": { outline: "none" },
            ".cm-selectionBackground, ::selection": {
              backgroundColor: "color-mix(in oklab, var(--chart-2) 35%, transparent)",
            },
            ".cm-tw-error": { backgroundColor: "color-mix(in oklab, var(--destructive) 14%, transparent)" },
            ".cm-specialChar": { color: "var(--destructive)" },
          }),
        ],
      }),
    });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // 文档换了由下面那个 effect 同步；高度只在建的时候定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === code) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: code } });
  }, [code]);

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const line = errorAt != null && errorAt >= 1 && errorAt <= v.state.doc.lines ? errorAt : null;
    v.dispatch({
      effects: [
        setError.of(line),
        ...(line ? [EditorView.scrollIntoView(v.state.doc.line(line).from, { y: "center" })] : []),
      ],
    });
  }, [errorAt, code]);

  return <div ref={host} className="min-h-0" />;
}
