import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestRow } from "@/types";
import { ModelCell } from "./ModelCell";
import { KeyCell } from "./cells";
import { RequestTable } from "./RequestTable";

vi.mock("@/ui/tip", () => ({ Tip: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("./useModelVia", () => ({ useViaConfig: () => null }));

const row: RequestRow = { id: 1, client: "my-client", model: "opus", sentModel: "glm-5.3", provider: "relay", path: "/v1/messages", atMs: 0, state: "done", status: 200 };

function table(grouped: boolean) {
  return renderToStaticMarkup(<RequestTable
    scroller={{ current: null }} rows={[row]} columns={["status", "cost", "model"]}
    openGroups={new Set(["s"])} selectedSession={null} onToggleGroup={() => {}} onOpenSession={() => {}}
    onAbortSession={() => {}} cursor={null} fresh={new Set()} freshGroups={new Set()} today={0}
    sortKey="time" sortDir="desc" onSort={() => {}} onCursor={() => {}} onOpen={() => {}} onFilter={() => {}}
    groups={grouped ? [{ id: "s", session: null, rows: [row] }] : undefined}
  />);
}

describe("流量表列与内容", () => {
  it.each([false, true])("自定义列顺序在请求和会话表头、表体一致（归组 %s）", (grouped) => {
    const html = table(grouped);
    const header = html.match(/<thead[\s\S]*?<\/thead>/)![0];
    expect(header.indexOf("费用")).toBeLessThan(header.indexOf("模型"));
    expect(header).not.toContain("上游");
    const rows = html.match(/<tr[^>]*data-(?:row|session)=[\s\S]*?<\/tr>/g)!;
    expect(rows.length).toBe(grouped ? 2 : 1);
    for (const r of rows) expect((r.match(/<td\b/g) ?? []).length).toBe(4);
  });

  it("改名时先显示发出的模型，再显示请求名；相同名称只显示一次", () => {
    const html = renderToStaticMarkup(<ModelCell r={row} />);
    expect(html.indexOf("glm-5.3")).toBeLessThan(html.indexOf("opus"));
    expect(html).toContain("max-width:208px");
    const same = renderToStaticMarkup(<ModelCell r={{ model: "opus", sentModel: "opus" }} />);
    expect(same.match(/opus/g)).toHaveLength(1);
  });

  it("未知应用的密钥名不留前置图标占位", () => {
    const html = renderToStaticMarkup(<KeyCell client="my-client" />);
    expect(html).toContain("my-client");
    expect(html).not.toContain("aria-hidden");
  });
});
