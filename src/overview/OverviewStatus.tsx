import { useEffect, useState } from "react";
import { SummaryItem } from "@/ui/page";
import { StatusDot } from "@/ui/status-dot";
import { AnimatedNumber } from "@/ui/motion";
import { Tip } from "@/ui/tip";
import { useNav } from "@/nav";
import { call } from "@/control";
import { compact } from "@/format";
import { pollLive } from "@/traffic/liveSpeed";
import type { Overview } from "@/types";
import { useText } from "@/i18n";
import { useInFlight } from "./useLive";
import { LinkText } from "./parts";
import { downWhy } from "./series";
import { overviewText } from "./overview.i18n";

/**
 * 页头下面那一行：此刻的状态。**只有数字和状态点，不写说明。**
 *
 * · 有几个请求在跑。跑着的时候点在跳，一直显示，不只在实时档：这是「网关此刻
 *   在不在干活」。它自己订阅事件流，一变只重画这一小块。
 * · 有请求在跑时，后面是此刻每秒生成多少 token（`/live`）。都还没开口时是 0 t/s，和菜单栏
 *   一样；没有在跑的不写。
 * · 有几个上游，其中几个用不了。用不了的那一项可以点，落到上游页并定位到它。
 *   还没有上游时说「尚未添加上游」，同样可以点。
 */
export function OverviewStatus({ ov }: { ov: Overview | null }) {
  const t = useText(overviewText);
  const nav = useNav();
  const n = useInFlight();
  const rate = useLiveRate(n > 0);
  const providers = ov?.providers.filter((p) => !p.disabled);
  // 用不了的上游：熔断中、凭据被拒、登录失效。和上游页那一行上的三个标记是同一套判断
  const down = ov?.providers.filter((p) => downWhy(p) !== null) ?? [];
  return (
    <>
      {n > 0 ? (
        <SummaryItem
          // 在跑的点用品牌的青→品红：这一页的品牌点缀之一（外面那一圈脉冲跟着青色走）
          lead={<StatusDot tone="pending" className="bg-linear-135 from-brand-from to-brand-to text-brand-from" />}
          value={<AnimatedNumber value={n} />}
          label={t.inFlight(n)}
        />
      ) : (
        <SummaryItem lead={<StatusDot tone="idle" />} label={t.idle} />
      )}
      {n > 0 && rate !== null && (
        <SummaryItem value={<AnimatedNumber value={rate} format={(v) => compact(Math.round(v))} />} label="t/s" />
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

/**
 * 此刻每秒生成多少 token（`LiveView.tokens_per_sec`）：有请求在跑时每秒问一次 core，用流量页
 * 那一圈（`pollLive`：上一问没回来不发下一问、窗口藏着时停下）。
 *
 * 没有在跑的、问不到的是 `null`，不写 —— 一个旧的数挂在那儿比不写更误导。core 说没有在跑
 * 的（事件流和 `/live` 前后脚）同样是 `null`。
 */
function useLiveRate(running: boolean): number | null {
  const [rate, setRate] = useState<number | null>(null);
  useEffect(() => {
    if (!running) return;
    // `pollLive` 交出来的是每一条的速度；合计（含「都还没开口」的 0）要从这一问的回答里拿
    let last: number | null = null;
    const stop = pollLive({
      ask: async () => {
        last = null;
        const v = await call("Live", null);
        last = v.tokens_per_sec;
        return v;
      },
      hidden: () => document.visibilityState === "hidden",
      onVisibility: (f) => {
        document.addEventListener("visibilitychange", f);
        return () => document.removeEventListener("visibilitychange", f);
      },
      emit: () => setRate(last),
    });
    return () => {
      last = null;
      stop();
    };
  }, [running]);
  return running ? rate : null;
}
