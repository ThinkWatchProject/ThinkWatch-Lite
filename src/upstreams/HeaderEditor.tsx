import { useState } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { useText } from "@/i18n";
import { headerEditorText } from "./HeaderEditor.i18n";
import { headerRow, keepsSavedValue, type HeaderRow, type UpstreamForm } from "./upstreamForm";

/**
 * 发给上游的请求头，一行一个。
 *
 * **已保存的敏感值不回填**：那一行的值留空表示沿用，和 API 密钥同一个约定。
 * 名称和值写得对不对（保留头、重名、占位符）由 core 在检测和保存时说。
 */
export function HeaderEditor({
  form,
  set,
}: {
  form: UpstreamForm;
  set: (patch: Partial<UpstreamForm>) => void;
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

  return (
    <div className="flex flex-col gap-2">
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
            placeholder={keepsSavedValue(form, r) ? t.keepSaved : t.valuePlaceholder}
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
