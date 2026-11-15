import { test, expect } from "@playwright/test";
import type {} from "../shots/drive";

for (const scene of ["overview", "traffic", "clients", "keys", "upstreams", "routing", "security", "mcp", "settings", "plugins", "connection-picker", "dry-run", "remote-add", "remote-clients"]) {
  test(`page and dialogs render without errors: ${scene}`, async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`/scripts/shots/index.html?scene=${scene}&lang=zh`);
    await page.waitForFunction(() => window.__shot?.state !== "loading");
    expect(await page.evaluate(() => window.__shot)).toEqual({ state: "ready" });
    expect(errors).toEqual([]);
    await expect(page.locator("select:visible")).toHaveCount(0);
    if (scene === "overview") {
      const hero = page.locator('[data-slot="overview-hero"]');
      const tabs = hero.getByRole("tab");
      await expect(tabs).toHaveCount(6);
      await tabs.nth(0).focus();
      await page.keyboard.press("ArrowRight");
      await expect(tabs.nth(1)).toBeFocused();
      await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
      await expect(hero.getByRole("tabpanel")).toBeVisible();
      const breakdown = page.locator('[data-slot="overview-breakdown"]');
      await breakdown.scrollIntoViewIfNeeded();
      await expect(breakdown.getByRole("table")).toHaveCount(1);
    }
    if (scene === "connection-picker") {
      const radios = page.getByRole("radiogroup").getByRole("radio");
      await expect(radios).toHaveCount(3);
      await expect(radios.nth(0)).toBeChecked();
      await page.getByText("homelab", { exact: true }).click();
      await expect(radios.nth(1)).toBeChecked();
      await radios.nth(1).focus();
      await page.keyboard.down("ArrowUp");
      await expect(radios.nth(0)).toBeChecked();
      await page.keyboard.up("ArrowUp");
    }
    await page.screenshot({ path: testInfo.outputPath(`${scene}.png`) });
  });
}
