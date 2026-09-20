import { describe, expect, it } from "vitest";

import { setLang } from "./index";
import { coreText, errorText, plain } from "./core.i18n";

/** 每条用例自己说用哪种语言 —— 全局的那个在测试之间是共享的 */
function inLang<T>(lang: "zh" | "en", f: () => T): T {
  setLang(lang);
  try {
    return f();
  } finally {
    setLang("zh");
  }
}

describe("core 发来的消息", () => {
  it("中文界面按码说自己那句话", () => {
    const m = {
      code: "l1.tcp.refused",
      args: { addr: "127.0.0.1:1080" },
      text: "127.0.0.1:1080 refused the connection: nothing is listening on that port.",
    };
    expect(inLang("zh", () => coreText(m))).toBe(
      "127.0.0.1:1080 拒绝连接，该端口上没有服务在监听。请检查地址和端口。",
    );
  });

  it("英文界面直接用 core 给的那句", () => {
    // **英文那一份不抄。**core 一改措辞，抄本立刻就是错的，而没有任何
    // 东西在守着它。
    const m = { code: "l1.tcp.refused", args: { addr: "x" }, text: "x refused the connection." };
    expect(inLang("en", () => coreText(m))).toBe("x refused the connection.");
  });

  it("不认识的码退回英文原句", () => {
    // core 比界面新、或者是加码之前落库的老记录。**一句英文好过一个码。**
    const m = { code: "gw.something.brand.new", text: "Something new happened." };
    expect(inLang("zh", () => coreText(m))).toBe("Something new happened.");
    expect(inLang("zh", () => coreText(plain("加码之前落的库")))).toBe("加码之前落的库");
  });

  it("缺参数不会把 undefined 写进句子", () => {
    // core 换了参数名而界面还没跟上时，宁可少一个词，也不要一个
    // 「undefined」出现在用户眼前
    const m = { code: "l1.dns.no_records", text: "resolved to nothing" };
    expect(inLang("zh", () => coreText(m))).not.toContain("undefined");
  });

  it("没有消息就是空串，不是「null」", () => {
    expect(coreText(null)).toBe("");
    expect(coreText(undefined)).toBe("");
  });
});

describe("invoke 抛出来的东西", () => {
  it("控制面的 JSON 按码翻", () => {
    const body = JSON.stringify({
      code: "control.upstream_not_found",
      args: { upstream: "官方" },
      text: "There is no upstream named `官方`.",
    });
    expect(inLang("zh", () => errorText(body))).toBe("未找到名为「官方」的上游。");
  });

  it("不是 JSON 的就是一句现成的话", () => {
    // 连不上 socket 之类：这些是界面自己那一侧写的，本来就翻好了
    expect(errorText("无法连接控制面")).toBe("无法连接控制面");
    expect(errorText(new Error("boom"))).toBe("boom");
  });

  it("长得像 JSON 但不是消息的，原样显示", () => {
    expect(errorText('{"不是": "一条消息"}')).toBe('{"不是": "一条消息"}');
    expect(errorText("{ 半个")).toBe("{ 半个");
  });
});
