import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ImportProposal, Overview } from "@/types";
import { ImportDialog } from "./ImportDialog";

// 对话框挂在 portal 里，服务端渲染画不出来：换成原地画的外壳，只看里面画了什么
vi.mock("@/ui/dialog", () => {
  const box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: box,
    DialogContent: box,
    DialogDescription: box,
    DialogFooter: box,
    DialogHeader: box,
    DialogTitle: box,
  };
});

const ov = { providers: [{ name: "taken" }], config_version: "v1" } as unknown as Overview;

/**
 * 绕过 Rust 侧的校验直接喂给界面：即使一份带着标记、脚本、Markdown 的提议漏了进来，
 * 对话框也只把它们当成文字
 */
const hostile: ImportProposal = {
  name: '<img src=x onerror="alert(1)">',
  base_url: "https://relay.example/<script>alert(1)</script>",
  host: "xn--pple-43d.example",
  protocol: "anthropic",
  key: "sk-[click](javascript:alert(1))",
  models: ["__bold__", "<a href='https://evil.example'>x</a>"],
};

function render(p: ImportProposal) {
  return renderToStaticMarkup(<ImportDialog proposal={p} ov={ov} onClose={() => {}} onCreated={() => {}} />);
}

describe("导入确认框", () => {
  it("把链接里的内容都当纯文本画", () => {
    const html = render(hostile);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<a[\s>]/i);
    expect(html).not.toMatch(/<strong|<b>|<em>/i);
    expect(html).not.toMatch(/\s(href|src|onerror)="/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("__bold__");
    expect(html).toContain("&lt;a href=&#x27;https://evil.example&#x27;&gt;x&lt;/a&gt;");
  });

  it("写明请求和密钥发往哪台主机（ASCII）", () => {
    const html = render(hostile);
    expect(html).toContain("请求内容与 API 密钥将发送至");
    expect(html).toMatch(/data-testid="import-host"[^>]*>xn--pple-43d\.example</);
  });

  it("密钥原样放在默认隐藏的输入框里", () => {
    const html = render(hostile);
    expect(html).toMatch(/type="password"[^>]*value="sk-\[click\]\(javascript:alert\(1\)\)"/);
  });

  it("名称已被使用时不能创建", () => {
    const html = render({ ...hostile, name: "taken" });
    expect(html).toContain("名称「taken」已被其他上游使用");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>创建/);
  });

  it("没给名称就按地址起一个", () => {
    const html = render({ base_url: "https://api.relay.example/v1", host: "api.relay.example", models: [] });
    expect(html).toMatch(/id="import-name"[^>]*value="relay"/);
    expect(html).toContain("未提供");
  });

  it("源码里没有注入 HTML 的口子", () => {
    const src = readFileSync(new URL("./ImportDialog.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
    expect(src).not.toMatch(/<a\s/);
  });
});
