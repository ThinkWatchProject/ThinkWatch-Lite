import { describe, expect, it } from "vitest";
import type { Transcript, TranscriptMessage, TranscriptPart, TranscriptTurn, TurnView } from "@/types";
import {
  allLost,
  argsPreview,
  blocksOf,
  clip,
  items,
  keepTurns,
  missingWhy,
  notesOf,
  outcomeOf,
  quiet,
  requestIdOf,
  splitRestart,
  toolNames,
  unrecorded,
  viewsById,
  type Missing,
} from "./transcript";

const text = (t: string): TranscriptPart => ({ kind: "text", text: t });
const call = (id: string, name: string, input = "{}"): TranscriptPart => ({ kind: "tool_call", id, name, input });
const result = (id: string, t = "ok", is_error = false): TranscriptPart => ({
  kind: "tool_result",
  call_id: id,
  text: t,
  is_error,
});
const msg = (role: TranscriptMessage["role"], ...parts: TranscriptPart[]): TranscriptMessage => ({ role, parts });

function turn(id: string, x: Partial<TranscriptTurn> = {}): TranscriptTurn {
  return { id, restart: false, system_changed: null, input: [], output: [], gaps: [], ...x };
}

/** 一轮什么都显示不出来：请求和响应的正文都不在 */
const gone = (id: string) => turn(id, { gaps: ["request_missing", "response_missing"] });

/** 正文不在的原因：每一轮都过了保留期限 */
const expired = (): Missing => "expired";

function view(id: number, x: Partial<TurnView> = {}): TurnView {
  return {
    id,
    at_ms: 0,
    model: "m",
    provider: "p",
    input_tokens: 1,
    output_tokens: 1,
    cache_read_tokens: 0,
    cost_micros: 1,
    duration_ms: 1,
    error: null,
    cancelled: false,
    cost_estimated: false,
    billing: "per-token",
    ...x,
  };
}

describe("一轮的输入排成块", () => {
  /** Anthropic 把工具结果放在 `user` 消息里：它们不能标成「用户」 */
  it("工具结果单独成块，不跟着消息的角色走", () => {
    const b = blocksOf([msg("user", result("a"), result("b"), text("接着看日志"))]);
    const shape = b.map((x) => (x.kind === "said" ? `said:${x.role}:${x.parts.length}` : `results:${x.parts.length}`));
    expect(shape).toEqual(["results:2", "said:user:1"]);
  });

  /** OpenAI 的每条结果是一条 `tool` 消息：连着的几条并成一块 */
  it("连着的几条结果消息并成一块，连着的同角色消息并成一块", () => {
    const b = blocksOf([
      msg("tool", result("a")),
      msg("tool", result("b")),
      msg("user", text("一")),
      msg("user", text("二")),
      msg("assistant", text("三")),
    ]);
    expect(b.map((x) => (x.kind === "said" ? `${x.role}:${x.parts.length}` : `results:${x.parts.length}`))).toEqual([
      "results:2",
      "user:2",
      "assistant:1",
    ]);
  });

  it("只有空白的正文不成块", () => {
    expect(blocksOf([msg("user", text("  \n ")), msg("assistant", text(""))])).toEqual([]);
    const b = blocksOf([msg("user", text(" "), text("有字"))]);
    expect(b).toEqual([{ kind: "said", role: "user", parts: [text("有字")] }]);
  });
});

describe("历史重新开始的那一轮", () => {
  it("收起到模型最后一次开口为止，之后的是这一轮新加的", () => {
    const input = [
      msg("user", text("摘要")),
      msg("assistant", call("c1", "Read")),
      msg("user", result("c1")),
      msg("assistant", call("c2", "Bash")),
      msg("tool", result("c2")),
      msg("user", text("测试都过了吗")),
    ];
    const { earlier, latest } = splitRestart(input);
    expect(earlier).toHaveLength(4);
    expect(latest).toEqual(input.slice(4));
  });

  /** 压缩成一段摘要、一条助手消息都没有：那一段本身就是这一轮的输入，不收起 */
  it("没有助手消息时一条都不收起", () => {
    const input = [msg("user", text("摘要")), msg("user", text("继续"))];
    expect(splitRestart(input)).toEqual({ earlier: [], latest: input });
  });

  it("以助手消息结尾时，新加的为空", () => {
    const input = [msg("user", text("问")), msg("assistant", text("答"))];
    expect(splitRestart(input)).toEqual({ earlier: input, latest: [] });
  });
});

describe("工具结果找回工具名", () => {
  it("调用在回答里，也可能在重新开始的那一轮带着的历史里", () => {
    const names = toolNames([
      turn("1", { output: [text("先读"), call("c1", "Read")] }),
      turn("2", { restart: true, input: [msg("assistant", call("c0", "Grep")), msg("user", result("c0"))] }),
    ]);
    expect(names.get("c1")).toBe("Read");
    expect(names.get("c0")).toBe("Grep");
    expect(names.get("nope")).toBeUndefined();
  });
});

describe("连着几轮都超过保留期限", () => {
  it("两轮以上并成一行，序号按原来的轮次", () => {
    const list = items([gone("1"), gone("2"), gone("3"), turn("4"), gone("5"), turn("6")], expired);
    expect(list.map((x) => (x.kind === "lost" ? `lost ${x.from}-${x.to}` : `turn ${x.n}`))).toEqual([
      "lost 1-3",
      "turn 4",
      // 只有一轮的不并：它照样有自己的头
      "turn 5",
      "turn 6",
    ]);
  });

  it("系统提示变了的那一轮不算什么都没有", () => {
    const changed = turn("2", { gaps: ["request_missing", "response_missing"], system_changed: "新的" });
    expect(items([gone("1"), changed, gone("3")], expired).map((x) => x.kind)).toEqual(["turn", "turn", "turn"]);
  });

  it("整次会话都超过保留期限", () => {
    expect(allLost([gone("1"), gone("2")], expired)).toBe("expired");
    expect(allLost([gone("1"), turn("2")], expired)).toBeNull();
    expect(allLost([], expired)).toBeNull();
  });
});

describe("显示不出来的部分写成哪几句", () => {
  it("请求和响应都没有了，并成一句", () => {
    expect(notesOf(gone("1"), "done", "expired")).toEqual({ request: ["expired"], response: [] });
    // 失败与否写在头上，这里只说内容没有了
    expect(notesOf(gone("1"), "failed", "expired")).toEqual({ request: ["expired"], response: [] });
  });

  /** 没有响应是因为根本没有，不是超过了保留期限 */
  it("失败的、取消的说结局，不说缺口", () => {
    const t = turn("1", { gaps: ["response_missing"] });
    expect(notesOf(t, "failed", "expired").response).toEqual(["response_failed"]);
    expect(notesOf(t, "cancelled", "expired").response).toEqual(["response_cancelled"]);
    expect(notesOf(t, "done", "expired").response).toEqual(["response_expired"]);
  });

  /** 回答写了一半就断了：后面要说一句，不然像是模型自己停了 */
  it("回答写了一半的失败、取消也要说", () => {
    const half = turn("1", { output: [text("先看")] });
    expect(notesOf(half, "failed", "unkept").response).toEqual(["response_failed"]);
    expect(notesOf(half, "cancelled", "unkept").response).toEqual(["response_cancelled"]);
    expect(notesOf(half, "done", "unkept").response).toEqual([]);
  });

  it("其余的缺口一一对上", () => {
    const t = turn("1", {
      gaps: ["request_missing", "request_truncated", "response_truncated", "response_unreadable"],
    });
    expect(notesOf(t, "done", "expired")).toEqual({
      request: ["request_expired", "request_truncated"],
      response: ["response_truncated", "response_unreadable"],
    });
  });
});

/**
 * 正文不在，是过了保留期限，还是没有保留下来（超出总量上限提前删掉的、写盘跟不上丢下的）。
 * 后一种说「已超过保留期限」是错的：按这一轮的时刻和报文的保留天数分开说。
 */
describe("正文为什么不在", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 9, 2, 12);

  it("早于保留期限的是过了期限，期限之内的是未保留", () => {
    expect(missingWhy(now - 8 * DAY, 7, now)).toBe("expired");
    expect(missingWhy(now - 6 * DAY, 7, now)).toBe("unkept");
    expect(missingWhy(now - 60_000, 7, now)).toBe("unkept");
    // 刚满期限的还没到删除的时候（core 删的是早于期限的那几天）
    expect(missingWhy(now - 7 * DAY, 7, now)).toBe("unkept");
  });

  /** 会话详情里还没有这一轮、概览没取到：「未保留」两种情况下都成立 */
  it("时刻或期限不知道时不说过了期限", () => {
    expect(missingWhy(null, 7, now)).toBe("unkept");
    expect(missingWhy(now - 30 * DAY, null, now)).toBe("unkept");
  });

  it("会话详情里那一轮的时刻，按字符串的 id 找到", () => {
    const views = viewsById([view(1, { at_ms: now - 10 * DAY }), view(2, { at_ms: now - DAY })]);
    const why = (t: TranscriptTurn) => missingWhy(views.get(t.id)?.at_ms ?? null, 7, now);
    expect([gone("1"), gone("2"), gone("3")].map(why)).toEqual(["expired", "unkept", "unkept"]);
  });

  it("每一处的说法跟着原因走", () => {
    expect(notesOf(gone("1"), "done", "unkept")).toEqual({ request: ["unkept"], response: [] });
    const request = turn("1", { gaps: ["request_missing"], output: [text("答")] });
    expect(notesOf(request, "done", "expired").request).toEqual(["request_expired"]);
    expect(notesOf(request, "done", "unkept").request).toEqual(["request_unkept"]);
    const response = turn("1", { gaps: ["response_missing"] });
    expect(notesOf(response, "done", "unkept").response).toEqual(["response_unkept"]);
  });

  it("连着的几轮原因不同就不并在一起", () => {
    const why = (t: TranscriptTurn): Missing => (Number(t.id) <= 2 ? "expired" : "unkept");
    const list = items([gone("1"), gone("2"), gone("3"), gone("4"), gone("5"), gone("6")], why);
    expect(list.map((x) => (x.kind === "lost" ? `${x.why} ${x.from}-${x.to}` : `turn ${x.n}`))).toEqual([
      "expired 1-2",
      "unkept 3-6",
    ]);
    // 原因交替的，一轮一轮各有各的头
    const alternate = (t: TranscriptTurn): Missing => (Number(t.id) % 2 === 0 ? "expired" : "unkept");
    expect(items([gone("1"), gone("2"), gone("3")], alternate).map((x) => x.kind)).toEqual(["turn", "turn", "turn"]);
  });

  it("整次会话都显示不出来时，每一轮都过了期限才说过了期限", () => {
    expect(allLost([gone("1"), gone("2")], () => "unkept")).toBe("unkept");
    expect(allLost([gone("1"), gone("2")], (t) => (t.id === "1" ? "expired" : "unkept"))).toBe("unkept");
  });
});

describe("工具调用的提要", () => {
  it("参数里第一个非空的字符串", () => {
    expect(argsPreview(JSON.stringify({ file_path: "scripts/deploy.sh", limit: 40 }))).toBe("scripts/deploy.sh");
    expect(argsPreview(JSON.stringify({ description: "", command: "pnpm test" }))).toBe("pnpm test");
  });

  it("字符串数组连成一行，空白压成一个空格", () => {
    expect(argsPreview(JSON.stringify({ command: ["bash", "-lc", "ls  -la"] }))).toBe("bash -lc ls -la");
    expect(argsPreview(JSON.stringify({ command: "git log\n  --oneline" }))).toBe("git log --oneline");
  });

  it("没有字符串就把 JSON 压成一行，没有参数就什么都不写", () => {
    expect(argsPreview(JSON.stringify({ n: 3, deep: { a: 1 } }))).toBe('{"n":3,"deep":{"a":1}}');
    expect(argsPreview("{}")).toBe("");
  });

  it("不是 JSON 的原样压成一行，太长的截断", () => {
    expect(argsPreview("ls\n-la")).toBe("ls -la");
    const long = argsPreview(JSON.stringify({ content: "x".repeat(500) }), 20);
    expect(long).toHaveLength(20);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("长文本先显示开头", () => {
  const limit = { chars: 100, lines: 10 };

  it("不长的不截，只多出一点的也不截", () => {
    expect(clip("短的", limit)).toBeNull();
    expect(clip("x".repeat(140), limit)).toBeNull();
    expect(clip(Array.from({ length: 14 }, () => "行").join("\n"), limit)).toBeNull();
  });

  it("按字数截，切在一行中间时退到最近的换行", () => {
    const s = `${"a".repeat(80)}\n${"b".repeat(200)}`;
    expect(clip(s, limit)).toBe("a".repeat(80));
    // 换行太远就不退
    const far = `${"a".repeat(20)}\n${"b".repeat(300)}`;
    expect(clip(far, limit)).toBe(`${"a".repeat(20)}\n${"b".repeat(79)}`);
  });

  it("按行数截", () => {
    const s = Array.from({ length: 40 }, (_, i) => `第${i + 1}行`).join("\n");
    const head = clip(s, limit)!;
    expect(head.split("\n")).toHaveLength(10);
    expect(head.endsWith("第10行")).toBe(true);
  });

  it("不把一个字拆成两半", () => {
    const s = "a".repeat(99) + "😀".repeat(100);
    const head = clip(s, limit)!;
    expect(head).toBe("a".repeat(99));
  });
});

describe("重新取回来的对话", () => {
  const base: Transcript = {
    session: "s1",
    system: "sys",
    turns: [turn("1", { input: [msg("user", text("问"))], output: [text("答")] }), turn("2", { output: [text("又答")] })],
  };
  const fresh = (): Transcript => JSON.parse(JSON.stringify(base)) as Transcript;

  it("一点没变：还是原来那一份", () => {
    expect(keepTurns(base, fresh())).toBe(base);
  });

  it("多了一轮：原来的几轮还是原来的对象，新的那一轮是新的", () => {
    const next = fresh();
    next.turns.push(turn("3", { output: [text("新")] }));
    const kept = keepTurns(base, next);
    expect(kept).not.toBe(base);
    expect(kept.turns[0]).toBe(base.turns[0]);
    expect(kept.turns[1]).toBe(base.turns[1]);
    expect(kept.turns[2]).toBe(next.turns[2]);
  });

  /** 过了保留期限：内容没了、缺口多了，那一轮要换成新的 */
  it("内容没了的那一轮换成新的", () => {
    const next = fresh();
    next.turns[0] = gone("1");
    const kept = keepTurns(base, next);
    expect(kept.turns[0]).toBe(next.turns[0]);
    expect(kept.turns[1]).toBe(base.turns[1]);
  });

  it("换了一次会话就是新的那一份", () => {
    const other = { ...fresh(), session: "s2" };
    expect(keepTurns(base, other)).toBe(other);
    expect(keepTurns(undefined, base)).toBe(base);
  });
});

describe("会话还没有落库", () => {
  /** 第一轮还在跑：core 说没有这次会话。那不是读取失败 */
  it("只认 core 的那个码", () => {
    expect(unrecorded({ code: "control.session_not_found", args: {}, text: "" })).toBe(true);
    expect(unrecorded({ code: "control.request_not_found", args: {}, text: "" })).toBe(false);
    expect(unrecorded(new Error("control.session_not_found"))).toBe(false);
    expect(unrecorded(undefined)).toBe(false);
  });
});

/**
 * 对话的 id 是字符串，会话详情的是数。**直接拿数当键的话一轮也对不上**，轮次头上就没有
 * 时刻、模型和费用。
 */
describe("对话的轮次对上会话详情的轮次", () => {
  it("按字符串的 id 找到那一轮", () => {
    const views = viewsById([view(48123, { model: "claude-sonnet-5" }), view(48124)]);
    expect(views.get("48123")?.model).toBe("claude-sonnet-5");
    expect(views.get("48124")?.id).toBe(48124);
    expect(views.get("48125")).toBeUndefined();
  });

  it("对话里的每一轮都找得到，顺序一致", () => {
    const transcript = [turn("48123"), turn("48124"), turn("48130")];
    const views = viewsById([view(48123), view(48124), view(48130)]);
    expect(transcript.map((t) => views.get(t.id)?.id)).toEqual([48123, 48124, 48130]);
  });
});

/** 数 token、压缩上下文这类调用：没有新消息、没有回答、也没有缺口 */
describe("没有对话内容的一轮", () => {
  it("什么都没有的才算", () => {
    expect(quiet(turn("1"))).toBe(true);
    expect(quiet(turn("1", { input: [msg("user", text("  "))], output: [text("")] }))).toBe(true);
    expect(quiet(turn("1", { output: [text("答")] }))).toBe(false);
    expect(quiet(turn("1", { input: [msg("user", text("问"))] }))).toBe(false);
  });

  it("有缺口、系统提示变了、历史重新开始的都不算", () => {
    expect(quiet(turn("1", { gaps: ["response_missing"] }))).toBe(false);
    expect(quiet(turn("1", { system_changed: "新的" }))).toBe(false);
    expect(quiet(turn("1", { restart: true }))).toBe(false);
  });
});

describe("轮次头", () => {
  it("结局和会话瀑布同一套说法", () => {
    expect(outcomeOf(undefined)).toBe("done");
    expect(outcomeOf(view(1))).toBe("done");
    expect(outcomeOf(view(1, { error: { code: "x", args: {}, text: "x" } }))).toBe("failed");
    expect(outcomeOf(view(1, { cancelled: true }))).toBe("cancelled");
  });

  /** 对话里的 id 是字符串，库里那一轮是数：有库里的就用它 */
  it("请求详情打开哪一条", () => {
    expect(requestIdOf("48123", view(48123))).toBe(48123);
    expect(requestIdOf("48123", undefined)).toBe(48123);
    expect(requestIdOf("not-a-number", undefined)).toBeNull();
    expect(requestIdOf("", undefined)).toBeNull();
  });
});
