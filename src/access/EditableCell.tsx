import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/ui/input";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { errorText } from "@/i18n/core.i18n";
import { patchConfig } from "@/patch";
import type { PatchOp } from "@/types";
import { accessText } from "./Access.i18n";

/**
 * 一个能改的字段。
 *
 * **失焦才提交，而且值没变就什么都不做。**每敲一个键就发一次 patch 会
 * 在历史里堆满噪音，而历史是回滚的依据。
 *
 * 提交时带上 `version` —— 那是乐观并发的凭据。用户在编辑器里同时改了
 * 什么，界面无从知道，所以永远不覆盖。
 */
export function EditableCell({
  value,
  path,
  version,
  mono,
  numeric,
}: {
  value: string;
  path: string;
  version: string | null;
  mono?: boolean;
  /**
   * 这一格是个数。
   *
   * **配置里的数字字段必须发数字。**发字符串的话 core 直接拒
   * （`invalid type: string "21", expected usize`）—— 而拒绝发生在
   * 失焦之后，用户看到的是一个弹出来的报错和一个弹回原值的格子，
   * 完全不知道自己做错了什么。并发上限和网关端口一直就是这样。
   */
  numeric?: boolean;
}) {
  const t = useText(accessText);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);
  /**
   * 输入法正在组字。
   *
   * **那条数据丢失就在这儿**：cc-switch 报过一个 12 字符的值被
   * 膨胀成 1396 字符 —— 受控组件在输入法还持有 composition range 时
   * 把 state 写回 DOM。我们是 Tauri（WebKit）+ 中文用户 + 配置输入框，
   * 三个条件全中。
   *
   * 更阴的是 **WebKit 在窗口切换时不发 `compositionend`** —— 用户输到
   * 一半点了别的窗口，那个事件永远不来。所以 `blur` 里要强制收尾。
   */
  const composing = useRef(false);
  // 外面换了版本（别人改了文件）就跟着走 —— 否则用户会盯着一个已经
  // 不存在的值发呆
  useEffect(() => setDraft(value), [value]);

  async function commit() {
    // 组字中不提交 —— 中间态提交上去的是一段还没成形的文本
    if (composing.current || draft === value || busy) return;
    if (!version) {
      toast.error(t.versionNotLoaded);
      setDraft(value);
      return;
    }
    // 数字格子里打了不是数的东西：**不发出去**。让它退回原值，
    // 比发一个注定被拒的 patch 再报一次错干脆
    const trimmed = draft.trim();
    if (numeric && !/^\d+$/.test(trimmed)) {
      setDraft(value);
      toast.error(t.notANumber);
      return;
    }
    setBusy(true);
    try {
      const ops: PatchOp[] = [
        { op: "replace", path, value: numeric ? Number(trimmed) : draft },
      ];
      // Tauri 的 invoke 用字符串 reject，不是 Error
      await patchConfig(ops, version);
    } catch (e) {
      // **失败时把草稿退回原值。**留着一个没保存成功的值，用户下次
      // 看这一行会以为它已经生效了。
      setDraft(value);
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Input
      value={draft}
      disabled={busy}
      onChange={(e) => setDraft(e.target.value)}
      onCompositionStart={() => (composing.current = true)}
      onCompositionEnd={(e) => {
        composing.current = false;
        setDraft(e.currentTarget.value);
      }}
      onBlur={(e) => {
        // WebKit 窗口切换时不发 `compositionend`，这里强制收尾
        composing.current = false;
        setDraft(e.currentTarget.value);
        void commit();
      }}
      // **macOS 会把 API key 的首字母大写。**一行属性的事，不写就是
      // 一类稳定复现的「key 明明是对的却认证失败」
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      spellCheck={false}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        // Esc 放弃这次编辑
        if (e.key === "Escape") {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      variant="inline"
      className={cn(mono && "font-mono")}
    />
  );
}
