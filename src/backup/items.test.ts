import { beforeAll, describe, expect, it } from "vitest";
import { setLang } from "@/i18n";
import type { ItemNode, ItemRef } from "@/types";
import { closure, differsLabel, groupBy, itemLabel, originLabel, refKey, refOf } from "./items";

beforeAll(() => setLang("zh"));

const node = (kind: ItemRef["kind"], name: string, refs: ItemRef[] = []): ItemNode => ({ item: { kind, name }, refs });

describe("配置项目", () => {
  it("键能原样拆回去，名字里有冒号也一样", () => {
    for (const r of [
      { kind: "provider", name: "relay:cn" },
      { kind: "security_rule", name: "content/项目代号" },
      { kind: "route_order", name: "" },
    ] as ItemRef[]) {
      expect(refOf(refKey(r))).toEqual(r);
    }
  });

  /** 规格 5.2：所选项目引用的项目自动勾上，一层层往下找；标「随附」的只是因为被引用才进来的 */
  it("随附按引用一层层补齐", () => {
    const nodes = [
      node("route", "长上下文", [{ kind: "provider", name: "公司中转" }, { kind: "group", name: "main" }]),
      node("group", "main", [{ kind: "provider", name: "anthropic" }]),
      node("provider", "公司中转", [{ kind: "proxy", name: "clash" }]),
      node("provider", "anthropic"),
      node("proxy", "clash"),
      node("provider", "ollama"),
    ];
    const { included, along } = closure(new Set([refKey({ kind: "route", name: "长上下文" })]), nodes);
    expect([...included].sort()).toEqual(
      ["group:main", "provider:anthropic", "provider:公司中转", "proxy:clash", "route:长上下文"].sort(),
    );
    expect(along.has("route:长上下文")).toBe(false);
    expect(along.has("proxy:clash")).toBe(true);
    // 自己选了的不算随附
    const both = closure(new Set(["route:长上下文", "proxy:clash"]), nodes);
    expect(both.along.has("proxy:clash")).toBe(false);
    // 引用成环也停得下来
    const loop = [node("group", "a", [{ kind: "group", name: "b" }]), node("group", "b", [{ kind: "group", name: "a" }])];
    expect(closure(new Set(["group:a"]), loop).included.size).toBe(2);
  });

  it("全局设置写节名，安全规则写分项和规则名，认不出的照原样", () => {
    expect(itemLabel({ kind: "global", name: "failover" })).toBe("故障转移");
    expect(itemLabel({ kind: "global", name: "something_new" })).toBe("something_new");
    expect(itemLabel({ kind: "security_rule", name: "content/项目代号" })).toBe("内容过滤 · 项目代号");
    expect(itemLabel({ kind: "security_rule", name: "other/x" })).toBe("other · x");
    expect(itemLabel({ kind: "client_prefs", name: "" })).toBe("Lite 通用偏好");
    expect(itemLabel({ kind: "provider", name: "relay" })).toBe("relay");
  });

  it("按类分组：类的先后固定，组里保持原来的顺序，路由顺序归进全局设置", () => {
    const groups = groupBy(
      [
        { kind: "plugin", name: "p" },
        { kind: "provider", name: "b" },
        { kind: "route_order", name: "" },
        { kind: "provider", name: "a" },
        { kind: "global", name: "failover" },
      ] as ItemRef[],
      (r) => r,
    );
    expect(groups.map((g) => g.kind)).toEqual(["provider", "plugin", "global"]);
    expect(groups[0]!.items.map((r) => r.name)).toEqual(["b", "a"]);
    expect(groups[2]!.items.map((r) => r.kind)).toEqual(["route_order", "global"]);
  });

  it("来源与不同之处的写法", () => {
    expect(originLabel("sync", "MacBook Air")).toBe("同步自 MacBook Air");
    expect(originLabel("sync", null)).toBe("同步");
    expect(originLabel("external", null)).toBe("手动编辑文件");
    expect(differsLabel(["conn", "models"])).toBe("连接、模型不同");
    expect(differsLabel(["retries"])).toBe("retries 不同");
    expect(differsLabel([])).toBeNull();
  });
});
