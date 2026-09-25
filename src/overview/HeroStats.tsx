import type { ReactNode } from "react";
import { ArrowDownRightIcon, ArrowRightIcon, ArrowUpRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import type { Range } from "@/ui/range";
import { useNav } from "@/nav";
import { compact } from "@/format";
import { usd, type Dashboard, type Summary } from "@/types";
import { useText } from "@/i18n";
import { LinkText } from "./parts";
import { overviewText } from "./overview.i18n";

/** 一段时间里的 token 合计。**「输入」含命中缓存的那部分**，见下面 `ctx` */
function tokensOf(s: Summary): number {
  return s.input_tokens + s.cache_read_tokens + s.cache_write_tokens + s.output_tokens;
}

function costOf(s: Summary): number {
  return s.cost_micros_exact + s.cost_micros_estimated;
}

const fmtTokens = (n: number) => compact(Math.round(n));
const fmtCount = (n: number) => Math.round(n).toLocaleString();

/**
 * 页头下面的三个大数：**用了多少、费用多少、发了多少次**。
 *
 * 它们是同一层的事实，所以同一个字号、同一个宽度的栏，中间一道细竖线。每一栏
 * 四层，从上到下一层比一层轻：名目、数、环比、限定语。
 *
 * **等宽栏，而不是并排的弹性块。**后者会让「较上一个区间」这类时有时无的限定语
 * 改变每一栏的宽度，切一次范围三个数字就横向挪一次位置。环比和限定语那两行也
 * 定高：少一条时不该把整页往上收。
 *
 * 数字走过去，不跳过去 —— 限定语里的数也一样；**只在同一个口径里走**
 * （`scope`）：换时间范围时那不是「涨了」，是换了一个东西在看。
 */
export function HeroStats({ d, range, scope }: { d: Dashboard; range: Range; scope: string }) {
  const t = useText(overviewText);
  const nav = useNav();
  const s = d.summary;
  const p = d.prev;
  /*
    **「输入」是送往上游的全部上下文，包含命中缓存的那部分。**`input_tokens`
    单独一个字段说的是「没命中缓存的那部分」—— 命中率高的时候它只有真实输入的
    零头，标成「输入」会让人以为自己几乎没用。
  */
  const ctx = s.input_tokens + s.cache_read_tokens + s.cache_write_tokens;
  const tokens = tokensOf(s);
  const cost = costOf(s);
  const rate = (s.failed / Math.max(1, s.requests)) * 100;
  /*
    **和上一个区间比。**上一个区间是零（刚开始用、或者那段时间没用）时没有可比的
    幅度，写一个「—」占住这一格，而不是空着 —— 空着的那一行读起来像少画了什么。
    取不到上一个区间（`prev` 为空）时整行空着：那是读取失败，不是「没有」。
  */
  const vs = (now: number, before: number | undefined, good?: "down") =>
    before === undefined ? null : before > 0 ? (
      <Delta v={(now - before) / before} period={range.compare} good={good} />
    ) : (
      <NoDelta period={range.compare} />
    );

  return (
    <div className="grid grid-cols-3" data-slot="hero-stats">
      <Stat
        label={t.kpiTokens}
        value={<AnimatedNumber value={tokens} format={fmtTokens} scope={scope} />}
        delta={vs(tokens, p ? tokensOf(p) : undefined)}
        detail={
          <Tip text={t.tokens(tokens.toLocaleString(), tokens)}>
            <span className="truncate">
              {t.input} <AnimatedNumber value={ctx} format={fmtTokens} scope={scope} />
              {" · "}
              {t.output} <AnimatedNumber value={s.output_tokens} format={fmtTokens} scope={scope} />
            </span>
          </Tip>
        }
      />
      <Stat
        label={t.kpiCost}
        value={<AnimatedNumber value={cost} format={usd} scope={scope} />}
        delta={vs(cost, p ? costOf(p) : undefined, "down")}
        detail={
          <>
            {s.cost_micros_estimated > 0 && (
              <Tip text={t.estimatedTip}>
                <span className="underline decoration-dotted underline-offset-2">
                  <AnimatedNumber
                    value={s.cost_micros_estimated}
                    format={(n) => t.estimated(usd(n))}
                    scope={scope}
                  />
                </span>
              </Tip>
            )}
            {s.unpriced_requests > 0 && (
              /*
                **这个数字要能点。**「533 条无法计价」说的是有一批请求没进账，却不说
                是哪些模型 —— 而「去哪儿补这个价」正是看到它之后唯一想做的事。点进去
                就是流量页筛好的那一批（归组态下看不出是哪些模型，所以不归组）。
              */
              <Tip text={t.unpricedTip}>
                <LinkText
                  className="text-warning"
                  onOpen={() => nav.open("requests", { grouped: false, filter: { unpricedOnly: true } })}
                >
                  <AnimatedNumber
                    value={s.unpriced_requests}
                    format={(n) => t.unpriced(Math.round(n))}
                    scope={scope}
                  />
                </LinkText>
              </Tip>
            )}
            {s.no_usage_requests > 0 && (
              <Tip text={t.noUsageTip}>
                <span className="underline decoration-dotted underline-offset-2">
                  <AnimatedNumber
                    value={s.no_usage_requests}
                    format={(n) => t.noUsage(Math.round(n))}
                    scope={scope}
                  />
                </span>
              </Tip>
            )}
            {s.cost_micros_estimated === 0 && s.unpriced_requests === 0 && s.no_usage_requests === 0 && (
              <span>{t.allMeasured}</span>
            )}
          </>
        }
      />
      <Stat
        label={t.kpiRequests}
        value={<AnimatedNumber value={s.requests} format={fmtCount} scope={scope} />}
        delta={vs(s.requests, p?.requests)}
        detail={
          <>
            {s.failed > 0 && (
              <Tip text={t.showFailed}>
                <LinkText
                  className="font-medium text-destructive"
                  onOpen={() => nav.open("requests", { grouped: false, filter: { failedOnly: true } })}
                >
                  <AnimatedNumber value={s.failed} format={(n) => t.failed(Math.round(n))} scope={scope} />
                </LinkText>
              </Tip>
            )}
            <AnimatedNumber value={rate} format={(n) => t.failureRate(n.toFixed(1))} scope={scope} />
          </>
        }
      />
    </div>
  );
}

function Stat({
  label,
  value,
  delta,
  detail,
}: {
  label: ReactNode;
  value: ReactNode;
  delta: ReactNode;
  detail: ReactNode;
}) {
  return (
    <div className="min-w-0 border-l border-border pl-6 first:border-l-0 first:pl-0">
      <p className="tw-head text-muted-foreground">{label}</p>
      <p className="mt-1 truncate tw-display leading-tight">{value}</p>
      <div className="mt-1.5 flex h-5 min-w-0 items-center gap-1.5 tw-label text-muted-foreground">{delta}</div>
      <div className="mt-1 flex min-h-4 min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 tw-label text-muted-foreground">
        {detail}
      </div>
    </div>
  );
}

/**
 * 一个环比：左边一小块写方向和幅度，右边写和什么比。
 *
 * **没有参照系的数字只能读，不能判断。**只有费用那一侧有「好坏」：少花是好事，
 * 所以降下来才上色。用量和请求数两个方向都不上色 —— 多用掉一些 token 不是问题，
 * 少用也不是成绩。不到百分之一算持平，箭头放平。
 */
function Delta({ v, period, good }: { v: number; period: string; good?: "down" }) {
  const t = useText(overviewText);
  const shown = Math.round(Math.abs(v * 100));
  const flat = shown === 0;
  const better = !flat && good === "down" && v < 0;
  const Icon = flat ? ArrowRightIcon : v < 0 ? ArrowDownRightIcon : ArrowUpRightIcon;
  return (
    <>
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-0.5 rounded-md px-1.5 tw-num font-medium",
          better ? "bg-success/12 text-success-foreground" : "bg-foreground/[0.06] text-foreground",
        )}
      >
        <Icon aria-hidden className="size-3" />
        {shown.toLocaleString()}%
      </span>
      <span className="truncate">{t.deltaVs(period)}</span>
    </>
  );
}

/** 上一个区间没有数据：幅度那一格写「—」，和有幅度时同一个形状 */
function NoDelta({ period }: { period: string }) {
  const t = useText(overviewText);
  return (
    <>
      <Tip text={t.noPrior(period)}>
        <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-foreground/[0.06] px-1.5 tw-num text-muted-foreground">
          —
        </span>
      </Tip>
      <span className="truncate">{t.deltaVs(period)}</span>
    </>
  );
}
