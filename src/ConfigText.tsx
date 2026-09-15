import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import YamlEditor from "./YamlEditor";
import type { ConfigAt, ConfigText as Doc } from "./types";
import { Button } from "@/ui/button";

/**
 * 文本模式：直接改 config.yaml。
 *
 * **它是表单模式的退路，也是它的上限**。表单能改的只有标量值，
 * 而加一个 provider、删一条规则、写一段注释，都只能在这里做。
 *
 * 语法高亮没有做。Monaco 是几 MB 的依赖，而这一层真正解决的问题是
 * 「改完之后会不会覆盖掉别人的改动」—— 那是版本号的事，不是编辑器的事。
 */
export default function ConfigTextMode({
  doc,
  onSaved,
  focus,
  rejectedLine,
  onJumpToForm,
}: {
  doc: Doc;
  /** 保存成功。外层拿它去重新拉配置和概览 */
  onSaved: () => void;
  /**
   * 从表单跳过来时要定位的那个名字。
   *
   * **这个联动的价值不只是方便**：它让用户亲眼看到「我在表单里改一个
   * 字段，文件里只有那一行变了」，而那比任何文档都更能建立对最小文本
   * 替换的信任。
   */
  focus?: string | null;
  /** 最近一次校验失败指到的行号。**没有就是 null**，不是 0 */
  rejectedLine?: number | null;
  /** 点「在表单里看」时回到表单并定位（反向那条） */
  onJumpToForm?: (name: string) => void;
}) {
  const [draft, setDraft] = useState(doc.text);
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

  /**
   * 从表单跳过来时要选中的区间（字符下标，CodeMirror 用的就是它）。
   *
   * **选中整块而不是只把光标放过去** —— 用户按「在文件里看」是想确认
   * 「这一段就是刚才表单里那个东西」，而一个看不见的光标回答不了这个。
   */
  /**
   * 光标停在哪一段上（反向联动）。
   *
   * **问后端，不在前端猜。**猜错的表现是「我明明点在中转上，右边显示
   * 的是官方」—— 那比没有这个功能更让人不信任这一页。
   */
  const [at, setAt] = useState<ConfigAt | null>(null);
  const askedFor = useRef(-1);
  const setCursor = (byteOffset: number) => {
    // 打字时每个字符问一次是浪费。**只在跨出上一次那一段时才问** ——
    // 而那个判断很便宜：偏移量变化小于几十个字节就不问
    if (Math.abs(byteOffset - askedFor.current) < 8) return;
    askedFor.current = byteOffset;
    void invoke<ConfigAt>("config_at", { offset: byteOffset })
      .then(setAt)
      .catch(() => setAt(null));
  };

  /** 校验报错指到的那一行。外层把最近一次拒绝传进来 */
  const errorLine = rejectedLine ?? null;

  const range = useMemo<[number, number] | null>(() => {
    if (!focus) return null;
    const at = draft.indexOf(`name: ${focus}`);
    if (at < 0) return null;
    const lineStart = draft.lastIndexOf("\n", at) + 1;
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
    return [lineStart, end];
    // 只在 focus 变的时候重算 —— 跟着 draft 变会让用户一打字就被拉回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  const stale = base.current !== doc.version;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error
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
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 tw-body dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            这个文件在你编辑期间被改过了。
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            现在保存会覆盖掉外面那次改动。
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(doc.text);
                base.current = doc.version;
                setError(null);
              }}
            >
              丢掉放弃本地改动，用文件里的
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                base.current = doc.version;
              }}
            >
              保留本地改动，覆盖文件
            </Button>
          </div>
        </div>
      )}

      <YamlEditor
        value={draft}
        onChange={setDraft}
        onCursor={setCursor}
        focusRange={range}
        errorLine={errorLine}
      />

      {/*
        反向联动：光标停在哪儿，就说它是哪一段。
        **这个提示存在的理由不是方便** —— 它让用户建立「表单就是文件的
        另一种视图」这个心智，而不是两个割裂的东西。
      */}
      {at?.name && (
        <p className="tw-body text-neutral-500">
          光标在 <span className="font-medium text-neutral-700 dark:text-neutral-300">{at.name}</span>
          {at.section ? `（${at.section}）` : ""} 这一段里
          {onJumpToForm && (
            <button
              onClick={() => onJumpToForm(at.name!)}
              className="ml-1 underline underline-offset-2 hover:text-neutral-900 dark:hover:text-neutral-100"
            >
              在表单里看
            </button>
          )}
        </p>
      )}

      <div className="flex items-center gap-3 tw-body">
        <Button
          size="sm"
          onClick={save}
          disabled={busy || !dirty}
        >
          {busy ? "保存中…" : "保存"}
        </Button>
        {dirty && !busy && <span className="text-amber-600 dark:text-amber-400">有未保存的改动</span>}
        <span className="ml-auto font-mono text-neutral-400">{doc.version}</span>
        <span className="text-neutral-400">{doc.path}</span>
      </div>

      {/* 保存失败最常见的两种：写错了（语法/字段/语义），和有人抢先改了。
          两者的下一步完全不同，所以原样把 core 那句话显示出来 */}
      {error && (
        <pre className="whitespace-pre-wrap rounded-md border border-amber-200 bg-amber-50 px-3 py-2 tw-body text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
          {error}
        </pre>
      )}
    </div>
  );
}
