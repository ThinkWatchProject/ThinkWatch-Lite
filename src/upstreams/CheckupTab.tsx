import type { ReactNode } from "react";
import { StethoscopeIcon } from "lucide-react";
import { call } from "@/control";
import { when } from "@/format";
import { useText } from "@/i18n";
import { useResource } from "@/lib/resource";
import { cn } from "@/lib/utils";
import type { ProviderView, UpstreamCheckup } from "@/types";
import type { Range } from "@/ui/range";
import { Skeleton } from "@/ui/skeleton";
import { EmptyState, ErrorState } from "@/ui/states";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ui/table";
import { Tip } from "@/ui/tip";
import { useStartOf } from "@/useNow";
import { checkupText } from "./Checkup.i18n";
import {
  cacheFlagged,
  cacheGaps,
  cacheShare,
  failFlagged,
  failRate,
  inputFlagged,
  inputGaps,
  pct,
  signedPct,
} from "./checkup";
import { VendorTile } from "./parts";

const HOUR = 3_600_000;

/**
 * 体检的数。窗口的起点对齐到整点：页面开着的时候起点一小时才挪一格，不会每分钟
 * 重问一遍同一个问题。**请求落地之后重读**，但最多半分钟一次 —— 七天、三十天的数，
 * 多一条请求几乎不动，而这一问要把整段时间的记录过一遍。
 */
function useUpstreamHealth(range: Range) {
  const hour = useStartOf(HOUR);
  const from = range.from ?? hour + HOUR - range.ms;
  return useResource("upstream-health", () => call("UpstreamHealth", { from_ms: from }), {
    events: ["request_finished", "request_failed", "request_cancelled"],
    throttleMs: 30_000,
    deps: [from],
  });
}

/**
 * 上游页的「体检」标签：一段时间里每个上游的几项事实，各带样本数和参照。
 *
 * 一行一个上游（请求多的在前）：请求与失败、回答里的模型名对不对得上、报的输入和
 * 别的上游比、缓存读到了多少、首 token 与速度。数字之外的说明都在悬停里。
 */
export function CheckupTab({ range, providers }: { range: Range; providers: ProviderView[] }) {
  const t = useText(checkupText);
  const health = useUpstreamHealth(range);
  const today = useStartOf(24 * HOUR);
  const d = health.data;

  if (d === undefined) {
    if (health.error !== undefined && !health.loading) {
      return (
        <ErrorState
          title={t.failed}
          error={health.error}
          onRetry={() => void health.reload()}
          retrying={health.refreshing}
        />
      );
    }
    return <CheckupSkeleton />;
  }
  if (d.upstreams.length === 0) {
    return <EmptyState icon={<StethoscopeIcon />} title={t.empty} description={t.emptyDesc} />;
  }
  // 库刚重建、记录留的天数比窗口短：开头那一段没有记录，要说出来 —— 不然「7 天」里其实只有两天
  const late = d.covered_since_ms !== null && d.covered_since_ms > d.from_ms + 60_000;
  return (
    <div className="flex flex-col gap-3">
      {late && <p className="tw-label text-muted-foreground">{t.covered(when(d.covered_since_ms!, today))}</p>}
      <Table className="tw-num">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-full">{t.upstream}</TableHead>
            <TableHead>
              <HeadTip text={t.modelsTip}>{t.models}</HeadTip>
            </TableHead>
            <TableHead className="text-right">
              <HeadTip text={t.inputTip}>{t.input}</HeadTip>
            </TableHead>
            <TableHead className="text-right">
              <HeadTip text={t.cacheTip}>{t.cache}</HeadTip>
            </TableHead>
            <TableHead className="text-right">{t.timing}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {d.upstreams.map((c) => (
            <TableRow key={c.upstream} className="hover:bg-transparent">
              <NameCell c={c} p={providers.find((p) => p.name === c.upstream)} />
              <ModelsCell c={c} />
              <InputCell c={c} />
              <CacheCell c={c} />
              <TimingCell c={c} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** 表头上带说明的那几列：字下面一道虚线，悬停看这一列比的是什么 */
function HeadTip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <Tip text={<span className="block max-w-64">{text}</span>}>
      <span className="cursor-default underline decoration-dotted underline-offset-2">{children}</span>
    </Tip>
  );
}

/** 一格里上下两行：上面是数，下面淡一档的是样本或补充。和上游标签那张表同一个写法 */
function Two({ top, bottom, tone, tip }: { top: ReactNode; bottom?: ReactNode; tone?: "warn" | "muted"; tip?: ReactNode }) {
  const body = (
    <div className="flex flex-col items-end">
      <span className={cn(tone === "warn" && "text-warning", tone === "muted" && "text-muted-foreground")}>{top}</span>
      <span className="tw-label text-muted-foreground">{bottom ?? "\u00a0"}</span>
    </div>
  );
  if (!tip) return body;
  return (
    <Tip text={<div className="flex max-w-80 flex-col gap-0.5">{tip}</div>}>
      <div className="cursor-default">{body}</div>
    </Tip>
  );
}

function Dash() {
  return <span className="text-muted-foreground">—</span>;
}

/** 上游一格：标志、名字，下面是请求数和失败率。上游已经删了的照样列出（记录里还有它） */
function NameCell({ c, p }: { c: UpstreamCheckup; p: ProviderView | undefined }) {
  const t = useText(checkupText);
  const rate = failRate(c);
  return (
    <TableCell className="max-w-0 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <VendorTile name={c.upstream} baseUrl={p?.base_url} protocol={p?.protocol} muted={!p || p.disabled} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.upstream}</div>
          <Tip
            text={
              <div className="flex flex-col gap-0.5">
                <p>{t.requestsTip(c.requests)}</p>
                <p>{t.failedTip(c.failed)}</p>
                {c.cancelled > 0 && <p>{t.cancelledTip(c.cancelled)}</p>}
              </div>
            }
          >
            <div className="w-fit cursor-default tw-label text-muted-foreground">
              {t.requests(c.requests)}
              {rate !== null && c.failed > 0 && (
                <span className={cn(failFlagged(c) && "text-warning")}> · {t.failedShare(pct(rate))}</span>
              )}
            </div>
          </Tip>
        </div>
      </div>
    </TableCell>
  );
}

/**
 * 模型名一格。**写得一致不能证明真是那个模型，写得不一致才是一条线索**：所以一致的
 * 写成淡的「一致」，不一致的写次数、悬停列出是哪几对。
 */
function ModelsCell({ c }: { c: UpstreamCheckup }) {
  const t = useText(checkupText);
  const m = c.models;
  if (m.named === 0) {
    return (
      <TableCell>
        <Tip text={t.noNames}>
          <span className="cursor-default">
            <Dash />
          </span>
        </Tip>
      </TableCell>
    );
  }
  if (m.differed === 0) {
    return (
      <TableCell>
        <Tip text={t.allSame(m.named)}>
          <div className="flex cursor-default flex-col">
            <span className="text-muted-foreground">{t.consistent}</span>
            <span className="tw-label text-muted-foreground">{t.named(m.named)}</span>
          </div>
        </Tip>
      </TableCell>
    );
  }
  return (
    <TableCell>
      <Tip
        text={
          <div className="flex max-w-96 flex-col gap-0.5">
            <p>{t.pairsTitle(m.differed, m.named)}</p>
            {m.examples.map((x) => (
              <p key={`${x.sent}\n${x.answered}`} className="break-all">
                {t.pair(x.sent, x.answered, x.count)}
              </p>
            ))}
          </div>
        }
      >
        <div className="flex cursor-default flex-col">
          <span className="text-warning">{t.differed(m.differed)}</span>
          <span className="tw-label text-muted-foreground">{t.named(m.named)}</span>
        </div>
      </Tip>
    </TableCell>
  );
}

/**
 * 输入 token 一格：和别的上游比得上的模型里，差得最多的那一个 —— 上面是差多少，下面
 * 是哪个模型。比不上的（只有它服务这些模型、样本不够）写「—」，悬停说为什么，
 * 并给出它自己的比值：单看一家的比值说明不了什么，但用户问起时要有。
 */
function InputCell({ c }: { c: UpstreamCheckup }) {
  const t = useText(checkupText);
  const gaps = inputGaps(c);
  const all = c.input.all;
  const allLine = all ? t.inputAll(t.ratio(all.median), all.samples) : null;
  if (gaps.length === 0) {
    return (
      <TableCell className="text-right">
        <Two
          top={<Dash />}
          tip={
            <>
              <p>{t.noComparison}</p>
              {allLine && <p>{allLine}</p>}
            </>
          }
        />
      </TableCell>
    );
  }
  const top = gaps[0]!;
  return (
    <TableCell className="text-right">
      <Two
        top={signedPct(top.gap)}
        tone={inputFlagged(top) ? "warn" : undefined}
        bottom={<span className="inline-block max-w-40 truncate align-bottom">{top.model}</span>}
        tip={
          <>
            <p>{t.inputUnit}</p>
            {gaps.map((g) => (
              <div key={g.model} className="mt-1">
                <p className={cn("font-medium", inputFlagged(g) && "text-warning")}>
                  {g.model} {signedPct(g.gap)}
                </p>
                <p>{t.inputLine(t.ratio(g.here.median), g.here.samples, g.otherUpstreams, t.ratio(g.others.median), g.others.samples)}</p>
              </div>
            ))}
            {allLine && <p className="mt-1">{allLine}</p>}
          </>
        }
      />
    </TableCell>
  );
}

/**
 * 缓存读取一格：上面是可命中缓存的轮次里，输入从缓存读的那一份；下面是几轮。和别的
 * 上游比，有哪个模型差得多就标出来 —— 读不读得到也看客户端（有的要客户端标出缓存
 * 断点），同样的客户端发给别的上游读得到，才是一条线索。
 */
function CacheCell({ c }: { c: UpstreamCheckup }) {
  const t = useText(checkupText);
  const all = c.cache.all;
  const share = cacheShare(all);
  if (all.turns === 0 || share === null) {
    return (
      <TableCell className="text-right">
        <Two top={<Dash />} tip={<p>{t.noTurns}</p>} />
      </TableCell>
    );
  }
  const gaps = cacheGaps(c);
  const flagged = gaps.some(cacheFlagged);
  return (
    <TableCell className="text-right">
      <Two
        top={pct(share)}
        tone={flagged ? "warn" : undefined}
        bottom={t.turns(all.turns)}
        tip={
          <>
            <p>{t.cacheSummary(all.turns, pct(share), all.zero_read_turns)}</p>
            {gaps.map((g) => (
              <div key={g.model} className="mt-1">
                <p className={cn("font-medium", cacheFlagged(g) && "text-warning")}>{g.model}</p>
                <p>{t.cacheLine(pct(g.hereShare), g.here.turns, g.otherUpstreams, pct(g.othersShare), g.others.turns)}</p>
              </div>
            ))}
          </>
        }
      />
    </TableCell>
  );
}

/** 首 token 和生成速度的中位数，上下两行，和上游标签那张表同一个写法 */
function TimingCell({ c }: { c: UpstreamCheckup }) {
  const t = useText(checkupText);
  if (!c.ttft_ms && !c.tokens_per_sec) {
    return (
      <TableCell className="text-right">
        <Two top={<Dash />} />
      </TableCell>
    );
  }
  return (
    <TableCell className="text-right">
      <Two
        top={c.ttft_ms ? t.ms(c.ttft_ms.p50) : <Dash />}
        bottom={c.tokens_per_sec ? t.speed(c.tokens_per_sec.p50) : "—"}
        tip={
          <>
            {c.ttft_ms && <p>{t.ttftTip(c.ttft_ms.samples)}</p>}
            {c.tokens_per_sec && <p>{t.speedTip(c.tokens_per_sec.samples)}</p>}
          </>
        }
      />
    </TableCell>
  );
}

/** 数还没到：几行占位，和真的行一样高 */
function CheckupSkeleton() {
  return (
    <div className="flex flex-col gap-4 pt-2" aria-busy="true">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="flex items-center gap-3" style={{ opacity: 1 - i * 0.18 }}>
          <Skeleton className="size-7 rounded-lg" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-32 rounded-sm" />
            <Skeleton className="h-2.5 w-20 rounded-sm" />
          </div>
          <Skeleton className="h-3 w-14 rounded-sm" />
          <Skeleton className="h-3 w-14 rounded-sm" />
          <Skeleton className="h-3 w-14 rounded-sm" />
          <Skeleton className="h-3 w-16 rounded-sm" />
        </div>
      ))}
    </div>
  );
}
