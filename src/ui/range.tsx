import { useCallback, useState } from "react";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Calendar } from "@/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { Segmented } from "@/ui/segmented";
import { StatusDot } from "@/ui/status-dot";
import { bucketStart } from "@/format";
import { textOf, useText } from "@/i18n";
import { rangeText } from "./range.i18n";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
   * **只有图（和它的图例）是实时的，别的都不是。**十分钟里的样本撑不起有意义
   * 的延迟分位，也统计不出像样的缓存命中率 —— 那些仍然按 24 小时算，各节标题
   * 右边标着。切到这一档，图一直往左走，有请求进来最右边立刻长高。
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
function fromPreset(p: Preset): Range {
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

/** 一个预设区间。从别的页带着区间跳过来时用 */
export function presetRange(id: Preset["id"]): Range {
  return fromPreset(PRESETS.find((p) => p.id === id) ?? PRESETS[0]!);
}

/**
 * 一格多宽。
 *
 * **比「一小时一格」细得多，这是故意的。**少而肥的格子只能看出「这段
 * 时间有没有用过」；细到四五十格以上，图上开始能看出**作息** —— 白天
 * 成片、夜里断开、周末矮一截。一张能看出作息的图才是仪表。
 *
 * 上限压在 120 格上下：再密就是把噪声当细节，而每一格还要再乘上模型
 * 个数去查库。
 */
export function bucketFor(rangeMs: number): number {
  if (rangeMs > 7 * DAY) return 6 * HOUR;
  if (rangeMs > 2 * DAY) return 2 * HOUR;
  return HOUR / 2;
}

/**
 * 一个区间从哪一刻算起。
 *
 * **对齐到格子的边界**，和概览那张图的格子一致。安全日志也按它取：从概览
 * 点进去时，日志的条数和概览上那个数是同一批，差一个格子的话两边就对不上。
 *
 * 实时档的汇总按 24 小时算（见 `LIVE_RANGE`），起点也按 24 小时取。
 */
export function windowStart(r: Range, now = Date.now()): number {
  return r.live ? bucketStart(now - DAY, HOUR) : bucketStart(now - r.ms, bucketFor(r.ms));
}

/**
 * 自定义区间：**从那一天到现在**。
 *
 * 它由起始的那一天完全决定 —— 跨度是算出来的，不是存下来的。这也是
 * 记住它时只记那一天的原因：隔了一小时再回来，「9 月 8 日至今」该多
 * 出那一小时，而不是原封不动地把当时的跨度搬过来。
 */
export function customRange(d: Date): Range {
  return {
    ms: Math.max(60_000, Date.now() - d.getTime()),
    get label() {
      return textOf(rangeText).since(d.toLocaleDateString());
    },
    get compare() {
      return textOf(rangeText).sameLength;
    },
    custom: true,
  };
}

/**
 * 实时档的窗口：十分钟，五秒一格（见 `LIVE_BUCKET_MS`）。
 *
 * **不能短到只剩「刚才那一下」。**一次 Claude Code 的任务往往连着跑上
 * 几分钟、几十条请求，两分钟的窗口里只看得见最后几条，看不出这一阵是
 * 刚起头还是快收尾了。十分钟装得下一整段，也装得下它前面那段空闲。
 */
export const LIVE_RANGE: Range = {
  ms: 10 * 60_000,
  get label() {
    return textOf(rangeText).live;
  },
  get compare() {
    return textOf(rangeText).preset["1d"];
  },
  live: true,
};

/**
 * 记住上次看的是哪一档。
 *
 * **换个页面再回来，看到的该还是刚才那一档。**概览是会被离开又回来
 * 的页面（去流量里翻一条请求，再回来看整体），而每回来一次就把范围
 * 弹回默认值，等于要求人记住自己刚才选了什么，然后重选一遍。
 *
 * 存的是**哪一档**，不是那个 `Range` 对象：`label` 和 `compare` 是按
 * 当前语言现取的 getter，序列化会把它们冻成当时那种语言；自定义区间
 * 的跨度也是按「到现在」算出来的，存下来隔一阵就不对了。所以只存一个
 * 标识，回来时重新构造。
 *
 * 出厂停在实时档 —— 第一次打开时，「现在有没有在跑」比「过去一天用了
 * 多少」更是个问题。
 *
 * `key` 让每一页各记各的：概览看的是「今天花了多少」，流量翻的是
 * 「上周二那阵子」—— 把两者绑在一起，去流量里查一次就会把概览也拨走。
 */
export function useRange(
  key = "tw-range",
  /**
   * 没存过的时候停在哪一档。
   *
   * **概览停实时，流量不行** —— 实时只有十分钟，一张请求表开局只剩十分钟
   * 的内容，看起来像什么都没有。翻历史的页面该从一天起步。
   */
  fallback: "live" | "1d" | "7d" | "30d" = "live",
): [Range, (r: Range) => void] {
  const [range, set] = useState<Range>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      const start = () => {
        if (fallback === "live") return LIVE_RANGE;
        const p = PRESETS.find((x) => x.id === fallback);
        return p ? fromPreset(p) : LIVE_RANGE;
      };
      if (!raw) return start();
      if (raw === "live") return LIVE_RANGE;
      const p = PRESETS.find((x) => x.id === raw);
      if (p) return fromPreset(p);
      if (raw.startsWith("from:")) {
        const d = new Date(raw.slice(5));
        // 存坏了、或者那一天在将来（改过系统时间）：当没存过
        if (!Number.isNaN(d.getTime()) && d.getTime() < Date.now()) return customRange(d);
      }
    } catch {
      // 读不到就用默认的。**不能因为存不了偏好就让这一页打不开**
    }
    const p = PRESETS.find((x) => x.id === fallback);
    return fallback === "live" || !p ? LIVE_RANGE : fromPreset(p);
  });

  const put = useCallback((r: Range) => {
    set(r);
    try {
      const id = r.live
        ? "live"
        : r.custom
          ? `from:${new Date(Date.now() - r.ms).toISOString()}`
          : (PRESETS.find((x) => x.ms === r.ms)?.id ?? "");
      if (id) window.localStorage.setItem(key, id);
    } catch {
      // 存不下就只在这一程里记着
    }
  }, [key]);

  return [range, put];
}

/**
 * 统计口径的时间范围。
 *
 * 预设覆盖绝大多数情况；自定义区间给的是「上个月账单对不上」那类问题，
 * 它需要的是一个具体的起止日，不是一个相对窗口。
 */
export function RangePicker({
  value,
  onChange,
  live = true,
  align = "end",
}: {
  value: Range;
  onChange: (r: Range) => void;
  /** 显不显示实时档。**流量页不显示** —— 十分钟的一张表说明不了什么 */
  live?: boolean;
  /** 日历朝哪边展开。放在一行左端时要 `start`，否则日历会往左盖住那排档位 */
  align?: "start" | "end";
}) {
  const t = useText(rangeText);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState<Date | undefined>();
  const preset = value.live
    ? undefined
    : PRESETS.find((p) => p.ms === value.ms && !value.custom);

  return (
    <div className="flex items-center gap-2">
      <Segmented<string>
        label={t.label}
        value={value.live ? "live" : (preset?.id ?? "")}
        options={[
          ...(live
            ? [
                {
                  id: "live",
                  label: (
                    <>
                      {/* 选中时是绿点，没选中是灰点。**不在这里跳**：跳动的那个点在图的
                          标题上（`LiveBadge`），同一件事不用两处一起闪 */}
                      <StatusDot tone={value.live ? "ok" : "idle"} />
                      {t.live}
                    </>
                  ),
                },
              ]
            : []),
          ...PRESETS.map((p) => ({ id: p.id, label: t.preset[p.id] })),
        ]}
        onChange={(v) => {
          if (v === "live") return onChange(LIVE_RANGE);
          const p = PRESETS.find((x) => x.id === v);
          if (p) onChange(fromPreset(p));
        }}
      />

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant={preset || value.live ? "ghost" : "outline"} size="sm">
            <CalendarIcon />
            {preset || value.live ? t.custom : value.label}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align={align}>
          <Calendar
            mode="single"
            selected={from}
            disabled={{ after: new Date() }}
            onSelect={(d) => {
              if (!d) return;
              setFrom(d);
              onChange(customRange(d));
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
