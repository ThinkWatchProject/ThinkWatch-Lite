import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { usd, type SessionView } from "@/types";
import { sessionsText } from "@/Sessions.i18n";

/**
 * 一次会话的花费。
 *
 * **三态**：有价格的加起来，没价格的单独说，一轮都没有价格时
 * 不显示 $0 —— 那是在撒谎。
 */
export function SessionCost({ s }: { s: SessionView }) {
  const t = useText(sessionsText);
  if (s.priced_turns === 0) {
    return (
      <Tip text={t.noPricedTurnsTip}>
        <span className="text-muted-foreground">{t.unpriced}</span>
      </Tip>
    );
  }
  return (
    <>
      {s.cost_micros_estimated > 0 ? (
        // **估算不能冒充实测**：合计里有估算的部分，就要带着记号
        <Tip text={t.estimatedTip(usd(s.cost_micros_estimated))}>
          <span className="underline decoration-dotted underline-offset-2">~{usd(s.cost_micros)}</span>
        </Tip>
      ) : (
        usd(s.cost_micros)
      )}
      {s.unpriced_turns > 0 && (
        <Tip text={t.unpricedTurnsTip}>
          <span className="ml-1 text-muted-foreground">{t.unpricedTurns(s.unpriced_turns)}</span>
        </Tip>
      )}
      {s.no_usage_turns > 0 && (
        <Tip text={t.noUsageTurnsTip}>
          <span className="ml-1 text-muted-foreground">{t.noUsageTurns(s.no_usage_turns)}</span>
        </Tip>
      )}
    </>
  );
}
