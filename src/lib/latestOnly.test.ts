import { describe, expect, it } from "vitest";
import { latestOnly } from "./latestOnly";

describe("只认最后一次", () => {
  it("后发出的那一次回来之前，先发出的那一次作废", () => {
    const tests = latestOnly();
    const first = tests.start();
    const second = tests.start();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("表单改了（drop）：还没回来的那一次作废，之后再发出的照常算", () => {
    // 检测连接发出去之后改了密钥：回来的「连接正常」说的是旧密钥
    const tests = latestOnly();
    const before = tests.start();
    tests.drop();
    expect(before()).toBe(false);
    const after = tests.start();
    expect(after()).toBe(true);
  });

  it("没有别的请求、表单也没改：回来时还算数", () => {
    const tests = latestOnly();
    const only = tests.start();
    expect(only()).toBe(true);
    expect(only()).toBe(true);
  });
});
