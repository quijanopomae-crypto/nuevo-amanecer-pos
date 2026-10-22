// Modo demostración del asistente: se usa cuando el Worker no tiene DEEPSEEK_API_KEY.
// Responde con reglas simples y devuelve las MISMAS llamadas de herramienta que haría el modelo,
// así la validación, los permisos y las tarjetas «Confirmar» se prueban igual sin gastar.
import { dateWordRange } from './pos-assistant-queries.js';
function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function findProducts(text, products) {
  const t = norm(text);
  return products.filter((p) => norm(p.nombre).split(/\s+/).some((w) => w.length >= 4 && t.includes(w)));
}
function numberBefore(text, product) {
  const t = norm(text), w = norm(product.nombre).split(/\s+/).find((x) => x.length >= 4 && t.includes(x));
  const m = w ? new RegExp('(\\d+)\\s+(?:\\w+\\s+){0,2}' + w).exec(t) : null;
  return m ? Number(m[1]) : 1;
}
const call = (name, args) => ({ name, arguments: JSON.stringify(args) });

// Fechas de documentos (AAAA-MM-DD; las arma el aparato): la palabra se convierte con el mismo cálculo de Lima del servidor (lunes = inicio de semana).
function dates(t) { const m = t.match(/\d{4}-\d{2}-\d{2}/g) || [];
  if (m.length) return { desde: m[0], hasta: m[1] || m[0] };
  return dateWordRange(periodWord(t)); }
// Consultas: igual que el modelo, la palabra de fecha va como «periodo» y el servidor calcula el rango en hora de Lima (pos-assistant-queries.js).
function periodWord(t) { return /mismo dia de la (otra semana|semana pasada)|hace (una semana|7 dias)/.test(t) ? 'mismo_dia_semana_pasada' : /antier|anteayer|antes de ayer/.test(t) ? 'antier'
  : /semana pasada/.test(t) ? 'semana_pasada' : /semana/.test(t) ? 'esta_semana' : /mes pasado/.test(t) ? 'mes_pasado'
  : /\bmes\b/.test(t) ? 'este_mes' : /\bayer\b/.test(t) ? 'ayer' : 'hoy'; }
function queryDates(t) { const m = t.match(/\d{4}-\d{2}-\d{2}/g) || []; return m.length ? { desde: m[0], hasta: m[1] || m[0] } : { periodo: periodWord(t) }; }

export function mockAssistantReply({ role, ctx, text, image }) {
  const t = norm(text), products = ctx.products || [];
  if (image) {
    if (/producto nuevo|nuevo producto|crear/.test(t)) return { content: 'Leí la foto del producto (demostración). Revisa los datos y pulsa Confirmar.',
      calls: [call('proponer_producto_nuevo', { nombre: 'Alcohol en gel 250 ml', precio: 6.5, costo: 3.9, stock_inicial: 12, stock_minimo: 4, categoria: 'cuidado', codigo_barras: '7750000123456', unidad: 'unidad' })] };
    const picks = products.slice(0, 3);
    const lineas = picks.map((p, i) => ({ product_id: p.id, nombre: p.nombre, cantidad: [24, 12, 6][i], costo_unitario: p.costo ? Math.round(p.costo * (i === 0 ? 1.12 : 1) * 100) / 100 : p.precio ? Math.round(p.precio * 0.62 * 100) / 100 : null }));
    lineas.push({ nombre: 'Producto no registrado (revisar)', cantidad: 2, costo_unitario: 4.5 });
    return { content: 'Leí la factura de la foto (demostración). Encontré ' + lineas.length + ' líneas. Revisa y pulsa Confirmar.',
      calls: [call('leer_factura_compra', { proveedor: 'Distribuidora Ejemplo SAC', documento: 'F001-000123', fecha: '2026-10-16', lineas })] };
  }
  // Consultas nuevas (solo lectura), antes de «vend…» (que manda a la pantalla Venta) y de las deudas en general.
  if (/\bgane\b|\bganamos\b|ganancia|utilidad/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'ganancia', ...queryDates(t) })] };
  if (/no se vend|sin ventas|no (se )?vendi|no sale|no salen/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'productos_sin_ventas', ...(/\d{4}-\d{2}-\d{2}|\bhoy\b|\bayer\b|semana|\bmes\b/.test(t) ? queryDates(t) : {}) })] };
  if (/a que hora|por hora|que hora(s)? (vendo|se vende|hay mas)|horas? de mas venta/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'ventas_por_hora', ...queryDates(t) })] };
  { const cli = /\bcliente\s*#?\s*([A-Za-z0-9_-]{1,40})\b/i.exec(String(text || '')); // solo el código («cliente #12» o «cliente 12»), nunca el nombre
    if (cli && /debe|deuda|saldo/.test(t) && !/estado de cuenta/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'deuda_cliente', cliente_id: cli[1] })] }; }
  if (/vend|carrito|cobra/.test(t) && !/vendid|ventas|reporte/.test(t)) return { content: 'Las ventas se hacen a mano en Venta. Yo te ayudo con stock, compras, precios, productos y reportes.', calls: [] };
  if (/document|pdf|imprim|reporte de|lista de precios|estado de cuenta|inventario valorizado|valorizado|cierre de caja|pedido para|lista de pedido/.test(t)) {
    const tipo = /lista de precios/.test(t) ? 'lista_precios' : /valoriz/.test(t) ? 'inventario_valorizado' : /reponer|pedido/.test(t) ? 'lista_pedido'
      : /estado de cuenta/.test(t) ? 'estado_cuenta' : /cierre|caja/.test(t) ? 'resumen_cierre' : 'reporte_ventas';
    const cli = /cliente #([A-Za-z0-9_-]{1,40})/.exec(String(text || '')); // el aparato manda «cliente #código», nunca el nombre
    return { content: 'Armé el documento. Es interno, NO es comprobante SUNAT.', calls: [call('preparar_documento', { tipo, ...dates(t), ...(cli ? { cliente_id: cli[1] } : {}) })] };
  }
  if (/sugerencias? de compra|sugiereme (que )?comprar|que (debo|tengo que|me conviene|deberia) comprar|cuanto (debo|tengo que|deberia) (comprar|pedir)/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'sugerencias_compra' })] };
  if (/resumen/.test(t) && !/cierre|caja/.test(t)) return { content: '', calls: [call('consultar', { tipo: /mes|mensual/.test(t) ? 'resumen_mes' : 'resumen_dia', ...(/\d{4}-\d{2}-\d{2}/.test(t) ? { hasta: t.match(/\d{4}-\d{2}-\d{2}/)[0] } : /\bayer\b|mes pasado|antier|anteayer|mismo dia de la/.test(t) ? { periodo: periodWord(t) } : {}) })] };
  if (/reponer|falta|bajo|minimo|agotad/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'bajo_stock' })] };
  if (/sin costo/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'sin_costo' })] };
  if (/atrasad|moros|creditos? vencid/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'creditos_atrasados' })] };
  if (/deud|deben|fiado/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'deudas_clientes' })] };
  if (/compras (recientes|ultimas)|ultimas compras/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'compras_recientes' })] };
  if (/mas vendid|top/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'top_productos', ...queryDates(t) })] };
  if (/ventas|vendi|vendimos/.test(t)) return { content: '', calls: [call('consultar', { tipo: 'ventas_periodo', ...queryDates(t) })] };
  if (/cuanto (hay|queda|tengo)|stock de/.test(t)) { const p = findProducts(t, products)[0]; return { content: '', calls: [call('consultar', { tipo: 'stock_producto', producto: p ? p.nombre : t.replace(/.*(stock de|queda de|hay de)/, '') })] }; }
  if (/precio/.test(t)) {
    const p = findProducts(t, products)[0];
    const n = /(\d+(?:[.,]\d+)?)\s*(?:soles|sol)?\s*$/.exec(t) || /a\s+(?:s\/\s*)?(\d+(?:[.,]\d+)?)/.exec(t);
    if (!p) return { content: 'Dime qué producto quieres cambiar de precio.', calls: [] };
    const nuevo = n ? Number(String(n[1]).replace(',', '.')) : Math.round((p.precio || 1) * 1.1 * 10) / 10;
    return { content: `Propongo cambiar ${p.nombre} a S/ ${nuevo.toFixed(2)}. Revisa y pulsa Confirmar.`,
      calls: [call('proponer_cambio_precio', { product_id: p.id, nombre: p.nombre, precio_nuevo: nuevo, motivo: 'Pedido en el chat' })] };
  }
  if (/ajust|merma|vencid|entrada|salida|devoluc/.test(t)) {
    const p = findProducts(t, products)[0]; if (!p) return { content: 'Dime qué producto y cuántas unidades.', calls: [] };
    const tipo = /merma|vencid|salida|dano|rot/.test(t) ? 'salida' : 'entrada';
    const motivo = /vencid/.test(t) ? 'Producto vencido' : /merma|dano|rot/.test(t) ? 'Merma / daño' : /devoluc/.test(t) ? 'Devolución' : 'Ajuste de inventario';
    return { content: 'Preparé el movimiento de stock. Revisa y pulsa Confirmar.', calls: [call('proponer_ajuste_stock', { product_id: p.id, tipo, cantidad: numberBefore(t, p), motivo })] };
  }
  if (/producto nuevo|nuevo producto|crea(r)? (el )?producto/.test(t)) {
    const m = /producto (?:nuevo )?([a-z0-9 ]{3,40}?)(?: a | precio |$)/.exec(t), pr = /(?:a|precio)\s*(?:s\/\s*)?(\d+(?:[.,]\d+)?)/.exec(t);
    return { content: 'Preparé el producto nuevo. Revisa y pulsa Confirmar.', calls: [call('proponer_producto_nuevo', { nombre: m ? m[1].trim() : 'Producto nuevo', precio: pr ? Number(pr[1].replace(',', '.')) : 5 })] };
  }
  if (/compra|proveedor|llego|llegaron/.test(t)) {
    const ps = findProducts(t, products);
    if (!ps.length) return { content: 'Dime qué productos llegaron y cuántos.', calls: [] };
    return { content: 'Preparé la compra. Revisa cantidades y costos, y pulsa Confirmar.',
      calls: [call('preparar_compra', { lineas: ps.map((p) => ({ product_id: p.id, nombre: p.nombre, cantidad: numberBefore(t, p) })) })] };
  }
  if (/como|ayuda|donde|que hago/.test(t)) {
    if (/caja/.test(t)) return { content: 'Así se abre la caja:', calls: [call('explicar_pasos', { tema: 'Abrir caja', pantalla: 'pageCaja', pasos: ['Toca Caja en el menú.', 'Pulsa «Abrir caja».', 'Escribe el dinero inicial.', 'Confirma.'] })] };
    if (/abono|credito|deuda/.test(t)) return { content: 'Así registras un abono:', calls: [call('explicar_pasos', { tema: 'Registrar un abono', pantalla: 'pageClientes', pasos: ['Toca Clientes.', 'Abre la ficha del cliente.', 'Pulsa «Abonar».', 'Escribe el monto y elige la deuda.', 'Pulsa Confirmar.'] })] };
    return { content: 'Así registras una compra:', calls: [call('explicar_pasos', { tema: 'Registrar una compra', pantalla: 'pageInventario', pasos: ['Toca Inventario.', 'Pulsa «Registrar compra».', 'Elige proveedor y documento.', 'Agrega productos, cantidades y costos.', 'Pulsa «Registrar compra».'] })] };
  }
  return { content: 'Hola, soy Burbuja. Te ayudo a ver stock y ventas, registrar compras, ajustar stock, cambiar precios, crear productos y armar documentos.', calls: [] };
}
