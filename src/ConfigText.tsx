import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { call } from "@/control";
import { locateEntry, type ConfigFocus } from "./configLocate";
import type { ConfigAt, ConfigText as Doc } from "./types";
import { Button } from "@/ui/button";
import { Banner } from "@/ui/banner";
import { notify } from "@/ui/notify";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { configTextText } from "./ConfigText.i18n";
import { errorText } from "@/i18n/core.i18n";
import { needsConfirmation } from "@/plugins/write";

/**
 * 编辑器**打开这个对话框时才加载**。CodeMirror 连同 YAML 语法有几百 KB，整个应用
 * 只有这里用：放进主包的话，每次打开主窗口都要多解析一遍它。框由下面先画出来，
 * 加载完编辑器填进去，版面不跳。
 */
const YamlEditor = lazy(() => import("./YamlEditor"));

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
   * 从表单跳过来时要定位的那一项：哪一段、叫什么。
   *
   * **这个联动的价值不只是方便**：它让用户亲眼看到「我在表单里改一个
   * 字段，文件里只有那一行变了」，而那比任何文档都更能建立对最小文本
   * 替换的信任。
   */
  focus?: ConfigFocus | null;
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
  /** core 不让这次保存装上、启用、换掉批准的代码的那个插件（它的那句话） */
  const [pluginRefusal, setPluginRefusal] = useState<string | null>(null);
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
    void call("ConfigAt", { offset: byteOffset })
      .then(setAt)
      .catch(() => setAt(null));
  };

  /** 校验报错指到的那一行。外层把最近一次拒绝传进来 */
  const errorLine = rejectedLine ?? null;

  /**
   * 从表单跳过来时要选中的区间（按文件原文算的字符下标，编辑器自己换成它的位置）。
   *
   * **选中整块而不是只把光标放过去** —— 用户按「在文件里看」是想确认
   * 「这一段就是刚才表单里那个东西」，而一个看不见的光标回答不了这个。
   */
  const range = useMemo<[number, number] | null>(
    // 在那一段里找，名字按整个值比：同名的密钥和路由、规则和上游各是各的（见 configLocate）
    () => (focus ? locateEntry(draft, focus) : null),
    // 只在 focus 变的时候重算 —— 跟着 draft 变会让用户一打字就被拉回去
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focus],
  );

  const stale = base.current !== doc.version;

  async function save() {
    setBusy(true);
    setPluginRefusal(null);
    try {
      await call("PutConfig", { text: draft, base_version: base.current });
      base.current = "";
      onSaved();
    } catch (e) {
      // 改得了工具调用的插件：这条路没有点过头的那一条，只能去插件页。几秒就消失的
      // toast 说不清去哪儿，这一句留在编辑器上
      if (needsConfirmation(e)) setPluginRefusal(errorText(e));
      else notify.error(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {/* 文件在你编辑期间被改过了。**给选择，不替他做决定** ——
          两边都是真实的改动，只有他知道哪个该留 */}
      <Banner show={stale} layout="inline" tone="warning" title={t.staleTitle}>
        <p>{t.staleBody}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(doc.text);
              base.current = doc.version;
            }}
          >
            {t.useFile}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              base.current = doc.version;
            }}
          >
            {t.keepMine}
          </Button>
        </div>
      </Banner>

      {pluginRefusal && (
        <PluginConfirmNotice
          reason={pluginRefusal}
          result="notSaved"
          onOpenPlugins={onJumpToForm && (() => onJumpToForm({ name: "", section: "plugins" }))}
        />
      )}

      <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-popover">
        <Suspense fallback={null}>
          <YamlEditor
            value={draft}
            onChange={setDraft}
            onCursor={setCursor}
            focusRange={range}
            errorLine={errorLine}
          />
        </Suspense>
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
        <Button size="sm" onClick={save} disabled={!dirty} pending={busy}>
          {common.save}
        </Button>
      </div>
    </div>
  );
}

/**
 * 写配置原文（保存文件、恢复版本）被 core 拒了：这次会装上、启用一个改得了回答里工具调用的
 * 插件，或者换掉它批准的代码（403 `control.plugin.needs_confirmation`）。这条路没有点过头的
 * 那一条，**只能在插件页里做**，那里会弹系统的确认框。写明没写成、为什么、去哪儿
 */
export function PluginConfirmNotice({
  reason,
  result,
  onOpenPlugins,
}: {
  /** core 的那句话（按界面语言） */
  reason: string;
  /** 没做成的是什么 */
  result: "notSaved" | "notRestored";
  onOpenPlugins?: () => void;
}) {
  const t = useText(configTextText).pluginConfirm;
  return (
    <Banner
      layout="inline"
      tone="error"
      title={t.title}
      actions={
        onOpenPlugins && (
          <Button variant="outline" size="sm" onClick={onOpenPlugins}>
            {t.open}
          </Button>
        )
      }
    >
      {t[result](reason)}
    </Banner>
  );
}
