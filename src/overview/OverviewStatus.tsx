import { SummaryItem } from "@/ui/page";
import { StatusDot } from "@/ui/status-dot";
import { AnimatedNumber } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { useNav } from "@/nav";
import type { Overview, ProviderView } from "@/types";
import { useText } from "@/i18n";
import { useInFlight } from "./useLive";
import { LinkText } from "./parts";
import { overviewText } from "./overview.i18n";

/**
 * 上游现在用不了：熔断中、凭据被拒、登录失效。**停用的不算** —— 那是有意关掉的。
 * 和上游页那一行上的三个标记是同一套判断。
 */
function unavailable(p: ProviderView): boolean {
  return !p.disabled && (p.health === "open" || p.auth_rejected != null || p.oauth?.needs_login === true);
}

/**
 * 页头下面那一行：此刻的状态。**只有数字和状态点，不写说明。**
 *
 * · 有几个请求在跑。跑着的时候点在跳，一直显示，不只在实时档：这是「网关此刻
 *   在不在干活」。它自己订阅事件流，一变只重画这一小块。
 * · 有几个上游，其中几个用不了。用不了的那一项可以点，落到上游页并定位到它。
 *   还没有上游时说「尚未添加上游」，同样可以点。
 */
export function OverviewStatus({ ov }: { ov: Overview | null }) {
  const t = useText(overviewText);
  const nav = useNav();
  const n = useInFlight();
  const providers = ov?.providers.filter((p) => !p.disabled);
  const down = ov?.providers.filter(unavailable) ?? [];
  return (
    <>
      {n > 0 ? (
        <SummaryItem lead={<StatusDot tone="pending" />} value={<AnimatedNumber value={n} />} label={t.inFlight(n)} />
      ) : (
        <SummaryItem lead={<StatusDot tone="idle" />} label={t.idle} />
      )}
      {providers &&
        (providers.length === 0 ? (
          <LinkText onOpen={() => nav.open("upstreams")}>
            <SummaryItem lead={<StatusDot tone="idle" />} label={t.noUpstreams} />
          </LinkText>
        ) : (
          <SummaryItem value={<AnimatedNumber value={providers.length} />} label={t.upstreams(providers.length)} />
        ))}
      {down.length > 0 && (
        <Tip text={t.showUpstreams}>
          <LinkText onOpen={() => nav.open("upstreams", { upstream: down[0]?.name })}>
            <SummaryItem
              lead={<StatusDot tone="warn" />}
              value={<AnimatedNumber value={down.length} />}
              label={t.unavailable(down.length)}
            />
          </LinkText>
        </Tip>
      )}
    </>
  );
}
