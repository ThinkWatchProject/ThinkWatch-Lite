import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { rowMotion, usePresentList } from "@/ui/motion";
import { useText } from "@/i18n";
import { Boxed } from "@/upstreams/parts";
import { parseRange, rangeText, v4Span } from "./cidr";
import { rangeListText } from "./RangeList.i18n";

/** 两份名单是不是同样几条（不论顺序） */
function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/**
 * 放行网段：一条一行，最后一行输入新的。
 *
 * **和密钥对话框里的「通配规则」同一个样子** —— 列出来的就是名单本身，
 * 输入框在名单的最后一行，右边写着「回车添加」。名单外面单放一个输入框
 * 的话，已经加进去的几条看起来像另一个输入框，而没按回车的那一条看起来
 * 像是已经加上了。
 *
 * 写错的当场说，留在输入框里改；不带前缀的是单个地址。**删一条写成字**（「删除」），
 * 不用 ×：× 在这个应用里只表示关闭。
 */
export function RangeList({
  id,
  value,
  defaults,
  disabled,
  onChange,
}: {
  id?: string;
  value: string[];
  /** 默认名单。和它不一样时给出「恢复默认」 */
  defaults: string[];
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) {
  const t = useText(rangeListText);
  const rows = usePresentList(value, (c) => c);
  const [draft, setDraft] = useState("");
  const [bad, setBad] = useState<string | null>(null);

  function commit() {
    const raw = draft.trim();
    if (!raw) return;
    const r = parseRange(raw);
    if (!r) {
      setBad(raw);
      return;
    }
    const text = rangeText(r, raw);
    if (!value.includes(text)) onChange([...value, text]);
    setDraft("");
  }

  const note = (c: string) => {
    const r = parseRange(c);
    if (!r) return "";
    const span = v4Span(r);
    if (span) return `${span[0]} – ${span[1]}`;
    return r.prefix === (r.v === 4 ? 32 : 128) ? t.single : "";
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-1">
      <Boxed className={cn(bad && "border-destructive")}>
        {rows.map(({ item: c, key, presence }) => (
          <div
            key={key}
            className={cn("group/range flex h-8 items-center gap-2.5 border-b border-border pr-1 pl-3", rowMotion(presence))}
          >
            <span className="min-w-0 flex-1 truncate font-mono tw-body">{c}</span>
            <span className="shrink-0 font-mono tw-label tabular-nums text-muted-foreground">{note(c)}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={t.remove(c)}
              disabled={disabled}
              className="shrink-0 text-muted-foreground"
              onClick={() => onChange(value.filter((x) => x !== c))}
            >
              {t.removeShort}
            </Button>
          </div>
        ))}
        <div className="flex h-8 items-center gap-2.5 bg-background px-3">
          <Input
            id={id}
            className="h-7 flex-1 border-0 bg-transparent px-0 font-mono shadow-none focus-visible:ring-0 dark:bg-transparent"
            value={draft}
            disabled={disabled}
            placeholder={t.placeholder}
            aria-invalid={bad ? true : undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => {
              setDraft(e.target.value);
              setBad(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
              e.preventDefault();
              commit();
            }}
            // 输了没按回车就去点别处：这一条也算上，不让它悄悄丢掉
            onBlur={commit}
          />
          <span className="shrink-0 tw-label text-muted-foreground">{t.enterToAdd}</span>
        </div>
      </Boxed>
      {bad ? (
        <p className="tw-label text-destructive">{t.bad(bad)}</p>
      ) : (
        <p className={cn("tw-label", value.length === 0 ? "text-warning" : "text-muted-foreground")}>
          {value.length === 0 ? t.empty : t.what}
          {!sameSet(value, defaults) && (
            <Button
              type="button"
              variant="link"
              disabled={disabled}
              className="ml-2 h-auto p-0 tw-label font-normal text-foreground underline-offset-2"
              onClick={() => onChange(defaults)}
            >
              {t.restore}
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
