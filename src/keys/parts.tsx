import { Logo, clientGlyph } from "@/ui/logos";
import { AnimatedNumber } from "@/ui/motion";
import { StatusDot } from "@/ui/status-dot";
import { cn } from "@/lib/utils";
import { CostFigure } from "@/CostFigure";
import { when } from "@/format";
import { useText } from "@/i18n";
import { BARS, type KeyUse } from "./usage";
import { partsText } from "./parts.i18n";

/**
 * 密钥页和客户端页共用的几样小东西。两页的表格是同一个长相：每行开头一块带标志的
 * 小方块（`@/ui/tile`）、两行字，右边一格 24 小时的用量（小柱图 + 次数）。
 */

/**
 * 方块里的客户端标志（单色）。**认不出来的写名字的第一个字**，不再套一层小方框
 * —— 外面已经是一个方块了，框里再画框是两层边。
 */
export function ClientMark({ id, name, size = 16 }: { id: string; name: string; size?: 16 | 18 }) {
  const g = clientGlyph(id) ?? clientGlyph(name);
  if (g) return <Logo id={g} size={size} />;
  const ch = Array.from(name.trim().replace(/^[^\p{L}\p{N}]+/u, ""))[0]?.toUpperCase() ?? "?";
  return <span className={cn("font-semibold leading-none", size === 18 ? "tw-title" : "tw-body")}>{ch}</span>;
}

/**
 * 24 小时的小柱图：一格一小时，最后一格是正在走的这一小时（时间窗见 `usageWindow`）。
 *
 * **每一行按自己的最大值画**：它回答的是「什么时候在用」，量有多大由旁边的
 * 数字说。空着的小时画一道很淡的底线 —— 一条什么都没有的空白读起来像是没取到。
 */
export function Sparkline({ series, className }: { series: number[]; className?: string }) {
  const max = Math.max(0, ...series);
  // 读屏读旁边的次数就够了：一排柱子念出来是二十四个数
  return (
    <span aria-hidden className={cn("flex h-4 shrink-0 items-end gap-px", className)}>
      {series.map((v, i) => (
        <span
          key={i}
          className={cn(
            "w-[2px] rounded-[1px] motion-bar",
            v > 0 ? (i === series.length - 1 ? "bg-chart-1" : "bg-chart-2") : "bg-foreground/[0.08]",
          )}
          // 有请求的格子至少 3px 高：一次请求的那一格要看得见
          style={{ height: v > 0 ? `max(3px, ${Math.round((v / max) * 100)}%)` : "1px" }}
        />
      ))}
    </span>
  );
}

/**
 * 24 小时那一格：小柱图，次数，下面一行是最近一次使用。
 *
 * · 用量没取到（`use === undefined` 且 `loaded` 为假）：只写「—」，不画一条空的柱图
 *   —— 那等于说「没有请求」，是一个编出来的零。
 * · 取到了、这把密钥没有请求：底线柱图 + 「—」。
 * · 名字为空（这个客户端还没有密钥）：「—」。
 * · 此刻有带着这把密钥的请求在跑（`busy`）：下面一行换成一个跳动的点和「请求中」
 *   —— 最近一次使用就是现在。
 *
 * 小柱图在窄窗口下收起（页面上的 `@container/page` 窄于 48rem）。
 */
export function UsageCell({
  use,
  loaded,
  lastSeen,
  busy,
  hasKey = true,
}: {
  use: KeyUse | undefined;
  /** 整份用量取到了没有 */
  loaded: boolean;
  lastSeen: number | null | undefined;
  /** 此刻有请求在跑 */
  busy?: boolean;
  hasKey?: boolean;
}) {
  const t = useText(partsText);
  if (!hasKey) return <span className="text-muted-foreground">—</span>;
  const n = use?.requests ?? 0;
  return (
    <div className="flex items-center justify-end gap-3">
      {loaded && (
        <Sparkline series={use?.series ?? EMPTY} className="motion-fade @max-3xl/page:hidden" />
      )}
      {/* 定宽：几行的小柱图才排成一列，不跟着右边字的长短左右错开 */}
      <div className="w-[5.5rem] shrink-0 text-right">
        <div className={cn("tw-num", !(loaded && n > 0) && "text-muted-foreground")}>
          {loaded && n > 0 ? <AnimatedNumber value={n} format={t.requests} /> : "—"}
        </div>
        <div className="tw-label tw-num text-muted-foreground">
          {busy ? (
            <span className="motion-fade inline-flex items-center gap-1.5">
              <StatusDot tone="pending" />
              {t.inProgress}
            </span>
          ) : (
            <LastSeen at={lastSeen} />
          )}
        </div>
      </div>
    </div>
  );
}

const EMPTY: number[] = new Array<number>(BARS).fill(0);

/** 最近一次使用：今天的写到秒，更早的写日期；从没用过就说从未使用 */
export function LastSeen({ at }: { at: number | null | undefined }) {
  const t = useText(partsText);
  return <>{at ? when(at) : t.neverUsed}</>;
}

/**
 * 金额那一格：没有请求写「—」；有请求的照概览排行那一格的写法（`CostFigure`）——
 * 算不出钱的写成一个词、不写「$0」，含估算的带「~」，缺了算不出来的带「≥」
 */
export function CostCell({ use, loaded }: { use: KeyUse | undefined; loaded: boolean }) {
  if (!loaded || !use || use.requests === 0) return <span className="text-muted-foreground">—</span>;
  return <CostFigure c={use} />;
}
