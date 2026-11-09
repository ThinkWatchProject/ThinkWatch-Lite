import type { Dispatch, SetStateAction } from "react";
import { ArrowDownIcon, ArrowUpIcon, Columns3Icon } from "lucide-react";
import { useText } from "@/i18n";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/ui/popover";
import { COMPACT_COLUMNS, DEFAULT_COLUMNS, moveColumn, orderedColumns, pinColumn, toggleColumn, type Columns, type Pin } from "./columns";
import { trafficText } from "./Traffic.i18n";
import type { Col } from "./virtual";

export function ColumnSettings({ settings, columns, onChange }: {
  settings: Columns;
  columns: Col[];
  onChange: Dispatch<SetStateAction<Columns>>;
}) {
  const t = useText(trafficText);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3Icon />
          {t.columns}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <PopoverTitle>{t.columns}</PopoverTitle>
        <div className="flex gap-1">
          <Button variant="outline" size="xs" onClick={() => onChange(COMPACT_COLUMNS)}>
            {t.compactColumns}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => onChange(DEFAULT_COLUMNS)}>
            {t.resetColumns}
          </Button>
        </div>
        <div>
          {orderedColumns(settings).map((col) => (
            <div key={col} className="flex items-center gap-2 py-1">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <Checkbox
                  checked={columns.includes(col)}
                  disabled={col === "status"}
                  onCheckedChange={(shown) => onChange((prev) => toggleColumn(prev, col, shown === true))}
                />
                {t[col]}
              </label>
              <NativeSelect size="inline" className="w-24 shrink-0"
                aria-label={t.pinColumn(t[col])}
                value={settings.pinned[col] ?? "none"}
                onChange={(e) => onChange((prev) => pinColumn(prev, col, e.target.value === "none" ? null : e.target.value as Pin))}
              >
                <NativeSelectOption value="none" disabled={col === "status" && Object.entries(settings.pinned).some(([c, p]) => c !== "status" && p === "left")}>{t.unpinnedColumn}</NativeSelectOption>
                <NativeSelectOption value="left">{t.pinColumnLeft}</NativeSelectOption>
                {col !== "status" && <NativeSelectOption value="right">{t.pinColumnRight}</NativeSelectOption>}
              </NativeSelect>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={moveColumn(settings, col, -1) === settings}
                aria-label={t.moveColumnUp(t[col])}
                onClick={() => onChange((prev) => moveColumn(prev, col, -1))}
              ><ArrowUpIcon /></Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={moveColumn(settings, col, 1) === settings}
                aria-label={t.moveColumnDown(t[col])}
                onClick={() => onChange((prev) => moveColumn(prev, col, 1))}
              ><ArrowDownIcon /></Button>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
