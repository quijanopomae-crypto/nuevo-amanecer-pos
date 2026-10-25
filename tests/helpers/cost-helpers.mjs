// Helpers reales de costo ausente (POS/js/core/utils.js) para pruebas que cargan scripts sueltos en vm.
// utils.js siempre carga antes de los scripts inline en el POS; aquí se inyecta el mismo código.
import { readFileSync } from 'node:fs';

const utils = readFileSync(new URL('../../POS/js/core/utils.js', import.meta.url), 'utf8');
const start = utils.indexOf('const NA_COST_ABSENT=');
const end = utils.indexOf('\n', utils.indexOf('function _naCostValue('));
if (start < 0 || end < 0) throw new Error('cost helpers not found in utils.js');
export const costHelpersSource = utils.slice(start, end) + '\n';
