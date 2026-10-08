import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { Tip } from "@/ui/tip";
import { usd, type HistoryRow, type RequestDetail } from "@/types";
import { requestDrawerText } from "./RequestDrawer.i18n";

/**
 * 请求详情几页共用的几样：「标签：值」的几行、一排数、这一条的结局、费用那一项。
 */

/** 这一条现在是什么结局。和流量表那一格同一套说法 */
export function stateOf(d: RequestDetail): "in_flight" | "done" | "failed" | "cancelled" {
  if (d.in_flight) return "in_flight";
  if (d.row.error) return "failed";
  if (d.row.cancelled) return "cancelled";
  return "done";
}

/** `stateOf` 的那几种 */
export type DrawerState = ReturnType<typeof stateOf>;

/**
 * 几行「标签：值」。**标签那一列按最长的那个词定宽**（两列的网格），不写死宽度：
 * 英文的「Uncached input」「Matched rule」比中文宽出一截，写死的宽度要么放不下、
 * 要么在中文里空出一大块。
 */
export function Rows({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[max-content_minmax(0,1fr)] items-start gap-x-4 gap-y-1.5", className)}>
      {children}
    </dl>
  );
}

/** 一行。`swatch`：标签前的色块，和图里那一段同色 */
export function Row({ label, value, swatch }: { label: string; value: ReactNode; swatch?: string }) {
  return (
    <>
      <dt className="flex items-center gap-1.5 text-muted-foreground">
        {swatch && <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", swatch)} />}
        {label}
      </dt>
      <dd className="min-w-0 break-all">{value}</dd>
    </>
  );
}

/** 四个数一排，和会话详情顶上那一排同一个样子 */
export function Stat({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="min-w-0 border-l border-border px-3 py-2.5 first:border-l-0">
      <dt className="truncate tw-label text-muted-foreground">{label}</dt>
      <dd className={cn("mt-0.5 truncate tw-num tw-head", muted ? "text-muted-foreground" : "text-foreground")}>
        {value}
      </dd>
    </div>
  );
}

/**
 * 费用那一项。**「没有价格」「不计费」「估算」各说各的**，和 0 不是一回事。
 * `short`：放在数字那一排里，只写数和记号，理由留给「用量」那一页。
 */
export function CostText({ r, running, short }: { r: HistoryRow; running: boolean; short?: boolean }) {
  const t = useText(requestDrawerText);
  if (running) return <>{short ? "—" : t.usagePending}</>;
  if (r.billing === "free") {
    return <span className="text-muted-foreground">{short ? t.free : `${usd(0)} · ${t.free}`}</span>;
  }
  // 「没有价格」和「费用为 0」是两件事
  if (r.cost_micros == null) return <span className="text-muted-foreground">{short ? "—" : t.unpriced}</span>;
  if (!r.cost_estimated) return <>{usd(r.cost_micros)}</>;
  const why = r.cancelled ? t.estimatedCancelled : r.error ? t.estimatedInterrupted : t.estimated;
  if (short) {
    return (
      <Tip text={why}>
        <span className="underline decoration-dotted underline-offset-2">~{usd(r.cost_micros)}</span>
      </Tip>
    );
  }
  return (
    <span className="text-warning">
      ~{usd(r.cost_micros)} · {why}
    </span>
  );
}
