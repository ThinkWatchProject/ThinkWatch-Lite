import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import type { Nav } from "@/nav";
import type { ConnView } from "@/connection/api";
import type { Overview, RequestRow } from "@/types";
import { NotSentIcon } from "@/traffic/cells";
import { UpstreamLogo } from "@/ui/logos";
import { score } from "./match";
import { buildItems, requestItems, type Sources } from "./items";

/** 记下每一次 `nav.open`，看面板把人送到了哪 */
function recorder() {
  const opened: unknown[][] = [];
  const nav: Nav = { surface: "dashboard", open: (...args: unknown[]) => void opened.push(args) } as Nav;
  return { nav, opened };
}

/** 概览里面板用得到的那几样；别的字段面板不读 */
const ov = {
  providers: [
    { name: "deepseek", base_url: "https://api.deepseek.com", protocol: "openai", disabled: false, health: "closed" },
    { name: "ollama", base_url: "http://127.0.0.1:11434", protocol: "openai", disabled: true, health: "closed" },
  ],
  clients: [
    { name: "default", default: true, disabled: false, client: null, route: null },
    { name: "cursor", default: false, disabled: false, client: "cursor", route: "codex" },
  ],
  routes: [{ name: "codex", rules: [{}, {}], clients: ["cursor"], default: false }],
  groups: [
    { name: "__all__", builtin: true, kind: "fallback", providers: ["deepseek", "ollama"] },
    { name: "budget", builtin: false, kind: "cheapest", providers: ["deepseek"] },
  ],
} as unknown as Overview;

const conn = {
  profiles: [
    { id: "local", name: "", local: true, host: null, port: null, addr: null, last_connected_at: null },
    { id: "studio", name: "Studio", local: false, host: "10.0.0.2", port: 18791, addr: "10.0.0.2:18791", last_connected_at: null },
  ],
  current: "local",
} as unknown as ConnView;

function sources(over: Partial<Sources> = {}): Sources {
  const noop = () => {};
  return {
    nav: recorder().nav,
    lang: "zh",
    linked: true,
    readOnly: false,
    remote: false,
    ov,
    railOpen: true,
    conn,
    clients: undefined,
    switchTo: noop,
    addConnection: noop,
    shell: {
      toggleRail: noop,
      refresh: noop,
      configFile: noop,
      history: noop,
      notices: noop,
      shortcuts: noop,
      checkUpdates: noop,
    },
    ...over,
  };
}

const ids = (s: Sources) => buildItems(s).map((i) => i.id);

describe("命令面板的条目", () => {
  it("页面按源列表的顺序，带 ⌘1…⌘9", () => {
    const pages = buildItems(sources()).filter((i) => i.group === "pages");
    expect(pages.map((p) => p.id)).toEqual([
      "page:dashboard",
      "page:requests",
      "page:clients",
      "page:keys",
      "page:upstreams",
      "page:routing",
      "page:security",
      "page:mcp",
      "page:settings",
    ]);
    expect(pages[3]!.combo).toEqual(["mod", "4"]);
  });

  it("连着、可写：新建和测速都在", () => {
    const all = ids(sources());
    for (const id of ["action:new-upstream", "action:new-key", "action:new-route", "action:speed-test", "action:dry-run"]) {
      expect(all).toContain(id);
    }
  });

  it("远程断了、内容只读：不出现写配置、花钱的动作，也不出现诊断包那一节", () => {
    const all = ids(sources({ readOnly: true, remote: true }));
    for (const id of ["action:new-upstream", "action:new-key", "action:new-route", "action:speed-test", "action:new-proxy"]) {
      expect(all).not.toContain(id);
    }
    expect(all).toContain("action:search-traffic");
    expect(all).not.toContain("settings:diagnostics");
  });

  it("没连上 core：只有设置、连接和不碰 core 的动作", () => {
    const all = ids(sources({ linked: false, ov: null }));
    expect(all.filter((i) => i.startsWith("page:"))).toEqual(["page:settings"]);
    expect(all).not.toContain("action:config-file");
    expect(all).not.toContain("settings:listen");
    expect(all).toContain("action:switch-connection");
    expect(all).toContain("connection:studio");
  });

  it("还没有上游：不能新建路由、测速；路由和策略组也不列（路由页打不开它们）", () => {
    const bare = { ...ov, providers: [] } as unknown as Overview;
    const all = ids(sources({ ov: bare }));
    expect(all).toContain("action:new-upstream");
    expect(all).not.toContain("action:new-route");
    expect(all).not.toContain("action:speed-test");
    expect(all).not.toContain("route:codex");
  });

  it("实体只在搜的时候出现；内置的「全部上游」不列；当前连接选不了", () => {
    const items = buildItems(sources());
    for (const i of items.filter((x) => ["upstreams", "keys", "routes", "groups", "connections"].includes(x.group))) {
      expect(i.searchOnly).toBe(true);
    }
    expect(items.map((i) => i.id)).not.toContain("group:__all__");
    expect(items.find((i) => i.id === "connection:local")?.disabled).toBe(true);
    expect(items.find((i) => i.id === "connection:studio")?.disabled).toBeFalsy();
  });

  it("选一个实体：送到那一页，打开点那一行会开的对话框", () => {
    const { nav, opened } = recorder();
    const items = buildItems(sources({ nav }));
    items.find((i) => i.id === "upstream:deepseek")!.run();
    items.find((i) => i.id === "key:cursor")!.run();
    items.find((i) => i.id === "group:budget")!.run();
    items.find((i) => i.id === "action:new-upstream")!.run();
    expect(opened).toEqual([
      ["upstreams", { edit: "deepseek" }],
      ["keys", { edit: "cursor" }],
      ["routing", { editGroup: "budget" }],
      ["upstreams", { create: "upstream" }],
    ]);
  });

  it("账号上游写登的是哪个账号，按邮箱也搜得到；登录失效和上游列表里一样说出来", () => {
    const account = {
      name: "chatgpt",
      base_url: "https://chatgpt.com/backend-api/codex",
      protocol: "chatgpt",
      disabled: false,
      health: "closed",
      oauth: {
        endpoint: "https://auth.openai.com/oauth/token",
        needs_login: true,
        account: { email: "dev@example.com", plan: "plus" },
      },
    };
    const withAccount = { ...ov, providers: [...ov.providers, account] } as unknown as Overview;
    const items = buildItems(sources({ ov: withAccount }));
    const item = items.find((i) => i.id === "upstream:chatgpt")!;
    expect(item.detail).toBe("dev@example.com");
    expect(score("dev@example", item.title, item.keywords)).toBeGreaterThan(0);
    expect((item.meta as ReactElement<{ text: string }>).props.text).toBe("需要重新登录");
    // 别的上游照旧写地址
    expect(items.find((i) => i.id === "upstream:deepseek")!.detail).toBe("api.deepseek.com");
  });

  it("只有一个连接时不出现「切换连接」", () => {
    const one = { ...conn, profiles: conn.profiles.slice(0, 1) } as ConnView;
    expect(ids(sources({ conn: one }))).not.toContain("action:switch-connection");
  });
});

function row(id: number, model: string, over: Partial<RequestRow> = {}): RequestRow {
  return { id, client: "default", provider: "deepseek", model, path: "/v1/chat/completions", atMs: id * 1000, state: "done", ...over };
}

describe("命令面板里的请求", () => {
  // 新的在前，和流量页手上的一样
  const rows = [
    row(105, "claude-sonnet-5", { provider: "anthropic", client: "claude-code" }),
    row(104, "deepseek-chat"),
    row(103, "claude-sonnet-5", { provider: "anthropic", client: "claude-code" }),
    row(102, "claude-haiku-4-5", { provider: "anthropic", client: "claude-code" }),
    row(101, "gpt-5.5-codex", { provider: "chatgpt", client: "codex" }),
  ];
  const { nav } = recorder();
  const byText = (q: string) => requestItems(rows, ov, nav, (t, kw) => score(q, t, kw), null, 5);

  it("按模型搜：每个模型只列最近的那一条", () => {
    expect(byText("claude").map((x) => x.item.id)).toEqual(["request:105", "request:102"]);
  });

  it("上游、密钥名不参与：那是流量页筛选的事", () => {
    expect(byText("anthropic")).toEqual([]);
    expect(byText("codex").map((x) => x.item.id)).toEqual(["request:101"]);
  });

  it("按编号：对上的在前，前缀对上的跟着，手上没有的那个编号垫底", () => {
    expect(requestItems(rows, ov, nav, () => 0, "103", 5).map((x) => x.item.id)).toEqual(["request:103"]);
    const got = requestItems(rows, ov, nav, () => 0, "10", 6);
    expect(got.map((x) => x.item.id)).toEqual([
      "request:105",
      "request:104",
      "request:103",
      "request:102",
      "request:101",
      "request:10",
    ]);
  });

  it("编号不在手上这几行里：照样给一条能打开的", () => {
    const got = requestItems(rows, ov, nav, () => 0, "48123", 5);
    expect(got).toHaveLength(1);
    expect(got[0]!.item.title).toBe("打开请求 #48123");
  });

  /** 条目的图形是哪一种：没有发往上游的是 `NotSentIcon`（带 `kind`），其余看组件本身 */
  const iconOf = (icon: unknown) => {
    const el = icon as ReactElement<{ kind?: string; name?: string }>;
    return el.type === NotSentIcon ? `not-sent:${el.props.kind}` : el.type === UpstreamLogo ? `upstream:${el.props.name}` : "other";
  };

  it("没有发往任何上游的：图形和那一行说是被规则拒绝还是无可用上游，不画「?」方块", () => {
    const denied = row(203, "claude-opus-5", {
      provider: "",
      client: "codex",
      state: "failed",
      error: { code: "gw.route.denied", args: { rule: "no-opus", reason: "Opus is not offered" }, text: "" },
    });
    const nowhere = row(202, "moonshotai/kimi-k2", {
      provider: "",
      client: "codex",
      state: "failed",
      error: { code: "gw.model.no_upstream_available", args: { model: "moonshotai/kimi-k2", detail: "" }, text: "" },
    });
    // 选定上游之后被拒绝的记在要去的那个上游上：照常画那个上游
    const afterPick = row(201, "claude-sonnet-5", {
      provider: "openrouter",
      client: "claude-code",
      state: "failed",
      error: { code: "gw.route.denied", args: { rule: "no-images-via-relay", reason: "" }, text: "" },
    });
    const got = requestItems([denied, nowhere, afterPick], ov, nav, () => 0, "20", 5).map((x) => x.item);
    expect(got.map((i) => [i.id, iconOf(i.icon), i.detail])).toEqual([
      ["request:203", "not-sent:denied", "#203 · 规则拒绝 · codex"],
      ["request:202", "not-sent:unavailable", "#202 · 无可用上游 · codex"],
      ["request:201", "upstream:openrouter", "#201 · openrouter · claude-code"],
      ["request:20", "other", undefined],
    ]);
  });

  it("本地应答的：标题是辅助请求的类别，图形是网关，按原词也搜得到", () => {
    // 流量表给本地应答那几行的「上游」是那一句说明，不是上游的名字
    const local = row(301, "", { model: undefined, provider: "本地应答", local: true, path: "titling", client: "claude-code" });
    const got = requestItems([local], ov, nav, (t, kw) => score("titling", t, kw), null, 5).map((x) => x.item);
    expect(got.map((i) => [i.title, iconOf(i.icon), i.detail])).toEqual([["生成标题", "other", "#301 · 本地应答 · claude-code"]]);
  });
});
