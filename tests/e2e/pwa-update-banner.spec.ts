import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

for (const width of [390, 768, 1366]) {
  for (const failure of ['redundant', 'error', 'rejection', 'timeout']) {
    test(`${failure}: retry and close failed PWA update at ${width}px`, async ({ page, baseURL }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        return url.origin === new URL(baseURL!).origin ? route.continue() : route.abort();
      });
      await page.clock.install();
      await page.addInitScript(() => {
        const container = new EventTarget();
        const registration = new EventTarget() as any;
        registration.waiting = null;
        registration.installing = null;
        let worker: any = null;
        let rejectUpdate = false;
        let retryStarted = false;
        let updateCalls = 0;
        function startInstalling() {
          worker = new EventTarget();
          worker.state = 'installing';
          worker.postMessage = () => {};
          registration.installing = worker;
          registration.dispatchEvent(new Event('updatefound'));
        }
        registration.update = () => {
          updateCalls++;
          if (rejectUpdate) return Promise.reject(new Error('simulated offline'));
          if (retryStarted) { retryStarted = false; startInstalling(); }
          return Promise.resolve(registration);
        };
        Object.defineProperty(container, 'controller', { value: { postMessage() {} } });
        Object.defineProperty(container, 'register', { value: () => Promise.resolve(registration) });
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
        (window as any).__pwaUpdateTest = {
          startInstalling,
          calls: () => updateCalls,
          fail(type: string) {
            if (type === 'redundant') {
              worker.state = 'redundant';
              registration.installing = null;
              worker.dispatchEvent(new Event('statechange'));
            } else if (type === 'error') worker.dispatchEvent(new Event('error'));
            else if (type === 'rejection') {
              rejectUpdate = true;
              window.dispatchEvent(new Event('online'));
            }
          },
          prepareRetry() { rejectUpdate = false; retryStarted = true; }
        };
      });
      await page.goto('/index.html');
      // Start registration even if the canonical readiness event has not fired yet.
      await page.clock.runFor(8000);
      await expect.poll(() => page.evaluate(() => (window as any).__pwaUpdateTest.calls())).toBeGreaterThan(0);
      const prompt = page.locator('#pwaUpdatePrompt');
      const status = page.locator('#pwaUpdateStatus');
      const action = page.locator('#pwaUpdateAction');
      await page.evaluate(() => (window as any).__pwaUpdateTest.startInstalling());
      await expect(prompt).toBeVisible();
      await expect(status).toHaveText('Descargando la versión nueva…');
      await expect(action).toHaveText('Descargando…');
      await expect(action).toBeDisabled();
      let navigations = 0;
      page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
      const fail = async () => {
        if (failure === 'timeout') {
          await page.clock.runFor(119000);
          await expect(prompt).toBeVisible();
          await expect(prompt).not.toHaveAttribute('data-state', 'error');
          // Reach 120001 ms in total, just beyond the 120 s failure deadline.
          await page.clock.runFor(1001);
        }
        else await page.evaluate(type => (window as any).__pwaUpdateTest.fail(type), failure);
      };
      await fail();
      await expect(prompt).toBeVisible();
      await expect(prompt).toHaveAttribute('data-state', 'error');
      await expect(status).toHaveText('No se pudo actualizar');
      await expect(action).toHaveText('Reintentar');
      await expect(action).toBeEnabled();
      // The existing action remains reachable at every required viewport.
      expect(await action.evaluate(el => {
        const box = el.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === el;
      })).toBe(true);
      const calls = await page.evaluate(() => (window as any).__pwaUpdateTest.calls());
      await page.evaluate(() => (window as any).__pwaUpdateTest.prepareRetry());
      await action.click();
      await expect.poll(() => page.evaluate(() => (window as any).__pwaUpdateTest.calls())).toBe(calls + 1);
      await expect(status).toHaveText('Descargando la versión nueva…');
      await expect(action).toBeDisabled();
      await fail();
      await expect(prompt).toBeHidden();
      await expect(prompt).toHaveCount(1);
      await page.clock.runFor(125000);
      await expect(prompt).toBeHidden();
      expect(navigations).toBe(0);
    });
  }
}
