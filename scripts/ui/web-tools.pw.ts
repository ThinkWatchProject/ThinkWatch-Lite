import type {} from "../shots/drive";
import { test, expect, type Page } from "@playwright/test";

async function open(page: Page, lang = "zh") {
  await page.goto(`/scripts/shots/index.html?scene=web-tools-config&lang=${lang}`);
  await page.waitForFunction(() => window.__shot?.state === "ready");
}

async function acceptSaves(page: Page) {
  await page.evaluate(() => {
    const context = window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> }; savedWebConfig?: unknown };
    const original = context.__TAURI_INTERNALS__.invoke;
    context.__TAURI_INTERNALS__.invoke = async (command, args) => {
      if (command === "call" && args?.endpoint === "SaveWebTools") {
        context.savedWebConfig = (args.req as { config: unknown }).config;
        return { version: "saved-by-browser-test" };
      }
      return original(command, args);
    };
  });
}

test("locale menus scroll and select in the real config dialog; drafts survive Save", async ({ page }) => {
  await open(page);
  await acceptSaves(page);
  const dialog = page.getByRole("dialog");
  const language = dialog.getByRole("combobox", { name: "搜索语言", exact: true });
  await language.click();
  const list = page.getByRole("listbox");
  await list.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await language.fill("英语");
  await page.getByRole("option", { name: "英语", exact: true }).click();
  await expect(language).toHaveValue("英语");
  const region = dialog.getByRole("combobox", { name: "国家或地区", exact: true });
  await region.click();
  await list.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await region.fill("日本");
  await page.getByRole("option", { name: "日本", exact: true }).click();
  await expect(region).toHaveValue("日本");
  const engine = dialog.getByRole("combobox", { name: "搜索引擎", exact: true });
  await engine.click();
  await expect(page.getByRole("option")).toHaveCount(3);
  await page.getByRole("option", { name: "Bing", exact: true }).click();
  const allowed = dialog.getByRole("textbox", { name: "允许的域名", exact: true });
  await allowed.fill("EXAMPLE.ORG, docs.example.org example.org");
  await allowed.press("Enter");
  await expect(dialog.getByRole("button", { name: "删除 example.org", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "删除 docs.example.org", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "删除 docs.example.org", exact: true }).click();
  await allowed.fill("pending.example.org");
  await dialog.getByRole("textbox", { name: "排除的域名", exact: true }).fill("ads.example.org");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => page.evaluate(() => (window as unknown as { savedWebConfig?: unknown }).savedWebConfig)).toMatchObject({
    engines: ["bing"], language: "en", region: "JP", allowed_domains: ["example.org", "pending.example.org"], blocked_domains: ["ads.example.org"],
  });
  const table = page.getByRole("table");
  await expect(table).toHaveCount(1);
  await expect(table.getByRole("row").filter({ hasText: "联网搜索与网页读取" })).toHaveCount(1);
  await page.getByRole("button", { name: "配置", exact: true }).click();
  await expect(language).toHaveValue("英语");
  await expect(region).toHaveValue("日本");
  await expect(engine).toHaveText("Bing");
});

test("invalid domains block saving; failed save retains edits; Escape closes the menu first", async ({ page }) => {
  await open(page);
  const dialog = page.getByRole("dialog");
  const input = dialog.getByRole("textbox", { name: "允许的域名", exact: true });
  await input.fill("https://example.org");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("alert").filter({ hasText: "https://example.org" })).toBeVisible();
  await input.fill("example.org");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toContainText("Screenshots are read-only.");
  await expect(input).toHaveValue("example.org");
  const language = dialog.getByRole("combobox", { name: "搜索语言", exact: true });
  await language.click();
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("listbox")).toBeHidden();
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

for (const lang of ["zh", "en"]) for (const colorScheme of ["light", "dark"] as const) {
  test(`config fits both window sizes: ${lang}/${colorScheme}`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    await open(page, lang);
    for (const size of [{ width: 1100, height: 720 }, { width: 820, height: 560 }]) {
      await page.setViewportSize(size);
      const dialog = page.getByRole("dialog");
      await expect.poll(async () => {
        const box = await dialog.boundingBox();
        return !!box && box.x >= 0 && box.y >= 0 && box.x + box.width <= size.width && box.y + box.height <= size.height;
      }).toBe(true);
      await expect(dialog.getByRole("button", { name: lang === "zh" ? "保存" : "Save", exact: true })).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`config-${size.width}.png`) });
    }
  });
}
