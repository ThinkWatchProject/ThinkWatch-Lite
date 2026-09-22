import { textOf, useText } from "@/i18n";
import { keyLabelText } from "./KeyLabel.i18n";

/**
 * 一把网关密钥：打码后的值，括号里是名字 —— `tw-re…wb4e（claude-code）`，
 * 和密钥页的写法一样。
 *
 * **打码的值是 core 在请求那一刻记下的**，不是按名字去查现在的密钥：名字
 * 随便起、密钥会更换，按名字查的话，更换之后老记录上会是新密钥的尾巴。
 * 老记录没有这个值，退回「密钥 名字」—— 只写名字的话，读起来像是哪个应用。
 */
export function KeyLabel({ name, masked }: { name: string; masked?: string | null }) {
  const t = useText(keyLabelText);
  if (!masked) return <>{t.bare(name)}</>;
  return (
    <>
      <span className="font-mono">{masked}</span>
      {t.named(name)}
    </>
  );
}

/** 同上，写成一句话。悬停说明里用 */
export function keyText(name: string, masked?: string | null): string {
  const t = textOf(keyLabelText);
  return masked ? masked + t.named(name) : t.bare(name);
}
