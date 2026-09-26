import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ProviderView } from "@/types";
import {
  blankForm,
  connectionChanged,
  connectionMissing,
  formFromView,
  headerRow,
  oauthKept,
  toInput,
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
