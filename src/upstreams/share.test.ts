import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ModelRow, PriceSheetInput, ProviderView } from "@/types";
import { inputsOf } from "@/keys/limits";
import { presetById } from "./presets";
import { carried, dropParam, shareProposal } from "./share";
import { authModeOf, formFromImport, formFromView, type UpstreamForm } from "./upstreamForm";

beforeAll(() => setLang("zh"));

function view(patch: Partial<ProviderView> = {}): ProviderView {
  return {
    name: "relay",
    base_url: "https://relay.example/v1",
    key: "sk-relay-Q3xA",
    auth_header: "x-api-key",
    headers: [{ name: "X-Team", value: "core" }],
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
    limits: [],
    balance_setting: "auto",
    balance: null,
    signed_in: null,
    sync_excluded: false,
    ...patch,
  };
}

const NONE = { models: null, sheet: null };

/**
 * 接收方的新建对话框里看到的，和分享方这个上游的编辑对话框里写的，是同一份：服务类型、地址、
 * 实际的协议、认证方式与凭据、请求头、高级设置、模型、计费。代理、停用状态这些链接本来就不带
 */
function shape(f: UpstreamForm) {
  const preset = presetById(f.preset);
  return {
    preset: f.preset,
    url: f.baseUrl.trim().replace(/\/+$/, ""),
    protocol: f.protocol || preset.protocol,
    auth: authModeOf(f),
    key: f.key,
    headers: f.headers.map((h) => [h.name, h.value]),
    oauth: authModeOf(f) === "oauth" ? [f.oauthEndpoint, f.oauthRefresh, f.oauthClientId, f.oauthClientSecret] : null,
    aws: authModeOf(f) === "aws-keys" ? [f.awsKeyId, f.awsSecret, f.awsToken, f.awsRegion] : null,
    identity: f.forwardClientIdentity,
    concurrency: f.maxConcurrent,
    limits: inputsOf(f.limits),
    manual: f.manualModels,
    scope: f.scope,
    scopeList: f.scopeList,
    billing: f.billing,
    balance: f.balance ?? preset.balance ?? "auto",
    name: f.name,
  };
}

/** 分享出去、按链接新建，表单和原来的一样 */
function roundTrips(p: ProviderView) {
  const { proposal } = shareProposal(p, NONE, true);
  expect(shape(formFromImport(proposal, []))).toEqual(shape(formFromView(p)));
}

describe("分享上游：链接里的提议", () => {
  it("各种服务分享出去再按链接新建，表单和原来的一样", () => {
    roundTrips(view({ balance_setting: "sub2api", base_url: "https://relay.example", protocol: null, protocol_explicit: false, forward_client_identity: true, max_concurrent: 8, models: ["m-1"], models_only: ["claude-*"] }));
    roundTrips(view({ name: "anthropic", base_url: "https://api.anthropic.com", headers: [], protocol: "anthropic", protocol_explicit: false }));
    roundTrips(view({ name: "openai", base_url: "https://api.openai.com", headers: [], protocol: "openai-responses", protocol_explicit: true }));
    roundTrips(view({ name: "zai", base_url: "https://api.z.ai/api/anthropic", headers: [], protocol: null, protocol_explicit: false }));
    roundTrips(view({ name: "ollama", base_url: "http://127.0.0.1:11434", key: null, headers: [], protocol: null, protocol_explicit: false, billing: "free" }));
    roundTrips(view({ name: "lan-ollama", base_url: "http://192.168.1.20:11434", key: null, headers: [], protocol: null, protocol_explicit: false, billing: "per-token" }));
    roundTrips(view({ balance_setting: "newapi", protocol: "openai-chat" }));
    roundTrips(
      view({
        limits: [
          { per: "minute", every: 5, measure: "tokens", max: 10_000_000, cache_reads: false, used: 4_200_000, reached: false },
          { per: "day", every: 1, measure: "cost", max: 5_500_000, cache_reads: false, used: 0, resets_at_ms: 1, reached: false },
          { per: "week", every: 1, measure: "tokens", max: 900_000, cache_reads: true, used: 0, reached: false },
        ],
      }),
    );
    roundTrips(view({ balance_setting: "openrouter", protocol: null, protocol_explicit: false }));
    roundTrips(
      view({
        key: null,
        headers: [],
        oauth: { endpoint: "https://auth.example/token", refresh: "rt-1", client_id: "cid", client_secret: "cs" },
      }),
    );
    roundTrips(
      view({
        name: "bedrock",
        base_url: "https://bedrock-runtime.ap-northeast-1.amazonaws.com",
        key: null,
        headers: [],
        protocol: "bedrock",
        protocol_explicit: false,
        aws: { access_key_id: "AKIAIOSFODNN7EXAMPLE", secret_access_key: "secret", session_token: null, region: null },
      }),
    );
    roundTrips(
      view({
        name: "bedrock-vpc",
        base_url: "https://vpce-1.bedrock-runtime.us-west-2.vpce.amazonaws.com",
        key: null,
        headers: [],
        protocol: "bedrock",
        protocol_explicit: true,
        aws: { access_key_id: "AKIAIOSFODNN7EXAMPLE", secret_access_key: "secret", session_token: "tok", region: "us-west-2" },
      }),
    );
  });

  it("地址不是那种服务的标准写法：按「自定义」，地址和协议照写", () => {
    const p = view({ name: "ds", base_url: "https://api.deepseek.com", protocol: "openai-chat", headers: [] });
    const { proposal } = shareProposal(p, NONE, true);
    expect(proposal.service).toBe("custom");
    expect(proposal.base_url).toBe("https://api.deepseek.com");
    expect(proposal.protocol).toBe("openai-chat");
  });

  it("服务自己定的不写：官方地址、固定的协议、缺省的计费方式", () => {
    const { proposal } = shareProposal(
      view({ name: "anthropic", base_url: "https://api.anthropic.com/", headers: [], protocol: "anthropic" }),
      NONE,
      true,
    );
    expect(proposal).toMatchObject({ service: "anthropic", base_url: null, protocol: null, billing: null, key: "sk-relay-Q3xA" });
  });

  it("不含密钥时密钥、请求头、OAuth 都不写，说明不包含密钥", () => {
    const { proposal, left } = shareProposal(view(), NONE, false);
    expect(proposal.key).toBeNull();
    expect(proposal.headers).toEqual([]);
    expect(left).toContain("secrets");
    const o = shareProposal(
      view({ key: null, headers: [], oauth: { endpoint: "https://a.example/t", refresh: "rt", client_id: null, client_secret: null } }),
      NONE,
      false,
    );
    expect(o.proposal.auth).toBe("key");
    expect(o.proposal.oauth).toBeNull();
  });

  it("`${变量名}` 写的值不进链接，说明原因", () => {
    const { proposal, left } = shareProposal(view({ key: "${RELAY_KEY}" }), NONE, true);
    expect(proposal.key).toBeNull();
    expect(left).toContain("env");
  });

  it("账号登录的上游只写服务和登录方式；出站代理、路由、停用状态写明不包含", () => {
    const chatgpt = shareProposal(
      view({ name: "chatgpt", base_url: "https://chatgpt.com/backend-api/codex", protocol: "chatgpt", key: null, headers: [{ name: "ChatGPT-Account-Id", value: "acc" }], proxy: "clash", disabled: true, references: [{ kind: "group", group: "main" }] }),
      NONE,
      true,
    );
    expect(chatgpt.proposal).toMatchObject({ service: "openai", auth: "account", base_url: null, key: null, headers: [] });
    expect(chatgpt.left).toEqual(expect.arrayContaining(["login", "proxy", "routes", "disabled"]));
    const zai = shareProposal(view({ name: "zai", base_url: "https://api.z.ai/api/anthropic", signed_in: "zai", headers: [] }), NONE, true);
    expect(zai.proposal).toMatchObject({ service: "zai", auth: "account", site: "zai", key: null });
    expect(carried(zai.proposal)).toEqual([{ kind: "login" }]);
  });

  it("手写的规格、自定义价目表跟着走；分档价写不进，说明不包含", () => {
    const models = [
      { id: "m-1", context_window: 200000, context_window_source: "manual", max_output_tokens: 8192, max_output_tokens_source: "price_table" },
      { id: "m-2", context_window: 128000, context_window_source: "price_table" },
    ] as ModelRow[];
    const sheet: PriceSheetInput = {
      name: "relay",
      multiplier: 1.2,
      models: { "m-1": { input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6, input_above_200k: 6 } },
    };
    const { proposal, left } = shareProposal(view({ pricing: "relay" }), { models, sheet }, true);
    expect(proposal.specs).toEqual([
      { model: "m-1", context_window: 200000, max_output_tokens: null, reasoning: null, image_input: null },
    ]);
    expect(proposal.price_sheet).toEqual({
      multiplier: 1.2,
      prices: [{ model: "m-1", input: 3, output: 15, cache_read: 0.3, cache_write_5m: 3.75, cache_write_1h: 6 }],
    });
    expect(left).toContain("tiers");
    expect(carried(proposal).map((c) => c.kind)).toEqual(
      expect.arrayContaining(["address", "key", "headers", "specs", "prices", "multiplier"]),
    );
  });

  it("用量上限照设定写进链接，用量不写；登录账号的不写", () => {
    const limits = [
      { per: "minute" as const, every: 5, measure: "tokens" as const, max: 10_000_000, cache_reads: false, used: 9, reached: false },
    ];
    const { proposal } = shareProposal(view({ limits }), NONE, true);
    expect(proposal.limits).toEqual([{ per: "minute", every: 5, measure: "tokens", max: 10_000_000, cache_reads: false }]);
    expect(carried(proposal)).toContainEqual({ kind: "limits", n: 1 });
    expect(dropParam(proposal, "limits")?.limits).toEqual([]);
    const zai = shareProposal(
      view({ name: "zai", base_url: "https://api.z.ai/api/anthropic", signed_in: "zai", headers: [], limits }),
      NONE,
      true,
    );
    expect(zai.proposal.limits).toEqual([]);
  });

  it("写不进链接的那一项去掉；地址、服务类型去不掉", () => {
    const { proposal } = shareProposal(view({ models: ["m 1"] }), NONE, true);
    expect(dropParam(proposal, "models")?.models).toEqual([]);
    expect(dropParam(proposal, "oauth_refresh")?.auth).toBe("key");
    expect(dropParam(proposal, "prices")?.price_sheet).toBeNull();
    expect(dropParam(proposal, "url")).toBeNull();
    expect(dropParam(proposal, "service")).toBeNull();
  });
});
