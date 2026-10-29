import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import { fetchInto, resetResources } from "@/lib/resource";
import type { GuardDetail, SavedSource, SecurityDetail, SecurityEventView, SecurityKindView, SecurityRuleView } from "@/types";
import { CATALOG_KEY } from "./catalog";
import { toCsv } from "./export";
import { CoreText, EventDetail, kindName, RuleMatchText, ruleName, ruleWhy, savedSourceText, snapshotName, viewName } from "./labels";
import { marksFromEvents } from "./marks";
import { groupRules } from "./rules";

/**
 * 规则的名字、说明、分组名由 core 给（规则表里的 `name_zh` / `why_zh` / `about` /
 * `about_zh`，分组是 `kinds`）。界面只管按语言取、反引号画成代码，以及缺了的时候退回得
 * 体面：中文缺了用英文，规则目录没取到用日志里存的英文名，再没有就是 id。
 */

const rule = (x: Partial<SecurityRuleView>): SecurityRuleView => ({
  id: "anthropic-api-key",
  custom: false,
  name: "Anthropic API key",
  name_zh: "Anthropic API 密钥",
  about: "Starts with `sk-ant-`, followed by at least 20 characters",
  about_zh: "`sk-ant-` 开头，其后至少 20 个字符",
  kind: "ai-services",
  matcher: { kind: "prefix", prefix: "sk-ant-", min_tail: 20 },
  enabled: true,
  on_by_default: true,
  ...x,
});

const KINDS: SecurityKindView[] = [
  { slug: "saved", name: "Saved credentials", name_zh: "保存的密钥" },
  { slug: "ai-services", name: "AI services", name_zh: "AI 服务" },
  { slug: "custom", name: "Custom", name_zh: "自定义" },
];

const guard = (rules: SecurityRuleView[], kinds: SecurityKindView[] = []): GuardDetail => ({ mode: "enforce", rules, kinds });

/** 把一份规则目录放进缓存，和安全页取到的一样 */
async function seed(d: Partial<SecurityDetail>) {
  await fetchInto(CATALOG_KEY, async () => ({
    redact: guard([]),
    inspect_tools: guard([]),
    content: guard([]),
    ...d,
  }));
}

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const plain = (node: React.ReactNode) => html(node).replace(/<[^>]+>/g, "");

beforeEach(() => resetResources());

describe("规则名", () => {
  it("内置规则按界面语言取 core 给的名字", () => {
    expect(viewName(rule({}))).toBe("Anthropic API 密钥");
    setLang("en");
    expect(viewName(rule({}))).toBe("Anthropic API key");
  });

  it("没有中文名的退回英文名；自定义规则就是它的名字", () => {
    expect(viewName(rule({ name_zh: undefined }))).toBe("Anthropic API key");
    expect(viewName(rule({ id: "客户编号", name: "客户编号", custom: true, name_zh: undefined }))).toBe("客户编号");
  });

  it("只带 id 的地方按 id 到规则目录里查", async () => {
    // 目录还没取到：日志里存的英文名，再没有就是 id
    expect(ruleName("redact", "anthropic-api-key", false, "Anthropic API key")).toBe("Anthropic API key");
    expect(ruleName("redact", "anthropic-api-key")).toBe("anthropic-api-key");
    await seed({
      redact: guard([rule({})]),
      inspect_tools: guard([
        rule({ id: "curl-pipe-sh", name: "Download and run", name_zh: "下载即执行", kind: "command" }),
      ]),
    });
    expect(ruleName("redact", "anthropic-api-key")).toBe("Anthropic API 密钥");
    expect(ruleName("inspect_tools", "curl-pipe-sh")).toBe("下载即执行");
    // 同一个 id 在别的防护里不算
    expect(ruleName("content", "curl-pipe-sh", false, "Download and run")).toBe("Download and run");
    // 规则已经没有了
    expect(ruleName("redact", "gone-rule", false, "Gone rule")).toBe("Gone rule");
    // 自定义规则原样
    expect(ruleName("redact", "客户编号", true)).toBe("客户编号");
    setLang("en");
    expect(ruleName("redact", "anthropic-api-key")).toBe("Anthropic API key");
  });

  it("日志一条按快照的 id 查，快照里的英文名是退路", async () => {
    const e = hit({
      rule: "anthropic-api-key",
      rule_snapshot: { builtin: true, id: "anthropic-api-key", name: "Anthropic API key", core_version: "0.85.0" },
    });
    expect(snapshotName(e)).toBe("Anthropic API key");
    await seed({ redact: guard([rule({})]) });
    expect(snapshotName(e)).toBe("Anthropic API 密钥");
  });
});

describe("规则说明", () => {
  it("why：中文界面取 why_zh，缺了退回英文", () => {
    const r = rule({ id: "curl-pipe-sh", why: "Runs whatever the remote serves", why_zh: "下载后直接执行" });
    expect(ruleWhy("inspect_tools", r)).toBe("下载后直接执行");
    expect(ruleWhy("inspect_tools", { ...r, why_zh: undefined })).toBe("Runs whatever the remote serves");
    expect(ruleWhy("inspect_tools", { ...r, why: "" })).toBe("");
    setLang("en");
    expect(ruleWhy("inspect_tools", r)).toBe("Runs whatever the remote serves");
  });

  it("about：按语言取，反引号里的画成代码", () => {
    expect(html(<RuleMatchText r={rule({})} />)).toBe(
      html(
        <>
          <code className="rounded bg-surface px-1 font-mono text-[0.92em] whitespace-pre text-foreground">sk-ant-</code>
          {" 开头，其后至少 20 个字符"}
        </>,
      ),
    );
    setLang("en");
    expect(plain(<RuleMatchText r={rule({})} />)).toBe("Starts with sk-ant-, followed by at least 20 characters");
  });

  it("反引号落单时照普通文字画", () => {
    expect(plain(<CoreText text="a `b` c `d" />)).toBe("a b c `d");
    expect(html(<CoreText text="a `b` c `d" />).match(/<code/g)?.length).toBe(1);
  });

  it("没有 about：列出写法；没有写法的说是内置检查", () => {
    expect(plain(<RuleMatchText r={rule({ about: undefined, about_zh: undefined })} />)).toBe("sk-ant-");
    const vault = rule({
      about: undefined,
      about_zh: undefined,
      matcher: {
        kind: "prefixes",
        prefixes: [
          { prefix: "hvs.", min_tail: 90, tail: "any" },
          { prefix: "hvb.", min_tail: 138, tail: "any" },
        ],
      },
    });
    expect(plain(<RuleMatchText r={vault} />)).toBe("hvs.、hvb.");
    expect(plain(<RuleMatchText r={rule({ about: undefined, about_zh: undefined, matcher: { kind: "jwt" } })} />)).toBe(
      "由内置检查判断",
    );
  });

  it("中文缺了用英文的 about", () => {
    expect(plain(<RuleMatchText r={rule({ about_zh: undefined })} />)).toBe(
      "Starts with sk-ant-, followed by at least 20 characters",
    );
  });

  it("危险命令里代码实现的检查、自定义规则照判据写", () => {
    const check = rule({ id: "secret-to-unknown-host", about: undefined, about_zh: undefined, matcher: { kind: "builtin", check: "credential-to-network" } });
    expect(plain(<RuleMatchText r={check} />)).toBe("凭据发往本机和该凭据的服务商以外的主机");
    const custom = rule({
      id: "客户编号",
      name: "客户编号",
      custom: true,
      about: "ignored",
      matcher: { kind: "regex", pattern: "CUST-\\d+", case_sensitive: true },
    });
    expect(plain(<RuleMatchText r={custom} />)).toBe("正则 CUST-\\d+");
  });
});

describe("分组", () => {
  it("分组名取 core 给的 kinds", () => {
    expect(kindName(KINDS, "ai-services")).toBe("AI 服务");
    setLang("en");
    expect(kindName(KINDS, "ai-services")).toBe("AI services");
  });

  it("旧的 core 不给 kinds：自定义照样叫自定义，其余写 slug", () => {
    expect(kindName(undefined, "custom")).toBe("自定义");
    expect(kindName(undefined, "ai-services")).toBe("ai-services");
    expect(kindName(KINDS, "vehicle")).toBe("vehicle");
  });

  it("按 core 给的顺序分组，保存的密钥在最前，自定义在最后", () => {
    const rows = [
      rule({ id: "thinkwatch-saved-secret", kind: "saved" }),
      rule({ id: "anthropic-api-key", kind: "ai-services" }),
      rule({ id: "openai-api-key", kind: "ai-services" }),
      rule({ id: "客户编号", custom: true, kind: "custom" }),
    ];
    expect(groupRules(rows, (r) => r).map((g) => g.key)).toEqual(KINDS.map((k) => k.slug));
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
