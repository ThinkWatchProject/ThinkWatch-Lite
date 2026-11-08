import type { Dispatch, SetStateAction } from "react";
import { ArrowDownIcon, ArrowUpIcon, Columns3Icon } from "lucide-react";
import { useText } from "@/i18n";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/ui/popover";
import { COMPACT_COLUMNS, DEFAULT_COLUMNS, moveColumn, toggleColumn, type Columns } from "./columns";
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
      <PopoverContent align="end" className="w-64">
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
          {settings.order.map((col, i) => (
            <div key={col} className="flex items-center gap-2 py-1">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <Checkbox
                  checked={columns.includes(col)}
                  disabled={col === "status"}
                  onCheckedChange={(shown) => onChange((prev) => toggleColumn(prev, col, shown === true))}
                />
                {t[col]}
              </label>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={i <= 1}
                aria-label={t.moveColumnUp(t[col])}
                onClick={() => onChange((prev) => moveColumn(prev, col, -1))}
              ><ArrowUpIcon /></Button>
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={i === 0 || i === settings.order.length - 1}
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
