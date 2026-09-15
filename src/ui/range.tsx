import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Calendar } from "@/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";

const DAY = 24 * 3_600_000;

/** 三个预设。值就是窗口毫秒数 —— 后端只认这一个数。 */
const PRESETS: { id: string; label: string; ms: number }[] = [
  { id: "1d", label: "24 小时", ms: DAY },
  { id: "7d", label: "7 天", ms: 7 * DAY },
  { id: "30d", label: "30 天", ms: 30 * DAY },
];

export type Range = { ms: number; label: string };

export const DEFAULT_RANGE: Range = { ms: DAY, label: "24 小时" };

/**
 * 统计口径的时间范围。
 *
 * 预设覆盖绝大多数情况；自定义区间给的是「上个月账单对不上」那类问题，
 * 它需要的是一个具体的起止日，不是一个相对窗口。
 */
export function RangePicker({
  value,
  onChange,
}: {
  value: Range;
  onChange: (r: Range) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Date | undefined>();
  const preset = PRESETS.find((p) => p.ms === value.ms && !value.label.includes("至"));

  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={preset?.id ?? ""}
        onValueChange={(v) => {
          const p = PRESETS.find((x) => x.id === v);
          if (p) onChange({ ms: p.ms, label: p.label });
        }}
      >
        {PRESETS.map((p) => (
          <ToggleGroupItem key={p.id} value={p.id}>
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={preset ? "ghost" : "outline"} size="sm">
            <CalendarIcon />
            {preset ? "自定义" : value.label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="single"
            selected={from}
            disabled={{ after: new Date() }}
            onSelect={(d) => {
              if (!d) return;
              setFrom(d);
              const ms = Date.now() - d.getTime();
              onChange({
                ms: Math.max(60_000, ms),
                label: `${d.toLocaleDateString()} 至今`,
              });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
