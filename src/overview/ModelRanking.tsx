import { cn } from "@/lib/utils";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { useNav } from "@/nav";
import { compact } from "@/format";
import { usd } from "@/types";
import { useText } from "@/i18n";
import { rankCost, type Metric, type RankRow } from "./series";
import { LinkRow, LinkText, MarkSpace, Meter, ModelMark } from "./parts";
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
          onOpen={r.merged ? undefined : () => nav.open("requests", { grouped: false, filter: { model: r.name } })}
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
          {/* 80px：「≥~$1234.56」要 79 */}
          <span className={cn("w-20 shrink-0 text-right", tokensMode ? "text-muted-foreground" : "font-medium")}>
            <Cost r={r} scope={scope} />
          </span>
          <span className="w-12 shrink-0 text-right tw-label text-muted-foreground">
            <AnimatedNumber value={r.requests} format={(n) => t.times(Math.round(n))} scope={scope} />
          </span>
        </LinkRow>
      ))}
    </div>
  );
}

/**
 * 一行的费用。写什么见 `rankCost`；有说明的写在悬停里。
 *
 * · 金额有说明时带虚线下划线，和会话、请求行里有说明的金额同一个记号。
 * · 「无法计价」是琥珀色：它要人去补一个价，和上面费用大数下的「N 条无法计价」同色。
 *   「无用量」补不了什么，淡一档。两个词都不跟着费用口径加粗 —— 它们不是金额。
 *
 * **有无法计价的请求时，这一格自己可以点**：落到流量页这个模型里没算出费用的那一批
 * —— 看到它之后要做的就是去补价，而补给谁要从那一批里看。合并的「其他」不是一个
 * 模型，只说不点。
 */
function Cost({ r, scope }: { r: RankRow; scope: string }) {
  const t = useText(overviewText);
  const nav = useNav();
  const c = rankCost(r, t);
  if (c.kind === "amount" && c.notes.length === 0)
    return <AnimatedNumber value={r.cost} format={usd} scope={scope} />;
  const shown =
    c.kind === "unpriced" ? (
      t.unpricedCell
    ) : c.kind === "noUsage" ? (
      t.noUsageCell
    ) : (
      <AnimatedNumber value={r.cost} format={(n) => c.prefix + usd(n)} scope={scope} />
    );
  const look =
    c.kind === "amount"
      ? "underline decoration-dotted underline-offset-2"
      : c.kind === "unpriced"
        ? "font-normal text-warning"
        : "font-normal text-muted-foreground";
  const tip = (
    <div className="space-y-1">
      {c.notes.map((l) => (
        <p key={l}>{l}</p>
      ))}
    </div>
  );
  return (
    <Tip text={tip}>
      {r.unpriced > 0 && !r.merged ? (
        <LinkText
          className={cn(look, "hover:decoration-solid")}
          onOpen={() => nav.open("requests", { grouped: false, filter: { model: r.name, unpricedOnly: true } })}
        >
          {shown}
          <span className="sr-only">{t.viewUnpriced}</span>
        </LinkText>
      ) : (
        <span className={look}>{shown}</span>
      )}
    </Tip>
  );
}
