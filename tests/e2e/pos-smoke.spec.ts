import { test, expect, Page } from '@playwright/test';

// Smoke E2E for the CANON POS app. Uses only real selectors present in
// POS/index.html. No real data, no network to Cloudflare/D1.

async function enterPos(page: Page) {
  if (await page.evaluate(() => innerWidth >= 768)) {
    const sidebar = page.locator('[data-menu-target="pagePOS"]');
    await expect(sidebar).toBeVisible();
    await sidebar.click();
    return;
  }
  await page.locator('.module-card').first().click();
}

test.describe('POS smoke', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/index.html');
  });

  test('initial menu loads with correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/Nuevo Amanecer/);
    await expect(page.locator('#pageMenu')).toBeVisible();
    await expect(page.locator('#topBusinessName')).toContainText('Nuevo Amanecer');
  });

  test('navigates from menu into POS module', async ({ page }) => {
    await enterPos(page);
    await expect(page.locator('#pagePOS')).toBeVisible();
    await expect(page.locator('#posSearch')).toBeVisible();
  });

  test('cart starts empty and checkout is disabled', async ({ page }) => {
    await enterPos(page);
    await expect(page.locator('#cartBadge')).toHaveText('0');
    await expect(page.locator('#btnPagar')).toBeDisabled();
  });

  test('back button returns to the menu', async ({ page }) => {
    await enterPos(page);
    await expect(page.locator('#pagePOS')).toBeVisible();
    await page.locator('#backBtn').click();
    await expect(page.locator('#pageMenu')).toBeVisible();
  });
});