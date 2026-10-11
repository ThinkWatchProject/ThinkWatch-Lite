import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import TABLE from "@/generated/import-services.json";
import type { ImportAuth, ImportProposal, ImportService, Protocol } from "@/types";
import { PROTOCOLS, bedrockUrl } from "@/upstreams/labels";
import { PRESETS, SERVICE_HOSTS, ZAI_ENDPOINTS, serviceOf } from "@/upstreams/presets";
import { authOptions, fieldRules, formFromImport } from "@/upstreams/upstreamForm";

/**
 * 导入链接按服务类型收哪几项，Rust 侧有一张表（`src-tauri/src/import_link.rs` 的 `SERVICES`）：
 * 「对话框里显示这一栏，链接才能给」。`src/generated/import-services.json` 是它生成的一份
 * （`tests/ts_bindings.rs` 核对文件和表一致）。这里拿它和新建对话框自己的规矩对：服务类型
 * （`PRESETS`）、显示哪几栏（`fieldRules`）、认证方式（`authOptions`）、按地址认服务
 * （`serviceOf`）。**任何一边改了另一边没跟上，这里就过不了**
 */

beforeAll(() => setLang("zh"));

type Address =
  | { kind: "required" }
  | { kind: "own"; address: string }
  | { kind: "site" }
  | { kind: "endpoint"; default: string }
  | { kind: "local"; default: string };
type Protocols = { kind: "fixed"; protocol: Protocol | null } | { kind: "choice"; protocols: Protocol[] };
interface Service {
  id: ImportService;
  auth: ImportAuth[];
  address: Address;
  protocols: Protocols;
  key: "required" | "optional" | "none";
  client_identity: boolean;
  balance: boolean;
  billing: "per-token" | "free";
}
const T = TABLE as unknown as {
  services: Service[];
  hosts: { host: string; service: ImportService }[];
  zai: { zai: string; bigmodel: string };
  protocols: Protocol[];
  bedrock_default_region: string;
};

/** 这种服务、这种认证方式最少的一份提议（和 Rust 侧那几条测试拼的一样） */
function minimal(s: Service, auth: ImportAuth): ImportProposal {
  return {
    service: s.id,
    auth,
    site: s.id === "zai" ? "bigmodel" : null,
    name: null,
    base_url: s.address.kind === "required" && auth !== "account" ? "https://relay.example" : null,
    protocol: null,
    key: null,
    oauth: auth === "oauth" ? { endpoint: "https://relay.example/token", refresh: "r", client_id: null, client_secret: null } : null,
    region: null,
    aws: auth === "aws-keys" ? { access_key_id: "AKIAIOSFODNN7EXAMPLE", secret_access_key: "s", session_token: null } : null,
    headers: [],
    client_identity: false,
    concurrency: null,
    balance: null,
    models: [],
    models_only: null,
    specs: [],
    billing: null,
    price_sheet: null,
  };
}

describe("导入链接的服务表和新建对话框对得上", () => {
  it("同样的服务类型，同样的顺序", () => {
    expect(T.services.map((s) => s.id)).toEqual(PRESETS.map((p) => p.id));
  });

  it("每一种服务：认证方式、地址、协议、密钥、转发客户端身份、余额来源、计费方式", () => {
    for (const [i, s] of T.services.entries()) {
      const p = PRESETS[i]!;
      const at = `${s.id}`;
      // AWS profile 读这台机器上的凭证文件：链接不能选它
      expect(p.auth.filter((a) => a !== "aws-profile"), at).toEqual(s.auth);
      expect(p.key, at).toBe(s.key);
      expect(!!p.clientIdentity, at).toBe(s.client_identity);
      expect(p.billing ?? "per-token", at).toBe(s.billing);
      expect(s.balance, at).toBe(p.id === "custom");
      if (s.protocols.kind === "fixed") {
        expect(p.protocols, at).toBeUndefined();
        expect(p.protocol || null, at).toBe(s.protocols.protocol);
      } else {
        expect(s.protocols.protocols, at).toEqual(p.protocols === "all" ? T.protocols : p.protocols);
      }
      switch (s.address.kind) {
        case "required":
          expect(p.baseUrl, at).toBe("");
          break;
        case "own":
          expect(p.baseUrl, at).toBe(s.address.address);
          expect(p.fixedUrl, at).toBeFalsy();
          break;
        case "site":
          expect(p.fixedUrl, at).toBe(true);
          break;
        case "endpoint":
          expect(p.id, at).toBe("bedrock");
          expect(p.baseUrl, at).toBe(s.address.default);
          expect(bedrockUrl(T.bedrock_default_region)).toBe(s.address.default);
          break;
        case "local":
          expect(p.id, at).toBe("ollama");
          expect(p.baseUrl, at).toBe(s.address.default);
          break;
      }
    }
  });

  it("链接能给的每一栏，对话框都显示", () => {
    for (const s of T.services) {
      for (const auth of s.auth) {
        const at = `${s.id} ${auth}`;
        const form = formFromImport(minimal(s, auth), []);
        expect(form.preset, at).toBe(s.id);
        expect(authOptions(form), at).toContain(auth);
        // 登录账号那一步只有名称和出站代理，连接的几栏都不显示（Rust 侧也都不收）
        if (auth === "account") continue;
        const rules = fieldRules(form);
        expect(rules.key, at).toBe(auth === "key" && s.key !== "none");
        expect(rules.clientIdentity, at).toBe(s.client_identity);
        expect(rules.balance, at).toBe(s.balance);
        // 由站点定地址的那一种，标准地址时不显示地址那一栏：链接给的只能是标准地址
        expect(rules.url, at).toBe(s.address.kind !== "site");
        if (s.protocols.kind === "fixed") {
          expect(rules.protocols, at).toBeNull();
        } else {
          const offered = rules.protocols === "all" ? PROTOCOLS.map((x) => x.id) : rules.protocols;
          for (const proto of s.protocols.protocols) expect(offered, at).toContain(proto);
        }
      }
    }
  });

  it("没写服务类型时按地址认：和编辑对话框同一张表", () => {
    expect(Object.fromEntries(T.hosts.map((h) => [h.host, h.service]))).toEqual(SERVICE_HOSTS);
    expect(T.zai).toEqual(ZAI_ENDPOINTS);
    const of = (baseUrl: string) => serviceOf({ baseUrl, protocol: "", balance: null }).preset;
    for (const h of T.hosts) expect(of(`https://${h.host}/v1`)).toBe(h.service);
    expect(of("https://bedrock-runtime.eu-west-1.amazonaws.com")).toBe("bedrock");
    expect(of("https://bedrock-runtime-fips.us-east-1.amazonaws.com")).toBe("bedrock");
    expect(of("http://127.0.0.1:11434")).toBe("ollama");
    expect(of("https://chatgpt.com/backend-api")).toBe("custom");
    expect(of("https://relay.example")).toBe("custom");
  });

  it("链接里的四种协议都是新建表单能选的", () => {
    const ids = PROTOCOLS.map((p) => p.id);
    for (const p of T.protocols) expect(ids).toContain(p);
  });
});
