import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import CORE_ZH from "@/i18n/core.zh.json";
import { labelsText } from "@/labels.i18n";
import type { Matcher, SavedSource, SecretKind, SecurityEventView, SecurityRuleView } from "@/types";
import { toCsv } from "./export";
import { EventDetail, MatcherText, prefixRuns, ruleName, savedSourceText } from "./labels";
import { securityLabelsText } from "./labels.i18n";
import { marksFromEvents } from "./marks";
import { groupRules, patternText } from "./rules";

/**
 * 密钥与隐私的规则目录：core 的接口约定定死了规则 id 和类别，界面按 id 查名字、按类别
 * 分组、按检查名给说明。**少一条就退回英文名或 id**，没有东西会报错，所以这里逐条点名。
 */

/** 接口约定里的全部内置规则 id（原有的 30 条加扩充的） */
const IDS = [
  "thinkwatch-saved-secret",
  // AI 服务
  "anthropic-api-key",
  "openai-project-key",
  "openai-api-key",
  "openai-service-key",
  "openrouter-key",
  "xai-key",
  "groq-key",
  "huggingface-token",
  "replicate-token",
  "perplexity-key",
  "bedrock-api-key",
  "fireworks-key",
  "cerebras-key",
  "langsmith-key",
  "langfuse-secret-key",
  "pinecone-key",
  "tavily-key",
  "minimax-key",
  "zhipu-api-key",
  "qianfan-api-key",
  "sk-compat-key",
  // 代码托管与软件发布
  "github-personal-token",
  "github-oauth-token",
  "github-server-token",
  "github-user-token",
  "github-fine-grained-token",
  "github-refresh-token",
  "gitlab-token",
  "gitlab-other-token",
  "npm-token",
  "pypi-token",
  "rubygems-token",
  "clojars-token",
  "docker-hub-token",
  "artifactory-key",
  "databricks-token",
  "sentry-token",
  "grafana-token",
  "postman-key",
  // 云服务与基础设施
  "aws-access-key-id",
  "aws-temporary-key-id",
  "aws-other-key-id",
  "google-api-key",
  "google-oauth-token",
  "digitalocean-token",
  "digitalocean-other-token",
  "alibaba-access-key-id",
  "tencent-secret-id",
  "volcengine-access-key-id",
  "azure-ad-client-secret",
  "cloudflare-origin-ca-key",
  "vault-token",
  "terraform-token",
  "doppler-token",
  "pulumi-token",
  "heroku-key",
  "flyio-token",
  "supabase-key",
  "age-secret-key",
  "onepassword-token",
  // 支付、通信与协作
  "slack-bot-token",
  "slack-user-token",
  "slack-app-token",
  "slack-other-token",
  "stripe-live-key",
  "stripe-restricted-key",
  "stripe-webhook-secret",
  "sendgrid-key",
  "shopify-token",
  "twilio-api-key",
  "brevo-key",
  "linear-key",
  "notion-token",
  "atlassian-token",
  // 私钥、JWT、连接串
  "private-key",
  "jwt",
  "conn-string-password",
  // 固定位置的凭据
  "auth-header-credential",
  "command-line-password",
  "url-token",
  "bot-webhook",
  "telegram-bot-token",
  "config-assignment",
  // 加密货币
  "crypto-mnemonic",
  "crypto-wif-key",
  "crypto-extended-key",
  // 个人信息
  "cn-resident-id",
  "cn-resident-id-15",
  "passport-mrz",
  "cn-passport",
  "hk-macau-taiwan-id",
  "mainland-travel-permit",
  "us-ssn",
  "uk-nino",
  "sg-nric",
  "kr-rrn",
  "jp-my-number",
  "in-aadhaar",
  "br-cpf",
  "bank-card",
  "iban",
  "email",
  "cn-mobile-phone",
  "cn-landline",
  "intl-phone",
  "cn-address",
  "geo-coordinates",
  "cn-license-plate",
  "vin",
  "imei",
  "mac-address",
  "public-ip",
  "labeled-name",
  "labeled-address",
  "labeled-birth-date",
  "labeled-account",
  "labeled-health",
  // 内网
  "internal-ip",
  "internal-domain",
];

/**
 * 代码里实现的规则：视图里是 `builtin { check: <规则 id> }`，说明按 id 查。哪几条走代码、哪几条
 * 走多前缀表由 core 定，这里把可能走代码的都列上（多前缀、赋值、字段名那几种有自己的说明）
 */
const CODE_IDS = [
  "zhipu-api-key",
  "qianfan-api-key",
  "sk-compat-key",
  "azure-ad-client-secret",
  "terraform-token",
  "auth-header-credential",
  "command-line-password",
  "url-token",
  "bot-webhook",
  "telegram-bot-token",
  "crypto-mnemonic",
  "crypto-wif-key",
  "crypto-extended-key",
  "cn-resident-id-15",
  "passport-mrz",
  "cn-passport",
  "hk-macau-taiwan-id",
  "mainland-travel-permit",
  "us-ssn",
  "uk-nino",
  "sg-nric",
  "kr-rrn",
  "jp-my-number",
  "in-aadhaar",
  "br-cpf",
  "iban",
  "cn-landline",
  "intl-phone",
  "cn-address",
  "geo-coordinates",
  "cn-license-plate",
  "vin",
  "imei",
  "mac-address",
  "public-ip",
];

/** 按位置认、只换一段的规则：说明里要写明只换哪一段 */
const POSITION_IDS = ["auth-header-credential", "command-line-password", "url-token", "bot-webhook"];

/** 类别，按 core 的顺序（规则表分组的顺序） */
const KINDS: SecretKind[] = [
  "saved",
  "ai-services",
  "dev-platforms",
  "cloud",
  "business",
  "private-keys",
  "jwt",
  "conn-strings",
  "in-context",
  "crypto",
  "id-documents",
  "foreign-ids",
  "financial",
  "contact",
  "location",
  "vehicle",
  "device",
  "labeled-personal",
  "internal",
  "custom",
];

const text = (m: Matcher) => renderToStaticMarkup(<MatcherText m={m} />).replace(/<[^>]+>/g, "");

describe("规则名", () => {
  it("每条规则都有中文名和英文名", () => {
    const zh = CORE_ZH.tables.secret_rule as Record<string, string>;
    const en = labelsText.en.secrets;
    expect(IDS.filter((id) => !zh[id])).toEqual([]);
    expect(IDS.filter((id) => !en[id])).toEqual([]);
    // 查得到，而且不是退回 id
    for (const id of IDS) expect(ruleName("redact", id), id).not.toBe(id);
    setLang("en");
    for (const id of IDS) expect(ruleName("redact", id), id).not.toBe(id);
  });

  it("两张表的条目一样，没有多出来的", () => {
    const zh = Object.keys(CORE_ZH.tables.secret_rule).sort();
    expect(zh).toEqual([...IDS].sort());
    expect(Object.keys(labelsText.en.secrets).sort()).toEqual(zh);
  });

  it("按接口约定的写法", () => {
    expect(ruleName("redact", "thinkwatch-saved-secret")).toBe("ThinkWatch 中保存的密钥");
    expect(ruleName("redact", "sk-compat-key")).toBe("OpenAI 兼容格式 API 密钥");
    setLang("en");
    expect(ruleName("redact", "sk-compat-key")).toBe("OpenAI-compatible API key");
  });
});

describe("分组", () => {
  it("每个类别都有中文名和英文名，旧的两类已经没有了", () => {
    for (const lang of ["zh", "en"] as const) {
      const kinds = securityLabelsText[lang].kinds as Record<string, string>;
      expect(KINDS.filter((k) => !kinds[k]), lang).toEqual([]);
      expect(kinds["api-keys"]).toBeUndefined();
      expect(kinds.personal).toBeUndefined();
    }
  });

  it("按 core 给的顺序分组，保存的密钥在最前，自定义在最后", () => {
    const rule = (id: string, kind: string, custom = false): SecurityRuleView => ({
      id,
      custom,
      name: id,
      why: "",
      kind,
      matcher: { kind: "saved" },
      enabled: true,
      on_by_default: true,
    });
    // core 按类别排好再给；自定义规则跟在后面
    const rows = [...KINDS.filter((k) => k !== "custom").map((k) => rule(`${k}-1`, k)), rule("客户编号", "custom", true)];
    expect(groupRules(rows, (r) => r).map((g) => g.key)).toEqual(KINDS);
  });
});

describe("规则说明", () => {
  it("多前缀：尾部要求一样的连成一段", () => {
    const m: Matcher = {
      kind: "prefixes",
      prefixes: [
        { prefix: "hvs.", min_tail: 90, tail: "any" },
        { prefix: "hvb.", min_tail: 138, tail: "any" },
        { prefix: "shpat_", min_tail: 32, tail: "hex" },
        { prefix: "shpca_", min_tail: 32, tail: "hex" },
      ],
    };
    expect(prefixRuns(m.prefixes).map((r) => r.prefixes)).toEqual([["hvs."], ["hvb."], ["shpat_", "shpca_"]]);
    expect(text(m)).toBe(
      "hvs. 开头，其后至少 90 个字符；hvb. 开头，其后至少 138 个字符；shpat_、shpca_ 开头，其后至少 32 个十六进制字符",
    );
    setLang("en");
    expect(text({ kind: "prefixes", prefixes: [{ prefix: "gsk_", min_tail: 52, tail: "alnum" }] })).toBe(
      "Starts with gsk_, followed by at least 52 letters or digits",
    );
  });

  it("保存的密钥：按值认，与格式无关", () => {
    expect(text({ kind: "saved" })).toContain("按值识别 ThinkWatch 中保存的密钥，与格式无关");
    setLang("en");
    expect(text({ kind: "saved" })).toContain("Recognized by value, whatever the format");
  });

  it("配置赋值、带字段名的值：列出变量名和字段名，只换值", () => {
    const a = text({ kind: "assignment", suffixes: ["SECRET", "API_KEY"] });
    expect(a).toContain("SECRET、API_KEY 结尾");
    expect(a).toContain("只换值");
    const l = text({ kind: "labeled", names: ["姓名", "real_name"] });
    expect(l).toContain("姓名、real_name");
    expect(l).toContain("只换值");
    setLang("en");
    expect(text({ kind: "assignment", suffixes: ["SECRET", "API_KEY"] })).toContain("only the value is replaced");
    expect(text({ kind: "labeled", names: ["dob"] })).toContain("only the value is replaced");
  });

  it("代码里认的规则各有一句说明，按位置认的写明只换哪一段", () => {
    for (const lang of ["zh", "en"] as const) {
      setLang(lang);
      const other = text({ kind: "builtin", check: "no-such-check" });
      for (const id of CODE_IDS) {
        const s = text({ kind: "builtin", check: id });
        expect(s, `${lang} ${id}`).not.toBe(other);
        expect(s.length, `${lang} ${id}`).toBeGreaterThan(10);
      }
      for (const id of POSITION_IDS) {
        expect(text({ kind: "builtin", check: id }), `${lang} ${id}`).toMatch(lang === "zh" ? /只换/ : /only the .* is replaced/);
      }
    }
  });

  it("中文说明是陈述句，不称呼用户", () => {
    const all = [
      ...CODE_IDS.map((id) => text({ kind: "builtin", check: id })),
      text({ kind: "saved" }),
      text({ kind: "assignment", suffixes: ["TOKEN"] }),
      text({ kind: "labeled", names: ["dob"] }),
    ];
    // 第一、第二人称的两个字按码位写：这个文件本身也在文案检查的范围里
    const pronouns = String.fromCharCode(0x4f60, 0x6211);
    expect(all.filter((s) => [...pronouns].some((c) => s.includes(c)))).toEqual([]);
  });

  it("检索时多前缀、变量名、字段名也算写法", () => {
    const r = (matcher: Matcher): SecurityRuleView => ({
      id: "x",
      custom: false,
      name: "x",
      why: "",
      kind: "cloud",
      matcher,
      enabled: true,
      on_by_default: true,
    });
    expect(patternText(r({ kind: "prefixes", prefixes: [{ prefix: "hvs.", min_tail: 90, tail: "any" }] }))).toBe("hvs.");
    expect(patternText(r({ kind: "assignment", suffixes: ["TOKEN", "SECRET"] }))).toBe("TOKEN SECRET");
    expect(patternText(r({ kind: "labeled", names: ["dob"] }))).toBe("dob");
  });
});

const hit = (x: Partial<SecurityEventView>): SecurityEventView => ({
  id: 1,
  at_ms: 0,
  request_id: 7,
  guard: "redact",
  rule: "thinkwatch-saved-secret",
  custom: false,
  action: "replaced",
  provider: "DeepSeek",
  client: "默认",
  model: "deepseek-chat",
  excerpt: "",
  count: 1,
  direction: "request",
  locations: [],
  more_locations: 0,
  rule_snapshot: { builtin: true, id: "thinkwatch-saved-secret", name: "Credentials saved in ThinkWatch", core_version: "0.85.0" },
  outcome_detail: { action: "replaced", placeholders: ["<<TW_SECRET_1>>"] },
  ...x,
});

const detail = (e: SecurityEventView) => renderToStaticMarkup(<EventDetail e={e} />).replace(/<[^>]+>/g, "");

describe("保存的密钥的来源", () => {
  const sources: [SavedSource, string, string][] = [
    [{ kind: "upstream-key", name: "DeepSeek" }, "上游「DeepSeek」的密钥", "Key of upstream “DeepSeek”"],
    [{ kind: "upstream-header", name: "Azure" }, "上游「Azure」请求头中的值", "Header value of upstream “Azure”"],
    [{ kind: "access-key", name: "默认" }, "网关密钥「默认」", "Gateway key “默认”"],
    [{ kind: "proxy-password", name: "公司" }, "代理「公司」的密码", "Password of proxy “公司”"],
    [{ kind: "control-key", name: "" }, "远程控制密钥", "Remote control key"],
    [{ kind: "sync-credential", name: "" }, "同步与备份凭据", "Sync and backup credential"],
  ];

  it("每种来源都写得出", () => {
    for (const [s, zh] of sources) expect(savedSourceText(s)).toBe(zh);
    setLang("en");
    for (const [s, , en] of sources) expect(savedSourceText(s)).toBe(en);
  });

  it("不认识的来源退回名字", () => {
    expect(savedSourceText({ kind: "new-kind" as SavedSource["kind"], name: "备份" })).toBe("备份");
  });

  it("日志一条的第二行写来源，不写值", () => {
    expect(detail(hit({ source: { kind: "upstream-key", name: "DeepSeek" } }))).toBe("上游「DeepSeek」的密钥");
    expect(detail(hit({ source: { kind: "access-key", name: "默认" }, count: 3 }))).toBe("网关密钥「默认」 · 出现 3 次");
  });

  it("没有来源也没有值的：只剩次数，不留多余的分隔号", () => {
    expect(detail(hit({ count: 2 }))).toBe("出现 2 次");
    expect(detail(hit({}))).toBe("");
  });

  it("个人信息照常写报出来的值（只留认得出是哪一个的部分）", () => {
    expect(detail(hit({ rule: "cn-address", excerpt: "北京市朝阳区…", count: 2 }))).toBe("北京市朝阳区… · 出现 2 次");
    expect(detail(hit({ rule: "iban", excerpt: "…1234" }))).toBe("…1234");
  });

  it("翻历史拼回的徽标、导出都带着来源", () => {
    const e = hit({ source: { kind: "proxy-password", name: "公司" } });
    expect(marksFromEvents([e]).secrets?.items[0]?.source).toEqual({ kind: "proxy-password", name: "公司" });
    expect(toCsv([e])).toContain("代理「公司」的密码");
  });
});
