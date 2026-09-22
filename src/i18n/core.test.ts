import { describe, expect, it } from "vitest";

import { setLang } from "./index";
import { coreText, errorText, plain, ruleWhy } from "./core.i18n";

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
    // 词表里还没有这句。**一句英文好过一个码。**
    const m = { code: "gw.something.brand.new", text: "Something new happened." };
    expect(inLang("zh", () => coreText(m))).toBe("Something new happened.");
    expect(inLang("zh", () => coreText(plain("界面自己拼的一句")))).toBe("界面自己拼的一句");
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

describe("扫描发现：句子由词拼出来", () => {
  it("按 kind 和 rule 拼出中文", () => {
    const m = {
      code: "scan.rule.detail",
      args: { kind: "hooks", rule: "curl-pipe-sh" },
      text: "Downloads and runs it straight away; what runs is decided remotely and cannot be read first. A hook runs a shell command before or after a tool call, which is execution without the model taking part.",
    };
    expect(inLang("zh", () => coreText(m))).toBe(
      "下载后直接执行，执行的内容由远端决定且无法预先查看。hook 在工具调用前后直接执行 shell 命令，无需模型参与即可获得执行权限。",
    );
  });

  it("标题只取隐藏字符那句话的名字", () => {
    const m = {
      code: "scan.hidden",
      args: { kind: "skill", what: "zero_width" },
      text: "skill contains Zero-width characters",
    };
    expect(inLang("zh", () => coreText(m))).toBe("skill 中含有零宽字符");
  });

  it("不认识的规则 id 整句退回英文", () => {
    // 用户自己加的规则走的就是这条路：那条 `why` 是他自己写的一句话，
    // **原样显示才对**，拼一句缺了半截的中文不对
    const m = {
      code: "scan.rule.detail",
      args: { kind: "hooks", rule: "我自己加的规则" },
      text: "Something I wrote myself. A hook runs a shell command before or after a tool call, which is execution without the model taking part.",
    };
    expect(inLang("zh", () => coreText(m))).toBe(m.text);
  });
});

describe("工具调用防火墙命中的规则", () => {
  it("内置规则说中文", () => {
    expect(
      inLang("zh", () => ruleWhy("curl-pipe-sh", "Downloads and runs it straight away")),
    ).toBe("下载后直接执行，执行的内容由远端决定且无法预先查看");
  });

  it("用户自己写的规则原样显示", () => {
    expect(inLang("zh", () => ruleWhy("我的规则", "我自己写的理由"))).toBe("我自己写的理由");
  });

  it("英文界面用 core 给的那句", () => {
    expect(inLang("en", () => ruleWhy("curl-pipe-sh", "Downloads and runs it"))).toBe(
      "Downloads and runs it",
    );
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
