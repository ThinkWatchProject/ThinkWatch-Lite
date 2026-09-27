import { describe, expect, it } from "vitest";
import { locateEntry, type ConfigFocus } from "./configLocate";

/** 和截图用的示例配置同一个形状：密钥、路由同名，规则和上游同名 */
const CONFIG = `version: 1
clients:
  - name: default
    key: tw-aaa
  - name: codex
    key: tw-bbb
    route: codex
providers:
  - name: gemini
    base_url: https://generativelanguage.googleapis.com
  - name: codex-relay
    base_url: https://relay.example.com
groups:
  - name: main
    providers: [gemini]
routes:
  - name: default
    rules:
      - name: gemini
        when: { model: "gemini-*" }
        to: gemini

      - name: catch-all
        to: main
  # codex 用自己的一条
  - name: codex
    rules:
      - name: catch-all
        to: codex-relay
`;

/** 选中的那几行 */
function pick(text: string, focus: ConfigFocus): string | null {
  const r = locateEntry(text, focus);
  return r && text.slice(r[0], r[1]);
}

describe("在配置文件中定位", () => {
  it("同名的密钥和路由各自定位到自己那一段", () => {
    // 以前全文找第一个 `name: codex`，路由的「定位」选中的是那把密钥
    expect(pick(CONFIG, { section: "routes", name: "codex" })).toBe(
      "  - name: codex\n    rules:\n      - name: catch-all\n        to: codex-relay\n",
    );
    expect(pick(CONFIG, { section: "clients", name: "codex" })).toBe(
      "  - name: codex\n    key: tw-bbb\n    route: codex\n",
    );
    expect(pick(CONFIG, { section: "routes", name: "default" })).toMatch(/^ {2}- name: default\n {4}rules:/);
    expect(pick(CONFIG, { section: "clients", name: "default" })).toBe("  - name: default\n    key: tw-aaa\n");
  });

  it("只认那一段的直接成员：路由里的规则不算路由", () => {
    // 上游 gemini 在上游那一段；路由那一段里只有一条叫 gemini 的规则
    expect(pick(CONFIG, { section: "providers", name: "gemini" })).toBe(
      "  - name: gemini\n    base_url: https://generativelanguage.googleapis.com\n",
    );
    expect(pick(CONFIG, { section: "routes", name: "gemini" })).toBe("routes:\n");
  });

  it("名字按整个值比：code 不会停在 codex 上", () => {
    const text = "clients:\n  - name: codex\n    key: a\n  - name: code\n    key: b\n";
    expect(pick(text, { section: "clients", name: "code" })).toBe("  - name: code\n    key: b\n");
  });

  it("引号里的名字、行尾的注释都认", () => {
    const text = [
      "groups:",
      '  - name: "长 上下文"',
      "    providers: [a]",
      "  - name: 'it''s'   # 单引号",
      "    providers: [b]",
      "  - name: plain # 注释",
      "    providers: [c]",
      "",
    ].join("\n");
    expect(pick(text, { section: "groups", name: "长 上下文" })).toBe('  - name: "长 上下文"\n    providers: [a]\n');
    expect(pick(text, { section: "groups", name: "it's" })).toBe("  - name: 'it''s'   # 单引号\n    providers: [b]\n");
    expect(pick(text, { section: "groups", name: "plain" })).toBe("  - name: plain # 注释\n    providers: [c]\n");
  });

  it("名字不在第一行、`-` 单独一行、写成一行的 {…} 都找得到", () => {
    const text = [
      "providers:",
      "  - base_url: https://a.example.com",
      "    name: a",
      "  -",
      "    name: b",
      "    base_url: https://b.example.com",
      "  - {name: c, base_url: 'https://c.example.com'}",
      "proxies: []",
    ].join("\n");
    expect(pick(text, { section: "providers", name: "a" })).toBe("  - base_url: https://a.example.com\n    name: a\n");
    expect(pick(text, { section: "providers", name: "b" })).toBe(
      "  -\n    name: b\n    base_url: https://b.example.com\n",
    );
    expect(pick(text, { section: "providers", name: "c" })).toBe("  - {name: c, base_url: 'https://c.example.com'}\n");
  });

  it("不缩进的序列：成员的 `-` 顶格写", () => {
    const text = "clients:\n- name: a\n  key: x\n- name: b\n  key: y\nroutes:\n- name: a\n  rules: []\n";
    expect(pick(text, { section: "clients", name: "b" })).toBe("- name: b\n  key: y\n");
    expect(pick(text, { section: "routes", name: "a" })).toBe("- name: a\n  rules: []\n");
  });

  it("一项中间的空行算它的，末尾的空行和下一项前面的注释不算", () => {
    expect(pick(CONFIG, { section: "routes", name: "default" })).toBe(
      [
        "  - name: default",
        "    rules:",
        "      - name: gemini",
        '        when: { model: "gemini-*" }',
        "        to: gemini",
        "",
        "      - name: catch-all",
        "        to: main",
        "",
      ].join("\n"),
    );
  });

  it("CRLF 的文件：区间是原文的下标，连 \\r\\n 一起选", () => {
    const text = CONFIG.replaceAll("\n", "\r\n");
    expect(pick(text, { section: "clients", name: "codex" })).toBe(
      "  - name: codex\r\n    key: tw-bbb\r\n    route: codex\r\n",
    );
  });

  it("那一段里没有这一项：选中那一段的标题行；那一段都没有：不选", () => {
    expect(pick(CONFIG, { section: "groups", name: "gone" })).toBe("groups:\n");
    expect(pick(CONFIG, { section: "proxies", name: "clash" })).toBeNull();
    // 写成一行的列表认不出成员，退到标题行
    expect(pick("proxies: [{name: clash, addr: '127.0.0.1:7890'}]\n", { section: "proxies", name: "clash" })).toBe(
      "proxies: [{name: clash, addr: '127.0.0.1:7890'}]\n",
    );
  });

  it("文件开头有 BOM 时第一行的那一段照样找得到", () => {
    expect(pick("﻿clients:\n  - name: a\n    key: x\n", { section: "clients", name: "a" })).toBe(
      "  - name: a\n    key: x\n",
    );
  });

  it("只认顶格的那一段：别处缩进着的同名键不算", () => {
    const text = "security:\n  routes:\n    - name: x\nroutes:\n  - name: x\n    rules: []\n";
    expect(locateEntry(text, { section: "routes", name: "x" })).toEqual([text.indexOf("routes:\n  - name: x") + 8, text.length]);
  });
});
