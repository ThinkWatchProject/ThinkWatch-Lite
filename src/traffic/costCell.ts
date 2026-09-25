import type { sessionsText } from "./Sessions.i18n";
import { usd, type SessionView } from "@/types";

type Text = (typeof sessionsText)["zh"];

/**
 * 一次会话的费用那一格写什么。**一个数或一个词，说明进悬停。**
 *
 * **三态**：有价格的加起来，没价格的单独说，一轮都没有价格时不显示
 * $0 —— 那是在撒谎。
 *
 * **合计里缺了轮次，金额就写成下限（「≥$0.233」）。**缺的是无法计价和
 * 没有用量的那几轮：它们产生了费用，只是算不出来。缺几轮、为什么缺写在
 * 悬停里。原来这些限定语跟在金额后面（「$0.233 +1 轮无法计价」），这一格
 * 因此有 150px，归组表比默认窗口宽出一截，被挤出视野的正是费用这一列。
 *
 * **纯的，因为「什么时候写成下限」要能被测。**
 */
export function costCell(
  s: SessionView,
  t: Text,
): {
  text: string;
  /** 没有金额可写（一轮都没有价格），淡一档 */
  muted: boolean;
  /** 悬停里的几句话，一句一段。空的就没有悬停 */
  notes: string[];
} {
  // 合计之外的轮次，各说各的
  const outside = [
    ...(s.unpriced_turns > 0 ? [t.unpricedTurnsTip(s.unpriced_turns)] : []),
    ...(s.no_usage_turns > 0 ? [t.noUsageTurnsTip(s.no_usage_turns)] : []),
  ];
  if (s.priced_turns === 0) {
    return { text: t.unpriced, muted: true, notes: [t.noPricedTurnsTip, ...outside] };
  }
  // **估算不能冒充实测**：合计里有估算的部分，就要带着记号
  const estimated = s.cost_micros_estimated > 0;
  return {
    text: (outside.length > 0 ? "≥" : "") + (estimated ? "~" : "") + usd(s.cost_micros),
    muted: false,
    notes: [...(estimated ? [t.estimatedTip(usd(s.cost_micros_estimated))] : []), ...outside],
  };
}
