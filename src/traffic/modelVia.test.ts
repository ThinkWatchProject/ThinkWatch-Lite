import { describe, expect, it } from "vitest";
import type { AttemptView, HistoryRow, KnownModel, PluginRunView, RequestRow, RoutingView } from "@/types";
import { aliasTable, hopVia, routingModels, rowMark, type HopFacts, type ViaConfig } from "./modelVia";

/** 设计稿里的那一份：两个别名、一条指定模型的规则、一条改名的规则、一条第二阶段的改名 */
const cfg: ViaConfig = {
  aliases: new Map([
    ["claude-sonnet-5", ["claude-sonnet-5", "us.anthropic.claude-sonnet-5-v1:0", "anthropic/claude-sonnet-5"]],
    ["deepseek-v4.1", ["DeepSeek-v4.1-flash"]],
  ]),
  routes: [
    {
      name: "default",
      rules: [
        {
          name: "Opus 走 Bedrock",
          to: [
            { provider: "bedrock", model: "us.anthropic.claude-opus-5-v1:0" },
            { provider: "anthropic", model: "claude-opus-5" },
          ],
        },
        { name: "long-context", set: { model: "claude-sonnet-5" } },
        { name: "relay-rename", set: { model: "anthropic/claude-haiku-4-5" } },
        { name: "relay-sonnet", set: { model: "anthropic/claude-sonnet-5" } },
        { name: "relay-no-thinking", set: { model: null } },
        { name: "兜底", to: "__all__" },
      ],
    },
  ],
};

const hop = (over: Partial<HopFacts>): HopFacts => ({
  client: "claude-sonnet-5",
  provider: "anthropic",
  sent: "claude-sonnet-5",
  route: "default",
  rule: "兜底",
  rewrittenBy: [],
  plugin: false,
  ...over,
});

describe("别名表", () => {
  it("从 GET /models 里挑出带模型列表的那几项", () => {
    const models: KnownModel[] = [
      { id: "claude-sonnet-5", providers: ["anthropic", "bedrock"], alias: ["claude-sonnet-5", "us.x"], aliases: [] },
      { id: "claude-haiku-4-5", providers: ["anthropic"], aliases: ["haiku"] },
      { id: "empty", providers: [], alias: [], aliases: [] },
    ];
    expect([...aliasTable(models)]).toEqual([["claude-sonnet-5", ["claude-sonnet-5", "us.x"]]]);
    // 目录取不到：一个别名都没有
    expect(aliasTable(undefined).size).toBe(0);
  });
});

describe("一跳发出的模型名是怎么来的", () => {
  it("别名：发出的是别名列表里的名称；在这家正好同名也算", () => {
    expect(hopVia(hop({ provider: "bedrock", sent: "us.anthropic.claude-sonnet-5-v1:0" }), cfg)).toBe("alias");
    expect(hopVia(hop({}), cfg)).toBe("alias");
    expect(
      hopVia(hop({ client: "deepseek-v4.1", provider: "relay-cn", sent: "DeepSeek-v4.1-flash" }), cfg),
    ).toBe("alias");
  });

  it("别名表里没有这个名称、或者发出的不在它的列表里：不是别名", () => {
    expect(hopVia(hop({ client: "claude-haiku-4-5", sent: "claude-haiku-4-5" }), cfg)).toBeNull();
    // 别名的列表改过了，老记录对不上
    expect(hopVia(hop({ provider: "vertex", sent: "claude-sonnet-5@20260901" }), cfg)).toBeNull();
  });

  it("指定模型：上游和模型都在决定去向的那条规则的列表里", () => {
    const pinned = { client: "claude-opus-5", rule: "Opus 走 Bedrock" };
    expect(hopVia(hop({ ...pinned, provider: "bedrock", sent: "us.anthropic.claude-opus-5-v1:0" }), cfg)).toBe("pinned");
    // 名称没变也是指定的
    expect(hopVia(hop({ ...pinned, provider: "anthropic", sent: "claude-opus-5" }), cfg)).toBe("pinned");
  });

  it("规则现在是指定模型、这一跳却不在列表里：规则改过，说不准；插件改写过这一跳的说是插件", () => {
    const pinned = { client: "claude-opus-5", rule: "Opus 走 Bedrock" };
    expect(hopVia(hop({ ...pinned, provider: "openrouter", sent: "anthropic/claude-opus-5" }), cfg)).toBeNull();
    // 客户端写的恰好是别名也不说别名：那时候这条规则是什么样不知道
    expect(hopVia(hop({ rule: "Opus 走 Bedrock", provider: "openrouter", sent: "anthropic/claude-sonnet-5" }), cfg)).toBeNull();
    expect(
      hopVia(hop({ ...pinned, provider: "bedrock", sent: "us.anthropic.claude-opus-5-v1:1", plugin: true }), cfg),
    ).toBe("plugin");
  });

  it("规则改名：改写了参数的规则里有「模型改为」，发出的就是它（或它作为别名对到这家的名称）", () => {
    expect(
      hopVia(hop({ client: "claude-haiku-4-5", provider: "openrouter", sent: "anthropic/claude-haiku-4-5", rewrittenBy: ["relay-rename"] }), cfg),
    ).toBe("rule");
    // 改成的是别名，再按别名表对到 bedrock
    expect(
      hopVia(
        hop({ client: "claude-opus-5", provider: "bedrock", sent: "us.anthropic.claude-sonnet-5-v1:0", rewrittenBy: ["relay-no-thinking", "long-context"] }),
        cfg,
      ),
    ).toBe("rule");
  });

  it("规则改名排在别名前面；只改了别的参数的规则不算", () => {
    // 别名本身也说得通（openrouter 上它就叫这个），但「模型改为」才是改名的那一步
    expect(
      hopVia(hop({ provider: "openrouter", sent: "anthropic/claude-sonnet-5", rewrittenBy: ["relay-sonnet"] }), cfg),
    ).toBe("rule");
    expect(
      hopVia(hop({ provider: "bedrock", sent: "us.anthropic.claude-sonnet-5-v1:0", rewrittenBy: ["relay-no-thinking"] }), cfg),
    ).toBe("alias");
  });

  it("插件：别的都说不通、插件在这一跳改写过请求", () => {
    expect(hopVia(hop({ client: "gpt-5.5", provider: "chatgpt", sent: "gpt-5.5-mini", plugin: true }), cfg)).toBe("plugin");
  });

  it("都对不上：不说原因", () => {
    expect(hopVia(hop({ client: "gpt-5.5", provider: "chatgpt", sent: "gpt-5.5-mini" }), cfg)).toBeNull();
    // 改名的那条规则后来删了
    expect(
      hopVia(hop({ client: "gpt-5.5", provider: "chatgpt", sent: "gpt-5.5-mini", rewrittenBy: ["deleted-rule"] }), cfg),
    ).toBeNull();
    // 路由后来删了
    expect(hopVia(hop({ route: "gone", rule: "Opus 走 Bedrock", provider: "bedrock", sent: "x" }), cfg)).toBeNull();
  });
});

describe("流量表上游那一格的标记", () => {
  const row = (over: Partial<RequestRow>): RequestRow => ({
    id: 1,
    client: "cursor",
    provider: "bedrock",
    model: "claude-sonnet-5",
    path: "/v1/messages",
    atMs: 0,
    state: "done",
    route: "default",
    rule: "兜底",
    sentModel: "us.anthropic.claude-sonnet-5-v1:0",
    ...over,
  });

  it("别名：看服务它的那一跳，发出的名称和客户端写的不同才标", () => {
    expect(rowMark(row({}), cfg)).toEqual({ via: "alias", sent: "us.anthropic.claude-sonnet-5-v1:0", rule: "兜底" });
    // 在 anthropic 那里同名：发出的就是模型那一列写的，不标
    expect(rowMark(row({ provider: "anthropic", sentModel: undefined }), cfg)).toBeNull();
  });

  it("指定：名称相同也标，上游是规则指定的", () => {
    expect(
      rowMark(row({ model: "claude-opus-5", rule: "Opus 走 Bedrock", sentModel: "us.anthropic.claude-opus-5-v1:0" }), cfg),
    ).toEqual({ via: "pinned", sent: "us.anthropic.claude-opus-5-v1:0", rule: "Opus 走 Bedrock" });
    expect(rowMark(row({ model: "claude-opus-5", provider: "anthropic", rule: "Opus 走 Bedrock", sentModel: undefined }), cfg)).toEqual({
      via: "pinned",
      sent: "claude-opus-5",
      rule: "Opus 走 Bedrock",
    });
  });

  it("规则改名、插件改名不在这里标（插件有自己的徽标）", () => {
    expect(
      rowMark(row({ model: "claude-haiku-4-5", provider: "openrouter", sentModel: "anthropic/claude-haiku-4-5", rewrittenBy: ["relay-rename"] }), cfg),
    ).toBeNull();
    expect(rowMark(row({ model: "gpt-5.5", provider: "chatgpt", sentModel: "gpt-5.5-mini", pluginChanged: true }), cfg)).toBeNull();
  });

  it("没有发往任何上游、本地应答、还没有路由、配置还没取到、没有模型名：不标", () => {
    expect(rowMark(row({ provider: "" }), cfg)).toBeNull();
    expect(rowMark(row({ local: true, provider: "" }), cfg)).toBeNull();
    expect(rowMark(row({ route: undefined, rule: undefined }), cfg)).toBeNull();
    expect(rowMark(row({}), null)).toBeNull();
    expect(rowMark(row({ model: undefined }), cfg)).toBeNull();
  });
});

describe("详情的路由页", () => {
  const attempt = (provider: string, model?: string, outcome: AttemptView["outcome"] = "served"): AttemptView => ({
    provider,
    outcome,
    status: outcome === "served" ? 200 : 529,
    ms: 800,
    ...(model ? { model } : {}),
  });
  const rec = (model: string, routing: Partial<RoutingView>): Pick<HistoryRow, "model" | "routing"> => ({
    model,
    routing: { route: "default", rule: "兜底", group: "__all__", rewritten_by: [], denied_by: null, attempts: [], ...routing },
  });

  it("别名从 anthropic 故障转移到 bedrock：两跳都写模型名，只有改了名的那一跳有悬停", () => {
    const m = routingModels(
      rec("claude-sonnet-5", { attempts: [attempt("anthropic", undefined, "status"), attempt("bedrock", "us.anthropic.claude-sonnet-5-v1:0")] }),
      [],
      cfg,
    );
    expect(m).toEqual({
      alias: "claude-sonnet-5",
      pinnedBy: null,
      show: true,
      hops: [
        { sent: "claude-sonnet-5", changed: false, via: "alias" },
        { sent: "us.anthropic.claude-sonnet-5-v1:0", changed: true, via: "alias" },
      ],
    });
  });

  it("指定模型：写出是哪条规则", () => {
    const m = routingModels(
      rec("claude-opus-5", { rule: "Opus 走 Bedrock", group: null, attempts: [attempt("bedrock", "us.anthropic.claude-opus-5-v1:0")] }),
      [],
      cfg,
    );
    expect(m.alias).toBeNull();
    expect(m.pinnedBy).toBe("Opus 走 Bedrock");
    expect(m.hops).toEqual([{ sent: "us.anthropic.claude-opus-5-v1:0", changed: true, via: "pinned" }]);
  });

  it("插件看的是这一跳上的请求钩子改没改过", () => {
    const run = (attempt: number, hook: PluginRunView["hook"], outcome: PluginRunView["outcome"]): PluginRunView => ({
      plugin_id: "p",
      plugin_name: "p",
      hook,
      attempt,
      outcome,
      error: null,
      cpu_us: 10,
    });
    const r = rec("gpt-5.5", { attempts: [attempt("chatgpt", "gpt-5.5-mini", "status"), attempt("openrouter", "gpt-5.5-mini")] });
    const m = routingModels(r, [run(0, "request", "unchanged"), run(1, "request", "changed"), run(0, "reply", "changed")], cfg);
    expect(m.hops.map((h) => h.via)).toEqual([null, "plugin"]);
    expect(m.show).toBe(true);
    expect(m.alias).toBeNull();
  });

  it("没改名、不是别名也不是指定：尝试链照旧不写模型名", () => {
    const m = routingModels(rec("gpt-5.5", { attempts: [attempt("chatgpt")] }), [], cfg);
    expect(m).toEqual({ alias: null, pinnedBy: null, show: false, hops: [{ sent: "gpt-5.5", changed: false, via: null }] });
  });

  it("配置还没取到：只照记录写发出的名称，不说原因", () => {
    const m = routingModels(rec("claude-sonnet-5", { attempts: [attempt("bedrock", "us.anthropic.claude-sonnet-5-v1:0")] }), [], null);
    expect(m).toEqual({
      alias: null,
      pinnedBy: null,
      show: true,
      hops: [{ sent: "us.anthropic.claude-sonnet-5-v1:0", changed: true, via: null }],
    });
  });

  it("没有尝试（被拒绝、上游都接不了）：两行都不写", () => {
    const m = routingModels(rec("claude-sonnet-5", { attempts: [] }), [], cfg);
    expect(m).toEqual({ alias: null, pinnedBy: null, show: false, hops: [] });
  });
});
