import { describe, expect, it } from "vitest";
import { writeQueue, type VersionRef } from "./writeQueue";

/**
 * 一个按版本号把关的 core：带的版本号不是现在这一版就拒（409），写成了换一版。
 * 回话前让出一轮，和真的 IPC 一样是异步的。
 */
function fakeCore() {
  let n = 1;
  const seen: string[] = [];
  return {
    get current() {
      return `v${n}`;
    },
    seen,
    async write(base: string): Promise<{ version: string }> {
      seen.push(base);
      await new Promise((r) => setTimeout(r, 1));
      if (base !== `v${n}`) throw new Error(`409: based on ${base}, current is v${n}`);
      n += 1;
      return { version: `v${n}` };
    },
  };
}

function ref(initial: string): VersionRef & { value: string } {
  return {
    value: initial,
    get() {
      return this.value;
    },
    set(v: string) {
      this.value = v;
    },
  };
}

describe("连着写配置", () => {
  it("接连两次都写成：第二次带的是第一次写完的版本号", async () => {
    // 以前两次都读 `version.current`、一起发出去，第二次拿着旧版本号被拒
    const core = fakeCore();
    const version = ref(core.current);
    const queue = writeQueue(version);
    const [a, b] = await Promise.all([queue((base) => core.write(base)), queue((base) => core.write(base))]);
    expect(a.version).toBe("v2");
    expect(b.version).toBe("v3");
    expect(core.seen).toEqual(["v1", "v2"]);
    expect(version.value).toBe("v3");
  });

  it("一次写失败，错误交给它的调用方，后面的照常写，带的是最后一次成功的版本号", async () => {
    const core = fakeCore();
    const version = ref(core.current);
    const queue = writeQueue(version);
    const first = queue((base) => core.write(base));
    const broken = queue(() => Promise.reject(new Error("名字已被占用")));
    const third = queue((base) => core.write(base));
    await expect(first).resolves.toEqual({ version: "v2" });
    await expect(broken).rejects.toThrow("名字已被占用");
    await expect(third).resolves.toEqual({ version: "v3" });
    expect(core.seen).toEqual(["v1", "v2"]);
  });

  it("两次之间概览读回来了新版本（别处改过）：下一次带的是它", async () => {
    const core = fakeCore();
    const version = ref(core.current);
    const queue = writeQueue(version);
    await queue((base) => core.write(base));
    // 另一个窗口写了一次，概览跟上了
    await core.write(core.current);
    version.set(core.current);
    await expect(queue((base) => core.write(base))).resolves.toEqual({ version: "v4" });
  });

  it("按排进去的顺序一个一个来，不并发", async () => {
    const version = ref("v1");
    const queue = writeQueue(version);
    const log: string[] = [];
    const step = (name: string, ms: number) =>
      queue(async (base) => {
        log.push(`${name} start ${base}`);
        await new Promise((r) => setTimeout(r, ms));
        log.push(`${name} end`);
        return { version: `${base}+${name}` };
      });
    await Promise.all([step("a", 5), step("b", 1), step("c", 0)]);
    expect(log).toEqual(["a start v1", "a end", "b start v1+a", "b end", "c start v1+a+b", "c end"]);
  });
});
