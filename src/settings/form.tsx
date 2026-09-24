import { useCallback, useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { useConnections } from "@/connection/ConnectionProvider";
import { formText } from "./form.i18n";

/**
 * 两列表单：左边标签右对齐成一列，右边控件，控件下面一行说明。连接的添加与编辑、
 * 安全页「输出长度」的上限用它。设置页本身是一行一项的面板，见 `kit.tsx`。
 */
export function FormRows({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-6 gap-y-3">
      {children}
    </dl>
  );
}

export function FormRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: ReactNode;
  /** 控件的 id。给了的话点标签会聚焦控件 */
  htmlFor?: string;
  /** 控件下面那一行说明 */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {/* 控件高 28px、文字 13px：标签往下挪一点，和控件里的字落在同一条线上 */}
      <dt className="pt-1 tw-body text-muted-foreground">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : label}
      </dt>
      <dd className="flex min-w-0 flex-col items-start gap-1">
        {children}
        {hint && <p className="tw-label text-muted-foreground">{hint}</p>}
      </dd>
    </>
  );
}

/**
 * 两列表单下面的保存和放弃更改。**改过才出现**：没改的时候两个灰按钮摆在那儿，看起来
 * 像是有什么没存。`invalid` 时保存灰着：哪一格不对，那一格下面自己会说。设置页里
 * 一行一项的面板用的是 `kit.tsx` 的 `SaveBar`。
 */
export function FormActions({
  dirty,
  busy,
  invalid,
  onSave,
  onDiscard,
}: {
  dirty: boolean;
  busy: boolean;
  invalid?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}) {
  const t = useText(formText);
  const common = useText(commonText);
  if (!dirty && !busy) return null;
  return (
    <>
      <dt />
      <dd className="flex items-center gap-2 pt-1">
        <Button size="sm" pending={busy} disabled={invalid} onClick={onSave}>
          {common.save}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onDiscard}>
          {t.discard}
        </Button>
      </dd>
    </>
  );
}

/** 一个整数（或一位小数）的格子，后面可以跟一个单位。28px，和工具条、设置里一行的其他控件一样高 */
export function NumberInput({
  id,
  value,
  onChange,
  unit,
  invalid,
  disabled,
  decimal,
}: {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  invalid?: boolean;
  disabled?: boolean;
  /** 允许一位小数（报文上限按 GB 写，1.5 是正当的值） */
  decimal?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <Input
        id={id}
        variant="sm"
        inputMode={decimal ? "decimal" : "numeric"}
        className="w-24 font-mono tabular-nums"
        value={value}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        // **macOS 会把输入框的首字母大写、自动更正。**数字格子里没有这回事，
        // 但留着这几个属性，粘贴进来的东西不会被系统改写
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={(e) => onChange(e.target.value.trim())}
      />
      {unit && <span className="min-w-6 tw-body text-muted-foreground">{unit}</span>}
    </span>
  );
}

/** 正整数，且在范围内 */
export function intIn(v: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(v)) return false;
  const n = Number(v);
  return n >= min && n <= max;
}

/**
 * 改到一半的表单。**切到别的页再回来接着改**：设置页换页时整个卸掉，而改了一半的
 * 端口不该因为去流量页看了一眼就没了（目录上那一节挂着点，回来看得见）。只记在这次
 * 运行里；按连接分开 —— 换了连接就是另一份配置。
 */
const drafts = new Map<string, { conn: string; value: unknown }>();

/**
 * 一节表单的草稿：`draft` 是正在改的，`saved` 是配置里现在的。
 *
 * · 没在改的时候跟着配置走（别处改的、或者刚存完推回来的）。
 * · `commit(value?)`：刚存上（存的是 `value`，缺省是当前草稿）。配置推回来之前也不
 *   算「改过」—— 保存栏不会在「已保存」和「有未保存的更改」之间闪一下。
 * · `reset()`：放弃更改，回到配置里的值。
 */
export function useFormDraft<T>(
  name: string,
  saved: T,
  same: (a: T, b: T) => boolean,
): {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  dirty: boolean;
  commit: (value?: T) => void;
  reset: () => void;
} {
  const conn = useConnections().view?.current ?? null;
  const [draft, setDraft] = useState<T>(() => {
    const d = drafts.get(name);
    return d && conn !== null && d.conn === conn ? (d.value as T) : saved;
  });
  /** 刚存上的那一份。配置推回来（`saved` 变了）就不用它了 */
  const [committed, setCommitted] = useState<T | null>(null);
  const dirty = !same(draft, saved) && !(committed !== null && same(draft, committed));

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const savedKey = JSON.stringify(saved);
  useEffect(() => {
    setCommitted(null);
    if (!dirtyRef.current) setDraft(savedRef.current);
  }, [savedKey]);

  useEffect(() => {
    if (dirty && conn !== null) drafts.set(name, { conn, value: draft });
    else drafts.delete(name);
  }, [name, conn, dirty, draft]);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const commit = useCallback((value?: T) => {
    const v = value === undefined ? draftRef.current : value;
    dirtyRef.current = false;
    setDraft(v);
    setCommitted(v);
  }, []);
  const reset = useCallback(() => {
    dirtyRef.current = false;
    setCommitted(null);
    setDraft(savedRef.current);
  }, []);
  return { draft, setDraft, dirty, commit, reset };
}
