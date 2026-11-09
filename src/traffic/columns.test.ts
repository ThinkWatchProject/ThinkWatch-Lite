import { describe, expect, it } from "vitest";
import { ALL_COLUMNS, COMPACT_COLUMNS, DEFAULT_COLUMNS, moveColumn, normalizeColumns, pinColumn, toggleColumn, visibleColumns } from "./columns";

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

  it("迁移旧偏好不会移动指标列，新布局默认固定指标", () => {
    const old = { order: ["status", "cost", "model", "tokens", "time", "upstream", "client", "latency"], hidden: ["upstream"], autoClient: false };
    const migrated = normalizeColumns(old);
    expect(migrated.pinned).toEqual({});
    expect(visibleColumns(migrated, true)).toEqual(old.order.filter((c) => c !== "upstream"));
    expect(DEFAULT_COLUMNS.pinned).toEqual({ tokens: "right", cost: "right" });
    expect(normalizeColumns({ order: ALL_COLUMNS, hidden: [] }).pinned).toEqual(DEFAULT_COLUMNS.pinned);
    expect(normalizeColumns({ order: ALL_COLUMNS, pinned: {} }).pinned).toEqual({});
  });

  it("固定、隐藏、恢复和持久化不丢失用户的相对顺序", () => {
    const original = normalizeColumns({ order: ["status", "upstream", "cost", "time", "model"] });
    const fixed = pinColumn(pinColumn(original, "upstream", "right"), "model", "left");
    expect(visibleColumns(fixed, true)).toEqual(["status", "model", "cost", "time", "client", "latency", "tokens", "upstream"]);
    expect(fixed.pinned.status).toBe("left");
    const hidden = toggleColumn(fixed, "upstream", false);
    expect(visibleColumns(hidden, true)).not.toContain("upstream");
    expect(hidden.pinned.upstream).toBe("right");
    const restored = normalizeColumns(JSON.parse(JSON.stringify(toggleColumn(hidden, "upstream", true))));
    expect(visibleColumns(restored, true)).toEqual(visibleColumns(fixed, true));
    expect(pinColumn(pinColumn(restored, "model", null), "upstream", null).order).toEqual(original.order);
    expect(moveColumn(fixed, "model", 1)).toBe(fixed);
    expect(pinColumn(fixed, "status", "right")).toBe(fixed);
  });

  it("清理非法固定位置，状态列不能被移到右侧", () => {
    expect(normalizeColumns({ pinned: { cost: "right", upstream: "left", model: "invalid", unknown: "left", status: "right" } }).pinned)
      .toEqual({ cost: "right", upstream: "left", status: "left" });
  });
});
