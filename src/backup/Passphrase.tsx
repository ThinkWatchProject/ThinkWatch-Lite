import { useState } from "react";
import { FormRow } from "@/settings/form";
import { SecretInput } from "@/ui/secret-input";
import { Switch } from "@/ui/switch";
import { useText } from "@/i18n";
import { backupText } from "./backup.i18n";

/** 导出时设的口令最短几个字符（规格 5.2） */
export const MIN_PASSPHRASE = 8;

export interface Passphrase {
  on: boolean;
  setOn: (on: boolean) => void;
  first: string;
  setFirst: (v: string) => void;
  again: string;
  setAgain: (v: string) => void;
  /** 打开了加密、口令不合要求时那一句。没打开或者没毛病是 null */
  problem: string | null;
  /** 交给 core 的口令：没打开加密是 null */
  value: string | null;
}

/** 「口令加密」那一行的状态：开关缺省关；开了之后口令必填、至少 8 个字符、两次一致。口令不保存 */
export function usePassphrase(): Passphrase {
  const t = useText(backupText);
  const [on, setOn] = useState(false);
  const [first, setFirst] = useState("");
  const [again, setAgain] = useState("");
  const problem = !on
    ? null
    : first.length < MIN_PASSPHRASE
      ? t.passphraseShort
      : first !== again
        ? t.passphraseMismatch
        : null;
  return { on, setOn, first, setFirst, again, setAgain, problem, value: on ? first : null };
}

/**
 * 两列表单里的「口令加密」一行：开关和说明，开了之后下面两个密码框。**没填完不报错**：
 * 第二格还空着的时候不说「不一致」，说明照旧是那一句
 */
export function PassphraseRow({ p, disabled }: { p: Passphrase; disabled?: boolean }) {
  const t = useText(backupText);
  const typing = p.on && p.again === "" && p.first.length >= MIN_PASSPHRASE;
  const shown = p.on && p.problem && (p.first !== "" || p.again !== "") && !typing ? p.problem : null;
  return (
    <FormRow label={t.encrypt} hint={shown ? <span className="text-destructive">{shown}</span> : t.encryptHint}>
      <label className="flex items-center gap-2.5 pt-0.5 tw-body">
        <Switch checked={p.on} disabled={disabled} onCheckedChange={p.setOn} />
        {t.encryptWhat}
      </label>
      {p.on && (
        <div className="mt-1.5 grid w-full max-w-[360px] grid-cols-2 gap-2">
          <SecretInput
            aria-label={t.passphrase}
            placeholder={t.passphrase}
            value={p.first}
            disabled={disabled}
            aria-invalid={shown !== null && p.first.length < MIN_PASSPHRASE ? true : undefined}
            onChange={(e) => p.setFirst(e.target.value)}
          />
          <SecretInput
            aria-label={t.passphraseAgain}
            placeholder={t.passphraseAgain}
            value={p.again}
            disabled={disabled}
            aria-invalid={shown === t.passphraseMismatch ? true : undefined}
            onChange={(e) => p.setAgain(e.target.value)}
          />
        </div>
      )}
    </FormRow>
  );
}
