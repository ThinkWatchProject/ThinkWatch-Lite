import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ImportProposal, ProviderView } from "@/types";
import { ZAI_ENDPOINTS } from "./presets";
import {
  advancedNonDefault,
  applyPreset,
  authModeOf,
  blankForm,
  connectionMissing,
  fieldRules,
  formFromImport,
  formFromView,
  importHosts,
  importPlainText,
  newSheetName,
  retarget,
  sheetMissing,
  sheetToCreate,
  toInput,
  withImportedService,
} from "./upstreamForm";

// 断言按中文写：不随跑测试那台机器的系统语言变
beforeAll(() => setLang("zh"));

/** 一份提议：Rust 侧校验过的形状（`import_link::parse`），没写的照它的默认 */
function proposal(patch: Partial<ImportProposal>): ImportProposal {
  return {
    service: "custom",
    auth: "key",
    site: null,
    name: null,
    base_url: null,
    protocol: null,
    key: null,
    oauth: null,
    region: null,
    aws: null,
    headers: [],
    client_identity: false,
    concurrency: null,
    limits: [],
    balance: null,
    models: [],
    models_only: null,
    specs: [],
    billing: null,
    price_sheet: null,
    ...patch,
  };
}

const relay = proposal({
  service: "sub2api",
  name: "hk-relay",
  base_url: "https://relay.example",
  protocol: "openai-responses",
  key: "sk-relay",
  headers: [{ name: "X-Group", value: "vip" }],
  client_identity: true,
  concurrency: 8,
  limits: [
    { per: "minute", every: 5, measure: "tokens", max: 10_000_000, cache_reads: false },
    { per: "day", every: 1, measure: "cost", max: 20_000_000, cache_reads: false },
  ],
  models: ["gpt-5", "gpt-5-mini"],
  models_only: ["gpt-5*"],
  specs: [{ model: "gpt-5", context_window: 400000, max_output_tokens: null, reasoning: true, image_input: null }],
  billing: "per-token",
  price_sheet: {
    multiplier: 1.2,
    prices: [{ model: "gpt-5", input: 1.25, output: 10, cache_read: 0.125, cache_write_5m: 1.25, cache_write_1h: 1.25 }],
  },
});

describe("按导入链接预填新建对话框", () => {
  it("企业网关：名称、地址、密钥照链接", () => {
    const f = formFromImport(
      proposal({ service: "thinkwatch", name: "thinkwatch", base_url: "https://gw.corp.example", key: "tw-k" }),
      [],
    );
    expect(f).toMatchObject({
      preset: "thinkwatch",
      name: "thinkwatch",
      baseUrl: "https://gw.corp.example",
      protocol: "",
      authMode: "key",
      key: "tw-k",
      saved: null,
    });
    // 余额来源由服务类型定
    expect(toInput(f).balance).toBe("thinkwatch");
    expect(connectionMissing(f, null, [])).toBeNull();
  });

  it("中转站给齐的几项都进表单，交给 core 的也是这几项", () => {
    const f = formFromImport(relay, []);
    expect(f.limits.map((r) => [r.per, r.every, r.measure, r.max])).toEqual([
      ["minute", "5", "tokens", "10000000"],
      ["day", "1", "cost", "20.00"],
    ]);
    expect(f).toMatchObject({
      preset: "sub2api",
      maxConcurrent: "8",
      forwardClientIdentity: true,
      manualModels: ["gpt-5", "gpt-5-mini"],
      scope: "some",
      scopeList: ["gpt-5*"],
      billing: "per-token",
    });
    expect(advancedNonDefault(f)).toBe(true);
    const input = toInput(f);
    expect(input).toMatchObject({
      name: "hk-relay",
      base_url: "https://relay.example",
      key: "sk-relay",
      protocol: "openai-responses",
      headers: [{ name: "X-Group", value: "vip" }],
      forward_client_identity: true,
      max_concurrent: 8,
      limits: relay.limits,
      models: ["gpt-5", "gpt-5-mini"],
      models_only: ["gpt-5*"],
      billing: "per-token",
      balance: "sub2api",
    });
    // 新价目表不在交给 core 的上游定义里：「创建」时先建它，再让上游用它
    expect(input.pricing).toBeUndefined();
  });

  it("链接给的名称被占用时照样填，由人改一个；没给的按新建时的规矩起", () => {
    const taken = ["hk-relay", "relay", "anthropic", "chatgpt"];
    const f = formFromImport(relay, taken);
    expect(f.name).toBe("hk-relay");
    expect(connectionMissing(f, null, taken)).toBe("名称「hk-relay」已被其他上游使用");
    expect(formFromImport(proposal({ base_url: "https://api.relay.example/v1" }), taken).name).toBe("relay-2");
    expect(formFromImport(proposal({ service: "anthropic" }), taken).name).toBe("anthropic-2");
    expect(formFromImport(proposal({ service: "openai", auth: "account" }), taken).name).toBe("chatgpt-2");
    expect(formFromImport(proposal({ service: "zai", auth: "account", site: "zai" }), taken).name).toBe("zai");
  });

  it("有自己地址的服务：没给地址就是它的，协议、计费照这一格", () => {
    const a = formFromImport(proposal({ service: "anthropic", key: "sk-ant" }), []);
    expect(a).toMatchObject({ baseUrl: "https://api.anthropic.com", protocol: "anthropic", billing: "per-token" });
    const o = formFromImport(proposal({ service: "ollama" }), []);
    expect(o).toMatchObject({ baseUrl: "http://127.0.0.1:11434", billing: "free" });
    expect(fieldRules(o).key).toBe(false);
  });

  it("Bedrock：区域定标准地址；VPC 端点另写签名的区域；访问密钥原样", () => {
    const keys = { access_key_id: "AKIAIOSFODNN7EXAMPLE", secret_access_key: "s3cr3t", session_token: "tok" };
    const std = formFromImport(proposal({ service: "bedrock", auth: "aws-keys", region: "eu-central-1", aws: keys }), []);
    expect(std).toMatchObject({
      baseUrl: "https://bedrock-runtime.eu-central-1.amazonaws.com",
      awsRegion: "",
      authMode: "aws-keys",
      awsKeyId: keys.access_key_id,
      awsSecret: keys.secret_access_key,
      awsToken: "tok",
    });
    expect(toInput(std).aws).toEqual({ ...keys, region: undefined });
    const vpc = formFromImport(
      proposal({
        service: "bedrock",
        auth: "aws-keys",
        base_url: "https://vpce-1.bedrock-runtime.us-east-1.vpce.amazonaws.com",
        region: "us-east-1",
        aws: keys,
      }),
      [],
    );
    expect(vpc.awsRegion).toBe("us-east-1");
    expect(toInput(vpc).aws?.region).toBe("us-east-1");
    const plain = formFromImport(proposal({ service: "bedrock", key: "ABSK" }), []);
    expect(plain.baseUrl).toBe("https://bedrock-runtime.us-east-1.amazonaws.com");
    expect(toInput(plain).key).toBe("ABSK");
  });

  it("自定义的 OAuth：凭据照链接，检测用的 access token 不在链接里", () => {
    const f = formFromImport(
      proposal({
        base_url: "https://api.relay.example",
        auth: "oauth",
        oauth: { endpoint: "https://auth.relay.example/oauth/token", refresh: "rt", client_id: "cid", client_secret: null },
      }),
      [],
    );
    expect(authModeOf(f)).toBe("oauth");
    expect(toInput(f).oauth).toEqual({
      mode: "set",
      refresh: "rt",
      endpoint: "https://auth.relay.example/oauth/token",
      client_id: "cid",
      client_secret: undefined,
      access: undefined,
    });
  });

  it("账号登录：落在登录那一步，没有凭据；Z.ai / BigModel 按站点", () => {
    const c = formFromImport(proposal({ service: "openai", auth: "account" }), []);
    expect(c).toMatchObject({ preset: "openai", authMode: "account", name: "chatgpt", key: "" });
    expect(connectionMissing(c, null, [])).toBe("登录后继续");
    const z = formFromImport(proposal({ service: "zai", auth: "account", site: "zai" }), []);
    expect(z).toMatchObject({ zaiFamily: "zai", baseUrl: ZAI_ENDPOINTS.zai, name: "zai" });
    const k = formFromImport(proposal({ service: "zai", site: "bigmodel", key: "zk" }), []);
    expect(k).toMatchObject({ zaiFamily: "bigmodel", baseUrl: ZAI_ENDPOINTS.bigmodel, name: "bigmodel" });
    expect(fieldRules(k).url).toBe(false);
  });

  it("自定义：余额来源照链接，显示在高级设置里", () => {
    const f = formFromImport(proposal({ base_url: "https://relay.example", balance: "newapi" }), []);
    expect(fieldRules(f).balance).toBe(true);
    expect(advancedNonDefault(f)).toBe(true);
    expect(toInput(f).balance).toBe("newapi");
  });
});

describe("导入的对话框顶上那一句说的主机", () => {
  it("请求和密钥发往的主机；Token 端点在别的主机上时也写", () => {
    expect(importHosts(formFromImport(relay, []))).toEqual(["relay.example"]);
    const oauth = (endpoint: string) =>
      importHosts(
        formFromImport(
          proposal({
            base_url: "https://api.relay.example",
            auth: "oauth",
            oauth: { endpoint, refresh: "r", client_id: null, client_secret: null },
          }),
          [],
        ),
      );
    expect(oauth("https://auth.relay.example/token")).toEqual(["api.relay.example", "auth.relay.example"]);
    expect(oauth("https://api.relay.example/token")).toEqual(["api.relay.example"]);
  });

  it("带端口的写上端口，IDN 写成 ASCII", () => {
    expect(importHosts(formFromImport(proposal({ base_url: "http://[::1]:9" }), []))).toEqual(["[::1]:9"]);
    expect(importHosts(formFromImport(proposal({ base_url: "https://例子.example" }), []))).toEqual([
      "xn--fsqu00a.example",
    ]);
  });

  it("登录账号：登录之后请求发往的那一边；地址清空了就只说来自导入链接", () => {
    expect(importHosts(formFromImport(proposal({ service: "openai", auth: "account" }), []))).toEqual(["chatgpt.com"]);
    expect(importHosts(formFromImport(proposal({ service: "zai", auth: "account", site: "bigmodel" }), []))).toEqual([
      "open.bigmodel.cn",
    ]);
    expect(importHosts({ ...formFromImport(relay, []), baseUrl: "" })).toEqual([]);
  });
});

describe("内网的明文地址", () => {
  const at = (base_url: string, endpoint?: string) =>
    importPlainText(
      formFromImport(
        proposal({
          base_url,
          ...(endpoint
            ? { auth: "oauth", oauth: { endpoint, refresh: "r", client_id: null, client_secret: null } }
            : {}),
        }),
        [],
      ),
    );

  it("不是本机的 http:// 多说一句不加密", () => {
    expect(at("http://10.0.0.5:8080")).toBe(true);
    expect(at("http://gw.corp")).toBe(true);
    expect(at("http://[fd00::1]")).toBe(true);
    expect(at("https://gw.corp", "http://sso.corp/token")).toBe(true);
  });

  it("https、本机回环地址、登录账号不说", () => {
    expect(at("https://relay.example")).toBe(false);
    expect(at("http://127.0.0.1:8317")).toBe(false);
    expect(at("http://localhost:3000")).toBe(false);
    expect(at("http://[::1]:9")).toBe(false);
    expect(at("https://gw.corp", "https://sso.corp/token")).toBe(false);
    expect(importPlainText(formFromImport(proposal({ service: "openai", auth: "account" }), []))).toBe(false);
  });
});

describe("导入的对话框里退回第一步换一种服务", () => {
  const pick = (id: string, p = relay) => {
    const f = formFromImport(p, []);
    return withImportedService(f, applyPreset(f, id, []), p);
  };

  it("换成另一种没有固定地址的：地址、能选的协议留着", () => {
    const f = pick("custom");
    expect(f).toMatchObject({ preset: "custom", baseUrl: "https://relay.example", protocol: "openai-responses" });
    expect(toInput(f).key).toBe("sk-relay");
  });

  it("换成有自己地址的：地址、协议是那一格的，链接写明的计费方式留着；它不收的几项不交给 core", () => {
    const f = pick("anthropic", { ...relay, billing: "free", price_sheet: null });
    expect(f).toMatchObject({ baseUrl: "https://api.anthropic.com", protocol: "anthropic", billing: "free" });
    // 转发客户端身份 Anthropic 不给开：不交
    expect(toInput(f).forward_client_identity).toBe(false);
    expect(toInput(pick("ollama")).key).toBeUndefined();
  });

  it("余额来源只有自定义收", () => {
    const custom = proposal({ base_url: "https://relay.example", balance: "off" });
    expect(pick("newapi", custom).balance).toBeNull();
    expect(toInput(pick("newapi", custom)).balance).toBe("newapi");
    expect(pick("custom", custom).balance).toBe("off");
  });
});

describe("导入链接带来的新价目表", () => {
  it("名称跟着上游，改过就用改的；只在选着它、按量计费时创建", () => {
    const f = formFromImport(relay, []);
    expect(sheetToCreate(f)).toEqual({
      name: "hk-relay",
      multiplier: 1.2,
      models: { "gpt-5": { input: 1.25, output: 10, cache_read: 0.125, cache_write_5m: 1.25, cache_write_1h: 1.25 } },
    });
    expect(newSheetName({ ...f, name: "renamed" })).toBe("renamed");
    expect(newSheetName({ ...f, newSheet: { ...f.newSheet!, name: "fee" } })).toBe("fee");
    expect(sheetToCreate({ ...f, billing: "free" })).toBeNull();
    expect(sheetToCreate({ ...f, newSheet: { ...f.newSheet!, chosen: false } })).toBeNull();
    expect(sheetToCreate(formFromImport({ ...relay, price_sheet: null }, []))).toBeNull();
  });

  it("名称空着、被占用：由人改一个", () => {
    const f = formFromImport(relay, []);
    expect(sheetMissing(f, [])).toBeNull();
    expect(sheetMissing(f, [{ name: "hk-relay" }])).toBe("价目表名称「hk-relay」已被使用");
    expect(sheetMissing({ ...f, name: "" }, [])).toBe("填写价目表名称");
    expect(sheetMissing({ ...f, billing: "free" }, [{ name: "hk-relay" }])).toBeNull();
  });
});

describe("余额来源", () => {
  const view = (patch: Partial<ProviderView>): ProviderView =>
    ({
      name: "relay",
      base_url: "https://relay.example",
      key: "k",
      auth_header: "authorization",
      headers: [],
      oauth: null,
      protocol: "openai-chat",
      protocol_explicit: true,
      forward_client_identity: false,
      proxy: "direct",
      on_proxy_fail: "fail",
      models: [],
      models_only: null,
      model_source: "discovered",
      model_status: "listed",
      model_fetching: false,
      model_count: 0,
      disabled: false,
      health: "ok",
      billing: "per-token",
      references: [],
      pricing: null,
      balance_setting: "auto",
      balance: null,
      signed_in: null,
      ...patch,
    }) as ProviderView;

  it("只有自定义显示；不是自动识别时高级设置展开", () => {
    const custom = applyPreset(blankForm(), "custom", []);
    expect(fieldRules(custom).balance).toBe(true);
    expect(advancedNonDefault(custom)).toBe(false);
    expect(advancedNonDefault({ ...custom, balance: "auto" })).toBe(false);
    expect(advancedNonDefault({ ...custom, balance: "off" })).toBe(true);
    for (const id of ["anthropic", "sub2api", "thinkwatch", "ollama"]) {
      expect(fieldRules(applyPreset(blankForm(), id, [])).balance, id).toBe(false);
    }
  });

  it("新建时换走自定义，选过的余额来源不跟过去", () => {
    const f = { ...applyPreset(blankForm(), "custom", []), balance: "moonshot" as const };
    expect(applyPreset(f, "anthropic", []).balance).toBeNull();
    expect(toInput(applyPreset(f, "sub2api", [])).balance).toBe("sub2api");
  });

  it("编辑自定义上游时改成中转平台的来源：认成那一种服务，这一栏照样在", () => {
    const f = formFromView(view({}));
    expect(f.preset).toBe("custom");
    const next = retarget({ ...f, balance: "sub2api" });
    expect(next.preset).toBe("sub2api");
    expect(fieldRules(next).balance).toBe(true);
    expect(toInput(next).balance).toBe("sub2api");
    // 打开时就是中转平台的：没有这一栏
    expect(fieldRules(formFromView(view({ balance_setting: "sub2api" }))).balance).toBe(false);
  });
});
