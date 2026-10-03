import { useEffect, useRef } from "react";
import { Annotation, EditorState, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type DecorationSet,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
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

/** 读不了的位置和原因。行列从 1 数；没有列的只标整行 */
export interface CodeError {
  line: number;
  column: number | null;
  /** 写在那一行下面的一句（已经按界面语言说好）。没有就只标出位置 */
  message?: string;
}

/** 外面换进来的内容（改写、导入）：不当成用户在这里打的字报回去 */
const external = Annotation.define<boolean>();

/** 报错写在出错那一行下面，红字 */
class ErrorWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: ErrorWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-tw-error-msg";
    // 原因里可能有插件写的字：只当纯文本
    el.textContent = this.text;
    return el;
  }
}

/** 报错的位置：那一行一层浅红底、那一列下划线、那一行下面一句原因 */
const setError = StateEffect.define<CodeError | null>();
const errorMarks = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setError)) continue;
      const err = e.value;
      if (err == null || err.line < 1 || err.line > tr.state.doc.lines) {
        next = Decoration.none;
        continue;
      }
      const line = tr.state.doc.line(err.line);
      const marks = [Decoration.line({ class: "cm-tw-error" }).range(line.from)];
      if (err.column != null && line.length > 0) {
        const at = line.from + Math.min(Math.max(err.column - 1, 0), line.length - 1);
        marks.push(Decoration.mark({ class: "cm-tw-error-at" }).range(at, at + 1));
      }
      if (err.message) marks.push(Decoration.widget({ widget: new ErrorWidget(err.message), block: true, side: 1 }).range(line.to));
      next = Decoration.set(marks, true);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** 只换掉两份文字不一样的那一段：光标、滚动位置、撤销都按改动的那一小段走 */
function minimalChange(from: string, to: string) {
  let a = 0;
  const max = Math.min(from.length, to.length);
  while (a < max && from.charCodeAt(a) === to.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && from.charCodeAt(from.length - 1 - b) === to.charCodeAt(to.length - 1 - b)) b++;
  return { from: a, to: from.length - b, insert: to.slice(a, to.length - b) };
}

/**
 * 插件代码。只读（审核、对比）或者可以编辑（插件编辑器的「代码」页）。
 *
 * **长行折行。**审核时最常见的藏法是在一行末尾隔一大段空格再写一句：不折行的话那一句
 * 在横向滚动条的另一头。**看不见的字符画出来**：零宽字符和双向文本的控制符会让一段
 * 代码读起来和执行起来不一样（`highlightSpecialChars` 把它们画成红点，悬停是码位）。
 *
 * 编辑时，外面换进来的内容（表单改写了 manifest、从文件导入）只换掉不一样的那一段，
 * 不当成用户打的字报回去；撤销照样撤得回来。
 *
 * 按需加载（`lazy`），理由同配置文件编辑器：CodeMirror 只在这几个对话框里用。
 */
export default function CodeView({
  code,
  onChange,
  error,
  focusAt,
  maxHeight = 320,
  fill = false,
  label,
}: {
  code: string;
  /** 给了就能编辑：每一次用户改动交出整份代码 */
  onChange?: (code: string) => void;
  /** 读不了的位置，滚到那里并标出来 */
  error?: CodeError | null;
  /** 把光标放到这个位置（`at` 变了就再放一次），比如点了报错里的行列 */
  focusAt?: { line: number; column: number | null; at: number } | null;
  maxHeight?: number;
  /** 撑满外面的框（编辑器的「代码」页），不按 `maxHeight` 限高 */
  fill?: boolean;
  /** 读屏读出来的这一块叫什么 */
  label?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  // 回调放在 ref 里：CodeMirror 的扩展是建视图时冻住的
  const changed = useRef(onChange);
  changed.current = onChange;
  const editable = onChange != null;
  /** 编辑器上现在标着的那一份报错 */
  const shown = useRef<string>("");

  useEffect(() => {
    if (!host.current) return;
    const mode: Extension[] = editable
      ? [
          history(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (!u.docChanged || u.transactions.every((tr) => tr.annotation(external))) return;
            changed.current?.(u.state.doc.toString());
          }),
        ]
      : [EditorState.readOnly.of(true), EditorView.editable.of(false)];
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: code,
        extensions: [
          lineNumbers(),
          highlightSpecialChars({ addSpecialChars: /[‌‍‪-‬⁠-⁤⁨]/ }),
          javascript,
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          errorMarks,
          ...mode,
          ...(label ? [EditorView.contentAttributes.of({ "aria-label": label })] : []),
          EditorView.theme({
            "&": {
              fontSize: "12px",
              ...(fill ? { height: "100%" } : { maxHeight: `${maxHeight}px` }),
              backgroundColor: "transparent",
              color: "var(--foreground)",
            },
            ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
            ".cm-gutters": {
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              borderRight: "1px solid var(--border)",
            },
            ".cm-content": { cursor: editable ? "text" : "default" },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--muted) 60%, transparent)" },
            ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--foreground)" },
            "&.cm-focused": { outline: "none" },
            "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
              backgroundColor: "color-mix(in oklab, var(--chart-2) 35%, transparent)",
            },
            ".cm-tw-error": { backgroundColor: "color-mix(in oklab, var(--destructive) 14%, transparent)" },
            ".cm-tw-error-at": {
              textDecoration: "underline wavy var(--destructive)",
              textUnderlineOffset: "3px",
            },
            ".cm-tw-error-msg": {
              padding: "2px 8px 4px",
              color: "var(--destructive)",
              backgroundColor: "color-mix(in oklab, var(--destructive) 8%, transparent)",
              fontFamily: "var(--font-ui)",
              fontSize: "11px",
              lineHeight: "16px",
              whiteSpace: "pre-wrap",
            },
            ".cm-specialChar": { color: "var(--destructive)" },
          }),
        ],
      }),
    });
    view.current = v;
    // 新建的编辑器上还没有标过报错（开发模式下 effect 会先卸一次再装）
    shown.current = "";
    return () => {
      v.destroy();
      view.current = null;
    };
    // 文档换了由下面那个 effect 同步；能不能编辑、高度只在建的时候定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外面换了内容：只换不一样的那一段。和编辑器里的一样（刚打的字报出去又传回来）就不动
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const now = v.state.doc.toString();
    if (now === code) return;
    v.dispatch({ changes: minimalChange(now, code), annotations: external.of(true) });
  }, [code]);

  // 报错的位置。换了一份报错（或者没了）才重画；第一次标出来时滚到那里
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const key = error ? `${error.line}:${error.column ?? ""}:${error.message ?? ""}` : "";
    if (key === shown.current) return;
    shown.current = key;
    const line = error && error.line >= 1 && error.line <= v.state.doc.lines ? error.line : null;
    v.dispatch({
      effects: [
        setError.of(line ? error! : null),
        ...(line && !v.hasFocus ? [EditorView.scrollIntoView(v.state.doc.line(line).from, { y: "center" })] : []),
      ],
    });
  }, [error, code]);

  // 点了报错里的行列：光标放过去、滚到那里、焦点进编辑器
  useEffect(() => {
    const v = view.current;
    if (!v || !focusAt) return;
    const n = Math.min(Math.max(1, focusAt.line), v.state.doc.lines);
    const line = v.state.doc.line(n);
    const pos = line.from + Math.min(Math.max((focusAt.column ?? 1) - 1, 0), line.length);
    v.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
  }, [focusAt]);

  return <div ref={host} className={fill ? "h-full min-h-0" : "min-h-0"} />;
}
