import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ProviderView } from "@/types";
import { serviceOf } from "./presets";
import {
  applyPreset,
  authModeOf,
  authOptions,
  blankForm,
  connectionChanged,
  connectionMissing,
  fieldRules,
  formFromDraft,
  formFromView,
  headerRow,
  inScope,
  modelsMissing,
  oauthKept,
  retarget,
  signedInKey,
  siteLocked,
  toInput,
  withAuth,
  withManualAdded,
  withManualRemoved,
  withSite,
  type UpstreamForm,
} from "./upstreamForm";

// 断言按中文写：不随跑测试那台机器的系统语言变
beforeAll(() => setLang("zh"));

function view(patch: Partial<ProviderView> = {}): ProviderView {
  return {
    name: "relay",
    base_url: "https://relay.example/v1",
    key: "sk-relay-Q3xA",
    auth_header: "x-api-key",
    headers: [
      { name: "anthropic-version", value: "2023-06-01" },
      { name: "X-Relay-Token", value: "rt-5d1e9f2c" },
    ],
    oauth: null,
    protocol: "anthropic",
    protocol_explicit: true,
    forward_client_identity: false,
    proxy: "direct",
    on_proxy_fail: "fail",
    models: [],
    models_only: null,
    model_source: "discovered",
    model_status: "listed",
    model_fetching: false,
    model_count: 3,
    disabled: false,
    health: "ok",
    billing: "per-token",
    references: [],
    pricing: null,
    balance_setting: "auto",
    balance: null,
    signed_in: null,
    ...patch,
  };
}

function oauthView(): ProviderView {
  return view({
    key: null,
    oauth: {
      endpoint: "https://auth.example/token",
      refresh: "rt-saved",
      client_id: "cid",
      client_secret: "cs-saved",
    },
  });
}

function fresh(patch: Partial<UpstreamForm>): UpstreamForm {
  return { ...blankForm(), name: "relay", baseUrl: "https://relay.example", ...patch };
}

describe("编辑时回填原样", () => {
  it("地址、密钥和请求头按配置里写的回填，没改就原样交回", () => {
    const p = view();
    const f = formFromView(p);
    expect(f.baseUrl).toBe("https://relay.example/v1");
    expect(f.key).toBe("sk-relay-Q3xA");
    const input = toInput(f);
    expect(input.base_url).toBe("https://relay.example/v1");
    expect(input.key).toBe("sk-relay-Q3xA");
    expect(input.oauth).toEqual({ mode: "none" });
    expect(input.headers).toEqual([
      { name: "anthropic-version", value: "2023-06-01" },
      { name: "X-Relay-Token", value: "rt-5d1e9f2c" },
    ]);
    expect(connectionChanged(f, p)).toBe(false);
  });

  it("转发客户端身份：新建默认关，编辑时回填、原样交回", () => {
    expect(toInput(blankForm()).forward_client_identity).toBe(false);
    const f = formFromView(view({ forward_client_identity: true }));
    expect(f.forwardClientIdentity).toBe(true);
    expect(toInput(f).forward_client_identity).toBe(true);
    expect(toInput({ ...f, forwardClientIdentity: false }).forward_client_identity).toBe(false);
  });

  it("并发上限：回填、原样交回；清空就是不限。停用、启用走同一份，不会把它丢掉", () => {
    const f = formFromView(view({ max_concurrent: 4 }));
    expect(f.maxConcurrent).toBe("4");
    expect(toInput(f).max_concurrent).toBe(4);
    expect(toInput({ ...f, maxConcurrent: "" }).max_concurrent).toBeUndefined();
    expect(formFromView(view()).maxConcurrent).toBe("");
    expect(toInput(blankForm()).max_concurrent).toBeUndefined();
  });

  it("并发上限只收 1 到 1000 的整数，写错了保存不了", () => {
    const f = formFromView(view());
    for (const ok of ["1", "1000", " 12 "]) {
      expect(connectionMissing({ ...f, maxConcurrent: ok }, "relay", ["relay"])).toBeNull();
    }
    for (const bad of ["0", "1001", "2.5", "-1", "abc"]) {
      expect(connectionMissing({ ...f, maxConcurrent: bad }, "relay", ["relay"])).toBe(
        "并发上限须为 1 到 1000 之间的整数",
      );
      expect(toInput({ ...f, maxConcurrent: bad }).max_concurrent).toBeUndefined();
    }
  });

  it("清空密钥就是不要密钥；清空请求头的值要补上", () => {
    const f = formFromView(view());
    expect(toInput({ ...f, key: " " }).key).toBeUndefined();
    const cleared = { ...f, headers: [{ ...f.headers[1]!, value: "" }] };
    expect(connectionMissing(cleared, "relay", ["relay"])).toBe("填写请求头「X-Relay-Token」的值");
  });

  it("环境变量引用原样回填、原样交回", () => {
    const p = view({ key: "${RELAY_KEY}" });
    const f = formFromView(p);
    expect(f.key).toBe("${RELAY_KEY}");
    expect(toInput(f).key).toBe("${RELAY_KEY}");
    expect(connectionChanged(f, p)).toBe(false);
  });

  it("OAuth 回填原样；没改就交「保持原样」，检测也不用填 Access Token", () => {
    const f = formFromView(oauthView());
    expect(f.authMode).toBe("oauth");
    expect(f.oauthRefresh).toBe("rt-saved");
    expect(f.oauthClientSecret).toBe("cs-saved");
    expect(oauthKept(f)).toBe(true);
    expect(toInput(f).oauth).toEqual({ mode: "keep" });
    expect(toInput(f).key).toBeUndefined();
    expect(connectionMissing(f, "relay", ["relay"])).toBeNull();
  });

  it("改了 OAuth 的任何一项就整份交新的", () => {
    const f = { ...formFromView(oauthView()), oauthRefresh: "rt-new" };
    expect(oauthKept(f)).toBe(false);
    expect(toInput(f).oauth).toEqual({
      mode: "set",
      refresh: "rt-new",
      endpoint: "https://auth.example/token",
      client_id: "cid",
      client_secret: "cs-saved",
      access: undefined,
    });
    expect(connectionMissing({ ...f, oauthRefresh: "" }, "relay", ["relay"])).toBe(
      "填写 Refresh Token 与 Token 端点",
    );
  });

  it("OAuth 改成 API 密钥：删掉 OAuth、交新密钥", () => {
    const f = { ...formFromView(oauthView()), authMode: "key" as const, key: "sk-new" };
    expect(toInput(f).oauth).toEqual({ mode: "none" });
    expect(toInput(f).key).toBe("sk-new");
  });

  it("从 API 密钥改成 OAuth：必须填新的 OAuth 凭据，原密钥删掉", () => {
    const f = { ...formFromView(view()), authMode: "oauth" as const };
    expect(connectionMissing(f, "relay", ["relay"])).toBe("填写 Refresh Token 与 Token 端点");
    const filled = { ...f, oauthRefresh: "rt", oauthEndpoint: "https://auth.example/token" };
    expect(toInput(filled).key).toBeUndefined();
    expect(toInput(filled).oauth).toMatchObject({ mode: "set", refresh: "rt" });
  });

  it("改了地址、请求头、协议或代理都算连接改过", () => {
    const p = view();
    const f = formFromView(p);
    expect(connectionChanged({ ...f, baseUrl: "https://relay.example" }, p)).toBe(true);
    expect(connectionChanged({ ...f, headers: [...f.headers, headerRow("X-Org", "o-1")] }, p)).toBe(true);
    expect(connectionChanged({ ...f, protocol: "openai-chat" }, p)).toBe(true);
    expect(connectionChanged({ ...f, proxy: "system" }, p)).toBe(true);
  });
});

describe("第一步选服务类型", () => {
  it("预设填地址、协议、名称；名称已被占用就加序号", () => {
    const f = applyPreset(blankForm(), "anthropic", ["anthropic"]);
    expect(f.preset).toBe("anthropic");
    expect(f.name).toBe("anthropic-2");
    expect(f.baseUrl).toBe("https://api.anthropic.com");
    expect(f.protocol).toBe("anthropic");
    expect(f.billing).toBe("per-token");
  });

  it("退回第一步换一种：没手动改过的名称跟着换，改过的留着", () => {
    const a = applyPreset(blankForm(), "anthropic", []);
    expect(applyPreset(a, "openai", []).name).toBe("openai");
    const mine = applyPreset({ ...a, name: "work" }, "openai", []);
    expect(mine.name).toBe("work");
    expect(mine.baseUrl).toBe("https://api.openai.com");
  });

  it("本地服务不计费；换回自定义清空地址和协议", () => {
    const o = applyPreset(blankForm(), "ollama", []);
    expect(o.billing).toBe("free");
    const c = applyPreset(o, "custom", []);
    expect(c).toMatchObject({ preset: "custom", name: "", baseUrl: "", protocol: "", billing: "per-token" });
  });

  it("跟着地址猜出的名称也算没动过：换一格时跟着换", () => {
    const s = { ...applyPreset(blankForm(), "sub2api", []), baseUrl: "https://api.relay-hk.example", name: "relay-hk" };
    expect(applyPreset(s, "anthropic", []).name).toBe("anthropic");
  });

  it("这一格没有的认证方式换成它的第一种", () => {
    const o = withAuth(applyPreset(blankForm(), "openai", []), "account", []);
    expect(applyPreset(o, "anthropic", []).authMode).toBe("key");
    const b = withAuth(applyPreset(blankForm(), "bedrock", []), "aws-profile", []);
    expect(applyPreset(b, "custom", []).authMode).toBe("key");
    // 两格都有的留着
    const t = withAuth(applyPreset(blankForm(), "thinkwatch", []), "oauth", []);
    expect(applyPreset(t, "sub2api", []).authMode).toBe("oauth");
  });
});

describe("认证方式与站点", () => {
  it("每种服务能选的认证方式；自定义填了 Bedrock 地址就是 Bedrock 那三种", () => {
    const opts = (id: string) => authOptions(applyPreset(blankForm(), id, []));
    expect(opts("openai")).toEqual(["key", "account"]);
    expect(opts("zai")).toEqual(["key", "account"]);
    expect(opts("bedrock")).toEqual(["key", "aws-keys", "aws-profile"]);
    expect(opts("anthropic")).toEqual(["key"]);
    expect(opts("ollama")).toEqual(["key"]);
    for (const id of ["custom", "thinkwatch", "sub2api", "newapi"]) expect(opts(id)).toEqual(["key", "oauth"]);
    const c = applyPreset(blankForm(), "custom", []);
    expect(authOptions({ ...c, baseUrl: "https://bedrock-runtime.eu-west-1.amazonaws.com" })).toEqual([
      "key",
      "aws-keys",
      "aws-profile",
    ]);
  });

  it("编辑时没有预设：OAuth 的上游照旧是 OAuth，不被当成这一格没有的方式", () => {
    const f = formFromView(oauthView());
    expect(authOptions(f)).toEqual(["key", "oauth"]);
    expect(authModeOf(f)).toBe("oauth");
  });

  it("OpenAI 换成 ChatGPT 账号：没动过的名称换成 chatgpt，动过的留着", () => {
    const o = applyPreset(blankForm(), "openai", ["chatgpt"]);
    expect(withAuth(o, "account", ["chatgpt"]).name).toBe("chatgpt-2");
    expect(withAuth(withAuth(o, "account", []), "key", []).name).toBe("openai");
    expect(withAuth({ ...o, name: "work" }, "account", []).name).toBe("work");
  });

  it("Z.ai / BigModel 换站点：地址和名称跟着换", () => {
    const z = applyPreset(blankForm(), "zai", []);
    expect(z).toMatchObject({ name: "zai", baseUrl: "https://api.z.ai/api/anthropic", protocol: "anthropic" });
    const b = withSite(z, "bigmodel", []);
    expect(b).toMatchObject({ zaiFamily: "bigmodel", name: "bigmodel", baseUrl: "https://open.bigmodel.cn/api/anthropic" });
    // 账号登录也按站点起名（和 core 登录时不给名字的叫法一样）
    expect(withAuth(b, "account", []).name).toBe("bigmodel");
    expect(withSite({ ...z, name: "glm" }, "bigmodel", []).name).toBe("glm");
  });

  it("登录账号时这张表单不往下交：登录成功由 core 写配置", () => {
    const o = withAuth(applyPreset(blankForm(), "openai", []), "account", []);
    expect(authModeOf(o)).toBe("account");
    expect(connectionMissing(o, null, [])).toBe("登录后继续");
    // 别的服务没有账号登录：按 API 密钥算
    expect(authModeOf({ ...applyPreset(blankForm(), "anthropic", []), authMode: "account" })).toBe("key");
  });
});

describe("编辑时认出是哪一种服务", () => {
  const of = (baseUrl: string, protocol: ProviderView["protocol"] | "" = "", balance: ProviderView["balance_setting"] | null = null) =>
    serviceOf({ baseUrl, protocol, balance: balance ?? null });

  it("官方地址按主机认，路径不同照样是它", () => {
    expect(of("https://api.anthropic.com").preset).toBe("anthropic");
    expect(of("https://api.openai.com/v1").preset).toBe("openai");
    expect(of("https://generativelanguage.googleapis.com/v1beta").preset).toBe("gemini");
    expect(of("https://api.deepseek.com/anthropic").preset).toBe("deepseek");
    expect(of("https://api.deepseek.com").preset).toBe("deepseek");
    expect(of("https://openrouter.ai/api").preset).toBe("openrouter");
    expect(of("https://api.z.ai/api/anthropic")).toEqual({ preset: "zai", family: "zai" });
    expect(of("https://api.z.ai/api/paas/v4")).toEqual({ preset: "zai", family: "zai" });
    expect(of("https://open.bigmodel.cn/api/anthropic")).toEqual({ preset: "zai", family: "bigmodel" });
  });

  it("Bedrock 认标准地址，也认协议；Ollama 认 11434 端口", () => {
    expect(of("https://bedrock-runtime.us-west-2.amazonaws.com").preset).toBe("bedrock");
    expect(of("https://bedrock-runtime-fips.us-gov-west-1.amazonaws.com").preset).toBe("bedrock");
    expect(of("https://vpce-1.bedrock.example.internal", "bedrock").preset).toBe("bedrock");
    expect(of("http://127.0.0.1:11434").preset).toBe("ollama");
    expect(of("http://gpu-box.lan:11434/").preset).toBe("ollama");
  });

  it("中转平台和企业网关在任意地址上：按写明的余额来源认", () => {
    expect(of("https://api.relay-hk.example", "", "sub2api").preset).toBe("sub2api");
    expect(of("https://one.example.com", "", "newapi").preset).toBe("newapi");
    expect(of("https://gateway.corp.example", "", "thinkwatch").preset).toBe("thinkwatch");
    // 官方地址先认：写了别的来源也还是那一家
    expect(of("https://openrouter.ai/api", "", "off").preset).toBe("openrouter");
  });

  it("登录 Z.ai / BigModel 账号换来的密钥：是登录的那一边，不看地址", () => {
    expect(serviceOf({ baseUrl: "https://api.z.ai/api/anthropic", protocol: "", balance: null, signedIn: "zai" })).toEqual({
      preset: "zai",
      family: "zai",
    });
    expect(serviceOf({ baseUrl: "https://glm.example/api", protocol: "", balance: null, signedIn: "bigmodel" })).toEqual({
      preset: "zai",
      family: "bigmodel",
    });
    expect(serviceOf({ baseUrl: "https://glm.example/api", protocol: "", balance: null, signedIn: null }).preset).toBe("custom");
  });

  it("别的都是自定义；ChatGPT 账号也是（它有自己的「账号」一节）", () => {
    expect(of("https://relay.example/v1").preset).toBe("custom");
    expect(of("https://relay.example/v1", "", "auto").preset).toBe("custom");
    expect(of("https://relay.example/v1", "", "off").preset).toBe("custom");
    expect(of("https://chatgpt.com/backend-api/codex", "chatgpt").preset).toBe("custom");
    expect(of("not a url").preset).toBe("custom");
    expect(formFromView(view({ base_url: "https://chatgpt.com/backend-api/codex", protocol: "chatgpt" })).preset).toBe("custom");
  });

  it("编辑表单按认出来的服务问：官方地址、标准写法时只剩密钥", () => {
    const f = formFromView(view({ base_url: "https://api.anthropic.com", protocol: "anthropic", protocol_explicit: false, headers: [] }));
    expect(f.preset).toBe("anthropic");
    expect(fieldRules(f)).toEqual({ auth: ["key"], site: false, url: true, protocols: null, key: true, clientIdentity: false });
    // OpenAI 编辑时没有「登录账号」：ChatGPT 账号是另一个上游
    const o = formFromView(view({ base_url: "https://api.openai.com", protocol: "openai-chat", protocol_explicit: true }));
    expect(fieldRules(o).auth).toEqual(["key"]);
    expect(fieldRules(o).protocols).toEqual(["openai-chat", "openai-responses"]);
    // Z.ai / BigModel 有：登录换来的是这个上游的一把新密钥
    const z = formFromView(view({ base_url: "https://open.bigmodel.cn/api/anthropic", protocol_explicit: true }));
    expect(z).toMatchObject({ preset: "zai", zaiFamily: "bigmodel", authMode: "key" });
    expect(fieldRules(z)).toMatchObject({ site: true, url: false, protocols: null, auth: ["key", "account"], key: true });
  });

  it("改了地址就重认：官方地址改成别的主机，从此是自定义", () => {
    const f = formFromView(view({ base_url: "https://api.anthropic.com", protocol_explicit: false }));
    const moved = retarget({ ...f, baseUrl: "https://relay.example" });
    expect(moved.preset).toBe("custom");
    expect(fieldRules(moved).protocols).toBe("all");
    expect(retarget({ ...moved, baseUrl: "https://api.anthropic.com/" }).preset).toBe("anthropic");
    // 按余额来源认出来的，换地址还是它
    const s = formFromView(view({ base_url: "https://a.example", balance_setting: "sub2api" }));
    expect(retarget({ ...s, baseUrl: "https://b.example" }).preset).toBe("sub2api");
    // 新建时服务类型是第一步选的，不重认
    const c = applyPreset(blankForm(), "custom", []);
    expect(retarget({ ...c, baseUrl: "https://api.anthropic.com" }).preset).toBe("custom");
  });
});

describe("编辑 Z.ai / BigModel 上游：账号登录", () => {
  const zai = (patch: Partial<ProviderView> = {}) =>
    view({
      name: "zai",
      base_url: "https://api.z.ai/api/anthropic",
      key: "zk-signed-in",
      headers: [],
      protocol_explicit: true,
      ...patch,
    });

  it("登录换来的密钥：认成那一边的账号登录，不显示密钥那一栏", () => {
    const f = formFromView(zai({ signed_in: "zai" }));
    expect(f).toMatchObject({ preset: "zai", zaiFamily: "zai", authMode: "account" });
    expect(authModeOf(f)).toBe("account");
    expect(fieldRules(f)).toMatchObject({ auth: ["key", "account"], site: true, url: false, key: false });
    expect(signedInKey(f)).toBe(true);
    // 站点跟着账号，不能换
    expect(siteLocked(f)).toBe(true);
    // 保存不拦，密钥原样交回（core 见密钥没变，还记着是登录换来的）
    expect(connectionMissing(f, f.name, [f.name])).toBeNull();
    expect(toInput(f).key).toBe("zk-signed-in");
    expect(connectionChanged(f, zai({ signed_in: "zai" }))).toBe(false);
  });

  it("登录的是哪一边看 signed_in，不看地址", () => {
    const b = formFromView(zai({ base_url: "https://glm.proxy.example/api/anthropic", signed_in: "bigmodel" }));
    expect(b).toMatchObject({ preset: "zai", zaiFamily: "bigmodel", authMode: "account" });
    expect(b.saved?.site).toBe("bigmodel");
    // 改了地址也还是它
    expect(retarget({ ...b, baseUrl: "https://other.example" })).toMatchObject({ preset: "zai", zaiFamily: "bigmodel" });
  });

  it("登录换来的上游换成 API 密钥：显示那一把密钥，原样交回", () => {
    const f = withAuth(formFromView(zai({ signed_in: "zai" })), "key", ["zai"]);
    expect(authModeOf(f)).toBe("key");
    expect(fieldRules(f).key).toBe(true);
    expect(f.key).toBe("zk-signed-in");
    expect(toInput(f).key).toBe("zk-signed-in");
    expect(f.name).toBe("zai");
    expect(signedInKey(f)).toBe(false);
    expect(siteLocked(f)).toBe(true);
  });

  it("手填的密钥：照旧是 API 密钥，可以换成账号登录 —— 登录之后才能保存", () => {
    const f = formFromView(zai({ key: "zk-typed" }));
    expect(authModeOf(f)).toBe("key");
    expect(fieldRules(f)).toMatchObject({ auth: ["key", "account"], key: true });
    expect(siteLocked(f)).toBe(false);
    const a = withAuth(f, "account", ["zai"]);
    expect(authModeOf(a)).toBe("account");
    expect(a.name).toBe("zai");
    expect(fieldRules(a).key).toBe(false);
    expect(signedInKey(a)).toBe(false);
    expect(siteLocked(a)).toBe(true);
    expect(connectionMissing(a, a.name, [a.name])).toBe("登录后继续");
    // 换回 API 密钥：照常保存
    expect(connectionMissing(withAuth(a, "key", ["zai"]), "zai", ["zai"])).toBeNull();
  });

  it("换成账号登录时站点回到能登录的那一边", () => {
    const f = formFromView(zai({ base_url: "https://open.bigmodel.cn/api/anthropic", key: "bk" }));
    const moved = withSite(f, "zai", ["zai"]);
    expect(moved).toMatchObject({ zaiFamily: "zai", baseUrl: "https://api.z.ai/api/anthropic" });
    expect(withAuth(moved, "account", ["zai"])).toMatchObject({
      zaiFamily: "bigmodel",
      baseUrl: "https://open.bigmodel.cn/api/anthropic",
    });
    // 地址本来就是那一边的（末尾多一个 /）：原样留着
    const slash = formFromView(zai({ base_url: "https://api.z.ai/api/anthropic/", key: "zk" }));
    expect(withAuth(slash, "account", ["zai"]).baseUrl).toBe("https://api.z.ai/api/anthropic/");
  });

  it("不在标准地址上、也不是登录换来的：没有账号登录（core 不在那里换密钥）", () => {
    const f = formFromView(zai({ base_url: "https://api.z.ai/api/paas/v4", protocol: "openai-chat" }));
    expect(f.saved?.site).toBeNull();
    expect(fieldRules(f).auth).toEqual(["key"]);
  });
});

describe("写着的值一律显示", () => {
  it("官方地址配了 OAuth：给「自定义」的认证方式，OAuth 照样在、照样交回", () => {
    const f = formFromView({
      ...view({ base_url: "https://api.anthropic.com", key: null, protocol_explicit: false }),
      oauth: { endpoint: "https://auth.example/token", refresh: "rt", client_id: null, client_secret: null },
    });
    expect(f.preset).toBe("anthropic");
    expect(fieldRules(f).auth).toEqual(["key", "oauth"]);
    expect(authModeOf(f)).toBe("oauth");
    expect(toInput(f).oauth).toEqual({ mode: "keep" });
  });

  it("本机的 Ollama 写了密钥：显示，也交回；没写就不显示", () => {
    const k = formFromView(view({ base_url: "http://127.0.0.1:11434", key: "${OLLAMA_KEY}", protocol: "openai-chat" }));
    expect(k.preset).toBe("ollama");
    expect(fieldRules(k).key).toBe(true);
    expect(toInput(k).key).toBe("${OLLAMA_KEY}");
    // 清空了也不会让那一栏消失：按打开时写着的定
    expect(fieldRules({ ...k, key: "" }).key).toBe(true);
    const n = formFromView(view({ base_url: "http://127.0.0.1:11434", key: null, protocol: "openai-chat" }));
    expect(fieldRules(n).key).toBe(false);
  });

  it("写着的协议不是这种服务定的那个：给完整的协议列表", () => {
    const a = formFromView(view({ base_url: "https://api.anthropic.com", protocol: "openai-chat", protocol_explicit: true }));
    expect(fieldRules(a).protocols).toBe("all");
    expect(toInput(a).protocol).toBe("openai-chat");
    // OpenAI 没写协议（自动识别）：只给那两种的话「自动识别」就选不回来了
    const o = formFromView(view({ base_url: "https://api.openai.com", protocol: "openai-chat", protocol_explicit: false }));
    expect(fieldRules(o).protocols).toBe("all");
    // DeepSeek 没写协议：地址认不出来，按原格式转发 —— 不是这种服务定的 Anthropic，显示出来
    const d = formFromView(view({ base_url: "https://api.deepseek.com", protocol: null, protocol_explicit: false }));
    expect(fieldRules(d).protocols).toBe("all");
  });

  it("Z.ai 的地址不是标准地址：显示地址，不给站点", () => {
    const z = formFromView(view({ base_url: "https://api.z.ai/api/paas/v4", protocol: "openai-chat", protocol_explicit: true }));
    expect(z.preset).toBe("zai");
    expect(fieldRules(z)).toMatchObject({ site: false, url: true, protocols: "all" });
    // 改成标准地址：站点出现，地址那一栏留着（打开时写的是别的地址）
    expect(fieldRules({ ...z, baseUrl: "https://api.z.ai/api/anthropic" })).toMatchObject({ site: true, url: true });
  });

  it("打开了「转发客户端身份」的官方地址上游：照样显示", () => {
    const f = formFromView(view({ base_url: "https://api.deepseek.com/anthropic", forward_client_identity: true }));
    expect(fieldRules(f).clientIdentity).toBe(true);
    expect(fieldRules(formFromView(view({ base_url: "https://api.deepseek.com/anthropic" }))).clientIdentity).toBe(false);
  });

  it("编辑时不要求密钥：已保存的上游可能用自己写的请求头鉴权", () => {
    const f = formFromView(view({ base_url: "https://api.anthropic.com", key: null }));
    expect(f.headers.length).toBeGreaterThan(0);
    expect(connectionMissing(f, f.name, [f.name])).toBeNull();
    expect(toInput(f).headers).toEqual([
      { name: "anthropic-version", value: "2023-06-01" },
      { name: "X-Relay-Token", value: "rt-5d1e9f2c" },
    ]);
  });
});

describe("交给 core 的定义", () => {
  const filled = (id: string) => ({ ...applyPreset(blankForm(), id, []), name: "x", baseUrl: "https://relay.example", key: "sk-1" });

  it("余额来源跟着服务类型：Sub2API、New API、企业网关写明，其余不写（自动）", () => {
    expect(toInput(filled("sub2api")).balance).toBe("sub2api");
    expect(toInput(filled("newapi")).balance).toBe("newapi");
    expect(toInput(filled("thinkwatch")).balance).toBe("thinkwatch");
    for (const id of ["custom", "openrouter", "deepseek", "openai", "anthropic"]) {
      expect("balance" in toInput(filled(id))).toBe(false);
    }
  });

  it("编辑时余额来源原样交回：保存一次不会把「不读」或写明的来源改回自动", () => {
    for (const setting of ["off", "thinkwatch", "sub2api", "auto"] as const) {
      const p = view({ balance_setting: setting });
      const f = formFromView(p);
      expect(toInput(f).balance).toBe(setting);
      // 改了别的再保存也一样
      expect(toInput({ ...f, billing: "free", maxConcurrent: "4" }).balance).toBe(setting);
      expect(connectionChanged(f, p)).toBe(false);
    }
  });

  it("要密钥的服务没填密钥不能往下走；自定义可以不填", () => {
    const a = { ...applyPreset(blankForm(), "anthropic", []), key: "" };
    expect(connectionMissing(a, null, [])).toBe("填写 API 密钥");
    expect(connectionMissing({ ...a, key: "${ANTHROPIC_API_KEY}" }, null, [])).toBeNull();
    expect(connectionMissing({ ...applyPreset(blankForm(), "custom", []), name: "r", baseUrl: "https://r.example" }, null, [])).toBeNull();
    // OAuth 时不要密钥
    const t = withAuth({ ...filled("thinkwatch"), key: "" }, "oauth", []);
    expect(connectionMissing({ ...t, oauthRefresh: "rt", oauthEndpoint: "https://auth.example/token" }, null, [])).toBeNull();
  });

  it("Ollama 不显示密钥，也不交：别的服务上填过的不会跟过来", () => {
    const o = applyPreset({ ...blankForm(), key: "sk-left-over" }, "ollama", []);
    expect(connectionMissing(o, null, [])).toBeNull();
    expect(toInput(o).key).toBeUndefined();
  });

  it("这一格定了的协议原样交；企业网关自动识别", () => {
    expect(toInput(filled("openrouter")).protocol).toBe("openai-chat");
    expect(toInput(filled("deepseek")).protocol).toBe("anthropic");
    expect(toInput(filled("thinkwatch")).protocol).toBeUndefined();
  });
});

describe("新建时的凭据", () => {
  it("密钥可以不填：本地服务和用请求头鉴权的中转站都不需要", () => {
    const f = fresh({});
    expect(connectionMissing(f, null, [])).toBeNull();
    expect(toInput(f).key).toBeUndefined();
  });

  it("地址必填", () => {
    expect(connectionMissing(fresh({ baseUrl: " " }), null, [])).toBe("填写接口地址");
  });

  it("空行忽略；只有名称或只有值的行要补全", () => {
    expect(toInput(fresh({ headers: [headerRow()] })).headers).toEqual([]);
    expect(connectionMissing(fresh({ headers: [headerRow("", "v")] }), null, [])).toBe(
      "填写请求头名称",
    );
    expect(connectionMissing(fresh({ headers: [headerRow("X-Org", " ")] }), null, [])).toBe(
      "填写请求头「X-Org」的值",
    );
  });
});

describe("Bedrock 上游", () => {
  const bedrockView = (aws: ProviderView["aws"]) =>
    view({
      name: "bedrock",
      base_url: "https://bedrock-runtime.us-west-2.amazonaws.com",
      key: null,
      auth_header: "authorization",
      headers: [],
      protocol: "bedrock",
      protocol_explicit: false,
      aws,
      region: "us-west-2",
    });

  it("访问密钥原样回填，原样交回；空着的会话令牌不交", () => {
    const f = formFromView(
      bedrockView({ access_key_id: "${AWS_ACCESS_KEY_ID}", secret_access_key: "${AWS_SECRET_ACCESS_KEY}" }),
    );
    expect(f.authMode).toBe("aws-keys");
    const input = toInput(f);
    expect(input.aws).toEqual({
      access_key_id: "${AWS_ACCESS_KEY_ID}",
      secret_access_key: "${AWS_SECRET_ACCESS_KEY}",
      session_token: undefined,
      region: undefined,
    });
    expect(input.key).toBeUndefined();
    expect(input.oauth).toEqual({ mode: "none" });
  });

  it("profile 只交名字", () => {
    const f = formFromView(bedrockView({ profile: "dev" }));
    expect(f.authMode).toBe("aws-profile");
    expect(toInput(f).aws).toEqual({ profile: "dev", region: undefined });
  });

  it("只交当前这种认证方式的：切到 API 密钥，访问密钥不交", () => {
    const f: UpstreamForm = {
      ...formFromView(bedrockView({ access_key_id: "AKIA", secret_access_key: "s" })),
      authMode: "key",
      key: "${AWS_BEARER_TOKEN_BEDROCK}",
    };
    const input = toInput(f);
    expect(input.aws).toBeUndefined();
    expect(input.key).toBe("${AWS_BEARER_TOKEN_BEDROCK}");
  });

  it("换成别的协议之后，访问密钥这种认证方式不再生效；Bedrock 不收 OAuth", () => {
    const keys: UpstreamForm = {
      ...blankForm(),
      name: "x",
      baseUrl: "https://api.openai.com",
      protocol: "openai-chat",
      authMode: "aws-keys",
      awsKeyId: "AKIA",
      awsSecret: "s",
    };
    expect(toInput(keys).aws).toBeUndefined();
    const oauth: UpstreamForm = {
      ...blankForm(),
      name: "x",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
      authMode: "oauth",
      oauthRefresh: "rt",
      oauthEndpoint: "https://auth.example/token",
    };
    expect(toInput(oauth).oauth).toEqual({ mode: "none" });
  });

  it("缺的是哪一样说清楚", () => {
    const base: UpstreamForm = {
      ...blankForm(),
      name: "b",
      baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com",
    };
    expect(connectionMissing({ ...base, authMode: "aws-keys", awsKeyId: "AKIA" }, null, [])).toBe(
      "填写访问密钥 ID 与私有访问密钥",
    );
    expect(connectionMissing({ ...base, authMode: "aws-profile" }, null, [])).toBe("填写 AWS profile 的名称");
    expect(connectionMissing({ ...base, authMode: "aws-profile", awsProfile: "dev" }, null, [])).toBeNull();
  });

  it("改了访问密钥就是改了连接", () => {
    const v = bedrockView({ access_key_id: "AKIA", secret_access_key: "s" });
    const f = formFromView(v);
    expect(connectionChanged(f, v)).toBe(false);
    expect(connectionChanged({ ...f, awsSecret: "s2" }, v)).toBe(true);
  });
});

describe("按客户端原来的 Bedrock 设置新建", () => {
  it("API 密钥：标准地址、变量引用原样交出去", () => {
    const f = formFromDraft(
      { region: "us-west-2", auth: { kind: "key", key: "${AWS_BEARER_TOKEN_BEDROCK}" } },
      ["bedrock"],
    );
    expect(f.preset).toBe("bedrock");
    expect(f.name).toBe("bedrock-2");
    const input = toInput(f);
    expect(input.protocol).toBe("bedrock");
    expect(input.base_url).toBe("https://bedrock-runtime.us-west-2.amazonaws.com");
    expect(input.key).toBe("${AWS_BEARER_TOKEN_BEDROCK}");
    expect(input.aws).toBeUndefined();
  });

  it("访问密钥加自己的地址：区域另写", () => {
    const f = formFromDraft(
      {
        region: "eu-central-1",
        base_url: "https://vpce-1.bedrock-runtime.eu-central-1.vpce.amazonaws.com",
        auth: {
          kind: "keys",
          access_key_id: "${AWS_ACCESS_KEY_ID}",
          secret_access_key: "${AWS_SECRET_ACCESS_KEY}",
          session_token: "${AWS_SESSION_TOKEN}",
        },
      },
      [],
    );
    expect(f.name).toBe("bedrock");
    expect(toInput(f).aws).toEqual({
      access_key_id: "${AWS_ACCESS_KEY_ID}",
      secret_access_key: "${AWS_SECRET_ACCESS_KEY}",
      session_token: "${AWS_SESSION_TOKEN}",
      region: "eu-central-1",
    });
    expect(toInput(f).key).toBeUndefined();
  });

  it("profile 只交名字；没找到凭据的留空给人填", () => {
    const p = toInput(formFromDraft({ region: "us-east-1", auth: { kind: "profile", profile: "dev" } }, []));
    expect(p.aws).toEqual({ profile: "dev", region: undefined });
    const none = formFromDraft({ region: "ap-northeast-1", auth: { kind: "none" } }, []);
    expect(none.authMode).toBe("key");
    expect(toInput(none).key).toBeUndefined();
  });
});

describe("编辑对话框里手动添加的模型", () => {
  it("回填配置里的手动清单，保存时和别的设置一起交回", () => {
    const f = formFromView(view({ models: ["gpt-6-luna"] }));
    expect(f.manualModels).toEqual(["gpt-6-luna"]);
    const added = { ...f, ...withManualAdded(f, ["o5"]) };
    expect(toInput(added).models).toEqual(["gpt-6-luna", "o5"]);
    const removed = { ...added, ...withManualRemoved(added, "gpt-6-luna", false) };
    expect(toInput(removed).models).toEqual(["o5"]);
  });

  it("全部模型：新加的本来就在范围里，留着的那份指定清单不动", () => {
    const f = fresh({ scope: "all", scopeList: ["a"] });
    const patch = withManualAdded(f, ["x"]);
    expect(patch).toEqual({ manualModels: ["x"] });
    expect(inScope({ ...f, ...patch }, "x")).toBe(true);
  });

  it("指定模型：新加的一并勾上，不会加完了却悄悄不生效", () => {
    const f = fresh({ scope: "some", scopeList: ["a"], manualModels: ["m"] });
    const next = { ...f, ...withManualAdded(f, ["x", "y"]) };
    expect(next.manualModels).toEqual(["m", "x", "y"]);
    expect(next.scopeList).toEqual(["a", "x", "y"]);
    expect(inScope(next, "x") && inScope(next, "y")).toBe(true);
    expect(toInput(next).models_only).toEqual(["a", "x", "y"]);
  });

  it("指定模型里的通配规则已经覆盖的，不再写一遍", () => {
    const f = fresh({ scope: "some", scopeList: ["gpt-*"] });
    expect(withManualAdded(f, ["gpt-6-luna", "o5"]).scopeList).toEqual(["gpt-*", "o5"]);
    expect(withManualAdded(f, ["GPT-6"])).toEqual({ manualModels: ["GPT-6"] });
  });

  it("移除上游没列的：这一行没了，指定清单里写着它的那一项一起去掉（通配规则不动）", () => {
    const f = fresh({ scope: "some", scopeList: ["gpt-*", "x", "a"], manualModels: ["x", "gpt-6"] });
    expect(withManualRemoved(f, "x", false)).toEqual({ manualModels: ["gpt-6"], scopeList: ["gpt-*", "a"] });
    expect(withManualRemoved(f, "gpt-6", false)).toEqual({ manualModels: ["x"], scopeList: ["gpt-*", "x", "a"] });
  });

  it("移除上游也列了的：只是不再是手动添加的，启用范围不动", () => {
    const f = fresh({ scope: "some", scopeList: ["a"], manualModels: ["a"] });
    expect(withManualRemoved(f, "a", true)).toEqual({ manualModels: [] });
  });

  it("指定模型里唯一启用的那个被移除了：要求至少选一个，不让存一个空的范围", () => {
    const f = fresh({ scope: "some", scopeList: ["x"], manualModels: ["x"] });
    const next = { ...f, ...withManualRemoved(f, "x", false) };
    expect(next.scopeList).toEqual([]);
    expect(modelsMissing(next)).toBe("至少选择一个模型");
  });
});
