import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import type { RequestRow } from "@/types";
import { useNow } from "@/useNow";
import { LIST_LIMIT } from "@/useRequests";
import { AnimatedNumber } from "@/ui/motion";
import { Button } from "@/ui/button";
import { SummaryItem } from "@/ui/page";
import { StatusDot } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { summarize, type Bar } from "./summary";
import { trafficText } from "./Traffic.i18n";

const MIN = 60_000;

/**
 * 流量页页头的那一行：在不在跑、一共几条、几条失败、近 30 分钟的节奏。
 *
 * **失败数是一个开关**：点它等于按下过滤条上的「仅显示失败」，再点一次放开。页头
 * 说「12 条失败」，下一步永远是「哪 12 条」。
 *
 * 数字变了会走过去（`AnimatedNumber`），不跳；小图按分钟对齐，每分钟往左挪一格，
 * 最右那一格是正在走的这一分钟。
 */
export function TrafficSummary({
  rows,
  failedOnly,
  onFailedOnly,
}: {
  rows: RequestRow[];
  failedOnly: boolean;
  onFailedOnly: (on: boolean) => void;
}) {
  const t = useText(trafficText);
  // 小图只在跨过一分钟时才要挪；十秒看一次，挪得晚也晚不过十秒
  const minute = Math.floor(useNow(10_000) / MIN) * MIN;
  const s = useMemo(() => summarize(rows, minute, LIST_LIMIT), [rows, minute]);
  const capped = rows.length >= LIST_LIMIT;

  // 一条都没有：下面的空状态已经说了，这里再排一串 0 和一条平线只是噪音
  if (rows.length === 0) return <SummaryItem lead={<StatusDot tone="idle" />} label={t.idle} />;

  return (
    <>
      <SummaryItem
        lead={<StatusDot tone={s.inFlight > 0 ? "pending" : "idle"} />}
        value={s.inFlight > 0 ? <AnimatedNumber value={s.inFlight} /> : undefined}
        label={s.inFlight > 0 ? t.inFlight : t.idle}
      />
      <SummaryItem
        lead={capped ? <span>{t.latest}</span> : undefined}
        value={<AnimatedNumber value={s.total} />}
        label={t.requestsUnit(s.total)}
      />
      {s.failed > 0 && (
        <Tip text={t.failedOnly}>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={failedOnly}
            onClick={() => onFailedOnly(!failedOnly)}
            // 和旁边几项同一个样子：同样的字、同样的行高（上下各让出 4px），只是悬停和按下时有底色
            className="-mx-1.5 -my-1 h-6 gap-1.5 px-1.5 font-normal text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
          >
            <StatusDot tone="error" />
            <AnimatedNumber value={s.failed} className="font-medium text-foreground" />
            <span>{t.failedUnit(s.failed)}</span>
          </Button>
        </Tip>
      )}
      <span className="inline-flex items-center gap-2 whitespace-nowrap">
        <Sparkline bars={s.bars} label={t.sparkLabel(s.recent, s.recentFailed)} />
        <span>
          {t.recent(
            <span className="tw-num font-medium text-foreground">
              {/* 列表装满了、更早的被挤了出去：这个数是下限 */}
              {!s.complete && "≥"}
              <AnimatedNumber value={s.recent} />
            </span>,
          )}
        </span>
      </span>
    </>
  );
}

/** `16:42` */
function hhmm(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 近 30 分钟每分钟几条，一分钟一格。
 *
 * 一格 4px 宽、柱子 3px：留出的那 1px 是柱子之间的空隙，悬停的范围仍然是整格，
 * 格与格之间没有摸不到的缝。失败的那一截垫在底下、用红色；没有请求的分钟画一条
 * 底线，时间轴才看得出是连续的。**最右那一格用前景色** —— 那是「现在」。
 *
 * 纵轴从 0 开始，最高那一格顶满；只有一两条请求时按 3 条算满，免得一条请求就
 * 顶到头、看起来像一阵高峰。
 */
const Sparkline = memo(function Sparkline({ bars, label }: { bars: Bar[]; label: string }) {
  const t = useText(trafficText);
  const max = Math.max(3, ...bars.map((b) => b.n));
  const last = bars.length - 1;
  return (
    <span role="img" aria-label={label} className="inline-flex h-4 items-end">
      {bars.map((b, i) => {
        const ok = b.n - b.failed;
        return (
          <Tip key={b.at} text={t.sparkBar(hhmm(b.at), b.n, b.failed)}>
            <span aria-hidden className="flex h-4 w-1 flex-col items-center justify-end">
              {b.n === 0 ? (
                <span className="h-px w-[3px] bg-muted-foreground/25" />
              ) : (
                <>
                  {ok > 0 && (
                    <span
                      className={cn(
                        "motion-bar w-[3px] rounded-t-[1px]",
                        i === last ? "bg-foreground/80" : "bg-muted-foreground/55",
                      )}
                      style={{ height: `max(2px, ${(ok / max) * 100}%)` }}
                    />
                  )}
                  {b.failed > 0 && (
                    <span
                      className={cn("motion-bar w-[3px] bg-destructive", ok === 0 && "rounded-t-[1px]")}
                      style={{ height: `max(2px, ${(b.failed / max) * 100}%)` }}
                    />
                  )}
                </>
              )}
            </span>
          </Tip>
        );
      })}
    </span>
  );
});
