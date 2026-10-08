import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestView, OnError, PluginInspection } from "@/types";
import { CHECK_AFTER, EditingEngine, REWRITE_AFTER, formOf, type Form, type Values } from "./editing";

/** 一份 manifest：出错时、适用范围、一个文字设置项 */
function manifest(onError: OnError = "reject", note = "", clients: string[] = []): ManifestView {
  return {
    name: "mask",
    description: null,
    permissions: ["system"],
    requests: ["conversation"],
    scope: { clients, models: [], upstreams: [] },
    on_error: onError,
    reply_mode: "block",
    settings_schema: [{ key: "note", kind: "string", label: "Note", value: note }],
    hooks: { request: true, reply_text: false, tool_call: false },
  };
}

const ok = (m: ManifestView): PluginInspection => ({ manifest: m, sha256: "", error: null });
const broken: PluginInspection = {
  manifest: null,
  sha256: "",
  error: { message: { code: "gw.plugin.syntax_at", args: {}, text: "unbalanced" }, line: 3, column: 7 },
};

/**
 * 一个手动放行的 core：读和改写都排着，测试决定什么时候、按什么顺序回答。`inspect` /
 * `rewrite` 记下每次收到的代码和值。
 */
function fakeCore() {
  const inspects: { source: string; answer: (r: PluginInspection) => void; fail: (e: unknown) => void }[] = [];
  const rewrites: { source: string; values: Values; answer: (s: string) => void; fail: (e: unknown) => void }[] = [];
  return {
    inspects,
    rewrites,
    core: {
      inspect: (source: string) =>
        new Promise<PluginInspection>((answer, fail) => inspects.push({ source, answer, fail })),
      rewrite: (source: string, values: Values) =>
        new Promise<string>((answer, fail) => rewrites.push({ source, values, answer, fail })),
    },
  };
}

const START = "export default { manifest: { on_error: 'reject' } }";

function engine() {
  const f = fakeCore();
  const e = new EditingEngine(null, { source: START, inspection: ok(manifest()) }, f.core);
  const detach = e.attach();
  return { e, detach, ...f };
}

/** 表单换一项 */
const withOnError = (f: Form, onError: OnError): Form => ({ ...f, onError });
const withNote = (f: Form, note: string): Form => ({ ...f, settings: { ...f.settings, note } });

const flushMicrotasks = () => vi.advanceTimersByTimeAsync(0);

describe("插件编辑器：代码和表单两头", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("打开时：表单从代码读出来", () => {
    const { e } = engine();
    expect(e.snapshot().form).toEqual(formOf(null, manifest()));
    expect(e.snapshot().source).toBe(START);
  });

  describe("改代码", () => {
    it("停下 0.4 秒才读，连着打字只读最后那一份；读得了，表单换成代码里的值", async () => {
      const { e, inspects } = engine();
      e.editCode("a");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER - 1);
      e.editCode("ab");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER - 1);
      expect(inspects).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(inspects.map((i) => i.source)).toEqual(["ab"]);
      expect(e.snapshot().checking).toBe(true);

      inspects[0]!.answer(ok(manifest("skip", "hi")));
      await flushMicrotasks();
      expect(e.snapshot().checking).toBe(false);
      expect(e.snapshot().form?.onError).toBe("skip");
      expect(e.snapshot().form?.settings.note).toBe("hi");
      expect(e.snapshot().manifest?.on_error).toBe("skip");
    });

    it("读不了：记下原因，表单和 manifest 停在上一次读得了的样子", async () => {
      const { e, inspects } = engine();
      const before = e.snapshot().form;
      e.editCode("broken");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER);
      inspects[0]!.answer(broken);
      await flushMicrotasks();
      expect(e.snapshot().error?.line).toBe(3);
      expect(e.snapshot().form).toBe(before);
      expect(e.snapshot().manifest).toEqual(manifest());
    });

    it("晚到的回答不要：读的时候代码又改了", async () => {
      const { e, inspects } = engine();
      e.editCode("one");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER);
      e.editCode("two");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER);
      expect(inspects.map((i) => i.source)).toEqual(["one", "two"]);
      // 第二次先回、第一次后回：第一次的结果不覆盖
      inspects[1]!.answer(ok(manifest("skip")));
      await flushMicrotasks();
      inspects[0]!.answer(ok(manifest("reject", "stale")));
      await flushMicrotasks();
      expect(e.snapshot().form?.onError).toBe("skip");
      expect(e.snapshot().form?.settings.note).toBe("");
    });

    it("从文件导入的马上读，不等 0.4 秒", () => {
      const { e, inspects } = engine();
      e.editCode("imported", true);
      expect(inspects.map((i) => i.source)).toEqual(["imported"]);
    });

    it("一样的代码不算改动", () => {
      const { e, inspects } = engine();
      e.editCode(START);
      vi.advanceTimersByTime(CHECK_AFTER);
      expect(inspects).toHaveLength(0);
    });

    it("连不上 core：说一声；下一次读成了就不再说", async () => {
      const { e, inspects } = engine();
      e.editCode("x");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER);
      inspects[0]!.fail({ code: "", args: {}, text: "connection reset" });
      await flushMicrotasks();
      expect(e.snapshot().syncError).toBe("connection reset");
      expect(e.snapshot().checking).toBe(false);
      e.editCode("xy");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER);
      inspects[1]!.answer(ok(manifest()));
      await flushMicrotasks();
      expect(e.snapshot().syncError).toBeNull();
    });
  });

  describe("改表单", () => {
    it("停下 0.25 秒按表单改写代码，代码和 manifest 换成改写之后的", async () => {
      const { e, rewrites } = engine();
      e.editForm(withNote(e.snapshot().form!, "a"));
      e.editForm(withNote(e.snapshot().form!, "ab"));
      await vi.advanceTimersByTimeAsync(REWRITE_AFTER - 1);
      expect(rewrites).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(rewrites).toHaveLength(1);
      expect(rewrites[0]!.source).toBe(START);
      expect(rewrites[0]!.values.settings).toEqual({ note: "ab" });

      rewrites[0]!.answer("rewritten");
      await flushMicrotasks();
      expect(e.snapshot().source).toBe("rewritten");
      expect(e.snapshot().manifest?.settings_schema[0]?.value).toBe("ab");
    });

    it("读的时候表单又改了：表单不跟着读回来的结果变，manifest 照样换", async () => {
      const { e, inspects } = engine();
      e.editCode("code");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER);
      e.editForm(withOnError(e.snapshot().form!, "skip"));
      inspects[0]!.answer(ok(manifest("reject", "from code")));
      await flushMicrotasks();
      expect(e.snapshot().form?.onError).toBe("skip");
      expect(e.snapshot().form?.settings.note).toBe("");
      expect(e.snapshot().manifest?.settings_schema[0]?.value).toBe("from code");
    });

    it("改写的时候代码又改了：改写回来的不要", async () => {
      const { e, rewrites } = engine();
      e.editForm(withNote(e.snapshot().form!, "a"));
      await vi.advanceTimersByTimeAsync(REWRITE_AFTER);
      e.editCode("typed meanwhile");
      rewrites[0]!.answer("rewritten");
      await flushMicrotasks();
      expect(e.snapshot().source).toBe("typed meanwhile");
    });

    it("填得不对的不往代码里写，等着的那一次也作废", async () => {
      const { e, rewrites } = engine();
      e.editForm(withNote(e.snapshot().form!, "a"));
      // 适用范围选了「指定」却没加名单
      const f = e.snapshot().form!;
      e.editForm({ ...f, scope: { ...f.scope, clients: { mode: "some", list: [] } } });
      await vi.advanceTimersByTimeAsync(REWRITE_AFTER * 4);
      expect(rewrites).toHaveLength(0);
    });

    it("改回了打开时的值、代码没动过：代码回到打开时的那一份，在路上的改写作废", async () => {
      const { e, rewrites } = engine();
      const original = e.snapshot().form!;
      e.editForm(withNote(original, "a"));
      await vi.advanceTimersByTimeAsync(REWRITE_AFTER);
      expect(rewrites).toHaveLength(1);
      e.editForm(withNote(original, ""));
      expect(e.snapshot().source).toBe(START);
      rewrites[0]!.answer("rewritten");
      await vi.advanceTimersByTimeAsync(REWRITE_AFTER * 4);
      expect(e.snapshot().source).toBe(START);
      expect(rewrites).toHaveLength(1);
    });

    it("代码动过就不退回打开时的那一份，照常改写", async () => {
      const { e, inspects, rewrites } = engine();
      const original = e.snapshot().form!;
      e.editCode("touched");
      await vi.advanceTimersByTimeAsync(CHECK_AFTER);
      inspects[0]!.answer(ok(manifest()));
      await flushMicrotasks();
      e.editForm(withNote(original, ""));
      await vi.advanceTimersByTimeAsync(REWRITE_AFTER);
      expect(rewrites.map((r) => r.source)).toEqual(["touched"]);
    });
  });

  it("两头的改动不搅在一起：等着读代码时改了表单，先把那次读发出去", async () => {
    const { e, inspects, rewrites } = engine();
    e.editCode("code");
    e.editForm(withNote(e.snapshot().form!, "n"));
    expect(inspects.map((i) => i.source)).toEqual(["code"]);
    await vi.advanceTimersByTimeAsync(REWRITE_AFTER);
    expect(rewrites.map((r) => r.source)).toEqual(["code"]);
  });

  it("flush：等着的马上发，在路上的都落地了才返回", async () => {
    const { e, rewrites } = engine();
    e.editForm(withNote(e.snapshot().form!, "saved"));
    let done = false;
    const p = e.flush().then(() => (done = true));
    // 不等 0.25 秒就发了
    expect(rewrites).toHaveLength(1);
    await flushMicrotasks();
    expect(done).toBe(false);
    rewrites[0]!.answer("rewritten");
    await p;
    expect(e.now().source).toBe("rewritten");
    expect(e.now().manifest?.settings_schema[0]?.value).toBe("saved");
  });

  it("卸下之后：等着的不再发，回来的结果都不要", async () => {
    const { e, detach, inspects } = engine();
    e.editCode("x");
    await vi.advanceTimersByTimeAsync(CHECK_AFTER);
    e.editCode("xy");
    detach();
    inspects[0]!.answer(ok(manifest("skip")));
    await vi.advanceTimersByTimeAsync(CHECK_AFTER * 4);
    expect(inspects).toHaveLength(1);
    expect(e.snapshot().form?.onError).toBe("reject");
  });

  it("每次变化都通知订阅的组件，快照换成新的一份", () => {
    const { e } = engine();
    const seen = vi.fn();
    e.subscribe(seen);
    const before = e.snapshot();
    e.editCode("x");
    expect(seen).toHaveBeenCalled();
    expect(e.snapshot()).not.toBe(before);
  });
});
