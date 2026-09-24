// 界面能调的每一个控制面端点（src/control.ts 的 WEBVIEW_ENDPOINTS）。
//
// 类型是按端点名映射出来的：**core 加了端点、改了请求或响应的形状，这里就编译不过**
// （`pnpm shots` 第一步就是对这个目录跑 tsc）。截图只读不写，改配置的端点一律拒绝 ——
// 场景里要是点到了保存，拍出来的是一条报错，而不是一张假装保存成功的图。
import type { WebviewEndpoint } from "@/control";
import type { Endpoints, L1Result } from "@/types";
import {
  CONFIG_TEXT,
  configVersion,
  dryRun,
  knownModels,
  overview,
  providerModels,
  priceFor,
  pricing,
  priceSource,
  security,
  keys,
} from "./config";
import { HISTORY, IN_FLIGHT, SEC_EVENTS, bodies, lastSeen, sessionView, sessions, turns, unpricedModels } from "./traffic";
import { DAY, HOUR, NOW, clone, msg } from "./util";

type Handler<N extends WebviewEndpoint> = (req: Endpoints[N]["req"], params: string[]) => Endpoints[N]["res"];

const refuse = (): never => {
  throw msg("", "Screenshots are read-only.");
};

const notFound = (what: string): never => {
  throw msg("", `${what} is not in the screenshot data.`);
};

/** 链路测速：每一家从哪一步到哪一步各用了多久 */
function l1(target: string, via: string | null): L1Result {
  const seg = (step: "dns" | "tcp" | "tls" | "handshake", peer: "upstream" | "proxy", ms: number) => ({ stage: { step, peer }, ms });
  const segments = via
    ? [seg("tcp", "proxy", 1), seg("handshake", "proxy", 2), seg("tls", "upstream", 186)]
    : target === "ollama"
      ? [seg("tcp", "upstream", 0)]
      : [seg("dns", "upstream", 12), seg("tcp", "upstream", 34), seg("tls", "upstream", 68)];
  return {
    target,
    via,
    ok: true,
    segments,
    total_ms: segments.reduce((a, s) => a + s.ms, 0),
    skipped: via ? [{ stage: { step: "dns", peer: "upstream" }, reason: "proxy_resolves" }] : target === "ollama" ? [{ stage: { step: "tls", peer: "upstream" }, reason: "plain_http" }] : [],
    failed: null,
    error: null,
  };
}

export const CORE: { [N in WebviewEndpoint]: Handler<N> } = {
  Interfaces: () => [
    { name: "lo0", addr: "127.0.0.1", loopback: true },
    { name: "en0", addr: "192.168.1.23", loopback: false },
  ],
  Overview: () => overview(lastSeen()),
  L1: (req) =>
    overview(lastSeen())
      .providers.filter((p) => !req.provider || p.name === req.provider)
      .map((p) => l1(p.name, p.proxy === "direct" || p.proxy === "system" ? null : p.proxy)),
  InFlight: () => clone(IN_FLIGHT),

  GetConfig: () => ({ path: "~/.thinkwatch/config.yaml", text: CONFIG_TEXT, version: configVersion() }),
  PatchConfig: refuse,
  PutConfig: refuse,
  ConfigHistory: () => [{ version: configVersion(), at_ms: NOW - 2 * DAY, origin: "ui", bytes: 2_714, current: true }],
  ConfigAt: () => ({ section: null, name: null }),
  ConfigRollback: refuse,
  SaveListen: refuse,

  History: (req) => {
    const from = req.from_ms ?? -Infinity;
    const to = req.to_ms ?? Infinity;
    return clone(
      HISTORY.filter((h) => h.at_ms >= from && h.at_ms < to)
        .slice(-(req.limit ?? 500))
        .reverse(),
    );
  },
  RequestDetail: (_req, [id]) => {
    const h = HISTORY.find((x) => x.id === Number(id)) ?? notFound(`Request #${id}`);
    return { row: clone(h), ...bodies(h), in_flight: false };
  },
  Sessions: (req) => sessions(req.limit ?? 200),
  SessionDetail: (_req, [id]) => ({ session: sessionView(id!) ?? notFound(`Session ${id}`), turns: turns(id!) }),
  SpeedQuote: refuse,
  SpeedRun: refuse,
  ReplayQuote: refuse,
  ReplayRun: refuse,
  DryRun: (req) => dryRun(req),

  Keys: () => keys(lastSeen()),
  CreateKey: refuse,
  UpdateKey: refuse,
  SetDefaultKey: refuse,

  CreateProvider: refuse,
  TestProvider: refuse,
  PreviewProvider: (req) => ({ protocol: req.protocol ?? null, auth_header: "authorization" }),
  UpdateProvider: refuse,
  DeleteProvider: refuse,
  ProviderModels: (_req, [name]) => providerModels(name!) ?? notFound(`Upstream ${name}`),
  RefreshProviderModels: (_req, [name]) => providerModels(name!) ?? notFound(`Upstream ${name}`),
  RefreshStaleModels: () => ({ providers: [] }),

  CreateProxy: refuse,
  TestProxy: refuse,
  UpdateProxy: refuse,
  DeleteProxy: refuse,

  CreateRoute: refuse,
  UpdateRoute: refuse,
  DeleteRoute: refuse,
  SetDefaultRoute: refuse,
  CreateGroup: refuse,
  UpdateGroup: refuse,
  DeleteGroup: refuse,
  KnownModels: () => knownModels(),

  Pricing: () => pricing(unpricedModels()),
  RefreshPricing: refuse,
  SetPricingAutoUpdate: refuse,
  QueryPrice: (req) => {
    const models = req.models ?? [];
    const items = models.map((model) => {
      const price = priceFor("anthropic", model) ?? priceFor("chatgpt", model) ?? priceFor("gemini", model) ?? priceFor("deepseek", model);
      return { model, price, source: price ? { kind: "default" as const, date: priceSource("anthropic")!.date } : null, estimated: false, max_input_tokens: null };
    });
    return { items, matched: items.length };
  },
  CreatePriceSheet: refuse,
  PriceSheet: (_req, [name]) => (name === "relay-discount" ? { name, multiplier: 0.8, models: {} } : notFound(`Price sheet ${name}`)),
  UpdatePriceSheet: refuse,
  DeletePriceSheet: refuse,

  Security: () => security(),
  SecurityEvents: (req) => {
    const xs = SEC_EVENTS.filter(
      (e) =>
        (!req.guard || e.guard === req.guard) &&
        (req.from_ms == null || e.at_ms >= req.from_ms) &&
        (req.to_ms == null || e.at_ms < req.to_ms) &&
        (req.before == null || e.id < req.before),
    );
    const limit = req.limit ?? 100;
    return { events: clone(xs.slice(0, limit)), more: xs.length > limit };
  },
  SetSecurityMode: refuse,
  ToggleBuiltinRule: refuse,
  SetBuiltinRuleAction: refuse,
  SetSecurityLimit: refuse,
  CreateCustomRule: refuse,
  UpdateCustomRule: refuse,
  DeleteCustomRule: refuse,
  TestSecurity: () => ({ hits: [] }),

  ChatgptLoginStatus: refuse,
  ChatgptUsage: () => ({
    email: "alex@example.com",
    plan: "plus",
    windows: CHATGPT_WINDOWS(),
    reset_credits: 1,
  }),
  ChatgptResets: () => ({ available_count: 1, credits: [] }),
  UseChatgptReset: refuse,
  ZaiLoginStatus: refuse,
};

/** ChatGPT Plus 的两个额度窗口：5 小时用了一半多，每周的三成 */
export const CHATGPT_WINDOWS = () => [
  { window: "5h", used_percent: 58, resets_at_ms: NOW + 1 * HOUR + 48 * 60_000, status: null },
  { window: "weekly", used_percent: 31, resets_at_ms: NOW + 3 * DAY + 7 * HOUR, status: null },
];
