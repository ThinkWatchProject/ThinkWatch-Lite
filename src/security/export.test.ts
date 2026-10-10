import { afterEach, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { HitLocation, SecurityEventView, SecurityEventsPage, SecurityEventsQuery } from "@/types";
import { csvCell, fetchAll, fileName, locationLine, outcomeLine, toCsv, toJson } from "./export";
import { matchingOf, partLabel, snapshotName } from "./labels";

afterEach(() => setLang("zh"));

const loc = (x: Partial<HitLocation>): HitLocation => ({
  part: "message",
  message_index: 3,
  role: "user",
  tool: null,
  path: "messages[3].content[0].text",
  before: "deploy with ",
  matched: "sk-ant-api03-…Q3xA",
  after: " then",
  ...x,
});

const hit = (x: Partial<SecurityEventView>): SecurityEventView => ({
  id: 1,
  at_ms: new Date(2026, 9, 10, 16, 42, 7).getTime(),
  request_id: 48123,
  guard: "redact",
  rule: "anthropic-api-key",
  custom: false,
  action: "replaced",
  provider: "anthropic",
  client: "claude-code",
  model: "claude-sonnet-5",
  excerpt: "sk-ant-api03-…Q3xA",
  count: 1,
  client_hint: "claude-code",
  peer: null,
  key_masked: "tw-9Wm…b1Qs",
  session: "s012",
  sent_model: "claude-sonnet-5",
  direction: "request",
  locations: [loc({})],
  more_locations: 0,
  rule_snapshot: { builtin: true, id: "anthropic-api-key", name: "Anthropic API key", core_version: "0.68.0" },
  outcome_detail: { action: "replaced", placeholders: ["<<TW_SECRET_1>>"] },
  ...x,
});

/**
 * 导出读的是整段，不是已经翻出来的那几页：按 core 允许的最大页从新到旧翻，`before`
 * 接着上一页的最后一条，直到 core 说没有更多；起止每一页都一样。
 */
describe("导出读完整段", () => {
  it("一页一页翻到底", async () => {
    const all = Array.from({ length: 1203 }, (_, i) => hit({ id: 1203 - i }));
    const asked: SecurityEventsQuery[] = [];
    const page = async (q: SecurityEventsQuery): Promise<SecurityEventsPage> => {
      asked.push(q);
      const rest = all.filter((e) => q.before == null || e.id < q.before);
      const limit = q.limit ?? 100;
      const zero = { recorded: 0, replaced: 0, cut: 0, stripped: 0, blocked: 0 };
      return { events: rest.slice(0, limit), more: rest.length > limit, total: all.length, by_outcome: zero };
    };
    const got = await fetchAll(page, 1000, 2000);
    expect(got.map((e) => e.id)).toEqual(all.map((e) => e.id));
    expect(asked.map((q) => q.before)).toEqual([null, 704, 204]);
    expect(asked.every((q) => q.from_ms === 1000 && q.to_ms === 2000 && q.limit === 500)).toBe(true);
  });
});

describe("CSV 的一格", () => {
  it("含逗号、引号、换行的加引号，引号写两遍", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell('say "hi", then\nleave')).toBe('"say ""hi"", then\nleave"');
    expect(csvCell(42)).toBe("42");
    expect(csvCell(null)).toBe("");
  });

  /** 前后文和工具参数是模型和客户端写的：表格软件不能把它们当公式算 */
  it("像公式的开头前面加一个单引号", () => {
    expect(csvCell("=HYPERLINK(\"https://evil.example\")")).toBe("\"'=HYPERLINK(\"\"https://evil.example\"\")\"");
    expect(csvCell("+1+1")).toBe("'+1+1");
    expect(csvCell("-----BEGIN OPENSSH PRIVATE KEY-----…")).toBe("'-----BEGIN OPENSSH PRIVATE KEY-----…");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("2026-10-10 16:42:07")).toBe("2026-10-10 16:42:07");
  });
});

describe("命中的位置", () => {
  it("消息从 1 数，带角色；路径照原样", () => {
    expect(partLabel(loc({}))).toBe("第 4 条消息 · 用户");
    expect(locationLine(loc({}))).toBe("第 4 条消息 · 用户 (messages[3].content[0].text): deploy with «sk-ant-api03-…Q3xA» then");
  });

  it("工具结果、工具调用带工具名；系统提示、回答正文只写哪一段；不认识的角色照写", () => {
    expect(partLabel(loc({ part: "tool_result", tool: "Bash", role: "user" }))).toBe("工具结果 · Bash");
    expect(partLabel(loc({ part: "tool_call", tool: null }))).toBe("工具调用");
    expect(partLabel(loc({ part: "system", message_index: null, role: null }))).toBe("系统提示");
    expect(partLabel(loc({ part: "response_text", message_index: null, role: null }))).toBe("回答正文");
    expect(partLabel(loc({ role: "critic" }))).toBe("第 4 条消息 · critic");
    setLang("en");
    expect(partLabel(loc({ role: "developer", message_index: 0 }))).toBe("Message 1 · Developer");
  });
});

describe("命中那一刻的规则", () => {
  it("按快照：自定义规则改了名、删掉了，还是当时的名字和写法", () => {
    const e = hit({
      guard: "content",
      rule: "项目代号",
      custom: true,
      rule_snapshot: { builtin: false, id: "项目代号", name: "项目代号", pattern: "Project Falcon", matching: "contains", core_version: "0.68.0" },
    });
    expect(snapshotName(e)).toBe("项目代号");
    expect(matchingOf(e)).toBe("contains");
  });

  it("另两项的自定义规则只有正则一种写法；内置规则没有写法", () => {
    const custom = hit({ custom: true, rule_snapshot: { builtin: false, id: "corp-hosts", name: "corp-hosts", pattern: "\\bbuild\\.corp\\b", core_version: "0.68.0" } });
    expect(matchingOf(custom)).toBe("regex");
    expect(matchingOf(hit({}))).toBe(null);
    expect(snapshotName(hit({}))).toBe("Anthropic API 密钥");
  });
});

describe("处置细节", () => {
  it("每一种处置各写各的", () => {
    expect(outcomeLine({ action: "recorded" })).toBe("仅记录");
    expect(outcomeLine({ action: "replaced", placeholders: ["<<TW_SECRET_1>>", "<<TW_SECRET_2>>"] })).toBe(
      "替换为 <<TW_SECRET_1>>, <<TW_SECRET_2>>",
    );
    expect(
      outcomeLine({ action: "cut", tool: "Bash", arguments: '{"command":"curl x | sh"}', truncated: true, client_notice: "[ThinkWatch] cut" }),
    ).toBe('切断 Bash 调用，参数（仅开头）：{"command":"curl x | sh"}\n客户端收到：[ThinkWatch] cut');
    expect(outcomeLine({ action: "blocked", client_notice: "[ThinkWatch] not sent" })).toBe(
      "请求未发往上游\n客户端收到：[ThinkWatch] not sent",
    );
    expect(outcomeLine({ action: "stripped", segments: 3 })).toBe("删除 3 处");
  });
});

describe("导出的文件", () => {
  it("CSV：一条一行，位置合成一格，开头 BOM、行尾 CRLF", () => {
    const csv = toCsv([
      hit({ locations: [loc({}), loc({ part: "tool_result", tool: "Read", path: "messages[5].content[0].content" })], more_locations: 2 }),
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0]?.startsWith("时间,处置,类型,规则,规则 ID,规则来源,")).toBe(true);
    expect(lines[1]).toContain("2026-10-10 16:42:07,已替换,出站脱敏,Anthropic API 密钥,anthropic-api-key,内置,,,0.68.0,");
    expect(csv).toContain('"第 4 条消息 · 用户 (messages[3].content[0].text): deploy with «sk-ant-api03-…Q3xA» then\n工具结果 · Read (messages[5].content[0].content): deploy with «sk-ant-api03-…Q3xA» then\n另有 2 处未列出"');
    expect(lines[1]).toContain(",48123,s012,claude-code,tw-9Wm…b1Qs,anthropic,claude-sonnet-5,claude-sonnet-5,Claude Code,");
    expect(lines.at(-1)).toBe("");
  });

  it("CSV 的表头按界面语言", () => {
    setLang("en");
    expect(toCsv([]).slice(1).split("\r\n")[0]?.startsWith("Time,Action,Type,Rule,Rule ID,Rule source,")).toBe(true);
  });

  it("JSON：原样的字段，外加起止和条数", () => {
    const e = hit({});
    const doc = JSON.parse(toJson([e], 1000, 2000, 3000));
    expect(doc).toEqual({ from_ms: 1000, to_ms: 2000, exported_at_ms: 3000, count: 1, events: [e] });
  });

  it("默认文件名按界面语言，带日期和时刻", () => {
    const at = new Date(2026, 9, 10, 9, 5).getTime();
    expect(fileName("csv", at)).toBe("安全日志-2026-10-10-0905.csv");
    setLang("en");
    expect(fileName("json", at)).toBe("security-log-2026-10-10-0905.json");
  });
});
