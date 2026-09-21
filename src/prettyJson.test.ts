import { describe, expect, it } from "vitest";
import { prettyJson } from "./prettyJson";

const lines = (...xs: string[]) => xs.join("\n");

describe("JSON body 排版", () => {
  it("缩进两格，键后面空一格", () => {
    const body = '{"model":"claude-sonnet-5","stream":false,"messages":[{"role":"user","content":"hi"}]}';
    expect(prettyJson(body, false)).toBe(
      lines(
        "{",
        '  "model": "claude-sonnet-5",',
        '  "stream": false,',
        '  "messages": [',
        "    {",
        '      "role": "user",',
        '      "content": "hi"',
        "    }",
        "  ]",
        "}",
      ),
    );
  });

  /**
   * 这是不走 parse → stringify 的理由：排查时看到的得是发出去的那一份。
   */
  it("值原样保留，只动空白", () => {
    const body = '{"b":1.0,"2":12345678901234567890,"e":1E5,"s":"a \\"}{,:\\" b"}';
    expect(prettyJson(body, false)).toBe(
      lines(
        "{",
        '  "b": 1.0,',
        '  "2": 12345678901234567890,',
        '  "e": 1E5,',
        '  "s": "a \\"}{,:\\" b"',
        "}",
      ),
    );
  });

  it("排完还是同一个 JSON", () => {
    const value = {
      system: [{ type: "text", text: "You are a coding assistant.\nBe brief.", cache_control: { type: "ephemeral" } }],
      tools: [{ name: "Read", input_schema: { type: "object", properties: {}, required: ["path"] } }],
      metadata: {},
      stop_sequences: [],
      temperature: 0.2,
    };
    const body = JSON.stringify(value);
    const pretty = prettyJson(body, false)!;
    expect(JSON.parse(pretty)).toEqual(value);
    // 已经排过的再排一次不变
    expect(prettyJson(pretty, false)).toBe(pretty);
  });

  it("空的对象和数组写在一行", () => {
    expect(prettyJson('{"a":{},"b":[ ],"c":{ \n }}', false)).toBe(
      lines("{", '  "a": {},', '  "b": [],', '  "c": {}', "}"),
    );
    expect(prettyJson("[]", false)).toBe("[]");
  });

  it("只装标量的数组写在一行", () => {
    expect(prettyJson('{"required":["path","content"],"v":[0.1,-2,true,null]}', false)).toBe(
      lines("{", '  "required": ["path", "content"],', '  "v": [0.1, -2, true, null]', "}"),
    );
    expect(prettyJson("[[1,2],[3,4]]", false)).toBe(lines("[", "  [1, 2],", "  [3, 4]", "]"));
  });

  /**
   * body 超过上限时只存了开头。parse 不了，但开头照样要能读。
   */
  it("截断的排到哪算哪", () => {
    const body = '{"model":"x","messages":[{"role":"user","content":"hel';
    expect(prettyJson(body, true)).toBe(
      lines(
        "{",
        '  "model": "x",',
        '  "messages": [',
        "    {",
        '      "role": "user",',
        '      "content": "hel',
      ),
    );
    // 截在逗号后面，不留一行空缩进
    expect(prettyJson('{"a":1,', true)).toBe(lines("{", '  "a": 1,'));
    // 截在只装标量的数组中间，按多行排
    expect(prettyJson('{"v":[1,2', true)).toBe(lines("{", '  "v": [', "    1,", "    2"));
  });

  /**
   * 截断的不经过 parse，里面可能是任何东西。每一步都得往前走，否则数组
   * 里一个冒号就能让它原地打转，整个界面卡死。
   */
  it("截断的日志不会卡住", () => {
    expect(prettyJson("[2026-09-21 12:00:00] upstream closed", true)).toBeNull();
    expect(prettyJson("[a:b}c", true)).not.toBeUndefined();
  });

  it("不是 JSON 的原样显示", () => {
    const sse = 'event: message_start\ndata: {"type":"message_start"}\n\n';
    expect(prettyJson(sse, false)).toBeNull();
    expect(prettyJson('data: {"id":"1"}\n\ndata: [DONE]\n\n', false)).toBeNull();
    expect(prettyJson("<html>Bad Gateway</html>", false)).toBeNull();
    expect(prettyJson("", false)).toBeNull();
    // 以 `[` 开头的日志不是 JSON
    expect(prettyJson("[error] upstream said {nope}", false)).toBeNull();
  });

  /**
   * NDJSON 一行一个值，展开成几千行反而没法读。
   */
  it("一串值不算一个 JSON", () => {
    expect(prettyJson('{"a":1}\n{"b":2}\n', false)).toBeNull();
    expect(prettyJson('{"a":1}\n{"b":', true)).toBeNull();
  });

  it("前面有空白也认得出", () => {
    expect(prettyJson('\n  {"a":1}', false)).toBe(lines("{", '  "a": 1', "}"));
  });
});
