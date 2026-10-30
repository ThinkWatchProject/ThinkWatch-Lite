import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLang } from "@/i18n";
import type { Resource } from "@/lib/resource";
import { TooltipRoot } from "@/ui/tip";
import type { RedactException, RedactExceptions, SecurityEventView } from "@/types";
import { api } from "./api";
import { ExceptionsSection } from "./Exceptions";
import { HitDetail } from "./HitDetail";

const call = vi.fn();
vi.mock("@/control", () => ({ call: (...a: unknown[]) => call(...a) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
// 命中详情挂着规则目录（取数的钩子在服务端渲染里用不了）：这里只看按钮和标签
vi.mock("./catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./catalog")>()),
  useRuleCatalog: () => undefined,
}));

/**
 * 密钥与隐私的例外值（规格 D5）：规则表下方「例外 · N 个值」一节，日志命中详情里的
 * 「列为例外」和「例外」标签，以及界面交给 core 的调用。
 */

const item = (x: Partial<RedactException>): RedactException => ({
  sha256: "a".repeat(64),
  masked: "sk-ant-api03-…Q3xA",
  rule: "anthropic-api-key",
  added_at: new Date(2026, 9, 29, 9, 5).getTime(),
  ...x,
});

const resource = (data: RedactExceptions | undefined): Resource<RedactExceptions> =>
  ({ data, error: undefined, loading: data === undefined, refreshing: false, reload: async () => data, mutate: () => () => {} }) as Resource<RedactExceptions>;

const section = (data: RedactExceptions | undefined) =>
  renderToStaticMarkup(
    <TooltipRoot>
      <ExceptionsSection r={resource(data)} onAdd={() => {}} onRemove={() => {}} />
    </TooltipRoot>,
  );
const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const event = (x: Partial<SecurityEventView>): SecurityEventView => ({
  id: 7,
  at_ms: 0,
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
  direction: "request",
  locations: [],
  more_locations: 0,
  rule_snapshot: { builtin: true, id: "anthropic-api-key", name: "Anthropic API key", core_version: "0.86.0" },
  outcome_detail: { action: "replaced", placeholders: ["<<TW_SECRET_1>>"] },
  excepted: false,
  exceptable: false,
  ...x,
});

beforeEach(() => {
  setLang("zh");
  call.mockReset();
});

describe("例外一节", () => {
  it("没有例外：一句说明和「添加例外」", () => {
    const text = plain(section({ items: [], max: 500 }));
    expect(text).toContain("无例外值。");
    expect(text).toContain("添加例外");
    expect(text).not.toContain("个值");
    expect(text).not.toContain("首次认出的规则");
  });

  it("有例外：标题写个数，表里是掩码后的值、规则名、加入时间和「移出例外」；手动加入的没有规则", () => {
    const html = section({ items: [item({}), item({ sha256: "b".repeat(64), masked: "test…1234", rule: undefined })], max: 500 });
    const text = plain(html);
    expect(text).toContain("例外 · 2 个值");
    expect(html.match(/data-slot="exception"/g)).toHaveLength(2);
    expect(text).toContain("sk-ant-api03-…Q3xA");
    // 规则目录没取到时写 id
    expect(text).toContain("anthropic-api-key");
    expect(text).toContain("test…1234 —");
    expect(text).toContain("移出例外");
    // 只有掩码后的值，没有哈希
    expect(html).not.toContain("a".repeat(64));
  });

  it("满了：「添加例外」置灰，旁边写明原因", () => {
    const html = section({ items: [item({})], max: 1 });
    expect(plain(html)).toContain("已达上限 1 个");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?添加例外/);
  });

  it("尚未读到：不画按钮", () => {
    expect(plain(section(undefined))).not.toContain("添加例外");
  });

  it("英文界面", () => {
    setLang("en");
    const text = plain(section({ items: [item({})], max: 500 }));
    expect(text).toContain("Exceptions · 1 value");
    expect(text).toContain("First found by");
    expect(text).toContain("Remove");
  });
});

describe("命中详情", () => {
  const detail = (e: SecurityEventView, onExcept?: () => void) =>
    plain(
      renderToStaticMarkup(
        <TooltipRoot>
          <HitDetail e={e} onExcept={onExcept} />
        </TooltipRoot>,
      ),
    );

  it("能列为例外的才有「列为例外」", () => {
    expect(detail(event({ exceptable: true }), () => {})).toContain("列为例外");
    expect(detail(event({ exceptable: false }), () => {})).not.toContain("列为例外");
    // 请求详情里不给入口
    expect(detail(event({ exceptable: true }))).not.toContain("列为例外");
  });

  it("此刻是例外的标「例外」", () => {
    expect(detail(event({ excepted: true }))).toMatch(/例外/);
    expect(detail(event({}))).not.toMatch(/例外/);
  });
});

describe("交给 core 的调用", () => {
  it("命中次数、例外的列出、加入、从日志列入、移出", async () => {
    call.mockResolvedValue(null);
    await api.counts("redact", 1000);
    await api.exceptions();
    await api.addException("sk-test-value", "v1");
    await api.exceptEvent(42, "v2");
    await api.removeException("c".repeat(64), "v3");
    expect(call.mock.calls).toEqual([
      ["SecurityRuleCounts", { guard: "redact", since_ms: 1000 }],
      ["RedactExceptions", null],
      ["AddRedactException", { value: "sk-test-value", base_version: "v1" }],
      ["ExceptSecurityEvent", { base_version: "v2" }, "42"],
      ["RemoveRedactException", { base_version: "v3" }, "c".repeat(64)],
    ]);
  });
});
