import { describe, expect, it } from "vitest";
import type { CacheTally, UpstreamCheckup } from "@/types";
import {
  cacheFlagged,
  cacheGaps,
  failFlagged,
  inputFlagged,
  inputGaps,
  MIN_SAMPLES,
  MIN_TURNS,
  pct,
  signedPct,
} from "./checkup";

const tally = (turns: number, input: number, read: number, zero = 0): CacheTally => ({
  turns,
  zero_read_turns: zero,
  input_tokens: input,
  cache_read_tokens: read,
});

function checkup(p: Partial<UpstreamCheckup>): UpstreamCheckup {
  return {
    upstream: "relay",
    requests: 100,
    failed: 0,
    cancelled: 0,
    models: { named: 0, differed: 0, examples: [] },
    input: { all: null, by_model: [] },
    cache: { all: tally(0, 0, 0), by_model: [] },
    ttft_ms: null,
    tokens_per_sec: null,
    ...p,
  };
}

describe("输入和别的上游比", () => {
  it("差得多的模型在前，多了少了都算", () => {
    const c = checkup({
      input: {
        all: { median: 1.1, samples: 300 },
        by_model: [
          { model: "a", here: { median: 1.05, samples: 100 }, others: { median: 1.0, samples: 100 }, other_upstreams: 1 },
          { model: "b", here: { median: 0.6, samples: 100 }, others: { median: 1.0, samples: 100 }, other_upstreams: 2 },
        ],
      },
    });
    const gaps = inputGaps(c);
    expect(gaps.map((g) => g.model)).toEqual(["b", "a"]);
    expect(gaps[0]!.gap).toBeCloseTo(-0.4);
    // 少报也标：可能是删掉了一截对话
    expect(inputFlagged(gaps[0]!)).toBe(true);
    expect(inputFlagged(gaps[1]!)).toBe(false);
  });

  /**
   * 两家服务同一个模型时比较是对称的：中转多报，官方那边就是「少报」。只标离本地估算
   * 更远的那一家 —— 多报、删掉一截对话少报都标得出，诚实的那一家不被冤枉。
   */
  it("只标离本地估算更远的那一家", () => {
    const pair = (here: number, others: number) =>
      inputGaps(
        checkup({
          input: {
            all: null,
            by_model: [{ model: "a", here: { median: here, samples: 100 }, others: { median: others, samples: 100 }, other_upstreams: 1 }],
          },
        }),
      )[0]!;
    // 中转多报四成：标中转，不标官方（官方那边是 −29%）
    expect(inputFlagged(pair(1.4, 1.0))).toBe(true);
    expect(inputFlagged(pair(1.0, 1.4))).toBe(false);
    // 中转删掉一截对话，少报四成：标中转，不标官方（官方那边是 +67%）
    expect(inputFlagged(pair(0.6, 1.0))).toBe(true);
    expect(inputFlagged(pair(1.0, 0.6))).toBe(false);
  });

  /** 只有它服务这个模型：没有参照，单看它的比值说明不了什么 */
  it("别家没服务过的模型不比", () => {
    const c = checkup({
      input: {
        all: { median: 1.6, samples: 300 },
        by_model: [{ model: "a", here: { median: 1.6, samples: 300 }, others: null, other_upstreams: 0 }],
      },
    });
    expect(inputGaps(c)).toEqual([]);
  });

  it("任何一边样本不够都不比", () => {
    const few = MIN_SAMPLES - 1;
    const c = checkup({
      input: {
        all: null,
        by_model: [
          { model: "a", here: { median: 2, samples: few }, others: { median: 1, samples: 500 }, other_upstreams: 1 },
          { model: "b", here: { median: 2, samples: 500 }, others: { median: 1, samples: few }, other_upstreams: 1 },
        ],
      },
    });
    expect(inputGaps(c)).toEqual([]);
  });
});

describe("缓存和别的上游比", () => {
  it("别家读到不少、它读到的不到一半，才标出来", () => {
    const c = checkup({
      cache: {
        all: tally(60, 1_000_000, 100_000),
        by_model: [
          { model: "a", here: tally(30, 500_000, 20_000), others: tally(200, 2_000_000, 1_200_000), other_upstreams: 2 },
          { model: "b", here: tally(30, 500_000, 200_000), others: tally(200, 2_000_000, 1_000_000), other_upstreams: 1 },
        ],
      },
    });
    const gaps = cacheGaps(c);
    expect(gaps.map((g) => [g.model, cacheFlagged(g)])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  /** 别家也几乎读不到：多半是客户端没标缓存断点，不是上游的事 */
  it("别家也读不到时不标", () => {
    const c = checkup({
      cache: {
        all: tally(60, 1_000_000, 0),
        by_model: [{ model: "a", here: tally(30, 500_000, 0), others: tally(200, 2_000_000, 100_000), other_upstreams: 1 }],
      },
    });
    expect(cacheGaps(c).some(cacheFlagged)).toBe(false);
  });

  it("轮次不够不比", () => {
    const c = checkup({
      cache: {
        all: tally(5, 100_000, 0),
        by_model: [
          { model: "a", here: tally(MIN_TURNS - 1, 100_000, 0), others: tally(200, 2_000_000, 1_500_000), other_upstreams: 1 },
        ],
      },
    });
    expect(cacheGaps(c)).toEqual([]);
  });
});

describe("失败率", () => {
  it("请求够多、失败率够高才标", () => {
    expect(failFlagged(checkup({ requests: 100, failed: 12 }))).toBe(true);
    expect(failFlagged(checkup({ requests: 100, failed: 5 }))).toBe(false);
    // 三次里失败一次：样本太少
    expect(failFlagged(checkup({ requests: 3, failed: 1 }))).toBe(false);
  });
});

describe("写法", () => {
  it("百分比：不是零却不到 1% 的不写成 0%", () => {
    expect(pct(0)).toBe("0%");
    expect(pct(0.001)).toBe("<1%");
    expect(pct(0.624)).toBe("62%");
  });

  it("带符号的差，减号和加号一样宽", () => {
    expect(signedPct(0.31)).toBe("+31%");
    expect(signedPct(-0.38)).toBe("\u221238%");
    expect(signedPct(0.001)).toBe("0%");
  });
});
