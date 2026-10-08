import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertDialog, AlertDialogAction, AlertDialogConfirm } from "./alert-dialog";

/** 按钮在对话框的上下文里才画得出来（它是 Radix 的关闭按钮）；内容挂在 portal 里，这里不用 */
const html = (node: React.ReactNode) => renderToStaticMarkup(<AlertDialog open>{node}</AlertDialog>);
/** `disabled` 这个属性（类名里也有 `disabled:` 这几个字） */
const DISABLED = /\sdisabled=""/;

/**
 * 确认框的主按钮带「进行中」：和 `Button` 的 `pending` 一样失效、转圈、`aria-busy`，字不换。
 * `Button` 在 `asChild` 时不画转圈，所以原来各处手写一份转圈。
 */
describe("确认框的主按钮", () => {
  it("进行中：失效、转圈、aria-busy", () => {
    const out = html(<AlertDialogAction pending>删除</AlertDialogAction>);
    expect(out).toContain('aria-busy="true"');
    expect(out).toMatch(DISABLED);
    expect(out).toContain('data-slot="spinner"');
    expect(out).toContain("删除");
  });

  it("不在进行中：没有转圈", () => {
    const out = html(<AlertDialogAction>删除</AlertDialogAction>);
    expect(out).not.toContain("aria-busy");
    expect(out).not.toMatch(DISABLED);
    expect(out).not.toContain('data-slot="spinner"');
  });

  it("AlertDialogConfirm 把 pending 和 disabled 交给按钮", () => {
    expect(html(<AlertDialogConfirm pending onConfirm={() => {}}>卸载</AlertDialogConfirm>)).toContain(
      'data-slot="spinner"',
    );
    const off = html(
      <AlertDialogConfirm pending={false} disabled onConfirm={() => {}}>
        卸载
      </AlertDialogConfirm>,
    );
    expect(off).toMatch(DISABLED);
    expect(off).not.toContain('data-slot="spinner"');
  });
});
