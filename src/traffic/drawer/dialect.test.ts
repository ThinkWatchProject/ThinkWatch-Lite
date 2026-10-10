import { describe, expect, it } from "vitest";
import type { LiveBatch } from "@/types";
import { AnswerReader, dialectOf, readRequest, type ClientDialect } from "./dialect";
import { LiveContent, utf8Bytes } from "./live";
import { bodyText, fromDetail, fromLive } from "./wireModel";

const sse = (events: [string | null, unknown][]) =>
  events.map(([e, d]) => `${e ? `event: ${e}\n` : ""}data: ${typeof d === "string" ? d : JSON.stringify(d)}\n\n`).join("");

/** 一份回答切成很多段喂进去（`step` 个字一段），和整份一次喂进去读出来的一样 */
function readIn(dialect: ClientDialect, body: string, step: number) {
  const r = new AnswerReader(dialect);
  for (let i = 0; i < body.length; i += step) r.push(body.slice(i, i + step));
  return r.parts(true);
}

const ANTHROPIC = sse([
  ["message_start", { type: "message_start", message: { model: "claude-sonnet-5" } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先跑" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "测试。" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "c2ln" } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "三个失败的用例" } }],
  ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "都在 parse_header。" } }],
  ["content_block_start", { type: "content_block_start", index: 2, content_block: { type: "server_tool_use", id: "s", name: "web_search" } }],
  ["content_block_start", { type: "content_block_start", index: 3, content_block: { type: "tool_use", id: "toolu_1", name: "Bash", input: {} } }],
  ["content_block_delta", { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '{"command":' } }],
  ["content_block_delta", { type: "content_block_delta", index: 3, delta: { type: "input_json_delta", partial_json: '"cargo test"}' } }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 42 } }],
  ["message_stop", { type: "message_stop" }],
]);

describe("回答的读法", () => {
  it("Anthropic 的流：思考、正文、服务端工具记成其他、工具调用的参数拼起来", () => {
    expect(readIn("anthropic", ANTHROPIC, ANTHROPIC.length)).toEqual([
      { kind: "thinking", text: "先跑测试。" },
      { kind: "text", text: "三个失败的用例都在 parse_header。" },
      { kind: "other", label: "server_tool_use" },
      { kind: "tool_call", id: "toolu_1", name: "Bash", input: '{"command":"cargo test"}' },
    ]);
  });

  it("切在哪儿都一样：一个字一个字喂进去和整份一次喂进去读出来相同", () => {
    const whole = readIn("anthropic", ANTHROPIC, ANTHROPIC.length);
    expect(readIn("anthropic", ANTHROPIC, 1)).toEqual(whole);
    expect(readIn("anthropic", ANTHROPIC, 7)).toEqual(whole);
    // \r\n 的空行也认
    expect(readIn("anthropic", ANTHROPIC.replaceAll("\n", "\r\n"), 5)).toEqual(whole);
  });

  it("没长的块交出去的还是同一个对象，只有正在长的那一块换新的", () => {
    const r = new AnswerReader("anthropic");
    const cut = ANTHROPIC.indexOf("都在 parse_header");
    r.push(ANTHROPIC.slice(0, cut));
    const a = r.parts();
    r.push(ANTHROPIC.slice(cut, ANTHROPIC.indexOf("server_tool_use")));
    const b = r.parts();
    expect(b[0]).toBe(a[0]);
    expect(b[1]).not.toBe(a[1]);
    expect(b[1]).toEqual({ kind: "text", text: "三个失败的用例都在 parse_header。" });
  });

  it("还在长的工具调用参数是空的就是空的；读完了才写成 {}", () => {
    const body = sse([
      ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "t", name: "Ls", input: {} } }],
    ]);
    const r = new AnswerReader("anthropic");
    r.push(body);
    expect(r.parts()).toEqual([{ kind: "tool_call", id: "t", name: "Ls", input: "" }]);
    expect(r.parts(true)).toEqual([{ kind: "tool_call", id: "t", name: "Ls", input: "{}" }]);
  });

  it("Chat 的流：推理字段、正文、按 index 拼的工具调用，[DONE] 不算", () => {
    const chunk = (delta: unknown, finish: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason: finish }] });
    const body = sse([
      [null, chunk({ role: "assistant", reasoning_content: "看一下" })],
      [null, chunk({ reasoning_content: "分隔符。" })],
      [null, chunk({ content: "先跑" })],
      [null, chunk({ content: "测试。" })],
      [null, chunk({ tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "Bash", arguments: "" } }] })],
      [null, chunk({ tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] })],
      [null, chunk({}, "tool_calls")],
      [null, "[DONE]"],
    ]);
    expect(readIn("openai-chat", body, 3)).toEqual([
      { kind: "thinking", text: "看一下分隔符。" },
      { kind: "text", text: "先跑测试。" },
      { kind: "tool_call", id: "call_1", name: "Bash", input: '{"command":"ls"}' },
    ]);
  });

  it("Responses 的流：推理摘要分段空一行、正文、函数调用的参数", () => {
    const body = sse([
      ["response.created", { type: "response.created", response: { id: "r" } }],
      ["response.output_item.added", { type: "response.output_item.added", output_index: 0, item: { type: "reasoning" } }],
      ["x", { type: "response.reasoning_summary_text.delta", output_index: 0, summary_index: 0, delta: "第一段" }],
      ["x", { type: "response.reasoning_summary_text.delta", output_index: 0, summary_index: 1, delta: "第二段" }],
      ["x", { type: "response.output_item.done", output_index: 0, item: { type: "reasoning" } }],
      ["x", { type: "response.output_item.added", output_index: 1, item: { type: "message", role: "assistant" } }],
      ["x", { type: "response.content_part.added", output_index: 1, content_index: 0, part: { type: "output_text" } }],
      ["x", { type: "response.output_text.delta", output_index: 1, content_index: 0, delta: "好的" }],
      ["x", { type: "response.output_item.done", output_index: 1, item: { type: "message" } }],
      ["x", { type: "response.output_item.added", output_index: 2, item: { type: "function_call", call_id: "c1", name: "shell" } }],
      ["x", { type: "response.function_call_arguments.delta", output_index: 2, delta: '{"cmd":["ls"]}' }],
      ["x", { type: "response.output_item.added", output_index: 3, item: { type: "web_search_call" } }],
    ]);
    expect(readIn("openai-responses", body, 11)).toEqual([
      { kind: "thinking", text: "第一段\n\n第二段" },
      { kind: "text", text: "好的" },
      { kind: "tool_call", id: "c1", name: "shell", input: '{"cmd":["ls"]}' },
      { kind: "other", label: "web_search_call" },
    ]);
  });

  it("Gemini：不带 alt=sse 的 JSON 数组按元素读，截断了的读到最后一个完整的元素", () => {
    const chunk = (parts: unknown[]) => ({ candidates: [{ content: { role: "model", parts } }] });
    const body = JSON.stringify([
      chunk([{ text: "想一想", thought: true }]),
      chunk([{ text: "答案是 {42}" }]),
      chunk([{ functionCall: { name: "lookup", args: { q: "a\"b" } } }]),
    ]);
    expect(readIn("gemini", body, 4)).toEqual([
      { kind: "thinking", text: "想一想" },
      { kind: "text", text: "答案是 {42}" },
      { kind: "tool_call", id: "", name: "lookup", input: '{"q":"a\\"b"}' },
    ]);
    const r = new AnswerReader("gemini");
    r.push(body.slice(0, body.indexOf("functionCall") - 5));
    expect(r.parts()).toHaveLength(2);
  });

  it("整包的回答：齐了才读得成，认得出格式但没内容的不算读不懂", () => {
    const r = new AnswerReader("openai-chat");
    const whole = JSON.stringify({
      object: "chat.completion",
      choices: [{ message: { role: "assistant", content: "好", tool_calls: [{ id: "c", type: "function", function: { name: "f", arguments: "" } }] } }],
    });
    r.push(whole.slice(0, 20));
    expect(r.parts()).toEqual([]);
    r.push(whole.slice(20));
    expect(r.parts(true)).toEqual([
      { kind: "text", text: "好" },
      { kind: "tool_call", id: "c", name: "f", input: "{}" },
    ]);
    const empty = new AnswerReader("anthropic");
    empty.push(JSON.stringify({ type: "message", content: [] }));
    expect(empty.parts(true)).toEqual([]);
    expect(empty.recognized).toBe(true);
    const error = new AnswerReader("anthropic");
    error.push(JSON.stringify({ type: "error", error: { message: "x" } }));
    expect(error.recognized).toBe(false);
  });
});

describe("请求的读法", () => {
  it("Anthropic：系统提示几段空一行，工具按名字，只装着工具结果的消息是工具的", () => {
    const r = readRequest(
      "anthropic",
      JSON.stringify({
        system: [{ type: "text", text: "你是助手" }, { type: "text", text: "简短回答" }],
        tools: [{ name: "Bash" }, { name: "Read" }],
        messages: [
          { role: "user", content: "修一下" },
          { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a\nb" }] }] },
        ],
      }),
    );
    expect(r).toEqual({
      system: "你是助手\n\n简短回答",
      tools: ["Bash", "Read"],
      messages: [
        { role: "user", parts: [{ kind: "text", text: "修一下" }] },
        { role: "assistant", parts: [{ kind: "tool_call", id: "t1", name: "Bash", input: '{"command":"ls"}' }] },
        { role: "tool", parts: [{ kind: "tool_result", call_id: "t1", text: "a\nb", is_error: false }] },
      ],
    });
  });

  it("Chat：开头的 system 是系统提示，中途的照原位置；tool 消息是工具结果", () => {
    const r = readRequest(
      "openai-chat",
      JSON.stringify({
        messages: [
          { role: "system", content: "S" },
          { role: "user", content: [{ type: "text", text: "hi" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
          { role: "developer", content: "D" },
          { role: "tool", tool_call_id: "c", content: "ok" },
        ],
        tools: [{ type: "function", function: { name: "f" } }],
      }),
    );
    expect(r?.system).toBe("S");
    expect(r?.tools).toEqual(["f"]);
    expect(r?.messages.map((m) => m.role)).toEqual(["user", "system", "tool"]);
    expect(r?.messages[0]?.parts[1]).toEqual({ kind: "image", media_type: "image/png", bytes: 3 });
  });

  it("读不成 JSON 的（只存了开头）是 null", () => {
    expect(readRequest("anthropic", '{"messages":[{"role":"user","content":"半')).toBeNull();
  });

  it("格式按路径认，转换过的以记录里客户端那一边为准", () => {
    expect(dialectOf("/v1/messages")).toBe("anthropic");
    expect(dialectOf("/v1/chat/completions")).toBe("openai-chat");
    expect(dialectOf("/v1/responses")).toBe("openai-responses");
    expect(dialectOf("/v1beta/models/gemini-3-pro:streamGenerateContent?alt=sse")).toBe("gemini");
    expect(dialectOf("/v1/embeddings")).toBeNull();
    expect(dialectOf("/v1/chat/completions", "anthropic")).toBe("anthropic");
  });
});

describe("实时内容", () => {
  type Item = LiveBatch["items"][number];
  const head = (side: "client" | "upstream", dir: "request" | "response", attempt: number, line: string): Item => ({
    event: "head",
    data: { side, dir, attempt, line, headers: [] },
  });
  const body = (side: "client" | "upstream", dir: "request" | "response", attempt: number, text: string): Item => ({
    event: "body",
    data: { side, dir, attempt, text, truncated: false },
  });
  const batch = (items: LiveBatch["items"], closed: LiveBatch["closed"] = null): LiveBatch => ({ sub: "s", items, closed });

  it("同一段又来了一个头：之前那一遍的正文不留，从头算", () => {
    const live = new LiveContent();
    live.apply(batch([head("upstream", "request", 1, "POST https://a"), body("upstream", "request", 1, "第一遍")]));
    const first = live.get("upstream", "request", 1)!.chunks;
    live.apply(batch([head("upstream", "request", 1, "POST https://a"), body("upstream", "request", 1, "第二遍")]));
    const s = live.get("upstream", "request", 1)!;
    expect(s.chunks).toEqual(["第二遍"]);
    expect(s.chunks).not.toBe(first);
    expect(s.sends).toBe(2);
    expect(s.bytes).toBe(9);
  });

  it("整理成和存下的同一个样子：没收到的发给上游的请求体是和客户端一样，失败的那一跳不留", () => {
    const live = new LiveContent();
    live.apply(
      batch([
        head("client", "request", 0, "POST /v1/messages HTTP/1.1"),
        body("client", "request", 0, '{"messages":[]}'),
        head("upstream", "request", 1, "POST https://api.anthropic.com/v1/messages"),
        head("upstream", "response", 1, "HTTP/2 529"),
        head("upstream", "request", 2, "POST https://openrouter.ai/api/v1/chat/completions"),
        head("upstream", "response", 2, "HTTP/2 200"),
        body("upstream", "response", 2, "data: {}\n\n"),
      ]),
    );
    const d = {
      row: { routing: { attempts: [{ provider: "anthropic" }, { provider: "openrouter" }] } },
      plugins: [],
    } as unknown as Parameters<typeof fromLive>[1];
    const m = fromLive(live, d);
    expect(bodyText((m.client.request.body as { kind: "body"; body: Parameters<typeof bodyText>[0] }).body)).toBe('{"messages":[]}');
    expect(m.client.response.body).toEqual({ kind: "pending" });
    expect(m.upstream.map((u) => [u.attempt, u.provider, u.serving])).toEqual([
      [1, "anthropic", false],
      [2, "openrouter", true],
    ]);
    expect(m.upstream[0]!.request.body).toEqual({ kind: "not_kept" });
    expect(m.upstream[1]!.request.body).toEqual({ kind: "same" });
    expect(m.upstream[1]!.response.body.kind).toBe("body");
  });

  it("存下的：上游的回答没另存就是和客户端一样，没有报文头也看得到插件改写后的那一份", () => {
    const view = (text: string) => ({ text, original_len: text.length, truncated: false });
    const m = fromDetail({
      row: { routing: { attempts: [{ provider: "anthropic" }] } },
      heads: [],
      request_body: view("{}"),
      request_after_plugins: view('{"x":1}'),
      response_body: view("data: {}\n\n"),
      upstream_request_body: null,
      upstream_response_body: null,
      in_flight: false,
    } as unknown as Parameters<typeof fromDetail>[0]);
    expect(m.upstream).toHaveLength(1);
    expect(m.upstream[0]!.response.body).toEqual({ kind: "same" });
    expect(m.upstream[0]!.request.body.kind).toBe("body");
    expect(m.afterPlugins?.text).toBe('{"x":1}');
  });

  it("字节数按 UTF-8 算", () => {
    expect(utf8Bytes("ab")).toBe(2);
    expect(utf8Bytes("中文")).toBe(6);
    expect(utf8Bytes("😀")).toBe(4);
  });
});
