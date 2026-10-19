import { describe, expect, it } from "vitest";
import type { ImportRow, ItemKind } from "@/types";
import {
  actionsFor,
  blocked,
  bulk,
  carryOver,
  decisions,
  initialChoices,
  rowNotes,
  listed,
  nameProblems,
  tally,
  unresolved,
  writing,
} from "./importFlow";

function row(kind: ItemKind, name: string, status: ImportRow["status"], patch: Partial<ImportRow> = {}): ImportRow {
  return {
    item: { kind, name },
    status,
    global: kind === "global",
    flags: [],
    differs: [],
    suggested_name: status === "conflict" && kind !== "global" ? `${name} (2)` : null,
    error: null,
    refs: [],
    rename_flags: [],
    ...patch,
  };
}

const ROWS: ImportRow[] = [
  row("provider", "OpenRouter", "new"),
  row("provider", "公司中转", "conflict", { differs: ["conn", "models"] }),
  row("provider", "ChatGPT", "new", { flags: ["needs_login"] }),
  row("provider", "Bedrock 东京", "error", {
    error: { code: "x", text: "no profile" },
  }),
  row("provider", "anthropic", "same"),
  row("global", "failover", "conflict"),
  row("plugin", "headers", "new", { flags: ["plugin_disabled"] }),
];

/** 规格 5.4 的逐项状态与处理 */
describe("导入的逐项处理", () => {
  it("新增的缺省导入，冲突的没有缺省值，相同与错误的不处理", () => {
    const c = initialChoices(ROWS);
    expect(c["provider:OpenRouter"]?.action).toBe("import");
    expect(c["provider:公司中转"]?.action).toBeNull();
    expect(c["provider:公司中转"]?.name).toBe("公司中转 (2)");
    expect(c["provider:Bedrock 东京"]?.action).toBe("skip");
    expect(unresolved(ROWS, c)).toBe(2);
    expect(tally(ROWS)).toEqual({ new: 3, conflict: 2, same: 1, error: 1 });
    // 相同的只计数，不列出
    expect(listed(ROWS).some((r) => r.status === "same")).toBe(false);
  });

  it("全局设置只能覆盖或跳过；新增的只能导入或跳过", () => {
    expect(actionsFor(ROWS[1]!)).toEqual(["overwrite", "rename", "skip"]);
    expect(actionsFor(ROWS[5]!)).toEqual(["overwrite", "skip"]);
    expect(actionsFor(ROWS[0]!)).toEqual(["import", "skip"]);
    expect(actionsFor(ROWS[3]!)).toEqual([]);
  });

  it("「全部改名导入」只改能改名的冲突，全局设置留着待选", () => {
    const c = bulk(ROWS, initialChoices(ROWS), "rename");
    expect(c["provider:公司中转"]?.action).toBe("rename");
    expect(c["global:failover"]?.action).toBeNull();
    expect(unresolved(ROWS, c)).toBe(1);
    const all = bulk(ROWS, c, "skip");
    expect(all["provider:公司中转"]?.action).toBe("skip");
    expect(all["global:failover"]?.action).toBe("skip");
    // 新增的不受「全部跳过」影响
    expect(all["provider:OpenRouter"]?.action).toBe("import");
    expect(unresolved(ROWS, all)).toBe(0);
  });

  it("改名的名字不能空、不能和本机或配置包里同类的重名", () => {
    let c = bulk(ROWS, initialChoices(ROWS), "rename");
    const taken = new Map<ItemKind, Set<string>>([["provider", new Set(["公司中转", "local-only"])]]);
    expect(nameProblems(ROWS, c, taken)).toEqual({});
    c = { ...c, "provider:公司中转": { action: "rename", name: "  " } };
    expect(nameProblems(ROWS, c, taken)).toEqual({ "provider:公司中转": "empty" });
    c = { ...c, "provider:公司中转": { action: "rename", name: "local-only" } };
    expect(nameProblems(ROWS, c, taken)).toEqual({ "provider:公司中转": "taken" });
    c = { ...c, "provider:公司中转": { action: "rename", name: "OpenRouter" } };
    expect(nameProblems(ROWS, c, taken)).toEqual({ "provider:公司中转": "taken" });
    // 别的类里同名不算
    c = { ...c, "provider:公司中转": { action: "rename", name: "headers" } };
    expect(nameProblems(ROWS, c, taken)).toEqual({});
  });

  it("重新预览之后选过的留着，状态变了的按新的来", () => {
    const before = bulk(ROWS, initialChoices(ROWS), "overwrite");
    const rows = ROWS.map((r) => (r.item.name === "OpenRouter" ? { ...r, status: "conflict" as const } : r));
    const c = carryOver(rows, initialChoices(rows), before);
    expect(c["provider:公司中转"]?.action).toBe("overwrite");
    expect(c["global:failover"]?.action).toBe("overwrite");
    // 原来是新增（导入），现在成了冲突：导入不是冲突的处理，要重新选
    expect(c["provider:OpenRouter"]?.action).toBeNull();
  });

  /** 规格 5.4：引用了跳过的、不可导入的项目的，随之不可导入；改名导入的、本机已有同名的不算 */
  it("引用了不导入的项目的随之不可导入，一层层传下去", () => {
    const rows: ImportRow[] = [
      row("provider", "relay", "new"),
      row("provider", "bad", "error"),
      row("provider", "anthropic", "conflict"),
      row("group", "main", "new", { refs: [{ kind: "provider", name: "relay" }] }),
      row("route", "long", "new", { refs: [{ kind: "group", name: "main" }] }),
      row("route", "tokyo", "new", { refs: [{ kind: "provider", name: "bad" }] }),
      row("route", "direct", "conflict", { refs: [{ kind: "provider", name: "anthropic" }] }),
    ];
    let c = initialChoices(rows);
    expect(Object.keys(blocked(rows, c))).toEqual(["route:tokyo"]);
    c = { ...c, "provider:relay": { action: "skip", name: "" } };
    expect(blocked(rows, c)).toEqual({
      "group:main": { kind: "provider", name: "relay" },
      "route:long": { kind: "group", name: "main" },
      "route:tokyo": { kind: "provider", name: "bad" },
    });
    // 跳过冲突的上游：本机有同名的，引用它的照样能导入
    c = { ...c, "provider:anthropic": { action: "skip", name: "" }, "route:direct": { action: "overwrite", name: "" } };
    expect(blocked(rows, c)["route:direct"]).toBeUndefined();
    // 不可导入的交「跳过」，不算没选
    const ds = decisions(rows, c);
    expect(ds.find((d) => d.item.name === "long")?.action).toBe("skip");
    expect(unresolved(rows, { ...c, "route:direct": { action: null, name: "" } })).toBe(1);
  });

  /** 改名导入是另一个项目：带什么标记由 core 说（rename_flags）；覆盖时目的地不同由 missing_key 说 */
  it("冲突行按所选处理补的说明", () => {
    const r = row("provider", "relay", "conflict", { flags: ["missing_key"], rename_flags: ["missing_key", "needs_login"] });
    expect(rowNotes(r, { action: "overwrite", name: "" })).toEqual(["destination"]);
    expect(rowNotes(r, { action: "rename", name: "relay (2)" })).toEqual(["renameKey", "renameLogin"]);
    expect(rowNotes(r, { action: "skip", name: "" })).toEqual([]);
    const proxy = row("proxy", "office", "conflict", { rename_flags: ["missing_key"] });
    expect(rowNotes(proxy, { action: "rename", name: "office (2)" })).toEqual(["renamePass"]);
    expect(rowNotes(proxy, { action: "overwrite", name: "" })).toEqual([]);
  });

  it("交给 core 的：新增与冲突各一条，改名的带新名字，取消勾选的是跳过", () => {
    let c = bulk(ROWS, initialChoices(ROWS), "rename");
    c = bulk(ROWS, c, "overwrite");
    c = { ...c, "provider:公司中转": { action: "rename", name: " 公司中转-备 " }, "plugin:headers": { action: "skip", name: "" } };
    const ds = decisions(ROWS, c);
    expect(ds).toEqual([
      { item: { kind: "provider", name: "OpenRouter" }, action: "import" },
      { item: { kind: "provider", name: "公司中转" }, action: "rename", new_name: "公司中转-备" },
      { item: { kind: "provider", name: "ChatGPT" }, action: "import" },
      { item: { kind: "global", name: "failover" }, action: "overwrite" },
      { item: { kind: "plugin", name: "headers" }, action: "skip" },
    ]);
    expect(writing(ds)).toBe(4);
  });
});
