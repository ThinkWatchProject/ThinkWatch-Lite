import { describe, expect, it } from "vitest";
import { fieldScore, normalize, requestIdQuery, score } from "./match";

describe("命令面板的搜索打分", () => {
  it("查询先规整：小写、全角转半角、空白并成一个", () => {
    expect(normalize("  Claude   CODE ")).toBe("claude code");
    expect(normalize("ＤＥＥＰ")).toBe("deep");
    expect(normalize("＃48123")).toBe("#48123");
  });

  it("名字就是它 > 名字开头 > 词首 > 包含 > 按顺序散着沾边", () => {
    expect(fieldScore("keys", "keys")).toBe(1);
    expect(fieldScore("deepseek", "deep")).toBe(0.9);
    expect(fieldScore("claude-code", "code")).toBe(0.8);
    expect(fieldScore("api.deepseek.com", "deepseek")).toBe(0.8);
    expect(fieldScore("新建密钥…", "密钥")).toBe(0.65);
    const fuzzy = fieldScore("claude-code", "ccd");
    expect(fuzzy).toBeGreaterThan(0.15);
    expect(fuzzy).toBeLessThan(0.4);
    expect(fieldScore("deepseek", "xyz")).toBe(0);
  });

  it("单个字母和中文不做散着的比对：那样什么都沾边", () => {
    expect(fieldScore("claude-code", "x")).toBe(0);
    expect(fieldScore("新建上游", "新游")).toBe(0);
  });

  it("越紧凑的散着沾边分越高", () => {
    expect(fieldScore("gpt-5-codex", "gpc")).toBeGreaterThan(fieldScore("gemini-2.5-pro-compact", "gpc"));
  });

  it("别名打六折：名字对上的排在别名对上的前面", () => {
    expect(score("deep", "deepseek")).toBe(0.9);
    expect(score("deep", "省钱", ["deepseek", "gemini"])).toBeCloseTo(0.9 * 0.6);
    expect(score("dark", "外观", ["深色 浅色 主题", "dark light theme mode"])).toBeCloseTo(0.9 * 0.6);
    // 别名整个对上，也排在名字只是含有它的后面
    expect(score("keys", "密钥", ["keys"])).toBeLessThan(score("keys", "api-keys"));
  });

  it("中文：名字里含有它的动作排在别名里有它的页面前面", () => {
    const action = score("试算", "路由试算…");
    const page = score("试算", "路由", ["路由", "Routing", "规则 策略组 试算 辅助请求"]);
    expect(action).toBeGreaterThan(page);
    expect(page).toBeGreaterThan(0);
  });

  it("几个词都要命中；整句对上的不比拆开的差", () => {
    expect(score("new key", "New key…")).toBe(0.9);
    expect(score("key new", "New key…")).toBeGreaterThan(0.6);
    expect(score("new zzz", "New key…")).toBe(0);
  });

  it("空查询一律 1：全都出现，顺序由调用方定", () => {
    expect(score("", "whatever")).toBe(1);
    expect(score("   ", "whatever")).toBe(1);
  });

  it("请求编号：带不带 # 都认，至少两位", () => {
    expect(requestIdQuery("#48123")).toBe("48123");
    expect(requestIdQuery(" 48123 ")).toBe("48123");
    expect(requestIdQuery("#4")).toBeNull();
    expect(requestIdQuery("gpt4")).toBeNull();
  });
});
