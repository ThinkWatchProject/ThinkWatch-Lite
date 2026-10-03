import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sources(p));
    else if (/[.](ts|tsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** 制表、换行、回车以外的 C0 控制字符 */
function hasControlChar(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return true;
  }
  return false;
}

/** 唯一可以直接订阅 Tauri 事件的文件 */
const TAURI_EVENT = join("src", "lib", "tauriEvent.ts");

/**
 * 一段源码里绕过 `@/lib/tauriEvent` 订阅 Tauri 事件的地方：从 `@tauri-apps/api/event`
 * 拿值（只拿类型的 `import type` 不算）、窗口或 webview 上的 `.listen(`/`.once(`，
 * 以及窗口上那几个 `onXxx(` 事件接口 —— 它们返回的是同一种退订函数
 */
function tauriEventMisuse(code: string): string[] {
  const out: string[] = [];
  const values = code.replace(/import\s+type\s[^;]*?from\s*["']@tauri-apps\/api\/event["']/g, "");
  if (/["']@tauri-apps\/api\/event["']/.test(values)) out.push("@tauri-apps/api/event");
  if (/\.(listen|once)\s*(<[^>()]*>)?\s*\(/.test(code)) out.push(".listen( / .once(");
  if (/\bon(Resized|Moved|CloseRequested|FocusChanged|ScaleChanged|ThemeChanged|DragDropEvent)\s*\(/.test(code)) {
    out.push("window onXxx(");
  }
  return out;
}

describe("源码文件", () => {
  /**
   * **下拉框里的占位值曾经是一个字面的 NUL 字节。**编译和运行都没问题，
   * 但 git 从此把整个文件当二进制：PR 里看不到这个文件的 diff，评审时等于
   * 没审。
   */
  it("不含 NUL 等控制字符", () => {
    const bad = sources("src").filter((f) => hasControlChar(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });

  /**
   * **Tauri 的事件一律经 `@/lib/tauriEvent` 订阅。**直接用 `listen` 退订，会撞上
   * Tauri 还没在页面里登记好监听的那个空档：抛出没人接的 rejection（换页时一次
   * 几十个），监听也没退掉，卸掉的组件照样收事件。为什么、怎么避开见那个文件。
   * 测试文件不管：它们要 mock 这个模块。
   */
  it("Tauri 事件只经 @/lib/tauriEvent 订阅", () => {
    const bad = sources("src")
      .filter((f) => /[.]tsx?$/.test(f) && !/[.]test[.]tsx?$/.test(f) && f !== TAURI_EVENT)
      .flatMap((f) => tauriEventMisuse(readFileSync(f, "utf8")).map((why) => `${f}: ${why}`));
    expect(bad).toEqual([]);
  });

  /** 上面那条靠的几个正则真的认得出来，不是因为认不出才通过 */
  it("认得出绕过 @/lib/tauriEvent 的写法", () => {
    expect(tauriEventMisuse('import { listen } from "@tauri-apps/api/event";')).toEqual(["@tauri-apps/api/event"]);
    expect(tauriEventMisuse("import { once as o } from '@tauri-apps/api/event'")).toEqual(["@tauri-apps/api/event"]);
    expect(tauriEventMisuse('const { listen } = await import("@tauri-apps/api/event");')).toEqual([
      "@tauri-apps/api/event",
    ]);
    expect(tauriEventMisuse('getCurrentWindow().listen<string>("tauri://focus", f)')).toEqual([".listen( / .once("]);
    expect(tauriEventMisuse("await win.once('x', f)")).toEqual([".listen( / .once("]);
    expect(tauriEventMisuse("void getCurrentWindow().onFocusChanged(({ payload }) => f(payload))")).toEqual([
      "window onXxx(",
    ]);
    // 只拿类型、经 helper 订阅、配置里的 `listen.port` 都不算
    expect(tauriEventMisuse('import type { Event } from "@tauri-apps/api/event";')).toEqual([]);
    expect(tauriEventMisuse('const un = subscribe<string>("core-state", (e) => f(e.payload));')).toEqual([]);
    expect(tauriEventMisuse("const port = ov.listen.port;")).toEqual([]);
  });
});
