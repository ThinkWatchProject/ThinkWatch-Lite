import { describe, expect, it } from "vitest";
import type { ProviderView } from "@/types";
import {
  blankForm,
  connectionChanged,
  connectionMissing,
  formFromView,
  headerRow,
  toInput,
  type UpstreamForm,
} from "./upstreamForm";

function view(patch: Partial<ProviderView> = {}): ProviderView {
  return {
    name: "relay",
    base_url: "https://relay.example",
    base_url_masked: false,
    key: { display: "sk-…Q3xA" },
    auth_header: "x-api-key",
    headers: [
      { name: "anthropic-version", value: "2023-06-01", masked: false },
      { name: "X-Relay-Token", value: "rt-…9f2c", masked: true },
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
    billing: null,
    billing_effective: "per-token",
    trust: "untrusted",
    trust_explicit: false,
    redact: [],
    redact_explicit: false,
    references: [],
    pricing: null,
    ...patch,
  };
}

function fresh(patch: Partial<UpstreamForm>): UpstreamForm {
  return { ...blankForm(), name: "relay", baseUrl: "https://relay.example", ...patch };
}

describe("编辑时的凭据", () => {
  it("没动过：密钥和打过码的请求头沿用，公开的请求头原样发回", () => {
    const input = toInput(formFromView(view()), true);
    expect(input.key).toEqual({ mode: "keep" });
    expect(input.oauth).toEqual({ mode: "none" });
    expect(input.headers).toEqual([
      { name: "anthropic-version", value: "2023-06-01" },
      // 不给值 = 沿用。发回打过码的值会把码写进配置
      { name: "X-Relay-Token" },
    ]);
  });

  it("打过码的请求头：名称不分大小写，改了名就不再沿用", () => {
    const f = formFromView(view());
    const token = f.headers[1]!;
    const renamed = { ...f, headers: [{ ...token, name: "x-relay-token" }] };
    expect(toInput(renamed, true).headers).toEqual([{ name: "x-relay-token" }]);

    const other = { ...f, headers: [{ ...token, name: "X-Relay-Key" }] };
    expect(connectionMissing(other, "relay", ["relay"])).toBe("填写请求头「X-Relay-Key」的值");
  });

  it("填了新密钥就换；点了移除就删", () => {
    const f = formFromView(view());
    expect(toInput({ ...f, key: " sk-new " }, true).key).toEqual({ mode: "set", value: "sk-new" });
    expect(toInput({ ...f, keySaved: false }, true).key).toEqual({ mode: "none" });
  });

  it("环境变量引用回填，原样保存等于沿用", () => {
    const p = view({ key: { display: "环境变量 ${RELAY_KEY}", env: "RELAY_KEY" } });
    const f = formFromView(p);
    expect(f.key).toBe("${RELAY_KEY}");
    expect(connectionChanged(f, p)).toBe(false);
  });

  it("OAuth 没点更换就整份沿用；改成 API 密钥时删掉 OAuth", () => {
    const p = view({ key: null, oauth: { endpoint: "https://auth.example/token" } });
    const f = formFromView(p);
    expect(f.authMode).toBe("oauth");
    expect(toInput(f, true).oauth).toEqual({ mode: "keep" });
    expect(toInput(f, true).key).toEqual({ mode: "none" });
    expect(connectionMissing(f, "relay", ["relay"])).toBeNull();

    const switched = { ...f, authMode: "key" as const, key: "sk-new" };
    expect(toInput(switched, true).oauth).toEqual({ mode: "none" });
    expect(toInput(switched, true).key).toEqual({ mode: "set", value: "sk-new" });
  });

  it("从 API 密钥改成 OAuth：必须填新的 OAuth 凭据，原密钥删掉", () => {
    const f = { ...formFromView(view()), authMode: "oauth" as const };
    expect(connectionMissing(f, "relay", ["relay"])).toBe("填写 Refresh Token 与 Token 端点");
    const filled = { ...f, oauthRefresh: "rt", oauthEndpoint: "https://auth.example/token" };
    expect(toInput(filled, true).key).toEqual({ mode: "none" });
    expect(toInput(filled, true).oauth).toMatchObject({ mode: "set", refresh: "rt" });
  });

  it("改了请求头、协议或代理都算连接改过", () => {
    const p = view();
    const f = formFromView(p);
    expect(connectionChanged(f, p)).toBe(false);
    expect(connectionChanged({ ...f, headers: [...f.headers, headerRow("X-Org", "o-1")] }, p)).toBe(true);
    expect(connectionChanged({ ...f, protocol: "openai-chat" }, p)).toBe(true);
    expect(connectionChanged({ ...f, proxy: "system" }, p)).toBe(true);
  });
});

describe("新建时的凭据", () => {
  it("密钥可以不填：本地服务和用请求头鉴权的中转站都不需要", () => {
    const f = fresh({});
    expect(connectionMissing(f, null, [])).toBeNull();
    expect(toInput(f, false).key).toEqual({ mode: "none" });
  });

  it("空行忽略；只有名称或只有值的行要补全", () => {
    expect(toInput(fresh({ headers: [headerRow()] }), false).headers).toEqual([]);
    expect(connectionMissing(fresh({ headers: [headerRow("", "v")] }), null, [])).toBe(
      "填写请求头名称",
    );
    expect(connectionMissing(fresh({ headers: [headerRow("X-Org", " ")] }), null, [])).toBe(
      "填写请求头「X-Org」的值",
    );
  });
});
