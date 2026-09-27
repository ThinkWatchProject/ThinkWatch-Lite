import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 编辑对话框保存时带的 `base_version` 是**打开那一刻的**配置版本。
 *
 * **这不是洁癖，是一个真出过的 bug。**这几个对话框的 `configVersion` 跟着概览走，
 * 保存时读的是那一刻的值：对话框开着的时候别处改了配置（另一个窗口、直接改文件），
 * 概览读回来新版本，保存带着它 —— core 的冲突检查永远通过，旧表单把别人的改动悄悄
 * 盖掉。正确的写法是打开时 `useState(configVersion)` 记下来，保存、删除都带它；嵌套
 * 的对话框也拿它，写完把新版本交回来。
 *
 * 界面测试这里跑不起来（没有 DOM），所以按源码查：不许在保存时直接读 `configVersion`。
 */
const DIALOGS = [
  "src/upstreams/UpstreamDialog.tsx",
  "src/upstreams/ProxyDialog.tsx",
  "src/upstreams/PriceSheetDialog.tsx",
  "src/routing/RouteDialog.tsx",
  "src/routing/GroupDialog.tsx",
];

describe("编辑对话框的乐观并发", () => {
  it("打开时记下版本号，保存、删除、嵌套的对话框都用记下的那一个", () => {
    for (const f of DIALOGS) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/useState\(configVersion\)/);
      // `base_version: configVersion`、`api.deleteX(name, configVersion)`、原样传给嵌套的对话框
      expect(src, f).not.toMatch(/base_version:\s*configVersion\b|,\s*configVersion\)|=\{configVersion\}/);
    }
  });
});
