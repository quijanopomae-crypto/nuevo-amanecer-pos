import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const templatePath = join(here, 'index.template.html');
const outputPath = join(here, 'index.html');

const sections = {
  'menu': 'menu.html',
  'punto-venta': 'punto-venta.html',
  'inventario': 'inventario.html',
  'clientes': 'clientes.html',
  'caja': 'caja.html',
  'ventas': 'ventas.html',
  'gastos': 'gastos.html',
  'configuracion': 'configuracion.html'
};

export function buildLabHtml() {
  let html = readFileSync(templatePath, 'utf8');

  for (const [key, filename] of Object.entries(sections)) {
    const marker = `<!-- @LAB_SECTION:${key} -->`;
    const count = html.split(marker).length - 1;
    if (count !== 1) {
      throw new Error(`LAB_BUILD_MARKER_${count === 0 ? 'MISSING' : 'DUPLICATED'}: ${key}`);
    }
    const section = readFileSync(join(here, 'sections', filename), 'utf8').replace(/\n$/, '');
    html = html.replace(marker, section);
  }

  const leftovers = html.match(/<!-- @LAB_SECTION:[^>]+ -->/g);
  if (leftovers) throw new Error('LAB_BUILD_UNRESOLVED_MARKERS: ' + leftovers.join(', '));
  return html;
}

const generated = buildLabHtml();

if (process.argv.includes('--check')) {
  const current = readFileSync(outputPath, 'utf8');
  if (current !== generated) {
    console.error('LAB_BUILD_DRIFT');
    process.exit(1);
  }
  console.log('LAB_BUILD_PASS');
} else {
  writeFileSync(outputPath, generated, 'utf8');
  console.log('LAB_BUILD_WRITTEN');
}
