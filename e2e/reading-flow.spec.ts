import { expect, test } from "@playwright/test";

test("metin ekleme, doğal düzenleme, not ve yerel AI özeti birlikte çalışır", async ({ page }) => {
  const original = "Readflow E2E Belgesi\n\nBu, korunması gereken orijinal paragraftır.";
  const edited = "Readflow E2E Belgesi\n\nBu paragraf doğal düzenleme yüzeyinde değiştirildi.";

  await page.goto("/");
  await page.getByPlaceholder("Bağlantı ekle, metin yapıştır veya dosya bırak…").fill(original);
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page).toHaveURL(/\/doc\/\d+$/);

  await page.getByRole("button", { name: "Düzenlemeye başla" }).click();
  const editor = page.getByLabel("Düzenlenmiş metin (kullanıcı sürümü)");
  await expect(editor).toBeVisible();
  expect((await editor.boundingBox())?.height).toBeGreaterThan(480);
  await editor.fill(edited);
  await page.getByRole("button", { name: /Kaydet \(⌘\/Ctrl\+S\)/ }).click();
  await expect(page.getByRole("status").filter({ hasText: "Kaydedildi" }).first()).toBeVisible();

  await page.getByRole("tab", { name: "Orijinal" }).click();
  await expect(page.getByText("Bu, korunması gereken orijinal paragraftır.")).toBeVisible();
  await page.getByRole("tab", { name: "Düzenlenmiş" }).click();
  await expect(editor).toHaveValue(edited);

  await page.getByRole("button", { name: "Not" }).click();
  const note = page.getByLabel("Kişisel not (otomatik kaydedilir)");
  await note.fill("Bu fikir sonraki okumada geliştirilecek.");
  await page.getByRole("button", { name: /Kaydet \(⌘\/Ctrl\+S\)/ }).last().click();
  await expect(page.getByText(/Kaydedildi/).last()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Not" })).toBeFocused();

  await page.getByText("Çalıştırma ayarları", { exact: true }).click();
  await page.getByLabel("Notu AI'a ekle").check();
  await page.getByRole("button", { name: "Özetle" }).click();
  await expect(page.getByRole("tab", { name: /Özet/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: /Özet/ }).click();
  await expect(page.getByRole("heading", { name: "Mock Özet" })).toBeVisible({ timeout: 15_000 });
});

test("klasör belge sayısı sayfa yenilenmeden güncellenir", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Masaüstü sidebar davranışı");

  await page.goto("/");
  await page.getByLabel("Yeni klasör adı").fill("Canlı Sayaç");
  await page.getByLabel("Yeni klasör adı").press("Enter");
  await expect(page.getByRole("link", { name: /Canlı Sayaç\s+0/ })).toBeVisible();

  await page.getByPlaceholder("Bağlantı ekle, metin yapıştır veya dosya bırak…").fill("Sayaç belgesi\n\nKlasöre taşınacak içerik.");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page).toHaveURL(/\/doc\/\d+$/);
  await page.getByLabel("Klasör:").selectOption({ label: "Canlı Sayaç" });

  await expect(page.getByRole("link", { name: /Canlı Sayaç\s+1/ })).toBeVisible();
});

test("mobil menü klavye ile kapanır ve odağı geri verir", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "Mobil gezinme davranışı");

  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Menüyü aç" });
  await trigger.click();
  await expect(page.getByRole("dialog", { name: "Gezinme menüsü" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Gezinme menüsü" })).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("çevrimdışıyken daha önce açılan belge önbellekten okunur", async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Service worker tek projede yeterli");

  await page.goto("/");
  await page.getByPlaceholder("Bağlantı ekle, metin yapıştır veya dosya bırak…").fill("Çevrimdışı Belge\n\nUçakta da okunabilmeli.");
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page).toHaveURL(/\/doc\/\d+$/);
  const docUrl = page.url();

  // Service worker devreye girsin ve sayfayı önbelleğe alsın.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15_000 });
  await page.reload();
  await expect(page.getByText("Uçakta da okunabilmeli.")).toBeVisible();

  await context.setOffline(true);
  try {
    await page.goto(docUrl);
    await expect(page.getByText("Uçakta da okunabilmeli.")).toBeVisible();

    // Hiç açılmamış sayfa: çevrimdışı bilgilendirmesi gelir, hata ekranı değil.
    await page.goto("/doc/999999");
    await expect(page.getByRole("heading", { name: "Çevrimdışısın" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
