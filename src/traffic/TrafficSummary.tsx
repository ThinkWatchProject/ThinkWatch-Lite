import { useCallback, useMemo } from "react";
import { useText } from "@/i18n";
import type { RequestRow } from "@/types";
import { useNow } from "@/useNow";
import { LIST_LIMIT } from "@/useRequests";
import { AnimatedNumber } from "@/ui/motion";
import { Button } from "@/ui/button";
import { SummaryItem } from "@/ui/page";
import { Sparkline } from "@/ui/sparkline";
import { StatusDot } from "@/ui/status-dot";
import { Tip } from "@/ui/tip";
import { coreNow } from "./clock";
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
  // 小图只在跨过一分钟时才要挪；十秒看一次，挪得晚也晚不过十秒。**分钟按 core 的钟
  // 对**：行上的时刻是 core 的钟，连着另一台机器上的 core 时，两边的钟差多少，请求就
  // 错开多少格（见 `clock.ts`）。还没对过钟的那一下先按本机的
  const local = useNow(10_000);
  const minute = Math.floor((coreNow(local) ?? local) / MIN) * MIN;
  const s = useMemo(() => summarize(rows, minute, LIST_LIMIT), [rows, minute]);
  const capped = rows.length >= LIST_LIMIT;
  // 小图的每一格悬停时说哪一分钟、几条、几条失败。**引用要稳**：小图只在 `bars` 或它变了时才重画
  const barTip = useCallback((b: Bar) => t.sparkBar(hhmm(b.at), b.n, b.failed), [t]);

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
        <Sparkline bars={s.bars} tip={barTip} label={t.sparkLabel(s.recent, s.recentFailed)} />
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
