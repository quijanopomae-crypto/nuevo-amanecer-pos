import type { Page } from '@playwright/test';

/**
 * Espera a que termine la persistencia encolada en `_naPersistChain` (IndexedDB
 * + localStorage `na_snapshot_v9`). El arranque llama a saveAllData() y su
 * commit puede llegar después de que la prueba ya leyó localStorage; si se
 * captura el estado "antes" sin esperar, solo cambia `updatedAt` y la prueba
 * falla sin que la pantalla haya escrito nada.
 *
 * `_naPersistChain` es un `let` global (inline-02.js), no una propiedad de window:
 * se lee con eval. Si no existe o no es una promesa, falla con un error claro en
 * lugar de seguir sin esperar (lo que reabriría la carrera en silencio).
 */
export async function settlePersistence(page: Page) {
  await page.evaluate(async () => {
    const read = (): Promise<unknown> => {
      let chain: unknown;
      try { chain = (window as any).eval('_naPersistChain'); } catch (error) {
        throw new Error(`settlePersistence: global _naPersistChain not found — persistence queue was renamed? (${(error as Error)?.name || error})`);
      }
      if (!chain || typeof (chain as Promise<unknown>).then !== 'function') {
        throw new Error(`settlePersistence: global _naPersistChain is not a promise (${typeof chain}) — persistence queue was renamed?`);
      }
      return chain as Promise<unknown>;
    };
    for (let round = 0; round < 50; round++) {
      const chain = read();
      await chain.then(() => undefined, () => undefined);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (read() === chain) return;
    }
    throw new Error('settlePersistence: _naPersistChain no se estabilizó tras 50 rondas');
  });
}
