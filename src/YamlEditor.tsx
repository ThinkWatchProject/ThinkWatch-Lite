import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { yaml } from "@codemirror/lang-yaml";

/**
 * 配置文件的编辑器。
 *
 * **为什么是 CodeMirror 6 而不是 Monaco。** Monaco 是整个 VS Code 的
 * 编辑器内核，5MB 起步，它的价值在 IntelliSense 和 TypeScript 服务 ——
 * 我们一样都用不上。这一页要的就三样：语法高亮、行号、光标位置能对到
 * 语义节点。为一页配置把整个前端从 300KB 撑到 5MB 不划算（
 * 取舍同一条线）。
 *
 * 换掉 `textarea` 换来的三件事：
 *
 * 1. **行号** —— 配置报错时说的是「第 12 行」，而一个没有行号的框里
 *    数到第 12 行要用手指。
 * 2. **语法高亮** —— 一个缩进写错的块，在高亮下一眼能看出来。
 * 3. **光标偏移量** —— 反向联动（光标停在某个 provider 上 → 侧边显示
 *    它的表单）要的就是这个数，而它得是**精确的字节偏移**，不是靠正则
 *    猜出来的位置。
 */
export default function YamlEditor({
  value,
  onChange,
  onCursor,
  focusRange,
  errorLine,
}: {
  value: string;
  onChange: (v: string) => void;
  /** 光标动了，给出**字节**偏移量 —— 后端按字节切 */
  onCursor?: (byteOffset: number) => void;
  /** 从表单跳过来时要选中的字节区间 */
  focusRange?: [number, number] | null;
  /** 校验报错的那一行（1 起）。**没有就是 null**，不是 0 */
  errorLine?: number | null;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const view = useRef<EditorView | null>(null);
  // 回调放在 ref 里：CodeMirror 的扩展是建视图时冻住的，直接闭包进去
  // 会一直调到第一次渲染时的那个函数
  const cb = useRef({ onChange, onCursor });
  cb.current = { onChange, onCursor };

  useEffect(() => {
    if (!host.current) return;
    const enc = new TextEncoder();
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        yaml(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            // **字节偏移，不是字符偏移。**中文配置下两者差得很远，而
            // 后端是按字节切的（栽过好几次的那个坑）
            const head = u.state.selection.main.head;
            const before = u.state.doc.sliceString(0, head);
            cb.current.onCursor?.(enc.encode(before).length);
          }
        }),
        EditorView.theme({
          "&": { fontSize: "12px", height: "52vh" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
        }),
      ],
    });
    const v = new EditorView({ state, parent: host.current });
    view.current = v;
    return () => {
      v.destroy();
      view.current = null;
    };
    // 只建一次。文档内容的同步由下面那个 effect 负责
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外面换了内容（重新拉配置、放弃修改）时同步进来。
  // **正在编辑的不要冲掉** —— 相同就什么都不做
  useEffect(() => {
    const v = view.current;
    if (!v || v.state.doc.toString() === value) return;
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  // 从表单跳过来：选中那一段并滚到可见处。
  // **选中整块而不是只把光标放过去** —— 用户按「在文件里看」是想确认
  // 「这一段就是刚才表单里那个东西」，一个看不见的光标回答不了这个
  useEffect(() => {
    const v = view.current;
    if (!v || !focusRange) return;
    const [a, b] = focusRange;
    const max = v.state.doc.length;
    const from = Math.min(a, max);
    const to = Math.min(b, max);
    v.dispatch({
      selection: { anchor: from, head: to },
      effects: EditorView.scrollIntoView(from, { y: "center" }),
    });
    v.focus();
  }, [focusRange]);

  // 报错的那一行滚进视野。**不画红波浪** —— 校验错误的原文已经在上面
  // 那条横幅里说清楚了，再加一层装饰只是重复
  useEffect(() => {
    const v = view.current;
    if (!v || !errorLine) return;
    const line = Math.min(Math.max(1, errorLine), v.state.doc.lines);
    const pos = v.state.doc.line(line).from;
    v.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: "center" }),
    });
  }, [errorLine]);

  return (
    <div
      ref={host}
      className="overflow-hidden rounded-md border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
    />
  );
}
