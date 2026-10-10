import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ProviderView } from "@/types";
import {
  applyPreset,
  blankForm,
  connectionChanged,
  connectionMissing,
  formFromDraft,
  formFromView,
  headerRow,
  inScope,
  modelsMissing,
  oauthKept,
  toInput,
  withManualAdded,
  withManualRemoved,
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
