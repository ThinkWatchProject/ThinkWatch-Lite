import { describe, expect, it } from "vitest";
import { ago, densify, latency, money, repeated, statusTone, tokens, when } from "./format";
import { usd } from "./types";

describe("相对时间", () => {
  const now = 1_000_000_000;
  it("按秒、分、时、天分档", () => {
    expect(ago(now - 3_000, now)).toBe("3s");
    expect(ago(now - 90_000, now)).toBe("1m");
    expect(ago(now - 3_600_000 * 5, now)).toBe("5h");
    expect(ago(now - 86_400_000 * 3, now)).toBe("3d");
  });

  /** 时钟回拨或者服务端时间靠前时，不要显示负数 */
  it("未来的时间不显示负数", () => {
    expect(ago(now + 5_000, now)).toBe("0s");
  });
});

describe("延迟合成一列", () => {
  /**
   * 这条是合并的理由：非流式请求两个数几乎相同，两列只有一个信息。
   */
  it("差得不多时只显示一个数", () => {
    expect(latency(253, 254)).toBe("254ms");
    expect(latency(500, 520)).toBe("520ms");
  });

  /**
   * 差得开时两个数都要 —— 差值本身就是结论：首字节快而总耗时长 =
   * 模型在慢慢吐；两者都长 = 卡在网络或排队。
   */
  it("差得开时两个数都显示", () => {
    expect(latency(492, 1486)).toBe("492→1486ms");
  });

  it("还在跑（没有总耗时）时显示已知的那个", () => {
    expect(latency(300, undefined)).toBe("300ms");
    expect(latency(undefined, undefined)).toBe("—");
  });
});

describe("绝对时间", () => {
  // 2026-09-15 14:07:09 本地时间
  const now = new Date(2026, 8, 15, 14, 7, 9).getTime();

  it("今天的给到秒", () => {
    // 同一分钟内的几次请求要能分开 —— 少了秒就对不上号了
    expect(when(new Date(2026, 8, 15, 9, 3, 4).getTime(), now)).toBe("09:03:04");
  });

  it("更早的带上日期", () => {
    expect(when(new Date(2026, 8, 14, 23, 5).getTime(), now)).toBe("09-14 23:05");
  });

  /** 「今天」按日历天算，不是按 24 小时 —— 隔着零点的两分钟是两天 */
  it("零点两侧分属两天", () => {
    expect(when(new Date(2026, 8, 15, 0, 1, 0).getTime(), now)).toBe("00:01:00");
    expect(when(new Date(2026, 8, 14, 23, 59, 0).getTime(), now)).toBe("09-14 23:59");
  });
});

describe("token", () => {
  it("四位数以上换 k", () => {
    expect(tokens(463, 87)).toBe("463→87");
    expect(tokens(2_345, 463)).toBe("2.3k→463");
    expect(tokens(128_000, 1_200)).toBe("128k→1.2k");
  });

  it("没有用量就不显示 0", () => {
    // 还在跑的行、以及上游没报用量的行。0 会让它在排序里冒充一个测量结果
    expect(tokens(undefined, undefined)).toBe("—");
    expect(tokens(100, undefined)).toBe("—");
  });
});

describe("一行的金额", () => {
  it("估算的带记号", () => {
    expect(money(18_000, true)).toBe("~$0.018");
    expect(money(18_000, false)).toBe("$0.018");
  });

  it("算不出来的不显示 0", () => {
    // 订阅制上游、价目表里没有的模型 —— 都不是「零元」
    expect(money(undefined, false)).toBe("—");
  });
});

describe("重复值淡化", () => {
  const rows = [{ p: "relay" }, { p: "relay" }, { p: "official" }];
  it("和上一行相同算重复", () => {
    expect(repeated(rows, 0, (r) => r.p)).toBe(false); // 第一行永远不算
    expect(repeated(rows, 1, (r) => r.p)).toBe(true);
    expect(repeated(rows, 2, (r) => r.p)).toBe(false); // 变了，要显亮
  });
});

describe("状态分档", () => {
  it("5xx 和失败都是 bad", () => {
    expect(statusTone(500, "done")).toBe("bad");
    expect(statusTone(200, "failed")).toBe("bad");
  });
  it("4xx 是 warn，2xx 是 ok", () => {
    expect(statusTone(429, "done")).toBe("warn");
    expect(statusTone(200, "done")).toBe("ok");
  });
  /** 进行中不能算成功 —— 它还没有结果 */
  it("进行中单独一档", () => {
    expect(statusTone(undefined, "in_flight")).toBe("pending");
  });
});

describe("补空桶", () => {
  const b = (at_ms: number, requests: number) => ({
    at_ms,
    requests,
    failed: 0,
    cost_micros_exact: 0,
    cost_micros_estimated: 0,
    unpriced_requests: 0,
  });

  /**
   * 这条是这个函数存在的全部理由：跳过空桶的话，一天里的空档会被两边的
   * 柱子挤没，图上看起来就是连续在用 —— 而「昨天下午我根本没碰它」正是
   * 看这张图想确认的事。
   */
  it("中间没数据的那一格要补成零，不是跳过", () => {
    const out = densify([b(0, 2), b(2000, 1)], 0, 3000, 1000);
    expect(out.map((x) => x.requests)).toEqual([2, 0, 1]);
    expect(out.map((x) => x.at_ms)).toEqual([0, 1000, 2000]);
  });

  it("首尾的空格子也要补", () => {
    const out = densify([b(1000, 5)], 0, 3000, 1000);
    expect(out.map((x) => x.requests)).toEqual([0, 5, 0]);
  });

  it("一条数据都没有时给一排零，不是空数组", () => {
    expect(densify([], 0, 3000, 1000)).toHaveLength(3);
  });

  /** 跨度大、桶窄时不能算出几万格 —— 那不是一张图，是一次卡死 */
  it("格子数有上限", () => {
    expect(densify([], 0, 1_000_000_000, 1000).length).toBe(500);
  });

  it("参数不合法时给空数组，不是抛异常", () => {
    expect(densify([], 0, 1000, 0)).toEqual([]);
    expect(densify([], 1000, 0, 1000)).toEqual([]);
  });
});

describe("金额", () => {
  /** **小额不能显示成 $0.00** —— 那等于告诉用户这次调用是免费的 */
  it("小于一分钱时不显示成 $0.00", () => {
    // **$0.00 等于告诉用户这次调用是免费的**，而它不是
    expect(usd(300)).toBe("$0.0003");
  });
  it("正好是零就是零", () => {
    expect(usd(0)).toBe("$0");
  });
  it("大额两位小数", () => {
    expect(usd(2_500_000)).toBe("$2.50");
  });
});
