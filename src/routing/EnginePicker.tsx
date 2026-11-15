import { useRef } from "react";
import { useText } from "@/i18n";
import type { SearchEngine } from "@/types";
import { Button } from "@/ui/button";
import { Combobox, ComboboxTrigger, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty, ComboboxSeparator } from "@/ui/combobox";
import { webToolsText } from "./WebTools.i18n";
import { selectedEngines, type EngineChoice } from "./webToolsForm";

const engines: Record<SearchEngine, string> = { bing: "Bing", duckduckgo: "DuckDuckGo" };
const choices: EngineChoice[] = ["auto", ...Object.keys(engines) as SearchEngine[]];

/** Automatic is exclusive; an empty saved list continues to follow Core defaults. */
export function EnginePicker({ id, value, disabled, onChange }: {
  id: string;
  value: SearchEngine[];
  disabled: boolean;
  onChange: (value: SearchEngine[]) => void;
}) {
  const t = useText(webToolsText);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const label = (choice: EngineChoice) => choice === "auto" ? t.auto : engines[choice];
  const names = value.map(label).join(", ");
  const summary = value.length > 2 ? t.engineCount(value.length) : names || t.auto;
  return <Combobox<EngineChoice, true> multiple items={choices} value={value.length ? value : ["auto"]} disabled={disabled}
    itemToStringLabel={label} onValueChange={(next) => onChange(selectedEngines(value, next))}>
    <ComboboxTrigger ref={trigger} id={id} title={names || t.auto} render={<Button type="button" variant="outline" className="w-full min-w-0 justify-between border-input font-normal" />}>
      <span className="truncate">{summary}</span>
    </ComboboxTrigger>
    <ComboboxContent aria-label={t.engines} finalFocus={trigger}>
      <ComboboxInput showTrigger={false} aria-label={t.findEngine} placeholder={t.findEngine} />
      <ComboboxEmpty>{t.noEngineMatch}</ComboboxEmpty>
      <ComboboxList>{(choice: EngineChoice) => <div key={choice} role="presentation">
        <ComboboxItem value={choice}>{label(choice)}</ComboboxItem>
        {choice === "auto" && <ComboboxSeparator />}
      </div>}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}
