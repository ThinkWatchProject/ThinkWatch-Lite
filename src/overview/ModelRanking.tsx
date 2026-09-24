import { cn } from "@/lib/utils";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { useNav } from "@/nav";
import { compact } from "@/format";
import { usd } from "@/types";
import { useText } from "@/i18n";
import type { Metric, RankRow } from "./series";
import { LinkRow, MarkSpace, Meter, ModelMark } from "./parts";
import { overviewText } from "./overview.i18n";

const fmtTokens = (n: number) => compact(Math.round(n));

/**
 * 模型排行，也是上面那张图的图例：条的颜色就是图里那一层的颜色，条长按当前口径
 * 里最大的那一项归一。
 *
 * **药丸式的一行图例在模型一多就会折行，而且不携带比例。**这里的条长就是占比，
 * 图例的职责（颜色 ↔ 模型的映射）留下来了。
 *
 * **这一块永远在。**它在「有数据」和「没数据」之间消失的话，切一次时间范围整页
 * 就上下弹一次。没有数据时留一行字占住。
 *
 * 点一行：落到流量页，搜索框里填上这个模型名。合并的「其他」那一行不能点 ——
 * 它不是一个模型。
 */
export function ModelRanking({
  rows,
  by,
  topBar,
  scope,
  empty,
  onFocus,
}: {
  rows: RankRow[];
  by: Metric;
  topBar: number;
  scope: string;
  empty: string;
  /** 指着（悬停、键盘聚焦）哪一行：图里突出那一层。离开时是 `null` */
  onFocus: (name: string | null) => void;
}) {
  const t = useText(overviewText);
  const nav = useNav();
  const shown = usePresentList(rows, (r) => r.name);
  if (rows.length === 0 && shown.length === 0)
    return <p className="flex h-8 items-center tw-body text-muted-foreground">{empty}</p>;
  const tokensMode = by === "token";
  return (
    <div>
      {shown.map(({ item: r, key, presence }) => (
        <LinkRow
          key={key}
          className={rowMotion(presence)}
          hint={r.merged ? undefined : t.viewInTraffic}
          onOpen={r.merged ? undefined : () => nav.open("requests", { grouped: false, filter: { q: r.name } })}
          onPoint={(on) => onFocus(on ? r.name : null)}
        >
          {r.merged ? <MarkSpace /> : <ModelMark name={r.name} />}
          <span className="w-40 shrink-0 truncate" title={r.merged ? undefined : r.name}>
            {r.merged ? t.otherCount(r.merged) : r.name}
          </span>
          <Meter className="min-w-12 flex-1" value={tokensMode ? r.tokens : r.cost} max={topBar} color={r.color} />
          <Tip text={t.tokens(r.tokens.toLocaleString(), r.tokens)}>
            <span className={cn("w-16 shrink-0 text-right", tokensMode ? "font-medium" : "text-muted-foreground")}>
              <AnimatedNumber value={r.tokens} format={fmtTokens} scope={scope} />
            </span>
          </Tip>
          <span className={cn("w-16 shrink-0 text-right", tokensMode ? "text-muted-foreground" : "font-medium")}>
            {/*
              **用了 token 却没有费用，不写「$0」。**那可能是未定价（费用没算进来），也
              可能是不计费（本地模型）—— 分组的格子里没有「无法计价」的条数，分不出是哪
              一种，而「$0」只在后一种情况下是真的。
            */}
            {r.cost === 0 && r.tokens > 0 ? (
              <Tip text={t.noCost}>
                <span className="tw-num text-muted-foreground">—</span>
              </Tip>
            ) : (
              <AnimatedNumber value={r.cost} format={usd} scope={scope} />
            )}
          </span>
          <span className="w-12 shrink-0 text-right tw-label text-muted-foreground">
            <AnimatedNumber value={r.requests} format={(n) => t.times(Math.round(n))} scope={scope} />
          </span>
        </LinkRow>
      ))}
    </div>
  );
}
