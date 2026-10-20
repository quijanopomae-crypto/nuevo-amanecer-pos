import type { Page } from '@playwright/test';

/**
 * Espera a que termine la persistencia encolada en `_naPersistChain` (IndexedDB
 * + localStorage `na_snapshot_v9`). El arranque llama a saveAllData() y su
 * commit puede llegar después de que la prueba ya leyó localStorage; si se
 * captura el estado "antes" sin esperar, solo cambia `updatedAt` y la prueba
 * falla sin que la pantalla haya escrito nada.
 */
export async function settlePersistence(page: Page) {
  await page.evaluate(async () => {
    const read = () => { try { return (window as any).eval('_naPersistChain') as Promise<unknown> | undefined; } catch { return undefined; } };
    for (let round = 0; round < 50; round++) {
      const chain = read();
      if (!chain || typeof chain.then !== 'function') return;
      await chain.then(() => undefined, () => undefined);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (read() === chain) return;
    }
    throw new Error('_naPersistChain no se estabilizó');
  });
}
