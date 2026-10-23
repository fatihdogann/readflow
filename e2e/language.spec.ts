import { expect, test } from "@playwright/test";

test("language persists across pages and preserves document content", async ({ page }) => {
  await page.goto("/");
  const menu = page.getByRole("button", { name: "Menüyü aç", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("combobox", { name: "Uygulama dili" }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  // Language changes reload the page; wait for the new client handlers before typing.
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { name: "Make room for reading." })).toBeVisible();
  await page.getByRole("textbox", { name: "Link or text" }).fill("Türkçe belge korunur\n\nOkumak bir yarış değil, bir sohbet.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/\d+$/);
  await expect(page.getByRole("heading", { name: "Türkçe belge korunur" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Original", exact: true })).toBeVisible();
  await page.goto("/settings");
  await expect(page).toHaveTitle("Settings · Readflow");
  await expect(page.getByRole("heading", { name: "Settings", exact: true })).toBeVisible();
  const englishMenu = page.getByRole("button", { name: "Open menu", exact: true });
  if (await englishMenu.isVisible()) await englishMenu.click();
  await page.getByRole("combobox", { name: "App language" }).selectOption("tr");
  await expect(page.locator("html")).toHaveAttribute("lang", "tr");
  await expect(page.getByRole("heading", { name: "Ayarlar", exact: true })).toBeVisible();
});
