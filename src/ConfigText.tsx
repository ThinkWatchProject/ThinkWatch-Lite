import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import YamlEditor from "./YamlEditor";
import type { ConfigAt, ConfigText as Doc } from "./types";
import { Button } from "@/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/ui/alert";
import { Spinner } from "@/ui/spinner";
import { toast } from "sonner";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { configTextText } from "./ConfigText.i18n";

/**
 * 直接编辑 config.yaml。
 *
 * **它是各配置页的退路，也是它们的上限**。表单覆盖不到的写法（注释、
 * 手写的顺序）只能在这里做。真正要解决的问题是「改完之后会不会覆盖掉
 * 别人的改动」—— 那是版本号的事，不是编辑器的事。
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
  /** 点「在界面中查看」时跳到管理这一段的页面（反向那条） */
  onJumpToForm?: (at: { name: string; section: string | null }) => void;
}) {
  const t = useText(configTextText);
  const common = useText(commonText);
  const sections: Record<string, string | undefined> = t.sections;
  const [draft, setDraft] = useState(doc.text);
  const [busy, setBusy] = useState(false);
  /** 打开这一版时文件是什么样。**保存时带的就是它** */
  const base = useRef(doc.version);
  const dirty = draft !== doc.text;

  useEffect(() => {
    // 外面换了版本。**没改过就跟着走，改过就别动他的草稿** ——
    // 把用户正在写的东西冲掉，比让他看到一个过期的版本糟得多。
    if (!dirty) {
      setDraft(doc.text);
      base.current = doc.version;
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
    try {
      // Tauri 的 invoke 用字符串 reject，不是 Error
      await invoke("put_config", { text: draft, baseVersion: base.current });
      base.current = "";
      onSaved();
    } catch (e) {
      toast.error(typeof e === "string" ? e : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 文件在你编辑期间被改过了。**给选择，不替他做决定** ——
          两边都是真实的改动，只有他知道哪个该留 */}
      {stale && (
        <Alert variant="warning" className="px-3 py-2">
          <AlertTitle>{t.staleTitle}</AlertTitle>
          <AlertDescription>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            {t.staleBody}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setDraft(doc.text);
                base.current = doc.version;
              }}
            >
              {t.useFile}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                base.current = doc.version;
              }}
            >
              {t.keepMine}
            </Button>
          </div>
        </AlertDescription>
        </Alert>
      )}

      <div className="min-h-0 flex-1">
        <YamlEditor
          value={draft}
          onChange={setDraft}
          onCursor={setCursor}
          focusRange={range}
          errorLine={errorLine}
        />
      </div>

      {/*
        反向联动：光标停在哪儿，就说它是哪一段。
        **这个提示存在的理由不是方便** —— 它让用户建立「表单就是文件的
        另一种视图」这个心智，而不是两个割裂的东西。
      */}
      {at?.name && (
        <p className="tw-body text-muted-foreground">
          {t.cursorAt(at.section ? (sections[at.section] ?? at.section) : "")}{" "}
          <span className="font-medium text-foreground">{at.name}</span>
          {onJumpToForm && (
            <Button
              variant="link"
              size="xs"
              className="ml-1"
              onClick={() => onJumpToForm({ name: at.name!, section: at.section ?? null })}
            >
              {t.showInApp}
            </Button>
          )}
        </p>
      )}

      {/* 保存失败最常见的两种：写错了（语法/字段/语义），和有人抢先改了。
          两者的下一步完全不同，所以保存失败时原样显示 core 那句话 */}
      <div className="flex items-center gap-3 tw-body">
        <span className="min-w-0 truncate font-mono tw-label text-muted-foreground">{doc.path}</span>
        <div className="flex-1" />
        {dirty && !busy && <span className="text-warning">{t.unsaved}</span>}
        <Button size="sm" onClick={save} disabled={busy || !dirty}>
          {busy && <Spinner />}
          {common.save}
        </Button>
      </div>
    </div>
  );
}
