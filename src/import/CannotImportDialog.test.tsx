import { readFileSync } from "node:fs";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setLang } from "@/i18n";
import type { UpdateView } from "@/updateFlow";
import { CannotImportDialog } from "./CannotImportDialog";

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

/** 更新状态：测试里按需换 */
let update: UpdateView | undefined;
vi.mock("@/lib/resource", () => ({
  useResource: () => ({
    data: update,
    error: undefined,
    loading: false,
    refreshing: false,
    reload: async () => update,
    mutate: () => () => {},
  }),
}));
vi.mock("@/lib/tauriEvent", () => ({ useTauriEvent: () => {} }));

beforeAll(() => setLang("zh"));

function render(param: string | null) {
  return renderToStaticMarkup(<CannotImportDialog param={param} onClose={() => {}} />);
}

describe("无法导入这条链接", () => {
  it("写明不支持的参数；不知道有没有新版本时给「检查更新」", () => {
    update = { version: "2026.10.16", install: "standalone", check_updates: true, offer: null };
    const html = render("future_option");
    expect(html).toContain("无法导入这条链接");
    expect(html).toContain("这条链接含有当前版本不支持的参数「future_option」。");
    expect(html).not.toContain("更新 ThinkWatch Lite 后再打开这条链接。");
    expect(html).toMatch(/>检查更新</);
    expect(html).toMatch(/>关闭</);
  });

  it("参数名不能给人看时只说有不支持的参数", () => {
    update = { version: "2026.10.16", install: "standalone", check_updates: true, offer: null };
    expect(render(null)).toContain("这条链接含有当前版本不支持的参数。");
  });

  it("有新版本：说更新后再打开，给「安装更新」", () => {
    update = { version: "2026.10.16", install: "standalone", check_updates: true, offer: { version: "2026.10.20" } };
    const html = render("x");
    expect(html).toContain("更新 ThinkWatch Lite 后再打开这条链接。");
    expect(html).toMatch(/>安装更新</);
    expect(html).not.toMatch(/>检查更新</);
  });

  it("参数名当纯文本画", () => {
    update = undefined;
    const html = render("<b>x</b>");
    expect(html).not.toMatch(/<b>/);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    const src = readFileSync(new URL("./CannotImportDialog.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("dangerouslySetInnerHTML");
  });
});
