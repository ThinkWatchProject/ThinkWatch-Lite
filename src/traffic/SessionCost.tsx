import type React from "react";
import { Tip } from "@/ui/tip";
import { useText } from "@/i18n";
import { usd, type SessionView } from "@/types";
import { sessionsText } from "@/Sessions.i18n";

/**
 * 一次会话的花费。
 *
 * **三态**：有价格的加起来，没价格的单独说，一轮都没有价格时
 * 不显示 $0 —— 那是在撒谎。
 *
 * 订阅制上游服务的轮次**不在这三态里**：它们计入订阅额度，不按用量产生
 * 费用，既不加进合计，也不是「无法计价」。概览上同一批请求写的是「订阅额度
 * N 次」，这里用同一个说法。
 */
export function SessionCost({ s }: { s: SessionView }) {
  const t = useText(sessionsText);
  const subscription = s.subscription_turns > 0 && (
    <Tip text={t.subscriptionTip}>
      <span className="text-muted-foreground">{t.subscriptionTurns(s.subscription_turns)}</span>
    </Tip>
  );
  if (s.priced_turns === 0) {
    // 全走订阅的会话没有金额可写，但也没有缺什么
    if (subscription && s.unpriced_turns === 0 && s.no_usage_turns === 0) return subscription;
    return (
      <>
        <Tip text={t.noPricedTurnsTip}><span className="text-muted-foreground">{t.unpriced}</span></Tip>
        {subscription && <Also>{subscription}</Also>}
      </>
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
      {subscription && <Also>{subscription}</Also>}
    </>
  );
}

/**
 * 订阅额度跟在金额后面时用「·」隔开，不用「+」：「+N 轮无法计价」说的是
 * 合计之外还有没算进来的费用，订阅那几轮没有这样的费用。
 */
function Also({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span className="mx-1 text-muted-foreground">·</span>
      {children}
    </>
  );
}
