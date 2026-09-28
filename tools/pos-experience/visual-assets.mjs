export const visualAssets = Object.freeze([
  ['laboratorio/pos-lab/styles/tokens.css','POS/css/experience-v2/tokens.css'],
  ['laboratorio/pos-lab/styles/layout.css','POS/css/experience-v2/layout.css'],
  ['laboratorio/pos-lab/styles/responsive.css','POS/css/experience-v2/responsive.css'],
  ['laboratorio/pos-lab/styles/components/buttons.css','POS/css/experience-v2/components/buttons.css'],
  ['laboratorio/pos-lab/styles/components/cards.css','POS/css/experience-v2/components/cards.css'],
  ['laboratorio/pos-lab/styles/components/tables.css','POS/css/experience-v2/components/tables.css'],
  ['laboratorio/pos-lab/styles/components/forms.css','POS/css/experience-v2/components/forms.css'],
  ['laboratorio/pos-lab/styles/components/modals.css','POS/css/experience-v2/components/modals.css'],
  ['laboratorio/pos-lab/styles/components/navigation.css','POS/css/experience-v2/components/navigation.css'],
  ['laboratorio/pos-lab/styles/pages/menu.css','POS/css/experience-v2/pages/menu.css'],
  ['laboratorio/pos-lab/styles/pages/pos.css','POS/css/experience-v2/pages/pos.css'],
  ['laboratorio/pos-lab/styles/pages/inventario.css','POS/css/experience-v2/pages/inventario.css'],
  ['laboratorio/pos-lab/styles/pages/clientes.css','POS/css/experience-v2/pages/clientes.css','canon-namespace'],
  ['laboratorio/pos-lab/styles/pages/caja.css','POS/css/experience-v2/pages/caja.css'],
  ['laboratorio/pos-lab/styles/pages/ventas.css','POS/css/experience-v2/pages/ventas.css'],
  ['laboratorio/pos-lab/styles/pages/gastos.css','POS/css/experience-v2/pages/gastos.css'],
  ['laboratorio/pos-lab/styles/pages/configuracion.css','POS/css/experience-v2/pages/configuracion.css'],
  ['laboratorio/pos-lab/animations/motion.css','POS/css/experience-v2/animations/motion.css'],
  ['laboratorio/pos-lab/animations/transitions.css','POS/css/experience-v2/animations/transitions.css','canon-namespace'],
  ['laboratorio/pos-lab/animations/menu.css','POS/css/experience-v2/animations/menu.css'],
  ['laboratorio/pos-lab/animations/pos.css','POS/css/experience-v2/animations/pos.css'],
  ['laboratorio/pos-lab/animations/modals.css','POS/css/experience-v2/animations/modals.css'],
  ['laboratorio/pos-lab/animations/notifications.css','POS/css/experience-v2/animations/notifications.css']
].map(([lab, canon, transform = 'identity']) => Object.freeze({
  lab,
  canon,
  transform,
  href: canon.replace(/^POS\//, ''),
  precache: './' + canon.replace(/^POS\//, '')
})));

export function canonicalVisualSource(asset, source) {
  if (asset.transform !== 'canon-namespace') return source;
  return source
    .replaceAll('--lab-ease-standard', '--na-motion-ease-standard')
    .replaceAll('lab-fade-in', 'na-motion-fade-in')
    .replaceAll('lab-', 'na-');
}
