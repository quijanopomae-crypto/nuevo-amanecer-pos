// Seleccion conservadora: solo CSS/imagenes/documentacion ordinaria son visuales.
// Toda superficie de dinero, permisos, persistencia o despliegue exige regresion completa.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const critical = [
  /^POS\/js\/sync\//,
  /^POS\/js\/modules\//,
  /^POS\/js\/legacy-inline\//,
  /^POS\/js\/adapters\//,
  /^POS\/js\/compat\//,
  /^POS\/js\/config\//,
  /^POS\/js\/config\/pos-permissions\.js$/,
  /^POS\/js\/modules\/(?:ventas|stock|caja|credito|clientes|compras|pago)/i,
  /^POS\/js\/inventory\//,
  /^tools\/cloudflare-(?:lab|prod|backup)\//,
  /^infra\/database\/migrations\//,
  /^tools\/release\//,
  /^\.github\/workflows\//,
  /^ops\//,
  /\.sql$/i,
];
const visual = [
  /^POS\/css\/.*\.css$/i,
  /^POS\/(?:images?|icons?|assets)\/.*\.(?:png|jpe?g|webp|svg|gif)$/i,
  /^docs\/(?!DEVELOPMENT_RISK_POLICY\.md$|BRANCH_PREVIEW_WORKFLOW\.md$).*\.(?:md|png|jpe?g|webp)$/i,
];

export function classifyChanges(paths) {
  if (!Array.isArray(paths) || !paths.length) return 'critical';
  const files = paths.map(p => String(p).trim()).filter(Boolean);
  if (!files.length || files.some(p => p.startsWith('/') || p.includes('..') || p.includes('\\'))) return 'critical';
  if (files.some(p => critical.some(re => re.test(p)))) return 'critical';
  if (files.every(p => visual.some(re => re.test(p)))) return 'visual';
  return 'standard';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) { console.error('usage: change-impact.mjs PATHS_FILE'); process.exitCode = 2; }
  else {
    const paths = readFileSync(process.argv[2], 'utf8').split(/\r?\n/).filter(Boolean);
    console.log('level=' + classifyChanges(paths));
  }
}
