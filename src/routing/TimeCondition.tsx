import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Input } from "@/ui/input";
import { useText } from "@/i18n";
import { ToggleChips } from "./fields";
import {
  DAY_CODES,
  blankTimeWindow,
  formatDays,
  formatTime,
  formatTimeWindow,
  parseTime,
  parseTimeWindow,
  type DayCode,
} from "./timeWindow";
import { timeConditionText } from "./TimeCondition.i18n";
import { timeWindowText } from "./timeWindow.i18n";

/**
 * 一个时段在编辑器里的样子。读得懂的值拆成星期和两个时间框；读不懂的（手写进配置的）
 * 按原文给一个输入框，照样能改能删。`key` 只给列表用：删掉中间一行，后面几行的输入框不串
 */
type Row =
  | { key: string; kind: "picker"; days: boolean[]; start: string; end: string }
  | { key: string; kind: "raw"; text: string };

let seq = 0;
function nextKey(): string {
  seq += 1;
  return `tw${seq}`;
}

function rowOf(value: string): Row {
  const w = parseTimeWindow(value);
  if (!w) return { key: nextKey(), kind: "raw", text: value };
  return { key: nextKey(), kind: "picker", days: w.days, start: formatTime(w.start), end: formatTime(w.end) };
}

function blankRow(): Row {
  const w = blankTimeWindow();
  return { key: nextKey(), kind: "picker", days: w.days, start: formatTime(w.start), end: formatTime(w.end) };
}

/**
 * 一行 → 写进条件的值。合语法的写成规范形；一天都没选、时间写不对的，写成一个**读不回来**
 * 的值，让保存按钮旁边说话（`conditionProblem`）—— 不能写成「每天」，那是另一个意思
 */
function valueOf(r: Row): string {
  if (r.kind === "raw") return r.text;
  const start = parseTime(r.start);
  const end = parseTime(r.end);
  if (start != null && end != null) {
    const v = formatTimeWindow({ days: r.days, start, end });
    if (v) return v;
  }
  return `${formatDays(r.days) || "none"} ${r.start.trim()}-${r.end.trim()}`;
}

/**
 * 条件「时段」的编辑器：每个时段一行 —— 七个星期开关（周一在前）、开始、结束；几个时段
 * 满足其一即可，和其他多值条件一样。
 *
 * **行是这里的状态，条件的值从行算出来。**反过来（每次从值解析）的话，时间框里打到一半的
 * `9:` 读不回来，整行就会退成原文输入框。打开对话框时从值解析一次，之后只往外写
 */
export function TimeCondition({
  values,
  onChange,
  label,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  /** 读屏读出来的这一组叫什么 */
  label: string;
}) {
  const t = useText(timeConditionText);
  const dt = useText(timeWindowText);
  const [rows, setRows] = useState<Row[]>(() => (values.length ? values.map(rowOf) : [blankRow()]));
  const update = (next: Row[]) => {
    setRows(next);
    onChange(next.map(valueOf));
  };
  const patch = (i: number, p: Partial<Row>) =>
    update(rows.map((r, j) => (j === i ? ({ ...r, ...p } as Row) : r)));
  const dayOptions = DAY_CODES.map((id) => ({ id, label: t.days[id] }));
  return (
    <div className="flex w-full flex-col gap-2.5">
      {rows.map((r, i) => {
        const n = i + 1;
        const remove = rows.length > 1 && (
          <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground"
            aria-label={t.removeWindow(n)}
            onClick={() => update(rows.filter((_, j) => j !== i))}
          >
            {t.remove}
          </Button>
        );
        if (r.kind === "raw") {
          return (
            <div key={r.key} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Input
                  aria-label={t.window(n)}
                  className="font-mono"
                  value={r.text}
                  onChange={(e) => patch(i, { text: e.target.value })}
                />
                {remove}
              </div>
              <p className="tw-label text-muted-foreground">{t.rawHint}</p>
            </div>
          );
        }
        const start = parseTime(r.start);
        const end = parseTime(r.end);
        const overnight = start != null && end != null && end < start;
        // 两行一个时段：星期一行、时间一行。七个开关加两个时间框在对话框里排不进一行
        return (
          <div key={r.key} className="flex flex-col items-start gap-1.5">
            <ToggleChips
              mono={false}
              label={`${label} ${n}`}
              options={dayOptions}
              value={r.days.flatMap((on, k) => (on ? [DAY_CODES[k]!] : []))}
              onChange={(u) => {
                const on = u(r.days.flatMap((x, k) => (x ? [DAY_CODES[k]!] : [])));
                patch(i, { days: DAY_CODES.map((d: DayCode) => on.includes(d)) });
              }}
            />
            <div className="flex items-center gap-1.5">
              <TimeInput
                label={t.start(n)}
                value={r.start}
                onChange={(v) => patch(i, { start: v })}
              />
              <span className="text-muted-foreground">–</span>
              <TimeInput label={t.end(n)} value={r.end} onChange={(v) => patch(i, { end: v })} />
              {overnight && <span className="pl-1 tw-label text-muted-foreground">{dt.nextDay}</span>}
              {remove}
            </div>
          </div>
        );
      })}
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 self-start text-muted-foreground"
        onClick={() => update([...rows, blankRow()])}
      >
        <PlusIcon />
        {t.addWindow}
      </Button>
      <p className="tw-label text-muted-foreground">{t.note}</p>
    </div>
  );
}

/** `HH:MM`。离开时写成规范形（`9:00` → `09:00`）；写不对的标红，值照样留着 */
function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const minutes = parseTime(value);
  return (
    <Input
      aria-label={label}
      aria-invalid={minutes == null || undefined}
      className="w-18 text-center font-mono"
      inputMode="numeric"
      placeholder="09:00"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (minutes != null && formatTime(minutes) !== value) onChange(formatTime(minutes));
      }}
    />
  );
}
