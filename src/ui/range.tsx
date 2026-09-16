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

export type Range = {
  ms: number;
  label: string;
  /**
   * 实时档。
   *
   * **只有图是实时的，别的都不是。**两分钟窗口里算不出有意义的延迟
   * 分位，也统计不出缓存命中率 —— 那些仍然按 24 小时算，图下面有一行
   * 小字说明。切到这一档，图每秒左移一格，有请求进来最右边立刻长高。
   */
  live?: boolean;
  /**
   * 「较上一个 X」里的那个 X。
   *
   * **和 `label` 不是一回事。**自定义区间的 label 是「9/8 至今」，
   * 套进「较上一个」就不通了 —— 那时它只是一段等长的时间。
   */
  compare: string;
};

export const DEFAULT_RANGE: Range = { ms: DAY, label: "24 小时", compare: "24 小时" };

/** 实时档的窗口：两分钟、一秒一格。 */
export const LIVE_RANGE: Range = {
  ms: 2 * 60_000,
  label: "实时",
  compare: "24 小时",
  live: true,
};

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
  const preset = value.live
    ? undefined
    : PRESETS.find((p) => p.ms === value.ms && !value.label.includes("至"));

  return (
    <div className="flex items-center gap-2">
      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={value.live ? "live" : (preset?.id ?? "")}
        onValueChange={(v) => {
          if (v === "live") return onChange(LIVE_RANGE);
          const p = PRESETS.find((x) => x.id === v);
          if (p) onChange({ ms: p.ms, label: p.label, compare: p.label });
        }}
      >
        <ToggleGroupItem value="live">
          {/* 会呼吸的点。**它是这一档唯一的装饰**，而它说的是真的：
              那条曲线确实在动 */}
          <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-cache-hit" />
          实时
        </ToggleGroupItem>
        {PRESETS.map((p) => (
          <ToggleGroupItem key={p.id} value={p.id}>
            {p.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={preset || value.live ? "ghost" : "outline"} size="sm">
            <CalendarIcon />
            {preset || value.live ? "自定义" : value.label}
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
                compare: "等长区间",
              });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
