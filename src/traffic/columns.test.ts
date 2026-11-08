import { describe, expect, it } from "vitest";
import { ALL_COLUMNS, COMPACT_COLUMNS, DEFAULT_COLUMNS, moveColumn, normalizeColumns, toggleColumn, visibleColumns } from "./columns";

describe("流量列设置", () => {
  it("修复无效或旧的偏好，始终保留状态首列并补齐缺少的列", () => {
    expect(normalizeColumns(null)).toEqual(DEFAULT_COLUMNS);
    const settings = normalizeColumns({ order: ["cost", "cost", "unknown", null], hidden: ["status", "time", "unknown", "time"] });
    expect(settings.order).toEqual(["status", "cost", ...ALL_COLUMNS.filter((c) => c !== "status" && c !== "cost")]);
    expect(settings.hidden).toEqual(["time"]);
  });

  it("密钥默认随数据显隐；手动显示后单密钥也可见", () => {
    expect(visibleColumns(DEFAULT_COLUMNS, false)).not.toContain("client");
    expect(visibleColumns(DEFAULT_COLUMNS, true)).toContain("client");
    const selected = toggleColumn(DEFAULT_COLUMNS, "client", true);
    expect(visibleColumns(selected, false)).toContain("client");
    expect(visibleColumns(toggleColumn(selected, "client", false), true)).not.toContain("client");
  });

  it("调整顺序和隐藏后往返存储仍保留选择", () => {
    const settings = moveColumn(toggleColumn(DEFAULT_COLUMNS, "upstream", false), "cost", -1);
    const restored = normalizeColumns(JSON.parse(JSON.stringify(settings)));
    expect(visibleColumns(restored, true)).toEqual(["status", "time", "client", "model", "latency", "cost", "tokens"]);
    expect(moveColumn(restored, "status", 1)).toBe(restored);
    expect(moveColumn(restored, "time", -1)).toBe(restored);
    expect(toggleColumn(restored, "status", false)).toBe(restored);
  });

  it("紧凑视图保留模型、token 和费用", () => {
    expect(visibleColumns(COMPACT_COLUMNS, true)).toEqual(["status", "time", "model", "tokens", "cost"]);
  });
});
