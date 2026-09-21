import { describe, expect, it } from "vitest";

import { levelOf } from "./Exposure";

describe("监听范围的三档", () => {
  it("两个关键字各归各的", () => {
    expect(levelOf("loopback")).toBe("local");
    expect(levelOf("all")).toBe("all");
  });

  it("网卡名是局域网那一档", () => {
    // core v0.12.0 起配置里存的是名字，不是地址 —— 换网络之后仍然有效
    expect(levelOf("en0")).toBe("lan");
    expect(levelOf("utun3")).toBe("lan");
  });

  it("一张具体网卡的地址也是局域网那一档", () => {
    // 老配置和手写的都是地址，它们不该显示成别的档
    expect(levelOf("192.168.1.5")).toBe("lan");
  });

  it("写死的回环地址是仅本机，不是局域网", () => {
    // **判的是地址，不是写法** —— core 的 `is_exposed` 也是这么判的。
    // 判错的表现是界面凭空报一次暴露，而那台机器根本没对外监听
    expect(levelOf("127.0.0.1")).toBe("local");
    expect(levelOf("127.0.0.53")).toBe("local");
    expect(levelOf("::1")).toBe("local");
  });
});
