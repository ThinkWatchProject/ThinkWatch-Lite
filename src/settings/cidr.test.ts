import { describe, expect, it } from "vitest";

import { parseRange, rangeText, v4Span } from "./cidr";

const ok = (s: string) => parseRange(s) !== null;

describe("放行网段的写法", () => {
  it("网段和单个地址都收", () => {
    for (const s of ["192.168.1.0/24", "10.0.0.0/8", "0.0.0.0/0", "192.168.1.5", "fc00::/7", "::1", "::/0"]) {
      expect(ok(s), s).toBe(true);
    }
  });

  it("一个数字不是地址", () => {
    // 只看字符的检查会把 `1` 当成一条网段收进名单
    expect(ok("1")).toBe(false);
    expect(ok("1/8")).toBe(false);
    expect(ok("192.168.1")).toBe(false);
  });

  it("每段不超过 255，也不带前导零", () => {
    expect(ok("256.1.1.1")).toBe(false);
    expect(ok("192.168.01.1")).toBe(false);
    expect(ok("192.168.1.1.1")).toBe(false);
  });

  it("前缀不超过地址的位数", () => {
    expect(ok("192.168.0.0/32")).toBe(true);
    expect(ok("192.168.0.0/33")).toBe(false);
    expect(ok("fc00::/128")).toBe(true);
    expect(ok("fc00::/129")).toBe(false);
    expect(ok("10.0.0.0/")).toBe(false);
    expect(ok("10.0.0.0/x")).toBe(false);
  });

  it("IPv6 的 :: 只能出现一次，组数要对", () => {
    expect(ok("1:2:3:4:5:6:7:8")).toBe(true);
    expect(ok("1:2:3:4:5:6:7::")).toBe(true);
    expect(ok("1:2:3:4:5:6:7")).toBe(false);
    expect(ok("1:2:3:4:5:6:7:8::")).toBe(false);
    expect(ok("1::2::3")).toBe(false);
    expect(ok("12345::1")).toBe(false);
    expect(ok(":1")).toBe(false);
  });

  it("IPv6 末尾可以嵌一个 IPv4，别处不行", () => {
    expect(ok("::ffff:192.168.1.5")).toBe(true);
    expect(ok("1.2.3.4::")).toBe(false);
    expect(ok("::ffff:192.168.1.5:1")).toBe(false);
  });

  it("带网卡后缀的链路本地地址不收", () => {
    // core 的地址解析也不认 `%en0`，存进去整份配置都读不了
    expect(ok("fe80::1%en0")).toBe(false);
  });

  it("存的写法去掉空白，IPv6 转小写", () => {
    const at = (s: string) => rangeText(parseRange(s)!, s);
    expect(at(" 192.168.1.0/24 ")).toBe("192.168.1.0/24");
    expect(at("FC00::/7")).toBe("fc00::/7");
    expect(at("192.168.1.5")).toBe("192.168.1.5");
  });
});

describe("IPv4 网段的起止", () => {
  const span = (s: string) => v4Span(parseRange(s)!);

  it("私网段", () => {
    expect(span("10.0.0.0/8")).toEqual(["10.0.0.0", "10.255.255.255"]);
    expect(span("172.16.0.0/12")).toEqual(["172.16.0.0", "172.31.255.255"]);
    expect(span("192.168.0.0/16")).toEqual(["192.168.0.0", "192.168.255.255"]);
  });

  it("主机位写了也照网段算", () => {
    expect(span("192.168.1.5/24")).toEqual(["192.168.1.0", "192.168.1.255"]);
    expect(span("0.0.0.0/0")).toEqual(["0.0.0.0", "255.255.255.255"]);
  });

  it("单个地址和 IPv6 不给", () => {
    expect(span("192.168.1.5")).toBeNull();
    expect(span("192.168.1.5/32")).toBeNull();
    expect(span("fc00::/7")).toBeNull();
  });
});
