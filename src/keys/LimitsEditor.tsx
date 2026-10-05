import { useState } from "react";
import { PlusIcon } from "lucide-react";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import { Input } from "@/ui/input";
import { rowMotion, usePresentList } from "@/ui/motion";
import { NativeSelect, NativeSelectOption } from "@/ui/native-select";
import { StatusLabel } from "@/ui/status-dot";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { useNow } from "@/useNow";
import { Boxed, Note } from "@/upstreams/parts";
import type { KeyLimitView } from "@/types";
import {
  MEASURES,
  PERS,
  ROW_DAYS_NEEDED,
  amount,
  cleanMax,
  newRow,
  parseMax,
  resetText,
  usageOf,
  type LimitProblem,
  type LimitRow,
} from "./limits";
import { limitsText } from "./limits.i18n";
import { limitsEditorText } from "./LimitsEditor.i18n";

/** 没有价格的模型多于这么多个时先收起，只列前面几个 */
const UNPRICED_SHOWN = 6;

/**
 * 对话框里的「用量上限」：一条一行，读起来是一句话 ——「每 [天] 最多 [5] [费用 (USD)]」，
 * token 上限再加一个「计入缓存读取」。
 *
 * 编辑一把已有的密钥时，每一行下面写着此刻用了多少（core 的 `KeyLimitView`）：天、周、月
 * 是这一期的，带重置的时刻；分钟、小时是最近这一段的。到了的那一行标出来。
 *
 * 填错的当场说，写在那一行下面。**空着的那一格等离开它才说**：刚加的一行一出现就标红，
 * 说的是一件用户正要去做的事。删一条写成字，× 在这个应用里只表示关闭。
 */
export function LimitsEditor({
  rows,
  views,
  unpriced,
  problems,
  rowDays,
  onChange,
}: {
  rows: LimitRow[];
  /** core 给的这把密钥的上限和用量。新建时是空的 */
  views: readonly KeyLimitView[];
  /** 这把密钥用得到、却没有价格的模型。core 只在已经存了费用上限时才算 */
  unpriced: readonly string[];
  problems: ReadonlyMap<number, LimitProblem>;
  /** 此刻请求记录留几天，「每月」那一条的提示用 */
  rowDays: number | null;
  onChange: (rows: LimitRow[]) => void;
}) {
  const t = useText(limitsEditorText);
  // 「今天」「00:00 重置」随时间走：开着对话框过了零点，这一行要跟着换
  const now = useNow(60_000);
  const [focus, setFocus] = useState<number | null>(null);
  /** 离开过数值那一格的行：空着的从这时起才说「请填写」 */
  const [left, setLeft] = useState<ReadonlySet<number>>(() => new Set());
  const shown = usePresentList(rows, (r) => r.id);

  function update(id: number, patch: Partial<LimitRow>) {
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function add() {
    const r = newRow(rows);
    setFocus(r.id);
    onChange([...rows, r]);
  }

  const costLimited = rows.some((r) => r.measure === "cost");

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2.5">
        <span className="tw-body font-medium">{t.title}</span>
        <span className="tw-label text-muted-foreground">{t.hint}</span>
      </div>
      {rows.length > 0 && (
        <Boxed>
          {shown.map(({ item: r, key, presence }) => {
            const n = rows.indexOf(r) + 1;
            const problem = problems.get(r.id);
            return (
              <LimitLine
                key={key}
                row={r}
                n={n}
                className={rowMotion(presence)}
                autoFocus={r.id === focus}
                problem={problem === "required" && !left.has(r.id) ? undefined : problem}
                use={usageOf(r, views)}
                rowDays={rowDays}
                now={now}
                onChange={(patch) => update(r.id, patch)}
                onLeave={() => setLeft((s) => (s.has(r.id) ? s : new Set(s).add(r.id)))}
                onRemove={() => onChange(rows.filter((x) => x.id !== r.id))}
              />
            );
          })}
        </Boxed>
      )}
      <div className="flex items-center gap-2.5">
        <Button variant="outline" size="sm" className="w-fit" onClick={add}>
          <PlusIcon />
          {t.add}
        </Button>
        {rows.length === 0 && <span className="tw-label text-muted-foreground">{t.none}</span>}
      </div>
      {costLimited && unpriced.length > 0 && <Unpriced models={unpriced} />}
    </div>
  );
}

/** 一条上限。下面一行是用量，填错时换成错在哪 */
function LimitLine({
  row: r,
  n,
  className,
  autoFocus,
  problem,
  use,
  rowDays,
  now,
  onChange,
  onLeave,
  onRemove,
}: {
  row: LimitRow;
  /** 第几条，读屏用 */
  n: number;
  className?: string;
  autoFocus: boolean;
  problem: LimitProblem | undefined;
  use: KeyLimitView | undefined;
  rowDays: number | null;
  now: number;
  onChange: (patch: Partial<LimitRow>) => void;
  /** 离开了数值那一格 */
  onLeave: () => void;
  onRemove: () => void;
}) {
  const t = useText(limitsEditorText);
  const w = useText(limitsText);
  const said =
    problem === "required"
      ? t.required
      : problem === "notPositive"
        ? t.notPositive(r.measure === "cost")
        : problem === "costTooSmall"
          ? t.costTooSmall
          : problem === "duplicate"
            ? t.duplicate
            : problem === "retention"
              ? t.retention(w.per[r.per], ROW_DAYS_NEEDED[r.per] ?? 0, rowDays ?? 0)
              : null;
  return (
    <div className={cn("flex flex-col gap-1 border-b border-border px-3 py-2 last:border-b-0", className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <span className="tw-body">{t.every}</span>
        <NativeSelect
          aria-label={t.perLabel(n)}
          value={r.per}
          onChange={(e) => onChange({ per: e.target.value as LimitRow["per"] })}
        >
          {PERS.map((p) => (
            <NativeSelectOption key={p} value={p}>
              {w.per[p]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="tw-body">{t.atMost}</span>
        <Input
          aria-label={t.maxLabel(n)}
          aria-invalid={problem === "required" || problem === "notPositive" || problem === "costTooSmall" ? true : undefined}
          autoFocus={autoFocus}
          autoComplete="off"
          spellCheck={false}
          inputMode={r.measure === "cost" ? "decimal" : "numeric"}
          className="w-24 font-mono"
          value={r.max}
          onChange={(e) => onChange({ max: cleanMax(r.measure, e.target.value) })}
          onBlur={onLeave}
          onKeyDown={(e) => {
            // 对话框会把回车当成提交
            if (e.key === "Enter") e.preventDefault();
          }}
        />
        <NativeSelect
          aria-label={t.measureLabel(n)}
          value={r.measure}
          // 换了量，数的东西就换了：5 美元和 5 次请求不是一回事，原来填的数不留
          onChange={(e) => onChange({ measure: e.target.value as LimitRow["measure"], max: "", cacheReads: false })}
        >
          {MEASURES.map((m) => (
            <NativeSelectOption key={m} value={m}>
              {w.measure[m]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {r.measure === "tokens" && (
          <label className="flex items-center gap-1.5 tw-body">
            <Checkbox checked={r.cacheReads} onCheckedChange={(v) => onChange({ cacheReads: v === true })} />
            {t.cacheReads}
          </label>
        )}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={t.removeLabel(n)}
          className="ml-auto shrink-0 text-muted-foreground"
          onClick={onRemove}
        >
          {t.remove}
        </Button>
      </div>
      {said ? (
        <p className="tw-label text-destructive">{said}</p>
      ) : (
        use && <Usage row={r} use={use} now={now} />
      )}
    </div>
  );
}

/**
 * 「今天 $1.23 / $5.00 · 00:00 重置」「最近一分钟 12 / 30」。
 *
 * 用量是 core 数的；**上限按输入框里的**：改大改小的时候，这一行说的就是改完之后的样子。
 * 到了的写出来，数字换成琥珀色
 */
function Usage({ row, use, now }: { row: LimitRow; use: KeyLimitView; now: number }) {
  const w = useText(limitsText);
  const max = parseMax(row.measure, row.max) ?? use.max;
  const reached = use.used >= max;
  const resets = use.resets_at_ms != null && use.resets_at_ms > now ? resetText(use.resets_at_ms, now) : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 tw-label text-muted-foreground">
      <span className="tw-num">
        {w.period[row.per]}{" "}
        <span className={cn(reached && "text-warning")}>
          {amount(row.measure, use.used)} / {amount(row.measure, max)}
        </span>
        {resets && ` · ${resets}`}
      </span>
      {reached && (
        <StatusLabel tone="warn" className="tw-label">
          {w.reached}
        </StatusLabel>
      )}
    </div>
  );
}

/**
 * 没有价格的模型：费用记 0，费用上限管不住它们。**多了先收起**，只列前几个
 */
function Unpriced({ models }: { models: readonly string[] }) {
  const t = useText(limitsEditorText);
  const [all, setAll] = useState(false);
  const long = models.length > UNPRICED_SHOWN;
  const listed = all || !long ? models : models.slice(0, UNPRICED_SHOWN);
  return (
    <Note tone="warning">
      {t.unpriced(models.length)} <span className="font-mono">{listed.join(", ")}</span>
      {long && (
        <>
          {" "}
          <button
            type="button"
            className="underline decoration-dotted underline-offset-2"
            onClick={() => setAll((v) => !v)}
          >
            {all ? t.fewer : t.more(models.length - UNPRICED_SHOWN)}
          </button>
        </>
      )}
    </Note>
  );
}
