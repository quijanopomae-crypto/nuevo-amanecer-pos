// Proceso aparte (lo lanza assistant-empleado-texto-montos.test.mjs con --experimental-test-module-mocks): simula que la lista de
// consultas del empleado se abrió por error (p. ej. alguien agrega ventas_periodo o deudas_clientes al nivel 1). Solo se cambia
// queryAllowed EN ESTE PROCESO; el código de producción no se toca. Las demás barreras (solo Admin, resúmenes, permiso de costos)
// siguen igual. Imprime en stdout un JSON con lo que recibió el empleado y lo que se mandó al modelo, por consulta.
import { mock } from 'node:test';
const LEVELS = new URL('../../tools/cloudflare-lab/src/pos-assistant-levels.js', import.meta.url).href;
const real = await import(LEVELS + '?real'); // copia sin cambiar (el módulo no tiene imports)
const OPEN = JSON.parse(process.env.LISTA_ABIERTA || '[]');
mock.module(LEVELS, { namedExports: { ...real,
  queryAllowed: (role, tipo) => real.queryAllowed(role, tipo) || (role !== 'owner' && !real.seesOwnerData(role) && OPEN.includes(tipo)) } });
const { assistantChatRoute } = await import('../../tools/cloudflare-lab/src/pos-assistant.js');
const { chatWith, consultaResults } = await import('./empleado-montos-datos.mjs');
const roles = JSON.parse(process.env.ROLES || '["empleado:consultas"]');
const res = [];
for (const role of roles) for (const tipo of OPEN) for (const stream of [false, true]) {
  const r = await chatWith(assistantChatRoute, role, tipo, { stream });
  res.push({ role, tipo, stream, status: r.status, out: r.out, toModel: r.toModel, reads: r.reads, results: consultaResults(r.out) });
}
// Los registros «[asistente] tiempos» también salen por stdout: el resultado va al final tras una marca.
process.stdout.write("\n@@LISTA_ABIERTA@@" + JSON.stringify(res));
