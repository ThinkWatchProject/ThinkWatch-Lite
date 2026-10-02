import { describe, expect, it } from "vitest";
import { hunks, lineDiff, tally } from "./diff";
import { cpuMs, globMatch, ID_RE, requestInScope, shaPrefix, splitInvisible, suggestId, touchesReplies, touchesRequests } from "./model";
import { draftOf, scopeOf, scopeProblem, settingsDraftOf, settingsOf } from "./fields";

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

  it("设置项：数字按原样存着，保存时才换成数；填错的按标签报", () => {
    const schema = [
      { key: "note", kind: "string" as const, label: "附加内容", default: "" },
      { key: "days", kind: "number" as const, label: "天数", default: 7 },
      { key: "on", kind: "boolean" as const, label: "开关", default: true },
    ];
    const draft = settingsDraftOf(schema, { note: "x" });
    expect(draft).toEqual({ note: "x", days: "7", on: true });
    expect(settingsOf(schema, draft)).toEqual({ values: { note: "x", days: 7, on: true }, bad: [] });
    expect(settingsOf(schema, { ...draft, days: "seven" }).bad).toEqual(["天数"]);
  });
});
