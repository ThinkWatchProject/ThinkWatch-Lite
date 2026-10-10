import type { ReactNode } from "react";
import { ArrowRightIcon, TriangleAlertIcon } from "lucide-react";
import { useIgnored } from "@/ignore";
import { IconGuard, IconServer } from "@/ui/icons";
import { uiText } from "@/ui/ui.i18n";
import { presetRange, type Range } from "@/ui/range";
import { rangeText } from "@/ui/range.i18n";
import { useNav } from "@/nav";
import type { Dashboard, Overview } from "@/types";
import { useText } from "@/i18n";
import { attention, attentionCovered, attentionMark, type Attention as Item } from "./series";
import { LinkText } from "./parts";
import { overviewText } from "./overview.i18n";

/**
 * 顶上那条「需要处理的事」：请求失败、被切断的工具调用、用不了的上游、无法计价的请求。
 * 每一件一句话，行尾是去处理它的那一页。
 *
 * **什么都不用处理时整条不出现** —— 没问题的时候不该占地方。日常的脱敏次数不在这里：
 * 那是防护在正常工作。
 *
 * 每一行都能「忽略」：失败、无法计价是已经发生的事，在区间里会一直算着，没法处理掉，
 * 只能看过算数；忽略之后有新情况（又失败了、又一家上游不可用）再出现（`attentionMark`）。
 *
 * 实时档的数按 24 小时算（和缓存命中那几张卡片一样），句子前面标出来。
 */
export function AttentionStrip({ d, ov, range }: { d: Dashboard; ov: Overview | null; range: Range }) {
  const t = useText(overviewText);
  const rt = useText(rangeText);
  const nav = useNav();
  const items = attention(d, ov?.providers);
  const live = range.live === true;
  const scoped = (text: string) => (live ? t.scoped(rt.preset["1d"], text) : text);
  // 实时档的计数按 24 小时算（见 `windowStart`），日志也按 24 小时看
  const logRange = live ? presetRange("1d") : range;

  const row = (item: Item): { icon: ReactNode; text: string; go: string; open: () => void } => {
    switch (item.kind) {
      case "failed":
        return {
          icon: <TriangleAlertIcon />,
          text: scoped(t.attnFailed(item.n, item.top)),
          go: t.viewInTraffic,
          open: () => nav.open("requests", { grouped: false, filter: { failedOnly: true } }),
        };
      case "toolCut":
        return {
          icon: <IconGuard />,
          text: scoped(t.attnToolCut(item.n)),
          go: t.showLog,
          open: () => nav.open("security", { focus: { range: logRange, at: Date.now() } }),
        };
      case "upstreams": {
        const first = item.down[0];
        const why = { open: t.whyOpen, auth: t.whyAuth, login: t.whyLogin };
        return {
          icon: <IconServer />,
          text:
            item.down.length === 1 && first
              ? t.attnUpstream(first.name, why[first.why])
              : t.attnUpstreams(item.down.length, item.down.map((x) => x.name)),
          go: t.showUpstreams,
          open: () => nav.open("upstreams", { upstream: first?.name }),
        };
      }
      case "unpriced":
        return {
          icon: <TriangleAlertIcon />,
          text: scoped(t.attnUnpriced(item.n)),
          go: t.viewInTraffic,
          open: () => nav.open("requests", { grouped: false, filter: { unpricedOnly: true } }),
        };
    }
  };

  return <Strip items={items} buckets={d.buckets} row={row} label={t.attentionLabel} />;
}

/** 一行一件，忽略过的不画；全忽略了整条不出现 */
function Strip({
  items,
  buckets,
  row,
  label,
}: {
  items: Item[];
  buckets: Dashboard["buckets"];
  row: (item: Item) => { icon: ReactNode; text: string; go: string; open: () => void };
  label: string;
}) {
  // 四种各一行，钩子的次数固定
  const kinds = ["failed", "toolCut", "upstreams", "unpriced"] as const;
  const rows = kinds.map((kind) => {
    const item = items.find((i) => i.kind === kind);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const ig = useIgnored(`attention:${kind}`, item ? attentionMark(item, buckets) : null, attentionCovered);
    return item && !ig.ignored ? { item, ignore: ig.ignore } : null;
  });
  const shown = rows.filter((r) => r !== null);
  if (shown.length === 0) return null;
  return (
    <section
      aria-label={label}
      data-slot="overview-attention"
      className="rounded-lg border border-warning/30 bg-warning/[0.06] px-3 py-0.5"
    >
      {shown.map(({ item, ignore }) => (
        <Line key={item.kind} {...row(item)} onIgnore={ignore} />
      ))}
    </section>
  );
}

function Line({
  icon,
  text,
  go,
  open,
  onIgnore,
}: {
  icon: ReactNode;
  text: string;
  go: string;
  open: () => void;
  onIgnore: () => void;
}) {
  const u = useText(uiText);
  const link = "inline-flex shrink-0 items-center gap-1 tw-label whitespace-nowrap text-muted-foreground hover:text-foreground";
  return (
    <div className="flex min-h-[30px] min-w-0 items-center gap-2 border-warning/20 py-1 tw-body [&+&]:border-t [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-warning">
      {icon}
      <span className="min-w-0 flex-1">{text}</span>
      <LinkText onOpen={open} className={link}>
        {go}
        <ArrowRightIcon aria-hidden className="size-3" />
      </LinkText>
      <LinkText onOpen={onIgnore} className={link}>
        {u.ignore}
      </LinkText>
    </div>
  );
}
