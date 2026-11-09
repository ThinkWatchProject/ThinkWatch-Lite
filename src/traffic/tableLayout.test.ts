import { describe, expect, it } from "vitest";
import { ACTION_WIDTH, pinnedColumns, sizeColumns } from "./tableLayout";
import type { Col } from "./virtual";

describe("流量表弹性列宽和固定边界", () => {
  const columns: Col[] = ["status", "model", "upstream", "tokens", "cost"];
  const measured = { status: 48, model: 220, upstream: 172, tokens: 110, cost: 86 };

  it("先收缩名字列，数字按真实内容保留，放不下时才横向滚动", () => {
    const small = sizeColumns(columns, measured, 500);
    expect(small.widths.tokens).toBe(110);
    expect(small.widths.cost).toBe(86);
    expect(small.width).toBe(500);
    expect(small.widths.model).toBeGreaterThanOrEqual(112);
    expect(small.widths.upstream).toBeGreaterThanOrEqual(88);
    const narrow = sizeColumns(columns, measured, 320);
    expect(narrow.width).toBeGreaterThan(320);
    expect(narrow.widths.model).toBe(112);
    expect(narrow.widths.upstream).toBe(88);
    const wide = sizeColumns(columns, measured, 1000);
    expect(wide.width).toBe(1000);
    expect(wide.widths.tokens).toBe(110);
  });

  it("固定偏移使用实际可见列宽，包含右边的操作入口", () => {
    const { widths } = sizeColumns(columns, measured, 700);
    const layout = pinnedColumns(columns, { status: "left", tokens: "right", cost: "right" }, widths, 700);
    expect(layout.styles.status?.left).toBe(20);
    expect(layout.styles.cost?.right).toBe(20 + ACTION_WIDTH);
    expect(layout.styles.tokens?.right).toBe(20 + ACTION_WIDTH + widths.cost!);
    const noCost = pinnedColumns(columns.filter((c) => c !== "cost"), { tokens: "right", cost: "right" }, widths, 700);
    expect(noCost.styles.tokens?.right).toBe(20 + ACTION_WIDTH);
    expect(noCost.styles.cost).toBeUndefined();
  });

  it("安全和转换徽标为上游列保留最低宽度，不因名称收缩而截断", () => {
    const narrow = sizeColumns(columns, measured, 320, { upstream: 148 });
    expect(narrow.widths.upstream).toBe(148);
    expect(narrow.widths.tokens).toBe(110);
    expect(narrow.width).toBeGreaterThan(320);
  });

  it("过多固定列不会互相遮挡，恢复窗口后自动恢复原设置", () => {
    const pins = { status: "left", model: "left", upstream: "right", tokens: "right", cost: "right" } as const;
    const { widths } = sizeColumns(columns, measured, 500);
    const small = pinnedColumns(columns, pins, widths, 320);
    const fixedWidth = columns.reduce((sum, c) => sum + (small.pins[c] ? widths[c]! : 0), 0);
    expect(fixedWidth + ACTION_WIDTH + 96).toBeLessThanOrEqual(320);
    expect(small.pins.model).toBeUndefined();
    expect(pinnedColumns(columns, pins, widths, 1000).pins.model).toBe("left");
    expect(pins.model).toBe("left");
  });
});
