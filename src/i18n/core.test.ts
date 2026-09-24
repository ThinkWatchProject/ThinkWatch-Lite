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

describe("core 的错误：码加参数", () => {
  it("配置里一类东西的名字按词表说，查不到整句退回英文", () => {
    const m = (what: string) => ({
      code: "config.edit.name_taken",
      args: { what, name: "hk" },
      text: `there is already a ${what} named \`hk\``,
    });
    expect(inLang("zh", () => coreText(m("price sheet")))).toBe("已存在名为「hk」的价目表。");
    expect(inLang("zh", () => coreText(m("widget")))).toBe("there is already a widget named `hk`");
  });

  it("凭据那一句带不带上游名都能说", () => {
    // 编辑对话框里不带（就是正在改的那个），整份配置校验时带
    const m = { code: "config.credential.empty_key", text: "the API key is empty" };
    expect(inLang("zh", () => coreText(m))).toBe("API 密钥为空。");
    const withUpstream = {
      ...m,
      args: { upstream: "官方" },
      text: "the credential of upstream `官方`: the API key is empty",
    };
    expect(inLang("zh", () => coreText(withUpstream))).toBe("上游「官方」的凭据：API 密钥为空。");
  });

  it("原因外面的场合接回中文那句前面，场合可以套好几层", () => {
    // 取凭据失败：码是原因的码，上游名和英文开头是外面那层加的
    const m = {
      code: "config.secret.env_missing",
      args: { upstream: "官方", proxy: "hk", var: "HK_PASS" },
      text:
        "The credential for upstream `官方` could not be obtained: " +
        "The password for proxy `hk` could not be read: the environment variable HK_PASS is not set",
    };
    expect(inLang("zh", () => coreText(m))).toBe(
      "无法获取上游「官方」的凭据：无法读取代理「hk」的密码：未设置环境变量 HK_PASS。",
    );
    // 原因自己带着 `upstream`，英文没有那层开头：不凭空加一句
    const own = {
      code: "gw.oauth.not_configured",
      args: { upstream: "官方" },
      text: "Upstream `官方` has no OAuth configured.",
    };
    expect(inLang("zh", () => coreText(own))).toBe("上游「官方」未配置 OAuth。");
    // Z.ai 登录卡在哪一步
    const step = {
      code: "control.account_service_refused",
      args: { step: "create_key", why: "quota" },
      text: "Creating an API key: The account service refused the request: quota",
    };
    expect(inLang("zh", () => coreText(step))).toBe("创建 API 密钥：账号服务拒绝了请求：quota");
  });

  it("比较式写错时带上规则名", () => {
    const m = {
      code: "engine.compare.empty",
      args: { field: "input_tokens", rule: "长上下文" },
      text: "rule `长上下文`: condition input_tokens is written wrongly: the comparison is empty",
    };
    expect(inLang("zh", () => coreText(m))).toBe(
      "规则「长上下文」：条件 input_tokens 写法有误：比较式为空。",
    );
  });

  it("serde 的原话翻不了，外面那一层翻", () => {
    const m = {
      code: "config.rejected_at",
      args: { stage: "syntax", line: "3", detail: "found unexpected end of stream" },
      text: "syntax error (line 3): found unexpected end of stream",
    };
    expect(inLang("zh", () => coreText(m))).toBe(
      "配置第 3 行有语法错误：found unexpected end of stream",
    );
  });

  it("只有名字的列表换成「」和顿号", () => {
    const m = {
      code: "control.proxy_in_use",
      args: { proxy: "hk", upstreams: "`官方`, `中转`" },
      text: "Proxy `hk` is still used by upstream `官方`, `中转`; unlink those before deleting it.",
    };
    expect(inLang("zh", () => coreText(m))).toBe(
      "代理「hk」仍被上游「官方」、「中转」使用，请先解除关联再删除。",
    );
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
  it("控制面的失败是一个带码的对象，按码翻", () => {
    const e = {
      code: "control.upstream_not_found",
      args: { upstream: "官方" },
      text: "There is no upstream named `官方`.",
    };
    expect(inLang("zh", () => errorText(e))).toBe("未找到名为「官方」的上游。");
    expect(inLang("en", () => errorText(e))).toBe("There is no upstream named `官方`.");
  });

  it("桌面端自己的失败码是空串，照原句显示", () => {
    expect(inLang("zh", () => errorText({ code: "", text: "core 未在运行" }))).toBe("core 未在运行");
  });

  it("字符串和 Error 就是一句现成的话", () => {
    // Tauri 自己拒掉的调用（命令不存在、没有权限）是字符串
    expect(errorText("无法连接控制面")).toBe("无法连接控制面");
    expect(errorText(new Error("boom"))).toBe("boom");
  });

  it("字符串不再当 JSON 解析", () => {
    const s = '{"code":"control.shutdown","text":"shutting down"}';
    expect(inLang("zh", () => errorText(s))).toBe(s);
  });
});
