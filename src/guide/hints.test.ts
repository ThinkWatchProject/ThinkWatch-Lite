import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 内存里的 localStorage：每个用例一份新的，模块也重新载入（= 重新打开应用） */
function memoryStorage(seed?: string) {
  const data = new Map<string, string>(seed === undefined ? [] : [["tw-guide", seed]]);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    raw: () => data.get("tw-guide"),
  };
}

async function load(storage: ReturnType<typeof memoryStorage>) {
  vi.stubGlobal("window", { localStorage: storage });
  vi.resetModules();
  return import("./hints");
}

/** 画一个用 useHint 的组件，看它此刻说不说 */
function shown(mod: Awaited<ReturnType<typeof load>>, id: Parameters<typeof mod.useHint>[0], when: boolean) {
  const Probe = () => (mod.useHint(id, when).show ? "on" : "off");
  return renderToStaticMarkup(createElement(Probe));
}

describe("引导提示", () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it("条件成立、没点过「不再显示」时才出现", async () => {
    const mod = await load(memoryStorage());
    expect(shown(mod, "traffic-open-row", true)).toBe("on");
    expect(shown(mod, "traffic-open-row", false)).toBe("off");
  });

  it("点过「不再显示」之后不再出现，重新打开应用也一样", async () => {
    const storage = memoryStorage();
    const mod = await load(storage);
    // 点击发生在组件里：拿到 dismiss 再调
    let dismiss = () => {};
    const Grab = () => {
      dismiss = mod.useHint("security-observe", true).dismiss;
      return null;
    };
    renderToStaticMarkup(createElement(Grab));
    dismiss();
    expect(shown(mod, "security-observe", true)).toBe("off");
    // 别的提示不受影响
    expect(shown(mod, "traffic-open-row", true)).toBe("on");
    const again = await load(memoryStorage(storage.raw()));
    expect(shown(again, "security-observe", true)).toBe("off");
  });

  it("「重新显示」让关掉的全部回来，「开始使用」看过的记录留着", async () => {
    const storage = memoryStorage(JSON.stringify({ dismissed: ["next-clients", "first-request"], setupSeen: true }));
    const mod = await load(storage);
    expect(shown(mod, "next-clients", true)).toBe("off");
    mod.resetHints();
    expect(shown(mod, "next-clients", true)).toBe("on");
    expect(shown(mod, "first-request", true)).toBe("on");
    expect(JSON.parse(storage.raw()!)).toEqual({ dismissed: [], setupSeen: true });
  });

  it("一次记下好几条（别名的建议「忽略」全部），记过的不重复，「重新显示」一起回来", async () => {
    const storage = memoryStorage(JSON.stringify({ dismissed: ["next-clients"], setupSeen: false }));
    const mod = await load(storage);
    const Dismissed = () => mod.useDismissedHints().join(" ");
    mod.dismissHints(["alias-suggestion:Claude Opus 5|a,b", "next-clients", "alias-suggestion:Claude Opus 5|a,b"]);
    expect(renderToStaticMarkup(createElement(Dismissed))).toBe("next-clients alias-suggestion:Claude Opus 5|a,b");
    const again = await load(memoryStorage(storage.raw()));
    expect(renderToStaticMarkup(createElement(() => again.useDismissedHints().length))).toBe("2");
    again.resetHints();
    expect(renderToStaticMarkup(createElement(() => again.useDismissedHints().length))).toBe("0");
  });

  it("「开始使用」出现过才记一笔，只记一次", async () => {
    const storage = memoryStorage();
    const mod = await load(storage);
    const Seen = () => (mod.useSetupSeen() ? "seen" : "new");
    expect(renderToStaticMarkup(createElement(Seen))).toBe("new");
    mod.markSetupSeen();
    mod.markSetupSeen();
    expect(renderToStaticMarkup(createElement(Seen))).toBe("seen");
    expect(JSON.parse(storage.raw()!).setupSeen).toBe(true);
  });

  it("存的东西读不出来就当没看过", async () => {
    const mod = await load(memoryStorage("{not json"));
    expect(shown(mod, "next-upstream", true)).toBe("on");
    const odd = await load(memoryStorage(JSON.stringify({ dismissed: "next-upstream", setupSeen: "yes" })));
    expect(shown(odd, "next-upstream", true)).toBe("on");
    expect(renderToStaticMarkup(createElement(() => (odd.useSetupSeen() ? "seen" : "new")))).toBe("new");
  });

  it("存不进去时这一次运行里照样不再出现", async () => {
    const broken = { ...memoryStorage(), setItem: () => { throw new Error("quota"); } };
    const mod = await load(broken as unknown as ReturnType<typeof memoryStorage>);
    let dismiss = () => {};
    renderToStaticMarkup(createElement(() => ((dismiss = mod.useHint("next-request", true).dismiss), null)));
    expect(() => dismiss()).not.toThrow();
    expect(shown(mod, "next-request", true)).toBe("off");
  });
});
