import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 内存里的 localStorage：每个用例一份新的，模块也重新载入（= 重新打开应用） */
function memoryStorage(seed?: string) {
  const data = new Map<string, string>(seed === undefined ? [] : [["tw-ignored", seed]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    raw: () => data.get("tw-ignored"),
  };
}

async function load(storage: ReturnType<typeof memoryStorage>) {
  vi.stubGlobal("window", { localStorage: storage });
  vi.resetModules();
  return import("./ignore");
}

type Mod = Awaited<ReturnType<typeof load>>;

/** 画一个用 useIgnored 的组件：此刻忽略了没有，顺手把 ignore 交出来 */
function probe(mod: Mod, key: string, current: number, opts?: { session?: boolean }) {
  let ignore = () => {};
  const Probe = () => {
    const r = mod.useIgnored(key, current, mod.noMore, opts);
    ignore = r.ignore;
    return r.ignored ? "ignored" : "shown";
  };
  const out = renderToStaticMarkup(createElement(Probe));
  return { out, ignore };
}

describe("忽略", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("没忽略过就显示；忽略后记在这台电脑上，数变多了再出现", async () => {
    const storage = memoryStorage();
    const mod = await load(storage);
    const first = probe(mod, "attention:failed", 5);
    expect(first.out).toBe("shown");
    first.ignore();
    expect(storage.raw()).toBe(JSON.stringify({ "attention:failed": 5 }));
    expect(probe(mod, "attention:failed", 5).out).toBe("ignored");
    expect(probe(mod, "attention:failed", 4).out).toBe("ignored");
    expect(probe(mod, "attention:failed", 6).out).toBe("shown");
    // 重新打开应用还记得
    const again = await load(memoryStorage(storage.raw()));
    expect(probe(again, "attention:failed", 5).out).toBe("ignored");
  });

  it("只记这一次运行的：重新打开就忘了", async () => {
    const storage = memoryStorage();
    const mod = await load(storage);
    probe(mod, "shell:lost", 1, { session: true }).ignore();
    expect(probe(mod, "shell:lost", 1, { session: true }).out).toBe("ignored");
    expect(storage.raw()).toBeUndefined();
    const again = await load(memoryStorage());
    expect(probe(again, "shell:lost", 1, { session: true }).out).toBe("shown");
  });

  it("「重新显示」清掉全部，坏掉的存储当没忽略过", async () => {
    const mod = await load(memoryStorage("not json"));
    expect(probe(mod, "a", 1).out).toBe("shown");
    probe(mod, "a", 1).ignore();
    probe(mod, "b", 1, { session: true }).ignore();
    mod.resetIgnored();
    expect(probe(mod, "a", 1).out).toBe("shown");
    expect(probe(mod, "b", 1, { session: true }).out).toBe("shown");
  });
});
