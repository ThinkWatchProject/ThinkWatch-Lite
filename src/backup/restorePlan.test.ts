import { describe, expect, it } from "vitest";
import type { ItemRef, RestoreRow } from "@/types";
import { planRows, selection, tallyWritten } from "./restorePlan";

const ref = (kind: ItemRef["kind"], name: string): ItemRef => ({ kind, name });
const row = (item: ItemRef, change: RestoreRow["change"], kept: RestoreRow["kept"] = null): RestoreRow => ({
  item,
  change,
  kept,
});

const BASE: RestoreRow[] = [
  row(ref("provider", "relay"), "add"),
  row(ref("route", "long"), "modify"),
  row(ref("alias", "kimi"), "remove"),
  row(ref("key", "cursor"), "remove", "key_in_use"),
];

/** 规格 7.2 与 core 的计划：勾的是人选的，会动什么以 core 交回的为准 */
describe("恢复预览的勾选与计划", () => {
  it("全勾着交整个版本，取消勾选的不交，保留的本来就不能勾", () => {
    expect(selection(BASE, new Set())).toBeNull();
    expect(selection(BASE, new Set(["alias:kimi"]))).toEqual([ref("provider", "relay"), ref("route", "long")]);
  });

  it("没勾的写保持当前内容；被所选项目带着的写一并恢复；core 保留的写原因", () => {
    const unchecked = new Set(["provider:relay", "alias:kimi"]);
    // 只恢复路由：它用的上游本机没有，一并恢复；别名还被留下的路由引用，保留
    const plan = [row(ref("route", "long"), "modify"), row(ref("provider", "relay"), "add"), row(ref("alias", "kimi"), "remove", "referenced")];
    const shown = planRows(BASE, plan, unchecked);
    expect(shown.map((r) => [r.row.item.name, r.note, r.checked])).toEqual([
      ["relay", "along", false],
      ["long", "chosen", true],
      ["kimi", "kept", false],
      ["cursor", "kept", false],
    ]);
    expect(shown.find((r) => r.row.item.name === "kimi")?.row.kept).toBe("referenced");
    const none = planRows(BASE, [row(ref("route", "long"), "modify")], unchecked);
    expect(none.find((r) => r.row.item.name === "relay")?.note).toBe("untouched");
  });

  it("计划里多出来的（骨架里没有的）接在后面，不给勾", () => {
    const shown = planRows(BASE, [...BASE, row(ref("proxy", "clash"), "add")], new Set());
    expect(shown.at(-1)).toMatchObject({ box: false, note: "along" });
  });

  it("完成后的提示按实际动了的数", () => {
    expect(tallyWritten([row(ref("route", "a"), "add"), row(ref("key", "b"), "remove", "key_in_use")])).toEqual({
      restored: 1,
      kept: 1,
    });
  });
});
