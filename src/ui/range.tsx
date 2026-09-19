import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Calendar } from "@/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/ui/toggle-group";
import { textOf, useText } from "@/i18n";
import { rangeText } from "./range.i18n";

const DAY = 24 * 3_600_000;

type Preset = { id: "1d" | "7d" | "30d"; ms: number };

/** 三个预设。值就是窗口毫秒数 —— 后端只认这一个数。 */
const PRESETS: Preset[] = [
  { id: "1d", ms: DAY },
  { id: "7d", ms: 7 * DAY },
  { id: "30d", ms: 30 * DAY },
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
  /** 自定义区间。跨度恰好等于某个预设时，那个预设也不算选中 */
  custom?: boolean;
};

/*
  `label` 和 `compare` 是界面上的字，**读的时候才按当前语言取**：Range 会被
  存进页面的 state 里，存下来的若是字符串，换了语言它还是原来那种。
*/
function presetRange(p: Preset): Range {
  return {
    ms: p.ms,
    get label() {
      return textOf(rangeText).preset[p.id];
    },
    get compare() {
      return textOf(rangeText).preset[p.id];
    },
  };
}

export const DEFAULT_RANGE: Range = presetRange({ id: "1d", ms: DAY });

/** 实时档的窗口：两分钟、一秒一格。 */
export const LIVE_RANGE: Range = {
  ms: 2 * 60_000,
  get label() {
    return textOf(rangeText).live;
  },
  get compare() {
    return textOf(rangeText).preset["1d"];
  },
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
  const t = useText(rangeText);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Date | undefined>();
  const preset = value.live
    ? undefined
    : PRESETS.find((p) => p.ms === value.ms && !value.custom);

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
          if (p) onChange(presetRange(p));
        }}
      >
        <ToggleGroupItem value="live">
          {/* 会呼吸的点。**它是这一档唯一的装饰**，而它说的是真的：
              那条曲线确实在动 */}
          <span className="mr-1.5 inline-block size-1.5 animate-pulse rounded-full bg-cache-hit" />
          {t.live}
        </ToggleGroupItem>
        {PRESETS.map((p) => (
          <ToggleGroupItem key={p.id} value={p.id}>
            {t.preset[p.id]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={preset || value.live ? "ghost" : "outline"} size="sm">
            <CalendarIcon />
            {preset || value.live ? t.custom : value.label}
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
                get label() {
                  return textOf(rangeText).since(d.toLocaleDateString());
                },
                get compare() {
                  return textOf(rangeText).sameLength;
                },
                custom: true,
              });
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
