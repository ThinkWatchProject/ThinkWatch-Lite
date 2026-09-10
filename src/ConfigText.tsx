import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ConfigText as Doc } from "./types";

/**
 * 文本模式：直接改 config.yaml。
 *
 * **它是表单模式的退路，也是它的上限**（§3.8）。表单能改的只有标量值，
 * 而加一个 provider、删一条规则、写一段注释，都只能在这里做。
 *
 * 语法高亮没有做。Monaco 是几 MB 的依赖，而这一层真正解决的问题是
 * 「改完之后会不会覆盖掉别人的改动」—— 那是版本号的事，不是编辑器的事。
 */
export default function ConfigTextMode({
  doc,
  onSaved,
  focus,
}: {
  doc: Doc;
  /** 保存成功。外层拿它去重新拉配置和概览 */
  onSaved: () => void;
  /**
   * 从表单跳过来时要定位的那个名字（§7.10）。
   *
   * **这个联动的价值不只是方便**：它让用户亲眼看到「我在表单里改一个
   * 字段，文件里只有那一行变了」，而那比任何文档都更能建立对最小文本
   * 替换的信任（§3.8）。
   */
  focus?: string | null;
}) {
  const [draft, setDraft] = useState(doc.text);

  // 跳过来时把那一段选中并滚到可见处。
  //
  // **选中整块而不是只把光标放过去** —— 用户按「在文件里看」是想确认
  // 「这一段就是刚才表单里那个东西」，而一个看不见的光标回答不了这个。
  useEffect(() => {
    if (!focus || !box.current) return;
    const at = draft.indexOf(`name: ${focus}`);
    if (at < 0) return;
    const lineStart = draft.lastIndexOf("\n", at) + 1;
    // 这一块到下一个同级列表项（或文件末尾）为止
    const indent = draft.slice(lineStart).match(/^\s*(- )?/)?.[0].length ?? 0;
    let end = draft.length;
    let p = draft.indexOf("\n", at);
    while (p >= 0) {
      const next = draft.indexOf("\n", p + 1);
      const line = draft.slice(p + 1, next < 0 ? draft.length : next);
      // 空行不算结束 —— 一段配置里夹一个空行是很常见的写法
      if (line.trim() !== "") {
        const lead = line.match(/^\s*/)?.[0].length ?? 0;
        if (lead < indent || (lead === indent && line.trimStart().startsWith("- "))) {
          end = p + 1;
          break;
        }
      }
      p = next;
    }
    const el = box.current;
    el.focus();
    el.setSelectionRange(lineStart, end);
    // 滚到那一行附近。行高按 textarea 的 line-height 估，差几像素无所谓
    const before = draft.slice(0, lineStart).split("\n").length - 1;
    el.scrollTop = Math.max(0, (before - 3) * 18);
  }, [focus, draft]);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 打开这一版时文件是什么样。**保存时带的就是它** */
  const base = useRef(doc.version);
  const dirty = draft !== doc.text;

  useEffect(() => {
    // 外面换了版本。**没改过就跟着走，改过就别动他的草稿** ——
    // 把用户正在写的东西冲掉，比让他看到一个过期的版本糟得多。
    if (!dirty) {
      setDraft(doc.text);
      base.current = doc.version;
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.version]);

  const stale = base.current !== doc.version;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error（§9.7）
      await invoke("put_config", { text: draft, baseVersion: base.current });
      base.current = "";
      onSaved();
    } catch (e) {
      setError(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      {/* 文件在你编辑期间被改过了。**给选择，不替他做决定** ——
          两边都是真实的改动，只有他知道哪个该留 */}
      {stale && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            这个文件在你编辑期间被改过了。
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            现在保存会覆盖掉外面那次改动。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => {
                setDraft(doc.text);
                base.current = doc.version;
                setError(null);
              }}
              className="rounded border border-amber-400 px-2 py-1 text-amber-900 dark:border-amber-700 dark:text-amber-200"
            >
              丢掉我的改动，用文件里的
            </button>
            <button
              onClick={() => {
                base.current = doc.version;
              }}
              className="rounded border border-amber-400 px-2 py-1 text-amber-900 dark:border-amber-700 dark:text-amber-200"
            >
              保留我的，覆盖过去
            </button>
          </div>
        </div>
      )}

      <textarea
        ref={box}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="h-[52vh] w-full resize-y rounded-md border border-neutral-200 bg-white p-3 font-mono text-xs leading-relaxed dark:border-neutral-800 dark:bg-neutral-900"
      />

      <div className="flex items-center gap-3 text-xs">
        <button
          onClick={save}
          disabled={busy || !dirty}
          className="rounded-md bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
        >
          {busy ? "保存中…" : "保存"}
        </button>
        {dirty && !busy && <span className="text-amber-600 dark:text-amber-400">有未保存的改动</span>}
        <span className="ml-auto font-mono text-neutral-400">{doc.version}</span>
        <span className="text-neutral-400">{doc.path}</span>
      </div>

      {/* 保存失败最常见的两种：写错了（语法/字段/语义），和有人抢先改了。
          两者的下一步完全不同，所以原样把 core 那句话显示出来 */}
      {error && (
        <pre className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </pre>
      )}
    </div>
  );
}
