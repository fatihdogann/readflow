import { expect, test } from "@playwright/test";

test("mobil ana bölümler görünür kalır ve dar ekranda okuma taşmaz", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobil yerleşim");
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  const navigation = page.getByRole("navigation", { name: "Hızlı gezinme" });
  await expect(navigation).toBeVisible();
  await expect(page.getByLabel("Bağlantı veya metin")).not.toBeFocused();
  await expect(page.getByRole("heading", { name: "Son eklenenler" })).toBeInViewport();
  await navigation.getByRole("link", { name: "Arşiv", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Arşiv", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Arşiv", exact: true })).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: "Notlar", exact: true }).click();
  await expect(page.getByLabel("Not başlığı")).toBeVisible();
  await navigation.getByRole("link", { name: "Yeni ekle", exact: true }).click();
  await page.getByLabel("Bağlantı veya metin").fill("Dar ekranda okuma\n\n" + "Okumaya yer açan bir arayüz. ".repeat(60));
  await page.getByRole("button", { name: "Kaydet", exact: true }).click();
  await expect(page).toHaveURL(/\/doc\/\d+$/);
  await expect(page.getByRole("button", { name: "Özetle", exact: true })).not.toBeVisible();
  const assertFits = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  };
  await assertFits();
  await page.locator("summary").filter({ hasText: "Özetle ve düzenle" }).click();
  await expect(page.getByRole("button", { name: "Özetle", exact: true })).toBeVisible();
  await page.getByText("Çalıştırma ayarları", { exact: true }).click();
  await assertFits();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(navigation).toBeInViewport();
  const edit = page.getByRole("button", { name: "Düzenlemeye başla" });
  await edit.scrollIntoViewIfNeeded();
  const editBox = await edit.boundingBox();
  const navBox = await navigation.boundingBox();
  expect(editBox!.y + editBox!.height).toBeLessThanOrEqual(navBox!.y);
});
