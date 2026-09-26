import { useState } from "react";
import { LockIcon, PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { headerEditorText } from "./HeaderEditor.i18n";
import { headerRow, type HeaderRow, type UpstreamForm } from "./upstreamForm";

/**
 * 发给上游的请求头，一行一个，值是配置里写的原样。
 *
 * 名称和值写得对不对（保留头、重名、占位符）由 core 在检测和保存时说。
 *
 * **第一行是鉴权头**（有的话），和企业版一样把密钥当成请求头里的一行给人看。
 * 它由 API 密钥或 OAuth 凭据生成、跟着协议换名字，这里只显示不能改。
 */
export interface AuthRow {
  source: "key" | "oauth";
  /** 头的名字。地址还没填、不知道协议时是 null，显示 `unknownName` */
  name: string | null;
  unknownName: string;
  /** 值前面拼的，`Bearer` */
  prefix: string;
  /** 显示的值；null 时显示 `placeholder`（OAuth 的 token 是运行时换发的） */
  value: string | null;
  placeholder: string;
}

export function HeaderEditor({
  form,
  set,
  auth,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
  auth: AuthRow | null;
}) {
  const t = useText(headerEditorText);
  // 新加的那一行自动聚焦到名称
  const [focus, setFocus] = useState<number | null>(null);
  const rows = form.headers;

  function update(id: number, patch: Partial<HeaderRow>) {
    set({ headers: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }

  function add() {
    const row = headerRow();
    setFocus(row.id);
    set({ headers: [...rows, row] });
  }

  // 和输入框同高同圆角，但不是输入框：不能聚焦、不能改
  const locked =
    "flex h-8 min-w-0 items-center gap-1.5 rounded-lg border border-input/60 bg-muted/50 px-2.5 font-mono tw-body";

  return (
    <div className="flex flex-col gap-2">
      {auth && (
        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <div className={locked}>
            {auth.name ? (
              <span className="truncate">{auth.name}</span>
            ) : (
              <span className="truncate font-sans text-muted-foreground">{auth.unknownName}</span>
            )}
          </div>
          <div className={locked}>
            {auth.prefix && <span className="shrink-0 text-muted-foreground">{auth.prefix}</span>}
            {auth.value !== null ? (
              <span className="truncate">{auth.value}</span>
            ) : (
              <span className="truncate font-sans text-muted-foreground">{auth.placeholder}</span>
            )}
          </div>
          <Tip text={auth.source === "key" ? t.fromKey : t.fromOauth}>
            <span
              className="flex size-7 items-center justify-center text-muted-foreground"
              aria-label={auth.source === "key" ? t.fromKey : t.fromOauth}
            >
              <LockIcon className="size-3.5" />
            </span>
          </Tip>
        </div>
      )}
      {rows.map((r) => (
        <div key={r.id} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-2">
          <Input
            aria-label={t.name}
            autoFocus={r.id === focus}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder={t.namePlaceholder}
            value={r.name}
            onChange={(e) => update(r.id, { name: e.target.value })}
          />
          <Input
            aria-label={r.name.trim() ? t.valueOf(r.name.trim()) : t.value}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder={t.valuePlaceholder}
            value={r.value}
            onChange={(e) => update(r.id, { value: e.target.value })}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t.remove}
            onClick={() => set({ headers: rows.filter((x) => x.id !== r.id) })}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" className="w-fit" onClick={add}>
        <PlusIcon />
        {t.add}
      </Button>
    </div>
  );
}
