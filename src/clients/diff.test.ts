import { describe, expect, it } from "vitest";
import { diffRows } from "./PlanDialog";

describe("逐行 diff", () => {
  it("没动的行原地不动，改动的行紧挨着", () => {
    const before = '{\n  "a": 1,\n  "b": 2\n}\n';
    const after = '{\n  "a": 1,\n  "b": 3\n}\n';
    expect(diffRows(before, after)).toEqual([
      { text: "{", kind: "same" },
      { text: '  "a": 1,', kind: "same" },
      { text: '  "b": 2', kind: "del" },
      { text: '  "b": 3', kind: "add" },
      { text: "}", kind: "same" },
      { text: "", kind: "same" },
    ]);
  });

  it("新建的文件每一行都是加的", () => {
    expect(diffRows("", "{\n}\n").map((r) => r.kind)).toEqual(["add", "add", "same"]);
  });

  it("几万行里只动了一行：只比中间那一段，结果照样对", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}`);
    const after = [...lines.slice(0, 10_000), "inserted", ...lines.slice(10_000)];
    const rows = diffRows(lines.join("\n"), after.join("\n"));
    expect(rows.filter((r) => r.kind !== "same")).toEqual([{ text: "inserted", kind: "add" }]);
    expect(rows.map((r) => r.text)).toEqual(after);
  });
});
