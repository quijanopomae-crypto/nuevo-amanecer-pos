// FIX06 reutiliza el harness de carga real (index.html hasta inline-16, sin V10)
// checkpointed por FIX05. No sustituye funciones financieras del producto.
export { createPosSandbox, json, makeStore, POS_DIR } from '../../fix05/lib/sandbox.mjs';
