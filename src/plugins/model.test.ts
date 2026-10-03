import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ManifestView, PluginView } from "@/types";
import { localSchema, pluginDescription, pluginName } from "./defaults";
import { hunks, lineDiff, tally } from "./diff";
import {
  cpuMs,
  extraKinds,
  globMatch,
  holdsToolCalls,
  ID_RE,
  manifestUnknown,
  requestInScope,
  saveAsks,
  shaPrefix,
  shapeChanged,
  splitInvisible,
  suggestId,
  touchesReplies,
  touchesRequests,
} from "./model";
import { draftOf, scopeOf, scopeProblem, settingsDraftOf, settingsOf, suggestionMatches } from "./fields";
import { moved } from "./ListDialogs";

describe("通配", () => {
  it("* 是任意一段，可以为空", () => {
    expect(globMatch("claude-*", "claude-opus-4-5")).toBe(true);
    expect(globMatch("claude-*", "claude-")).toBe(true);
    expect(globMatch("*-mini", "gpt-5-mini")).toBe(true);
    expect(globMatch("a*b*c", "abc")).toBe(true);
    expect(globMatch("a*b*c", "ac")).toBe(false);
    expect(globMatch("*", "")).toBe(true);
    expect(globMatch("codex", "codex-cli")).toBe(false);
  });

  it("适用范围：空的那一项是全部；客户端按密钥名和推测的应用都比", () => {
    const row = { client: "default", client_hint: "claude-code", model: "claude-opus-4-5", provider: "anthropic" };
    expect(requestInScope({ clients: [], models: [], upstreams: [] }, row)).toBe(true);
    expect(requestInScope({ clients: ["claude-code"], models: ["claude-*"], upstreams: [] }, row)).toBe(true);
    expect(requestInScope({ clients: ["codex"], models: [], upstreams: [] }, row)).toBe(false);
    expect(requestInScope({ clients: [], models: [], upstreams: ["openrouter"] }, row)).toBe(false);
  });

  it("模型按发给上游的那个比：路由改写过的按改写之后的；不分大小写", () => {
    const row = {
      client: "default",
      model: "smart",
      provider: "deepseek",
      routing: {
        route: "default",
        rule: "r",
        rewritten_by: [],
        attempts: [{ provider: "deepseek", model: "DeepSeek-Chat", outcome: "served" as const, ms: 10 }],
      },
    };
    expect(requestInScope({ clients: [], models: ["deepseek*"], upstreams: [] }, row)).toBe(true);
    expect(requestInScope({ clients: [], models: ["smart"], upstreams: [] }, row)).toBe(false);
  });
});

/** 一个装着的插件，按需改几项 */
function plugin(over: Partial<PluginView> = {}): PluginView {
  return {
    id: "wsl-paths",
    name: "Convert WSL and Windows paths",
    description: "Rewrites drive paths in tool-call arguments.",
    enabled: false,
    on_error: "reject",
    permissions: ["messages", "reply_tool_calls"],
    requests: ["conversation"],
    scope: { clients: [], models: [], upstreams: [] },
    reply_mode: "block",
    settings_schema: [{ key: "windows_client", kind: "boolean", label: "The client runs on Windows (otherwise WSL)", value: false }],
    sha256: "aa",
    status: { kind: "disabled" },
    stats: { calls: 0, changed: 0, rejected: 0, errors: 0, avg_cpu_us: 0, last_error: null },
    ...over,
  };
}

/** 一份 manifest，按需改几项 */
function manifest(over: Partial<ManifestView> = {}): ManifestView {
  return {
    name: "Convert WSL and Windows paths",
    description: "Rewrites drive paths in tool-call arguments.",
    permissions: ["messages", "reply_tool_calls"],
    requests: ["conversation"],
    scope: { clients: [], models: [], upstreams: [] },
    reply_mode: "block",
    on_error: "reject",
    settings_schema: [{ key: "windows_client", kind: "boolean", label: "The client runs on Windows (otherwise WSL)", value: false }],
    hooks: { request: true, reply_text: false, tool_call: true },
    ...over,
  };
}

describe("要在系统的确认框里点头的改动（约定附录 4 §3）", () => {
  it("改得了工具调用的、读不出权限的算；别的不算", () => {
    expect(holdsToolCalls(["messages", "reply_tool_calls"])).toBe(true);
    expect(holdsToolCalls([])).toBe(true);
    expect(holdsToolCalls(null)).toBe(true);
    expect(holdsToolCalls(["system", "reply_text"])).toBe(false);
  });

  it("只改了数据（出错时、范围、设置的值）不是代码改动；别的都是", () => {
    const m = manifest();
    expect(shapeChanged(m, manifest({ on_error: "skip", scope: { clients: ["codex"], models: [], upstreams: [] } }))).toBe(false);
    expect(
      shapeChanged(m, manifest({ settings_schema: [{ ...m.settings_schema[0]!, value: true }] })),
    ).toBe(false);
    // 权限的顺序不算
    expect(shapeChanged(m, manifest({ permissions: ["reply_tool_calls", "messages"] }))).toBe(false);
    expect(shapeChanged(m, manifest({ permissions: ["messages"] }))).toBe(true);
    expect(shapeChanged(m, manifest({ name: "Paths" }))).toBe(true);
    expect(shapeChanged(m, manifest({ settings_schema: [{ ...m.settings_schema[0]!, label: "Windows" }] }))).toBe(true);
    expect(shapeChanged(m, manifest({ hooks: { request: true, reply_text: true, tool_call: true } }))).toBe(true);
  });

  it("改得了工具调用的插件：打开它、一定改了代码才直接去点头", () => {
    const tools = ["messages", "reply_tool_calls"] as const;
    const plain = ["system"] as const;
    expect(saveAsks({ old: [...tools], next: [...tools], turningOn: true, codeChanged: false })).toBe(true);
    expect(saveAsks({ old: [...tools], next: [...tools], turningOn: false, codeChanged: true })).toBe(true);
    // 只改了数据、停用：不问
    expect(saveAsks({ old: [...tools], next: [...tools], turningOn: false, codeChanged: false })).toBe(false);
    // 不碰工具调用的插件什么都不问
    expect(saveAsks({ old: [...plain], next: [...plain], turningOn: true, codeChanged: true })).toBe(false);
    // 新代码多要了工具调用：改代码要问
    expect(saveAsks({ old: [...plain], next: [...tools], turningOn: false, codeChanged: true })).toBe(true);
    // 原来那一版读不出权限：按改得了算
    expect(saveAsks({ old: null, next: [...plain], turningOn: true, codeChanged: false })).toBe(true);
  });

  it("读不出 manifest 的只有 id 和状态", () => {
    expect(manifestUnknown(plugin({ permissions: [], settings_schema: [] }))).toBe(true);
    expect(manifestUnknown(plugin())).toBe(false);
  });
});

describe("处理的请求种类", () => {
  it("只处理对话的不写；多出来的列出来，不处理对话的说「仅」", () => {
    expect(extraKinds(["conversation"])).toBeNull();
    expect(extraKinds(["completions", "conversation", "embeddings"])).toEqual({
      extra: ["embeddings", "completions"],
      withConversation: true,
    });
    expect(extraKinds(["embeddings"])).toEqual({ extra: ["embeddings"], withConversation: false });
  });
});

describe("默认插件的说法", () => {
  it("按 id 和 core 发的名字认，中文界面用中文名、说明和标签", () => {
    setLang("zh");
    const p = plugin();
    expect(pluginName(p.id, p.name)).toBe("WSL 路径转换");
    expect(pluginDescription(p)).toContain("/mnt/c/");
    expect(localSchema(p.id, p.name, p.settings_schema)[0]!.label).toBe("客户端运行在 Windows 上（关闭时按 WSL 处理）");
    expect(pluginName("reply-language", "Answer in a chosen language")).toBe("指定回答语言");
  });

  it("英文界面名字和说明照 manifest，标签另有英文", () => {
    setLang("en");
    const p = plugin();
    expect(pluginName(p.id, p.name)).toBe(p.name);
    expect(pluginDescription(p)).toBe(p.description);
    expect(localSchema(p.id, p.name, p.settings_schema)[0]!.label).toBe("The client runs on Windows (otherwise WSL)");
    setLang("zh");
  });

  it("同一个 id、别人写的插件照它自己写的显示", () => {
    setLang("zh");
    const theirs = plugin({ name: "路径小工具", description: "别人写的" });
    expect(pluginName(theirs.id, theirs.name)).toBe("路径小工具");
    expect(pluginDescription(theirs)).toBe("别人写的");
    expect(localSchema(theirs.id, theirs.name, theirs.settings_schema)).toBe(theirs.settings_schema);
    expect(pluginName(null, "Answer in a chosen language")).toBe("Answer in a chosen language");
  });
});

describe("权限分两头", () => {
  it("改请求的和改回答的", () => {
    expect(touchesRequests(["system"])).toBe(true);
    expect(touchesReplies(["system"])).toBe(false);
    expect(touchesReplies(["reply_tool_calls"])).toBe(true);
    expect(touchesRequests(["reply_text"])).toBe(false);
  });
});

describe("插件 ID", () => {
  it("先按文件名，再按插件名，重名接序号", () => {
    expect(suggestId("附加当前日期", "add-date.js", [])).toBe("add-date");
    expect(suggestId("Unify Terms", null, [])).toBe("unify-terms");
    expect(suggestId("附加当前日期", null, [])).toBe("plugin");
    expect(suggestId("x", "add-date.mjs", ["add-date", "add-date-2"])).toBe("add-date-3");
  });

  it("建议的 ID 都合 core 的写法", () => {
    for (const id of [suggestId("A".repeat(80), null, []), suggestId("—", "My Plugin (v2).js", [])]) {
      expect(ID_RE.test(id)).toBe(true);
    }
  });
});

describe("看不见的字符", () => {
  it("零宽字符和双向控制符切出来，写成码位", () => {
    const rlo = String.fromCodePoint(0x202e);
    const zw = String.fromCodePoint(0x200b);
    expect(splitInvisible(`txt${rlo}exe${zw}`)).toEqual([{ text: "txt" }, { code: "U+202E" }, { text: "exe" }, { code: "U+200B" }]);
    expect(splitInvisible("plain")).toEqual([{ text: "plain" }]);
    expect(splitInvisible("")).toEqual([{ text: "" }]);
  });
});

describe("数字的写法", () => {
  it("CPU 时间按毫秒一位小数，太短的另说", () => {
    expect(cpuMs(1234)).toBe("1.2");
    expect(cpuMs(50)).toBeNull();
  });
  it("SHA-256 前 16 位四个一组", () => {
    expect(shaPrefix("6f1c9a0277be41d0ffffffff")).toBe("6f1c 9a02 77be 41d0");
  });
});

describe("对比", () => {
  it("带行号，改动成段，中间没动的收起来", () => {
    const before = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 15", "line fifteen");
    const lines = lineDiff(before, after);
    expect(tally(lines)).toEqual({ added: 1, removed: 1 });
    const pieces = hunks(lines);
    expect(pieces.map((p) => p.kind)).toEqual(["skip", "lines", "skip"]);
    const shown = pieces[1]!.kind === "lines" ? pieces[1]!.lines : [];
    // 改动前后各三行原样的
    expect(shown.length).toBe(3 + 2 + 3);
    const del = shown.find((l) => l.kind === "del")!;
    const add = shown.find((l) => l.kind === "add")!;
    expect([del.a, del.b, add.a, add.b]).toEqual([16, null, null, 16]);
  });

  it("一样的两份没有改动段", () => {
    expect(hunks(lineDiff("a\nb", "a\nb"))).toEqual([]);
  });

  it("整份重写过的大文件不逐行配，也不卡住", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`).join("\n");
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`).join("\n");
    const t = tally(lineDiff(a, b));
    expect(t).toEqual({ added: 3000, removed: 3000 });
  });
});

describe("表单", () => {
  it("适用范围：「全部」写回去是空的，「指定」却一项没有是个问题", () => {
    const d = draftOf({ clients: ["claude-code"], models: [], upstreams: [] });
    expect(d.clients.mode).toBe("some");
    expect(d.models.mode).toBe("all");
    expect(scopeOf({ ...d, clients: { mode: "all", list: ["claude-code"] } }).clients).toEqual([]);
    expect(scopeProblem({ ...d, models: { mode: "some", list: [] } })).toBe("models");
    expect(scopeProblem(d)).toBeNull();
  });

  it("设置项：值从代码里来，数字按原样存着，交出去时才换成数；填错的按标签报", () => {
    const schema = [
      { key: "note", kind: "string" as const, label: "附加内容", value: "x" },
      { key: "days", kind: "number" as const, label: "天数", value: 7 },
      { key: "on", kind: "boolean" as const, label: "开关", value: true },
    ];
    const draft = settingsDraftOf(schema);
    expect(draft).toEqual({ note: "x", days: "7", on: true });
    expect(settingsOf(schema, draft)).toEqual({ values: { note: "x", days: 7, on: true }, bad: [] });
    expect(settingsOf(schema, { ...draft, days: "seven" }).bad).toEqual(["天数"]);
  });

  it("适用范围的建议：带 * 的按通配挑，不带的按包含挑，都不分大小写", () => {
    expect(suggestionMatches("claude-*", "claude-sonnet-4-5")).toBe(true);
    expect(suggestionMatches("claude-*", "gpt-5")).toBe(false);
    expect(suggestionMatches("*-mini", "GPT-5-Mini")).toBe(true);
    expect(suggestionMatches("sonnet", "claude-sonnet-4-5")).toBe(true);
    expect(suggestionMatches("", "anything")).toBe(true);
  });
});

describe("调整顺序", () => {
  it("挪到拿走之后的那个位置，别的顺次让开", () => {
    expect(moved(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moved(["a", "b", "c", "d"], 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(moved(["a", "b"], 1, 0)).toEqual(["b", "a"]);
  });
});
