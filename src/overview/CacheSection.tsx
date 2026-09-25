import { cn } from "@/lib/utils";
import { PageSection } from "@/ui/page";
import { AnimatedNumber, rowMotion, usePresentList } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { useNav } from "@/nav";
import { compact } from "@/format";
import { usd, type Dashboard } from "@/types";
import { useText } from "@/i18n";
import { cacheByModel, ROWS } from "./series";
import { ColumnHead, LinkRow, Meter, ModelMark, Scope } from "./parts";
import { overviewText } from "./overview.i18n";

const pct = (n: number) => `${Math.round(n)}%`;
const fmtTokens = (n: number) => compact(Math.round(n));
const fmtRatio = (n: number) => `${n.toFixed(1)} : 1`;

/**
 * 缓存。**要的是率，不是累计量** —— 「省了多少」在一个长会话里只会一路涨，它
 * 回答不了「缓存到底有没有在起作用」。
 *
 * 左边是这段时间的总账：命中率和净节省，一根构成条，条下面逐项列出三段各多少、
 * 占几成，最后是读写比；右边是各模型的命中率，回答「是哪个模型的缓存没起作用」。
 * 点一个模型落到流量页，看它的请求。
 */
export function CacheSection({ d, scope, scoped }: { d: Dashboard; scope: string; scoped?: string }) {
  const t = useText(overviewText);
  const nav = useNav();
  const s = d.summary;
  /*
    **「输入」是送往上游的全部上下文，包含命中缓存的那部分。**`input_tokens` 单独
    一个字段说的是「没命中缓存的那部分」。
  */
  const ctx = s.input_tokens + s.cache_read_tokens + s.cache_write_tokens;
  const hit = ctx > 0 ? s.cache_read_tokens / ctx : 0;
  const ratio = s.cache_write_tokens > 0 ? s.cache_read_tokens / s.cache_write_tokens : null;
  const models = cacheByModel(d, t.unknownModel);
  const shown = usePresentList(models.slice(0, ROWS - 1), (r) => r.name);
  const saved = s.cache_saved_micros;
  /* 三段按单价从低到高排：读缓存最便宜、写缓存最贵。**不标倍率** —— 读写各按几倍计费
     是某一家的价目，而这一页上的模型可能来自任何一个上游 */
  const parts = [
    { key: "read", color: "bg-cache-hit", name: t.cacheReads, n: s.cache_read_tokens },
    { key: "plain", color: "bg-cache-plain", name: t.uncachedInput, n: s.input_tokens },
    { key: "write", color: "bg-cache-write", name: t.cacheWrites, n: s.cache_write_tokens },
  ];

  return (
    <PageSection title={t.cache} actions={scoped ? <Scope>{scoped}</Scope> : undefined}>
      {ctx === 0 ? (
        <p className="flex h-8 items-center tw-body text-muted-foreground">{t.noTokens}</p>
      ) : (
        <div className="@container">
          <div className="grid gap-x-10 gap-y-6 @min-[640px]:grid-cols-2">
            <div className="min-w-0">
              <div className="flex h-6 items-baseline gap-2">
                <AnimatedNumber value={hit * 100} format={pct} scope={scope} className="tw-title" />
                <span className="tw-body text-muted-foreground">{t.hitRate}</span>
                {/*
                  **净额，不是毛额。**缓存写入通常按高于输入的单价计费，只统计命中省下
                  的部分，等于声称缓存永远只会降低支出 —— 而一份反复重建缓存、命中很少
                  的用法，实际费用高于不使用缓存。这个数按每个模型自己的价目算。
                */}
                <span className="ml-auto tw-body text-muted-foreground">
                  {saved < 0 ? t.netCost : t.netSavings}{" "}
                  <AnimatedNumber
                    value={Math.abs(saved)}
                    format={usd}
                    scope={scope}
                    className={cn("font-medium", saved < 0 ? "text-destructive" : "text-success")}
                  />
                </span>
              </div>
              {/* 这根条**就是命中率的公式本身**：三段按单价排，亮的越长越省 */}
              <div className="mt-2 flex h-2 gap-px overflow-hidden rounded-full">
                {parts.map((p) => (
                  <span key={p.key} className={cn("motion-bar", p.color)} style={{ width: `${(p.n / ctx) * 100}%` }} />
                ))}
              </div>
              <div className="mt-2">
                {parts.map((p) => (
                  <Tip key={p.key} text={t.tokens(p.n.toLocaleString(), p.n)}>
                    <div className="flex h-7 items-center gap-2.5 tw-body">
                      <span aria-hidden className={cn("size-2 shrink-0 rounded-[2px]", p.color)} />
                      <span className="min-w-0 flex-1 truncate text-muted-foreground">{p.name}</span>
                      <AnimatedNumber value={p.n} format={fmtTokens} scope={scope} className="w-14 shrink-0 text-right" />
                      <AnimatedNumber
                        value={(p.n / ctx) * 100}
                        format={pct}
                        scope={scope}
                        className="w-10 shrink-0 text-right text-muted-foreground"
                      />
                    </div>
                  </Tip>
                ))}
                {ratio != null && (
                  <div className="flex h-7 items-center gap-2.5 border-t border-border/70 tw-body">
                    <span aria-hidden className="size-2 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{t.readWrite}</span>
                    <AnimatedNumber value={ratio} format={fmtRatio} scope={scope} className="shrink-0 text-right font-medium" />
                  </div>
                )}
              </div>
            </div>

            <div className="min-w-0">
              <ColumnHead>{t.hitByModel}</ColumnHead>
              {shown.map(({ item: r, key, presence }) => (
                <LinkRow
                  key={key}
                  className={cn("h-7 gap-2.5", rowMotion(presence))}
                  hint={t.viewInTraffic}
                  onOpen={() => nav.open("requests", { grouped: false, filter: { model: r.name } })}
                >
                  <ModelMark name={r.name} />
                  <span className="min-w-0 flex-1 truncate" title={r.name}>
                    {r.name}
                  </span>
                  <Tip text={t.tokens(compact(r.ctx), r.ctx)}>
                    <span className="w-20 shrink-0">
                      <Meter value={r.hit} max={1} color="var(--cache-hit)" />
                    </span>
                  </Tip>
                  <AnimatedNumber value={r.hit * 100} format={pct} scope={scope} className="w-10 shrink-0 text-right" />
                </LinkRow>
              ))}
              {models.length > ROWS - 1 && (
                <p className="mt-1 tw-label text-muted-foreground">{t.moreNotListed(models.length - (ROWS - 1))}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </PageSection>
  );
}
