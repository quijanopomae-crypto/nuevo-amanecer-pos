import { test, expect } from '@playwright/test';

test('CANON phone home uses quick actions and drawer instead of duplicated module cards', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');

  await expect(page.locator('#naMobileWelcome')).toBeVisible();
  await expect(page.locator('#naMobileQuickActions')).toBeVisible();
  await expect(page.locator('#naMobileActivity')).toBeVisible();
  await expect(page.locator('#pageMenu .modules-grid')).toBeHidden();

  const quickSale = page.getByRole('button', { name: 'Nueva venta' });
  await expect(quickSale).toBeVisible();
  await quickSale.click();
  await expect(page.locator('#pagePOS')).toHaveClass(/active/);

  await page.locator('#backBtn').click();
  await expect(page.locator('#pageMenu')).toHaveClass(/active/);

  const menuToggle = page.locator('#naMobileMenuToggle');
  await expect(menuToggle).toBeVisible();
  await menuToggle.click();

  const drawer = page.locator('#naMobileDrawer');
  await expect(drawer).toHaveClass(/is-open/);
  await expect(drawer.getByRole('button', { name: /Punto de Venta/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Inventario/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Ventas/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^Clientes/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Cuentas por cobrar/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^Caja/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /^Gastos/ })).toBeVisible();
  await expect(drawer.getByRole('button', { name: /Configuración/ })).toBeVisible();

  await page.locator('#naMobileDrawerOverlay').click({ position: { x: 370, y: 400 } });
  await expect(drawer).not.toHaveClass(/is-open/);
});

test('tablet and desktop do not receive the mobile home or drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/index.html');

  await expect(page.locator('#naMobileWelcome')).toHaveCount(0);
  await expect(page.locator('#naMobileQuickActions')).toHaveCount(0);
  await expect(page.locator('#naMobileDrawer')).toHaveCount(0);
  await expect(page.locator('#naMobileMenuToggle')).toHaveCount(0);
  await expect(page.locator('#pageMenu .menu-desktop-sidebar')).toBeVisible();
});

test('mobile chrome disappears after rotating into tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/index.html');
  await expect(page.locator('#naMobileWelcome')).toBeVisible();
  await expect(page.locator('#naMobileMenuToggle')).toBeVisible();

  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('#naMobileWelcome')).toBeHidden();
  await expect(page.locator('#naMobileQuickActions')).toBeHidden();
  await expect(page.locator('#naMobileMenuToggle')).toBeHidden();
  await expect(page.locator('#pageMenu .menu-desktop-sidebar')).toBeVisible();
});