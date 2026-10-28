import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { Balance, Msg, ProviderQuota, ProviderView } from "@/types";
import { quotaRows, resetClock } from "./quotaRows";

// 本地时间 2026-10-28 14:00
const NOW = new Date(2026, 9, 28, 14, 0).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function provider(name: string, patch: Partial<ProviderView> = {}): ProviderView {
  return { name, base_url: "https://relay.example.com", protocol: null, disabled: false, balance: null, signed_in: null, ...patch } as ProviderView;
}

function bal(patch: Partial<Balance> = {}): Balance {
  return {
    source: "openrouter",
    read_at_ms: NOW - MIN,
    wallet: null,
    quota: null,
    windows: [],
    spent: null,
    expires_at_ms: null,
    error: null,
    ...patch,
  };
}

const failure: Msg = {
  code: "gw.balance.rejected",
  args: { status: "401" },
  text: "The balance could not be read: the upstream rejected the key (HTTP 401).",
};

const QUOTAS: ProviderQuota[] = [
  {
    provider: "chatgpt",
    windows: [
      { window: "5h", used_percent: 64, resets_at_ms: NOW + 2 * HOUR + 32 * MIN, status: null },
      { window: "weekly", used_percent: 31, resets_at_ms: NOW + 4 * DAY, status: null },
    ],
  },
  {
    provider: "bigmodel",
    windows: [
      // 过了重置时刻：手上的数是重置之前的，不算
      { window: "5h", used_percent: 99, resets_at_ms: NOW - MIN, status: null },
      {
        window: "30d",
        used_percent: 96,
        resets_at_ms: NOW + 10 * DAY,
        status: null,
        credits: { total: 1000, used: 960, remaining: 40 },
      },
    ],
  },
];

describe("额度与余额", () => {
  afterEach(() => setLang("zh"));

  it("重置的时刻：一天以内写钟点，更远的带日期，过了的不写", () => {
    expect(resetClock(NOW + 2 * HOUR + 32 * MIN, NOW)).toBe("16:32");
    expect(resetClock(NOW + 23 * HOUR, NOW)).toBe("13:00");
    expect(resetClock(NOW + 4 * DAY + 7 * HOUR, NOW)).toBe("11-01 21:00");
    expect(resetClock(NOW - MIN, NOW)).toBeNull();
    expect(resetClock(null, NOW)).toBeNull();
  });

  it("订阅额度：每个还作数的窗口一根条，右上角是最近的那次重置", () => {
    const ov = { providers: [provider("chatgpt", { protocol: "chatgpt" }), provider("bigmodel", { signed_in: "bigmodel" })] };
    const rows = quotaRows({ quotas: QUOTAS }, ov, NOW);
    expect(rows.map((r) => r.provider.name)).toEqual(["chatgpt", "bigmodel"]);
    const [gpt, glm] = rows;
    expect(gpt!.kind).toBe("ChatGPT 账号");
    expect(gpt!.gauges.map((g) => [g.label, g.percent, g.tone])).toEqual([
      ["5 小时", 64, "neutral"],
      ["每周", 31, "neutral"],
    ]);
    expect(gpt!.reset).toBe(NOW + 2 * HOUR + 32 * MIN);
    expect(gpt!.gauges[0]!.tip).toBe("5 小时额度已用 64%，16:32 重置");
    // 过了重置时刻的 5 小时窗口不画；剩下的那个用到九成六，琥珀，剩余积分照上游说的写
    expect(glm!.kind).toBe("账号登录");
    expect(glm!.gauges.map((g) => [g.label, g.tone, g.left])).toEqual([["30 天", "warn", "剩余 40 / 1,000 积分"]]);
    expect(glm!.reset).toBe(NOW + 10 * DAY);
  });

  it("用满是红的", () => {
    const quotas: ProviderQuota[] = [{ provider: "a", windows: [{ window: "5h", used_percent: 100, resets_at_ms: null, status: null }] }];
    const [row] = quotaRows({ quotas }, { providers: [provider("a")] }, NOW);
    expect(row!.gauges[0]!.tone).toBe("error");
    expect(row!.reset).toBeNull();
  });

  it("余额：钱包是右上角的大数，用掉多少写在下面，悬停同上游页", () => {
    const ov = {
      providers: [
        provider("openrouter", {
          balance: bal({ wallet: { amount: 3.2, currency: "USD" }, spent: { amount: 18.4, currency: "USD", period: "month", scope: null } }),
        }),
        provider("deepseek", { balance: bal({ source: "deepseek", wallet: { amount: 48.2, currency: "CNY" } }) }),
      ],
    };
    const [or, ds] = quotaRows({ quotas: [] }, ov, NOW);
    expect(or!.kind).toBe("余额");
    expect(or!.amount).toBe("$3.20");
    expect(or!.sub).toBe("本月已用 $18.40");
    expect(or!.gauges).toEqual([]);
    expect(or!.tip?.[0]).toMatch(/^OpenRouter · /);
    expect(ds!.amount).toBe("¥48.20");
  });

  it("余额的总额度和时间窗口画成条，剩余写在条后面", () => {
    const ov = {
      providers: [
        provider("relay", {
          balance: bal({
            source: "sub2api",
            quota: { limit: 100, used: 85, unit: "USD" },
            windows: [{ window: "1d", limit: 10, used: 2, unit: "USD", resets_at_ms: NOW + 3 * HOUR, scope: "user" }],
          }),
        }),
      ],
    };
    const [row] = quotaRows({ quotas: null }, ov, NOW);
    expect(row!.kind).toBe("Sub2API");
    expect(row!.gauges.map((g) => [g.label, g.percent, g.tone, g.left])).toEqual([
      ["总额度", 85, "warn", "剩余 $15 / $100"],
      ["1 天（账号）", 20, "neutral", "剩余 $8 / $10"],
    ]);
    expect(row!.reset).toBe(NOW + 3 * HOUR);
  });

  it("余额读取失败、没有读到过的数：写原因；读到过的照常写那一份", () => {
    const ov = {
      providers: [
        provider("a", { balance: bal({ error: failure }) }),
        provider("b", { balance: bal({ error: failure, wallet: { amount: 1, currency: "USD" } }) }),
      ],
    };
    const [a, b] = quotaRows({ quotas: [] }, ov, NOW);
    expect(a!.failed).toBe("无法读取余额：上游拒绝了此密钥（HTTP 401）。");
    expect(b!.failed).toBeNull();
    expect(b!.amount).toBe("$1");
  });

  it("停用的、什么都说不出的上游不列；没有上游配置时一行都没有", () => {
    const ov = {
      providers: [
        provider("chatgpt", { disabled: true }),
        provider("plain"),
        // 有余额对象，可什么都没读到也没出错：说不出东西
        provider("empty", { balance: bal() }),
      ],
    };
    expect(quotaRows({ quotas: QUOTAS }, ov, NOW)).toEqual([]);
    expect(quotaRows({ quotas: QUOTAS }, null, NOW)).toEqual([]);
  });

  it("英文", () => {
    setLang("en");
    const [row] = quotaRows({ quotas: QUOTAS }, { providers: [provider("chatgpt", { protocol: "chatgpt" })] }, NOW);
    expect(row!.gauges[0]!.tip).toBe("5h: 64% used; resets 16:32");
  });
});
