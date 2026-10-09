import { describe, expect, it } from "vitest";
import { nameIn } from "./row-menu";

describe("菜单条目里的名字", () => {
  it("拆成名字前、名字、名字后：只截断名字，动词留着", () => {
    expect(nameIn("仅显示上游 公司内部的 Claude 中转", "公司内部的 Claude 中转")).toEqual(["仅显示上游 ", "公司内部的 Claude 中转", ""]);
    expect(nameIn("Show only key ci-pipeline", "ci-pipeline")).toEqual(["Show only key ", "ci-pipeline", ""]);
    expect(nameIn("Requests of ci (last 24 h)", "ci")).toEqual(["Requests of ", "ci", " (last 24 h)"]);
  });

  it("没给名字、字里找不到它：不拆，原样写整句", () => {
    expect(nameIn("复制 ID")).toBe(null);
    expect(nameIn("复制 ID", "")).toBe(null);
    expect(nameIn("仅显示上游 relay", "openrouter")).toBe(null);
  });
});
