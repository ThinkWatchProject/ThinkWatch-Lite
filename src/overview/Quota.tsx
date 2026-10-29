import { TriangleAlertIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tip } from "@/ui/tip";
import { UpstreamLogo } from "@/ui/logos";
import { useNav } from "@/nav";
import { useNow } from "@/useNow";
import type { Dashboard, Overview } from "@/types";
import { useText } from "@/i18n";
import { balanceText } from "@/upstreams/balance.i18n";
import { QuotaBar } from "@/upstreams/QuotaBar";
import { LinkText } from "./parts";
import { quotaRows, resetClock, type Gauge, type QuotaRow } from "./quotaRows";
import { quotaText } from "./Quota.i18n";

/**
 * 额度与余额：订阅的额度窗口和各家余额，此刻的状态，不跟时间范围走。
 *
 * 每个上游一行：标志、名字、它是哪一种（ChatGPT 账号、账号登录、余额）；右上角是最近要
 * 重置的钟点，或者钱包余额。下面每个窗口一根条和已用的比例，用到八成起琥珀、用满红，
 * 都带图标（读屏念「即将用完」「已用完」）—— 和上游页同一个阈值。积分制窗口的剩余积分
 * 在悬停里，只有一个窗口时跟在条后面。余额读取失败、手上又没有读到过的数时写上游页同一句，
 * 原因在悬停里。
 *
 * 停用的上游不列。一个都没有时这一块不出现（`hasQuota`），「去向」占满一行。
 */
export function Quota({ d, ov }: { d: Dashboard; ov: Overview | null }) {
  const t = useText(quotaText);
  const nav = useNav();
  // 重置的钟点、过了重置时刻的窗口跟着时间走，数据没变也要重画
  const now = useNow();
  const rows = quotaRows(d, ov, now);
  if (rows.length === 0) return null;
  return (
    <section
      aria-label={t.title}
      data-slot="overview-quota"
      className="flex min-w-0 flex-col rounded-[10px] border border-border bg-panel px-4 pt-3 pb-2"
    >
      <div className="flex h-7 items-center gap-2.5">
        <h3 className="tw-head text-muted-foreground">{t.title}</h3>
        <LinkText className="ml-auto tw-label text-muted-foreground hover:text-foreground" onOpen={() => nav.open("upstreams")}>
          {t.showUpstreams}
        </LinkText>
      </div>
      <ul className="mt-1.5">
        {rows.map((r) => (
          <Row key={r.provider.name} r={r} now={now} />
        ))}
      </ul>
    </section>
  );
}

/** 有没有一个上游说得出额度或余额。没有的话这一块不出现，「去向」占满一行 */
export function hasQuota(d: Dashboard, ov: Overview | null): boolean {
  return quotaRows(d, ov, Date.now()).length > 0;
}

function Row({ r, now }: { r: QuotaRow; now: number }) {
  const t = useText(quotaText);
  const bt = useText(balanceText);
  const p = r.provider;
  const clock = resetClock(r.reset, now);
  const tip = r.tip && (
    <div className="flex max-w-80 flex-col gap-0.5">
      {r.tip.map((line, i) => (
        // 第一行是从哪儿读的、什么时候，和上游页的悬停一样加粗
        <p key={i} className={cn("break-words", i === 0 && "font-medium")}>
          {line}
        </p>
      ))}
    </div>
  );
  // 右上角：钱包余额压过重置时刻（余额那几行本来就在悬停里写着各窗口的重置）
  const corner = r.failed ? (
    <span className="ml-auto shrink-0 tw-label whitespace-nowrap text-warning">{bt.failed}</span>
  ) : r.amount ? (
    <span className="ml-auto shrink-0 tw-head tw-num whitespace-nowrap">{r.amount}</span>
  ) : clock ? (
    <span className="ml-auto shrink-0 tw-label whitespace-nowrap text-muted-foreground">{t.resetAt(clock)}</span>
  ) : null;
  return (
    <li className="border-t border-border/60 py-2 first:border-t-0">
      <div className="flex h-5 min-w-0 items-center gap-2.5">
        <UpstreamLogo name={p.name} baseUrl={p.base_url} protocol={p.protocol} className="text-muted-foreground" />
        <span className="shrink-0 tw-body whitespace-nowrap">{p.name}</span>
        {r.kind && <span className="min-w-0 truncate tw-label text-muted-foreground">{r.kind}</span>}
        {corner && (tip ? <Tip text={tip}>{corner}</Tip> : corner)}
      </div>
      {r.gauges.length > 0 && (
        <div className="mt-1.5 ml-[26px] flex flex-wrap items-center gap-x-[18px] gap-y-1">
          {r.gauges.map((g) => (
            <GaugeItem key={g.key} g={g} name={p.name} inline={r.gauges.length === 1} />
          ))}
        </div>
      )}
      {r.sub && <div className="mt-0.5 ml-[26px] truncate tw-label text-muted-foreground">{r.sub}</div>}
    </li>
  );
}

/**
 * 一个窗口：名字、条、提醒图标、已用的比例。剩余（积分、余额窗口的「剩余 … / …」）在
 * 悬停里；一行只有这一根条时跟在后面，放得下。
 */
function GaugeItem({ g, name, inline }: { g: Gauge; name: string; inline: boolean }) {
  const t = useText(quotaText);
  const used = Math.round(g.percent);
  const alert = g.tone === "error" ? t.exhausted : g.tone === "warn" ? t.nearlyOut : null;
  const tip = alert ? (
    <div className="space-y-1">
      <p className="font-medium">{alert}</p>
      <p>{g.tip}</p>
    </div>
  ) : (
    g.tip
  );
  return (
    <Tip text={tip}>
      <span className="flex min-w-0 items-center gap-[7px] tw-label whitespace-nowrap text-muted-foreground">
        {g.label}
        <QuotaBar percent={g.percent} label={t.gaugeLabel(name, g.label)} className="w-[72px] shrink-0" />
        {alert && (
          <TriangleAlertIcon
            role="img"
            aria-label={alert}
            className={cn("size-3 shrink-0", g.tone === "error" ? "text-destructive" : "text-warning")}
          />
        )}
        <span className={cn("tw-num text-foreground", g.tone === "error" && "text-destructive")}>{t.used(used)}</span>
        {inline && g.left && <span className="min-w-0 truncate">{g.left}</span>}
      </span>
    </Tip>
  );
}
