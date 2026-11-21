// Revisión determinista de cifras extraídas por la ÚNICA llamada multimodal de Work.
// Los datos de la imagen son no confiables; jamás se inventan unidades o importes.
const positive = value => value === null || value === undefined || value === '' ? null : Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;
const cents = n => Math.round(n * 100);
const near = (a,b) => Math.abs(a-b) <= 1; // tolerancia: un céntimo, no ajustes silenciosos
export function normalizePhotoPurchaseLine(raw = {}) {
  const packs = positive(raw.paquetes), perPack = positive(raw.unidades_por_paquete);
  const claimed = positive(raw.cantidad), unitCost = positive(raw.costo_unitario);
  const declared = positive(raw.total_linea);
  const flags = [];
  let quantity = claimed;
  if (packs !== null && perPack !== null) {
    const calculated = packs * perPack;
    if (!Number.isFinite(calculated) || calculated <= 0 || calculated > 9999) flags.push('cantidad_empaque');
    else {
      if (claimed !== null && claimed !== packs && Math.abs(claimed-calculated)>0.0001) flags.push('cantidad_empaque');
      quantity = calculated; // 5 paquetes × 12 unidades = 60; nunca 5.
    }
  } else if (packs !== null && perPack === null) {
    flags.push('unidades_por_paquete');
  }
  if (declared !== null && (quantity === null || unitCost === null || !near(cents(quantity * unitCost), cents(declared)))) flags.push('importe_fila');
  return { cantidad:quantity, costo_unitario:unitCost, paquetes:packs, unidades_por_paquete:perPack,
    presentacion:typeof raw.presentacion === 'string' ? raw.presentacion.slice(0,80) : '',
    unidad:typeof raw.unidad === 'string' ? raw.unidad.slice(0,25) : '',
    total_linea:declared, revisar:flags };
}
export function checkPhotoDocument(lines, source = {}) {
  const flags = [];
  const count=positive(source.numero_productos), units=positive(source.total_unidades), total=positive(source.total_documento);
  if (count !== null && count !== lines.length) flags.push('numero_productos');
  const quantity = lines.reduce((n,l)=>n+(Number(l.cantidad)||0),0);
  if (units !== null && (!lines.every(l=>Number(l.cantidad)>0) || Math.abs(quantity-units)>0.0001)) flags.push('total_unidades');
  const complete = lines.length > 0 && lines.every(l=>Number(l.cantidad)>0 && l.costo_unitario !== null && Number.isFinite(Number(l.costo_unitario)));
  const totalCalculated=complete ? lines.reduce((n,l)=>n+cents(Number(l.cantidad)*Number(l.costo_unitario)),0) : null;
  if (total !== null && (totalCalculated === null || !near(totalCalculated,cents(total)))) flags.push('total_documento');
  return { flags, cantidad_calculada:quantity, total_calculado:totalCalculated === null ? null : totalCalculated/100,
    total_impreso:total, unidades_impresas:units, productos_impresos:count };
}
