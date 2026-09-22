import type { ReactNode } from "react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Spinner } from "@/ui/spinner";
import { useText } from "@/i18n";
import { commonText } from "@/i18n/common.i18n";
import { formText } from "./form.i18n";

/**
 * 设置页里改网关配置的那几节（监听、并发、日志保留）共用的表单。
 *
 * **改完点保存才生效。**这几项改的是 config.yaml，改错的代价是客户端连不上
 * 或者日志被删 —— 一个选项点下去立刻生效、一个格子失焦就写盘，用户没有
 * 机会把几处一起改好再落地，也没有机会反悔。外观、提醒那几节改的是这个
 * 应用自己，点一下就换，照旧。
 *
 * 版式是两列：左边标签右对齐成一列，右边控件，控件下面一行说明。保存和
 * 放弃更改放在控件那一列的最下面，和控件对齐。
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
 * 保存和放弃更改。**改过才亮**，存的时候两个都灰掉。
 *
 * `invalid` 时保存灰着：哪一格不对，那一格下面自己会说。
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
  return (
    <>
      <dt />
      <dd className="flex items-center gap-2 pt-1">
        <Button size="sm" disabled={!dirty || busy || invalid} onClick={onSave}>
          {busy && <Spinner />}
          {common.save}
        </Button>
        <Button size="sm" variant="ghost" disabled={!dirty || busy} onClick={onDiscard}>
          {t.discard}
        </Button>
      </dd>
    </>
  );
}

/** 一个整数（或一位小数）的格子，后面可以跟一个单位 */
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
        inputMode={decimal ? "decimal" : "numeric"}
        className="h-7 w-24 font-mono tabular-nums"
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
      {unit && <span className="tw-body text-muted-foreground">{unit}</span>}
    </span>
  );
}

/** 正整数，且在范围内 */
export function intIn(v: string, min: number, max: number): boolean {
  if (!/^\d+$/.test(v)) return false;
  const n = Number(v);
  return n >= min && n <= max;
}
