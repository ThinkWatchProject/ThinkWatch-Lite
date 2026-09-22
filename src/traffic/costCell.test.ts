import { describe, expect, it } from "vitest";
import { sessionsText } from "@/Sessions.i18n";
import type { SessionView } from "@/types";
import { costCell } from "./costCell";

const t = sessionsText.zh;

/** 一次十轮、全部按价目表算出价格的会话；各条用例只改相关的那几个数 */
const session = (x: Partial<SessionView>): SessionView => ({
  id: "s",
  client: "claude-code",
  started_ms: 0,
  ended_ms: 60_000,
  turns: 10,
  cost_micros: 233_000,
  cost_micros_estimated: 0,
  priced_turns: 10,
  unpriced_turns: 0,
  no_usage_turns: 0,
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_write_tokens: 0,
  cache_saved_micros: 0,
  peak_input_tokens: 0,
  models: ["claude-sonnet-5"],
  errors: 0,
  ...x,
});

describe("会话费用那一格", () => {
  it("全部算出价格时只有金额，没有悬停", () => {
    expect(costCell(session({}), t)).toEqual({ text: "$0.233", muted: false, notes: [] });
  });

  /**
   * 这条是改成一行的理由：限定语原来跟在金额后面，一格 150px。缺了轮次
   * 就是下限，缺几轮、为什么缺进悬停。
   */
  it("合计缺了轮次时写成下限", () => {
    const c = costCell(session({ priced_turns: 9, unpriced_turns: 1 }), t);
    expect(c.text).toBe("≥$0.233");
    expect(c.notes).toEqual([t.unpricedTurnsTip(1)]);
    expect(costCell(session({ priced_turns: 8, no_usage_turns: 2 }), t).text).toBe("≥$0.233");
  });

  it("有估算的部分时带记号，悬停写出估算了多少", () => {
    const c = costCell(session({ cost_micros: 3_412_000, cost_micros_estimated: 61_000 }), t);
    expect(c.text).toBe("~$3.41");
    expect(c.notes).toEqual([t.estimatedTip("$0.061")]);
  });

  it("既有估算又缺了轮次时两个记号都在", () => {
    const c = costCell(
      session({ cost_micros_estimated: 5_000, priced_turns: 9, unpriced_turns: 1 }),
      t,
    );
    expect(c.text).toBe("≥~$0.233");
    expect(c.notes).toEqual([t.estimatedTip("$0.0050"), t.unpricedTurnsTip(1)]);
  });

  it("一轮都没有价格时写「无法计价」，不写 $0", () => {
    const c = costCell(
      session({ cost_micros: 0, priced_turns: 0, unpriced_turns: 8, no_usage_turns: 2 }),
      t,
    );
    expect(c.text).toBe(t.unpriced);
    expect(c.muted).toBe(true);
    expect(c.notes).toEqual([t.noPricedTurnsTip, t.unpricedTurnsTip(8), t.noUsageTurnsTip(2)]);
  });
});
