import { expect, test, type Page } from "@playwright/test";
import type { AliasPreviewRequest, AliasView, RouteSave } from "@/types";
import type {} from "../shots/drive";

async function open(page: Page, scene: "upstreams" | "routing") {
  await page.goto(`/scripts/shots/index.html?scene=${scene}&lang=zh`);
  await page.waitForFunction(() => window.__shot?.state === "ready");
  await page.evaluate(() => {
    const ctx = window as unknown as {
      __TAURI_INTERNALS__: { invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> };
      aliasWrites: unknown[];
      savedRoute?: RouteSave;
    };
    ctx.aliasWrites = [];
    const invoke = ctx.__TAURI_INTERNALS__.invoke;
    const alias: AliasView = {
      name: "coding", hide_originals: true, requests_24h: 0, cost_micros_24h: null, shadows: [],
      models: [{ model: "claude-opus-5", providers: ["anthropic"] }, { model: "claude-sonnet-5", providers: ["relay"] }],
      served_by: [{ provider: "anthropic", model: "claude-opus-5" }, { provider: "relay", model: "claude-sonnet-5" }],
    };
    ctx.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
      if (cmd === "alias_hints") return [];
      if (cmd === "call" && args) {
        switch (args.endpoint) {
          case "Aliases":
            return { aliases: [alias], hide_originals_supported: true, suggestions: [] };
          case "PreviewAlias": {
            const draft = args.req as AliasPreviewRequest;
            const targets = [...alias.served_by];
            if (draft.original === alias.name && draft.alias.models.includes("deepseek-chat")) {
              targets.push({ provider: "deepseek", model: "deepseek-chat" });
            }
            return { served_by: targets, problems: [], shadows: [], unserved: [], same_model: [], hidden_originals: [] };
          }
          case "CreateAlias":
          case "UpdateAlias":
            ctx.aliasWrites.push(args);
            return { version: "v2", renamed_in: { keys: [], rules: [], requests_24h: 0 } };
          case "UpdateRoute":
            ctx.savedRoute = args.req as RouteSave;
            return { version: "v2" };
        }
      }
      return invoke(cmd, args);
    };
  });
}

async function startAlias(page: Page) {
  await page.getByRole("button", { name: "deepseek 的模型", exact: true }).click();
  await page.getByRole("button", { name: "deepseek-chat 的操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "起别名…" }).click();
}

test("an upstream model joins an existing alias only after preview and save", async ({ page }) => {
  await open(page, "upstreams");
  for (const action of ["取消", "保存"]) {
    await startAlias(page);
    await page.getByRole("combobox", { name: "加入已有别名…" }).click();
    await page.getByRole("option", { name: "coding", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "编辑别名 coding" });
    await expect(editor.getByRole("checkbox", { name: "客户端仅展示别名" })).toBeChecked();
    const preview = editor.getByText("客户端请求 coding 时", { exact: true }).locator("..");
    await expect(preview.getByText("deepseek-chat", { exact: true })).toBeVisible();
    await expect(editor.getByRole("button", { name: "保存" })).toBeEnabled();
    expect(await page.evaluate(() => (window as unknown as { aliasWrites: unknown[] }).aliasWrites)).toEqual([]);
    await editor.getByRole("button", { name: action, exact: true }).click();
    await expect(editor).toBeHidden();
  }
  expect(await page.evaluate(() => (window as unknown as { aliasWrites: unknown[] }).aliasWrites)).toEqual([{
    endpoint: "UpdateAlias", params: ["coding"], req: { base_version: expect.any(String),
      alias: { name: "coding", models: ["claude-opus-5", "claude-sonnet-5", "deepseek-chat"], hide_originals: true } },
  }]);
});

test("the upstream editor can create another alias for an already included ID", async ({ page }) => {
  await open(page, "upstreams");
  await page.getByRole("row", { name: /^选择 anthropic / }).click();
  const upstream = page.getByRole("dialog", { name: "编辑上游" });
  await upstream.getByRole("button", { name: "模型", exact: true }).click();
  await upstream.getByRole("button", { name: "claude-opus-5 的操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "起别名…" }).click();
  const dialog = page.getByRole("dialog", { name: "新建别名" });
  await dialog.getByRole("combobox", { name: "加入已有别名…" }).click();
  await expect(page.getByRole("option", { name: "coding（已包含）" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await dialog.getByLabel("名称", { exact: true }).fill("new-name");
  await dialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(upstream).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { aliasWrites: unknown[] }).aliasWrites)).toMatchObject([{
    endpoint: "CreateAlias", req: { alias: { name: "new-name", models: ["claude-opus-5"] } },
  }]);
});

test("pinned alias searches keep only the chosen upstream ID and permit literal unlisted IDs", async ({ page }) => {
  await open(page, "routing");
  await page.getByRole("row", { name: /^default / }).click();
  const route = page.getByRole("dialog", { name: "编辑路由「default」" });
  await route.getByRole("button", { name: "添加规则" }).click();
  const rule = page.getByRole("dialog", { name: "添加规则" });
  await rule.getByLabel("名称", { exact: true }).fill("pin");
  await rule.getByRole("radio", { name: "指定上游模型" }).click();

  for (const [n, provider, model] of [[1, "anthropic", "claude-opus-5"], [2, "relay", "claude-sonnet-5"]] as const) {
    if (n === 2) await rule.getByRole("button", { name: "添加备用" }).click();
    await rule.getByRole("combobox", { name: `第 ${n} 个指定模型的上游` }).click();
    await page.getByRole("option", { name: provider, exact: true }).click();
    const raw = rule.getByRole("textbox", { name: "上游模型 ID" }).nth(n - 1);
    await raw.fill("manual-id");
    await raw.press("ArrowDown");
    const search = rule.getByPlaceholder("搜索模型 ID 或别名");
    await search.fill("CoDiNg");
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText(model);
    await search.press("Escape");
    await expect(raw).toHaveValue("manual-id");
    await raw.press("ArrowDown");
    await search.fill("coding");
    await page.getByRole("option", { name: new RegExp(model) }).click();
    await expect(raw).toHaveValue(model);
  }
  await rule.getByRole("button", { name: "添加备用" }).click();
  await rule.getByRole("combobox", { name: "第 3 个指定模型的上游" }).click();
  await page.getByRole("option", { name: "deepseek", exact: true }).click();
  await rule.getByRole("textbox", { name: "上游模型 ID" }).nth(2).fill("manual-only");
  await rule.getByRole("button", { name: "添加", exact: true }).click();
  await route.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { savedRoute?: RouteSave }).savedRoute?.route.rules.find((r) => r.name === "pin")?.to)).toEqual([
    { provider: "anthropic", model: "claude-opus-5" }, { provider: "relay", model: "claude-sonnet-5" },
    { provider: "deepseek", model: "manual-only" },
  ]);
});
