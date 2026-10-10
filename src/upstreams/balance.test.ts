import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { Balance, BalanceScope, BalanceWindow, Msg, Spent, SpentPeriod } from "@/types";
import {
  balanceBrief,
  balanceFace,
  balanceTip,
  billingLine,
  cash,
  measure,
  measurePair,
  readAgo,
  tightestWindow,
} from "./balance";

// 本地时间 2026-09-25 16:42:07：「多久前读取」「多久后重置」都从这一刻算
const NOW = new Date(2026, 8, 25, 16, 42, 7).getTime();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// core 的原话，界面按码说中文
const failure: Msg = {
  code: "gw.balance.rejected",
  args: { status: "401" },
  text: "The balance could not be read: the upstream rejected the key (HTTP 401).",
};
const FAILED_ZH = "无法读取余额：上游拒绝了此密钥（HTTP 401）。";

function bal(patch: Partial<Balance> = {}): Balance {
  return {
    source: "sub2api",
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

const usd = (amount: number) => ({ amount, currency: "USD" });
const spentUsd = (amount: number, period: SpentPeriod, scope: BalanceScope | null = null): Spent => ({
  amount,
  currency: "USD",
  period,
  scope,
});
const win = (
  window: string,
  used: number,
  limit: number,
  resetsIn: number | null = null,
  more: Partial<BalanceWindow> = {},
): BalanceWindow => ({
  window,
  limit,
  used,
  unit: "USD",
  resets_at_ms: resetsIn === null ? null : NOW + resetsIn,
  scope: null,
  ...more,
});

describe("金额", () => {
  it("美元写 $，人民币写 ¥，别的币种写代码", () => {
    expect(cash(18.4, "USD")).toBe("$18.40");
    expect(cash(63.2, "CNY")).toBe("¥63.20");
    expect(cash(12.5, "EUR")).toBe("EUR 12.50");
    expect(cash(5, "usd")).toBe("$5");
  });

  it("到分为止，整数不带小数，千位分隔；不到半分的不写成 0", () => {
    expect(cash(100, "USD")).toBe("$100");
    expect(cash(42.184, "USD")).toBe("$42.18");
    expect(cash(1234.5, "USD")).toBe("$1,234.50");
    expect(cash(0, "USD")).toBe("$0");
    expect(cash(0.004, "USD")).toBe("<$0.01");
    expect(cash(-1.2, "USD")).toBe("-$1.20");
  });

  it("单位不明的只写数，不带货币符号，也不写「UNKNOWN」", () => {
    expect(cash(12.5, "unknown")).toBe("12.50");
    expect(cash(300_000_000, "unknown")).toBe("300,000,000");
    expect(measure(12.5, "unknown")).toBe("12.50");
    expect(measurePair(42.18, 100, "unknown")).toBe("42.18 / 100");
    expect(measurePair(42.18, 100, "unknown", true)).toBe("42.18 / 100.00");
  });

  it("悬停里写全：一律两位小数，不到一分的写到四位", () => {
    expect(cash(100, "USD", true)).toBe("$100.00");
    expect(cash(0.0042, "USD", true)).toBe("$0.0042");
  });

  it("token 收成 k / M，悬停里写全；请求数写整数；计数带单位", () => {
    expect(measure(1_234_567, "tokens")).toBe("1.2M token");
    // 限额多是整数：「5M」「500k」，不写「5.0M」
    expect(measurePair(1_234_567, 5_000_000, "tokens")).toBe("1.2M / 5M token");
    expect(measurePair(320, 1000, "requests")).toBe("320 / 1,000 次");
    expect(measure(1_234_567, "tokens", true)).toBe("1,234,567 token");
    expect(measurePair(420, 500, "requests")).toBe("420 / 500 次");
    expect(measurePair(42.18, 100, "USD")).toBe("$42.18 / $100");
  });
});

describe("多久前读取", () => {
  it("一分钟内、分钟、小时，隔了一天写时刻", () => {
    expect(readAgo(NOW - 20_000, NOW)).toBe("刚刚读取");
    expect(readAgo(NOW - 3 * MIN, NOW)).toBe("3 分钟前读取");
    expect(readAgo(NOW - 2 * HOUR - 5 * MIN, NOW)).toBe("2 小时前读取");
    expect(readAgo(new Date(2026, 8, 23, 9, 5).getTime(), NOW)).toBe("09-23 09:05 读取");
  });
});

describe("上游表那一格", () => {
  it("没有余额：照旧说计费", () => {
    expect(balanceFace(null, NOW)).toBeNull();
    expect(balanceFace(undefined, NOW)).toBeNull();
    // 读过、没出错，却什么都没读到
    expect(balanceFace(bal(), NOW)).toBeNull();
  });

  it("总额度：剩余 / 总额、条、从哪儿读的和多久前", () => {
    const f = balanceFace(bal({ quota: { limit: 100, used: 57.82, unit: "USD" } }), NOW);
    expect(f).toEqual({
      kind: "quota",
      main: "剩余 $42.18 / $100",
      percent: expect.closeTo(57.82, 5),
      tone: "neutral",
      sub: "Sub2API 额度 · 1 分钟前读取",
    });
  });

  it("总额度用超了：剩余写 0，条是红的", () => {
    const f = balanceFace(bal({ quota: { limit: 10, used: 12, unit: "USD" } }), NOW);
    expect(f).toMatchObject({ kind: "quota", main: "剩余 $0 / $10", tone: "error" });
  });

  it("总额是 0：只写已用多少，不画条", () => {
    const f = balanceFace(bal({ source: "newapi", quota: { limit: 0, used: 81.6, unit: "USD" } }), NOW);
    expect(f).toMatchObject({ kind: "quota", main: "已用 $81.60", percent: null, sub: "New API 额度 · 1 分钟前读取" });
  });

  it("token 计的总额度", () => {
    const f = balanceFace(bal({ source: "thinkwatch", quota: { limit: 5_000_000, used: 3_800_000, unit: "tokens" } }), NOW);
    expect(f).toMatchObject({ kind: "quota", main: "剩余 1.2M / 5M token" });
  });

  it("总额度和钱包：写在同一行", () => {
    const f = balanceFace(bal({ quota: { limit: 100, used: 57.82, unit: "USD" }, wallet: usd(5) }), NOW);
    expect(f).toMatchObject({ kind: "quota", main: "剩余 $42.18 / $100 · 余额 $5" });
  });

  it("窗口：画最紧张的那个，和账号额度一个样子", () => {
    const f = balanceFace(
      bal({ source: "sub2api", windows: [win("daily", 4.1, 10, 7 * HOUR), win("5h", 8.6, 10, 2 * HOUR)] }),
      NOW,
    );
    expect(f).toEqual({
      kind: "window",
      window: "5h",
      used: "已用 86%",
      label: "5 小时 · 2 小时后",
      percent: expect.closeTo(86, 5),
      tone: "warn",
      sub: "剩余 $1.40 / $10",
    });
  });

  it("窗口的条：八成起琥珀，用满红", () => {
    const tone = (used: number) => {
      const f = balanceFace(bal({ windows: [win("1d", used, 100, HOUR)] }), NOW);
      return f?.kind === "window" ? f.tone : null;
    };
    expect(tone(79.9)).toBe("neutral");
    expect(tone(80)).toBe("warn");
    expect(tone(99.9)).toBe("warn");
    expect(tone(100)).toBe("error");
  });

  it("过了重置时刻的窗口不算数；没有重置时刻的照算", () => {
    const windows = [win("5h", 9.9, 10, -MIN), win("weekly", 3, 10)];
    expect(tightestWindow(windows, NOW)?.w.window).toBe("weekly");
    const f = balanceFace(bal({ windows }), NOW);
    expect(f).toMatchObject({ kind: "window", used: "已用 30%", label: "每周" });
  });

  it("窗口和总额度一起：谁用得多画谁", () => {
    const quota = { limit: 100, used: 40, unit: "USD" };
    expect(balanceFace(bal({ quota, windows: [win("5h", 9, 10, HOUR)] }), NOW)?.kind).toBe("window");
    expect(balanceFace(bal({ quota, windows: [win("5h", 1, 10, HOUR)] }), NOW)?.kind).toBe("quota");
  });

  it("token、请求数计的窗口写成计数", () => {
    const tokens = balanceFace(
      bal({ windows: [win("1d", 3_800_000, 5_000_000, HOUR, { unit: "tokens" })] }),
      NOW,
    );
    expect(tokens).toMatchObject({ kind: "window", used: "已用 76%", sub: "剩余 1.2M / 5M token" });
    const requests = balanceFace(bal({ windows: [win("5h", 680, 1000, HOUR, { unit: "requests" })] }), NOW);
    expect(requests).toMatchObject({ kind: "window", sub: "剩余 320 / 1,000 次" });
  });

  it("账号的限额（账号下每把密钥共用）在第二行说「账号额度」，这把密钥自己的不说", () => {
    const user = balanceFace(bal({ windows: [win("7d", 85, 100, 3 * HOUR, { scope: "user" })] }), NOW);
    expect(user).toMatchObject({ kind: "window", sub: "账号额度 · 剩余 $15 / $100" });
    const key = balanceFace(bal({ windows: [win("7d", 85, 100, 3 * HOUR, { scope: "key" })] }), NOW);
    expect(key).toMatchObject({ kind: "window", sub: "剩余 $15 / $100" });
  });

  it("企业网关：几个窗口、两种归属，画最紧的那个", () => {
    const b = bal({
      source: "thinkwatch",
      windows: [
        win("1d", 2.1, 10, 7 * HOUR, { scope: "key" }),
        win("30d", 410, 500, 12 * 24 * HOUR, { scope: "user" }),
        win("5h", 120_000, 1_000_000, 2 * HOUR, { scope: "key", unit: "tokens" }),
      ],
    });
    expect(balanceFace(b, NOW)).toMatchObject({
      kind: "window",
      window: "30d",
      used: "已用 82%",
      label: "30 天 · 12 天后",
      tone: "warn",
      sub: "账号额度 · 剩余 $90 / $500",
    });
  });

  it("只知道用掉了多少：今日、本月、累计，不画条", () => {
    const spent = (period: SpentPeriod, scope: BalanceScope | null = null) =>
      balanceFace(bal({ source: "thinkwatch", spent: spentUsd(12.4, period, scope) }), NOW);
    expect(spent("today")).toEqual({ kind: "wallet", main: "今日已用 $12.40" });
    expect(spent("month")).toEqual({ kind: "wallet", main: "本月已用 $12.40" });
    expect(spent("total")).toEqual({ kind: "wallet", main: "累计已用 $12.40" });
    // 这把密钥自己花的，和没说是谁的一样写
    expect(spent("month", "key")).toEqual({ kind: "wallet", main: "本月已用 $12.40" });
    // 有余额、额度或窗口时写它们，用掉多少在悬停里
    const both = bal({ wallet: usd(3), spent: spentUsd(12.4, "month") });
    expect(balanceFace(both, NOW)).toEqual({ kind: "wallet", main: "余额 $3" });
    expect(balanceTip(both, NOW)).toContain("本月已用 $12.40");
  });

  it("花的是账号整体的：写「账号…已用」", () => {
    const spent = (period: SpentPeriod) =>
      balanceFace(bal({ source: "thinkwatch", spent: spentUsd(12.4, period, "user") }), NOW);
    expect(spent("month")).toEqual({ kind: "wallet", main: "账号本月已用 $12.40" });
    expect(spent("today")).toEqual({ kind: "wallet", main: "账号今日已用 $12.40" });
    expect(spent("total")).toEqual({ kind: "wallet", main: "账号累计已用 $12.40" });
    // 有窗口时格子写窗口，账号花的钱在悬停里
    const b = bal({
      source: "thinkwatch",
      windows: [win("1d", 2, 10, HOUR, { scope: "user" })],
      spent: spentUsd(12.4, "month", "user"),
    });
    expect(balanceFace(b, NOW)?.kind).toBe("window");
    expect(balanceTip(b, NOW)).toContain("账号本月已用 $12.40");
    expect(balanceBrief(bal({ spent: spentUsd(12.4, "month", "user") }), NOW)?.text).toBe("账号本月已用 $12.40");
  });

  it("用掉的是 token、或者单位不明：写成计数、只写数", () => {
    const tokens = bal({ source: "newapi", spent: { amount: 1_234_567, currency: "tokens", period: "total", scope: null } });
    expect(balanceFace(tokens, NOW)).toEqual({ kind: "wallet", main: "累计已用 1.2M token" });
    expect(balanceTip(tokens, NOW)).toContain("累计已用 1,234,567 token");
    const unknown = bal({ source: "newapi", spent: { amount: 81.6, currency: "unknown", period: "total", scope: null } });
    expect(balanceFace(unknown, NOW)).toEqual({ kind: "wallet", main: "累计已用 81.60" });
  });

  it("窗口和钱包：钱包接在剩余后面", () => {
    const f = balanceFace(bal({ windows: [win("monthly", 20, 50)], wallet: usd(3.5) }), NOW);
    expect(f).toMatchObject({ kind: "window", label: "每月", sub: "剩余 $30 / $50 · 余额 $3.50" });
  });

  it("只有钱包：美元、人民币", () => {
    expect(balanceFace(bal({ source: "moonshot", wallet: usd(18.4) }), NOW)).toEqual({
      kind: "wallet",
      main: "余额 $18.40",
    });
    expect(balanceFace(bal({ source: "deepseek", wallet: { amount: 63.2, currency: "CNY" } }), NOW)).toEqual({
      kind: "wallet",
      main: "余额 ¥63.20",
    });
  });

  it("OpenRouter：设了额度的密钥写额度，花费在悬停里；没设的只写花费", () => {
    const limited = bal({
      source: "openrouter",
      quota: { limit: 10, used: 2.5, unit: "USD" },
      spent: spentUsd(2.5, "month"),
    });
    expect(balanceFace(limited, NOW)).toMatchObject({
      kind: "quota",
      main: "剩余 $7.50 / $10",
      sub: "OpenRouter 额度 · 1 分钟前读取",
    });
    expect(balanceTip(limited, NOW)).toContain("本月已用 $2.50");
    const open = bal({ source: "openrouter", spent: spentUsd(42.25, "month") });
    expect(balanceFace(open, NOW)).toEqual({ kind: "wallet", main: "本月已用 $42.25" });
    expect(balanceBrief(open, NOW)).toEqual({ source: "OpenRouter", text: "本月已用 $42.25", failed: false });
  });

  it("New API 的单位：人民币、token、单位不明", () => {
    const cny = balanceFace(bal({ source: "newapi", quota: { limit: 100, used: 36.8, unit: "CNY" } }), NOW);
    expect(cny).toMatchObject({ kind: "quota", main: "剩余 ¥63.20 / ¥100" });
    const tokens = balanceFace(bal({ source: "newapi", quota: { limit: 5_000_000, used: 1_000_000, unit: "tokens" } }), NOW);
    expect(tokens).toMatchObject({ kind: "quota", main: "剩余 4M / 5M token" });
    const unknown = bal({ source: "newapi", quota: { limit: 100, used: 57.82, unit: "unknown" } });
    expect(balanceFace(unknown, NOW)).toMatchObject({ kind: "quota", main: "剩余 42.18 / 100" });
    expect(balanceTip(unknown, NOW)).toContain("额度：已用 57.82 / 100.00，剩余 42.18");
    expect(balanceBrief(unknown, NOW)?.text).toBe("剩余 42.18 / 100");
    // 哪儿都不写「UNKNOWN」
    expect(balanceTip(unknown, NOW).join("\n")).not.toMatch(/unknown/i);
  });

  it("读取失败、没有读到过：琥珀色的标签，原因在悬停里", () => {
    const b = bal({ source: "newapi", error: failure });
    expect(balanceFace(b, NOW)).toEqual({ kind: "failed", reason: FAILED_ZH });
    expect(balanceTip(b, NOW)).toEqual(["New API", FAILED_ZH]);
  });

  it("读取失败、有上一次读到的：照常写那一份，失败只在悬停里", () => {
    const b = bal({ source: "deepseek", wallet: usd(18.4), error: failure });
    expect(balanceFace(b, NOW)).toEqual({ kind: "wallet", main: "余额 $18.40" });
    expect(balanceTip(b, NOW).at(-1)).toBe(FAILED_ZH);
  });
});

describe("悬停", () => {
  it("每个还作数的窗口、确切的金额、到期", () => {
    const b = bal({
      read_at_ms: new Date(2026, 8, 25, 16, 41).getTime(),
      wallet: usd(5),
      quota: { limit: 100, used: 57.82, unit: "USD" },
      windows: [win("5h", 8.6, 10, 2 * HOUR), win("daily", 4.1, 10, 7 * HOUR), win("weekly", 10, 10, -MIN)],
      expires_at_ms: new Date(2026, 10, 1, 12).getTime(),
    });
    expect(balanceTip(b, NOW)).toEqual([
      "Sub2API · 16:41 读取",
      "余额 $5.00",
      "额度：已用 $57.82 / $100.00，剩余 $42.18",
      "5 小时额度：已用 $8.60 / $10.00（86%），2 小时后重置",
      "每天额度：已用 $4.10 / $10.00（41%），7 小时后重置",
      "2026-11-01 到期",
    ]);
  });

  it("每个窗口带它的归属", () => {
    const b = bal({
      source: "thinkwatch",
      read_at_ms: new Date(2026, 8, 25, 16, 41).getTime(),
      windows: [
        win("1d", 2.1, 10, 7 * HOUR, { scope: "key" }),
        win("30d", 410, 500, 12 * 24 * HOUR, { scope: "user" }),
        win("5h", 120_000, 1_000_000, 2 * HOUR, { unit: "tokens" }),
      ],
    });
    expect(balanceTip(b, NOW)).toEqual([
      "ThinkWatch · 16:41 读取",
      "1 天额度（本密钥）：已用 $2.10 / $10.00（21%），7 小时后重置",
      "30 天额度（账号）：已用 $410.00 / $500.00（82%），12 天后重置",
      "5 小时额度：已用 120,000 / 1,000,000 token（12%），2 小时后重置",
    ]);
  });

  it("总额是 0 的总额度只写已用", () => {
    const b = bal({ quota: { limit: 0, used: 81.6, unit: "USD" } });
    expect(balanceTip(b, NOW)).toContain("额度：已用 $81.60");
  });
});

describe("检测连接的那一行", () => {
  it("没有可说的就没有这一行", () => {
    expect(balanceBrief(null, NOW)).toBeNull();
    expect(balanceBrief(bal(), NOW)).toBeNull();
  });

  it("来源，和格子里那几样排成一行", () => {
    expect(balanceBrief(bal({ source: "deepseek", wallet: usd(18.4) }), NOW)).toEqual({
      source: "DeepSeek",
      text: "余额 $18.40",
      failed: false,
    });
    expect(
      balanceBrief(
        bal({ quota: { limit: 100, used: 57.82, unit: "USD" }, wallet: usd(5), windows: [win("5h", 8.6, 10, HOUR)] }),
        NOW,
      ),
    ).toEqual({ source: "Sub2API", text: "剩余 $42.18 / $100 · 余额 $5 · 5 小时额度已用 86%", failed: false });
  });

  it("账号的限额说一声，这把密钥自己的不说", () => {
    const b = (scope: "key" | "user") =>
      balanceBrief(bal({ source: "thinkwatch", windows: [win("30d", 410, 500, DAY, { scope })] }), NOW)?.text;
    expect(b("user")).toBe("30 天额度（账号）已用 82%");
    expect(b("key")).toBe("30 天额度已用 82%");
  });

  it("读取失败写原因", () => {
    expect(balanceBrief(bal({ spent: spentUsd(12.4, "month") }), NOW)).toEqual({
      source: "Sub2API",
      text: "本月已用 $12.40",
      failed: false,
    });
    expect(balanceBrief(bal({ error: failure }), NOW)).toEqual({
      source: "Sub2API",
      text: FAILED_ZH,
      failed: true,
    });
  });
});

describe("计费那一行", () => {
  it("按量计费带价目表；不计费只写一个词", () => {
    expect(billingLine({ billing: "per-token", pricing: null })).toBe("按量计费 · 默认价目表");
    expect(billingLine({ billing: "per-token", pricing: "relay-fee" })).toBe("按量计费 · 价目表 relay-fee");
    expect(billingLine({ billing: "free", pricing: null })).toBe("不计费");
  });
});

describe("英文界面", () => {
  it("同样的几样，英文的写法", () => {
    setLang("en");
    expect(balanceFace(bal({ quota: { limit: 100, used: 57.82, unit: "USD" }, wallet: usd(5) }), NOW)).toMatchObject({
      main: "$42.18 / $100 left · Balance $5",
      sub: "Sub2API quota · read 1 min ago",
    });
    expect(balanceFace(bal({ windows: [win("5h", 8.6, 10, 2 * HOUR)] }), NOW)).toMatchObject({
      used: "86% used",
      label: "5h · in 2 h",
    });
    // 英文界面用 core 的原话
    expect(balanceFace(bal({ error: failure }), NOW)).toEqual({
      kind: "failed",
      reason: "The balance could not be read: the upstream rejected the key (HTTP 401).",
    });
    expect(balanceTip(bal({ windows: [win("daily", 4.1, 10, 7 * HOUR)] }), NOW)).toContain(
      "Daily limit: $4.10 / $10.00 used (41%), resets in 7 h",
    );
    expect(measure(1_234_567, "tokens")).toBe("1.2M tokens");
    expect(balanceFace(bal({ spent: spentUsd(12.4, "month") }), NOW)).toMatchObject({
      main: "$12.40 spent this month",
    });
    expect(balanceFace(bal({ spent: spentUsd(12.4, "month", "user") }), NOW)).toMatchObject({
      main: "Account: $12.40 this month",
    });
    expect(balanceFace(bal({ spent: spentUsd(3, "today", "user") }), NOW)).toMatchObject({
      main: "Account: $3 today",
    });
    expect(balanceFace(bal({ spent: spentUsd(3, "total", "user") }), NOW)).toMatchObject({
      main: "Account: $3 to date",
    });
    expect(balanceFace(bal({ quota: { limit: 100, used: 57.82, unit: "unknown" } }), NOW)).toMatchObject({
      main: "42.18 / 100 left",
    });
    expect(measurePair(320, 1000, "requests")).toBe("320 / 1,000 requests");
    expect(balanceFace(bal({ windows: [win("7d", 85, 100, HOUR, { scope: "user" })] }), NOW)).toMatchObject({
      sub: "Account limit · $15 / $100 left",
    });
    expect(balanceTip(bal({ windows: [win("7d", 85, 100, HOUR, { scope: "key" })] }), NOW)).toContain(
      "7-day limit (this key): $85.00 / $100.00 used (85%), resets in 1 h",
    );
    expect(billingLine({ billing: "per-token", pricing: null })).toBe("Per token · Default price sheet");
  });
});
