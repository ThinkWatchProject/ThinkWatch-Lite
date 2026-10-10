import { AnimatedNumber } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { cn } from "@/lib/utils";
import { useText } from "@/i18n";
import { usd } from "@/types";
import { overviewText } from "@/overview/overview.i18n";
import { rankCost } from "@/overview/series";

/**
 * 一段时间里的费用，三态分开：实测加估算的金额（微分）、其中估算的部分、算不出钱的条数
 * （无法计价的、没有用量的）
 */
export type CostParts = { cost: number; estimated: number; unpriced: number; noUsage: number };

/**
 * 一段时间里的费用：一个数或一个词，说明进悬停。
 *
 * **和概览的明细表同一套写法**（`rankCost`）：有用量却一条都没算出钱的写「无法
 * 计价」，连用量都没有的写「无用量」 —— **不写 $0**，那是在说它不花钱；其余写金额，
 * 有算不出来的请求时金额只是下限（「≥」），含估算的带「~」。
 *
 * 密钥页、上游页的合计用它。概览那一格另有点进流量页的动作，自己画。
 */
export function CostFigure({ c, className }: { c: CostParts; className?: string }) {
  const t = useText(overviewText);
  const r = rankCost(c, t);
  const shown =
    r.kind === "unpriced" ? (
      t.unpricedCell
    ) : r.kind === "noUsage" ? (
      t.noUsageCell
    ) : (
      <AnimatedNumber value={c.cost} format={(v) => r.prefix + usd(Math.round(v))} />
    );
  const look =
    r.kind === "unpriced"
      ? "text-warning"
      : r.kind === "noUsage"
        ? "text-muted-foreground"
        : r.notes.length > 0 && "underline decoration-dotted underline-offset-2";
  if (r.notes.length === 0) return <span className={className}>{shown}</span>;
  // 词的颜色压过调用方给的：页头的合计是 `text-foreground`，「无法计价」要的是琥珀色
  return (
    <Tip
      text={
        <div className="space-y-1">
          {r.notes.map((l) => (
            <p key={l}>{l}</p>
          ))}
        </div>
      }
    >
      <span className={cn(className, look)}>{shown}</span>
    </Tip>
  );
}
