import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { useText } from "@/i18n";
import { webToolsText } from "./WebTools.i18n";
import { domainList, validDomain } from "./webToolsForm";

/** One hostname per row. Drafts belong to the form so Save never drops input. */
export function DomainList({ id, value, draft, onDraft, onChange }: {
  id: string;
  value: string[];
  draft: string;
  onDraft: (value: string) => void;
  onChange: (value: string[]) => void;
}) {
  const t = useText(webToolsText);
  const entries = domainList(value, draft);
  const invalid = entries.filter((entry) => !validDomain(entry));
  const tooMany = entries.length > 100;
  function add() {
    if (!draft.trim() || invalid.length || tooMany) return;
    onChange(entries);
    onDraft("");
  }
  return <div className="min-w-0">
    <div className="overflow-hidden rounded-lg border border-border">
      <ul className="max-h-48 overflow-y-auto divide-y divide-border">
        {value.map((domain) => <li key={domain} className="flex min-h-8 items-center gap-2 px-3 py-1">
          <span className="min-w-0 flex-1 break-all font-mono tw-body">{domain}</span>
          <Button type="button" variant="ghost" size="xs" aria-label={t.removeDomain(domain)} onClick={() => onChange(value.filter((entry) => entry !== domain))}>{t.remove}</Button>
        </li>)}
      </ul>
      <div className={`flex items-center gap-2 p-2 ${value.length ? "border-t" : ""}`}>
        <Input id={id} value={draft} placeholder={t.domainPlaceholder} aria-invalid={invalid.length > 0 || tooMany} aria-describedby={`${id}-error`}
          autoComplete="off" autoCapitalize="off" spellCheck={false}
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); add(); } }} />
        <Button type="button" variant="outline" size="sm" disabled={!draft.trim() || invalid.length > 0 || tooMany} onClick={add}>{t.add}</Button>
      </div>
    </div>
    <p id={`${id}-error`} className="mt-1 tw-label text-destructive" role={invalid.length || tooMany ? "alert" : undefined}>
      {invalid.length ? t.invalidDomains(invalid.join(", ")) : tooMany ? t.tooManyDomains : null}
    </p>
  </div>;
}
