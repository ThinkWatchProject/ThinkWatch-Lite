import { test, expect } from "@playwright/test";

test("fixed choices support empty values, groups, keyboard, actions and form data", async ({ page }) => {
  await page.goto("/scripts/ui/");
  const select = page.getByRole("combobox", { name: "Fixed choices" });
  await expect(select).toHaveText("Automatic");
  await select.click();
  await expect(page.getByRole("option", { name: "Unavailable" })).toBeDisabled();
  await expect(page.getByRole("option", { name: "Automatic", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("option", { name: "One", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(select).toHaveText("One");
  await select.click();
  await page.getByRole("option", { name: "Create…" }).click();
  await expect(select).toHaveText("One");
  await select.click();
  await page.getByRole("option", { name: "Extra", exact: true }).click();
  await expect(select).toHaveText("Extra");
  await select.click();
  await page.getByRole("option", { name: "Value with prefix" }).click();
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("saved")).toHaveText('"value:one"');
  await page.getByRole("button", { name: "Reset choice" }).click();
  await expect(select).toHaveText("Automatic");
  await page.getByRole("button", { name: "Submit", exact: true }).click();
  await expect(page.getByTestId("saved")).toHaveText('""');
  await expect(page.getByRole("combobox", { name: "Disabled", exact: true })).toBeDisabled();
});

test("segmented choices cannot deselect a value, including the empty default", async ({ page }) => {
  await page.goto("/scripts/ui/");
  const group = page.getByRole("radiogroup", { name: "Mode", exact: true });
  const defaultChoice = group.getByRole("radio", { name: "Default", exact: true });
  await defaultChoice.click();
  await expect(defaultChoice).toBeChecked();
  await expect(page.getByTestId("changes")).toHaveText("0");
  await page.keyboard.press("ArrowRight");
  await expect(group.getByRole("radio", { name: "Custom" })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(group.getByRole("radio", { name: "Custom" })).toBeChecked();
  await group.getByRole("radio", { name: "Custom" }).click();
  await expect(page.getByTestId("changes")).toHaveText("1");
  await expect(group.getByRole("radio", { name: "Disabled mode" })).toBeDisabled();
});

for (const kind of ["Dialog", "Sheet", "Alert"]) {
  test(`${kind}: popup responds to real clicks, scrolling, selection and two-stage Escape`, async ({ page }) => {
    await page.goto("/scripts/ui/");
    await page.getByRole("button", { name: kind, exact: true }).click();
    const dialog = page.getByRole(kind === "Alert" ? "alertdialog" : "dialog");
    const input = dialog.getByRole("combobox", { name: "Searchable" });
    await input.click();
    const list = page.getByRole("listbox");
    await expect(list).toBeVisible();
    await list.hover();
    await page.mouse.wheel(0, 500);
    await expect.poll(() => list.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    await input.fill("Choice 75");
    await page.getByRole("option", { name: "Choice 75", exact: true }).click();
    await expect(input).toHaveValue("Choice 75");
    await input.click();
    await expect(list).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(list).toBeHidden();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });
}
