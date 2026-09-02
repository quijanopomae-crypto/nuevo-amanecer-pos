/*
 * ocr-parse.js — PARSE de compras OCR (V1.1).
 *
 * Responsabilidad UNICA: convertir texto OCR bruto en lineas de compra
 * estructuradas. NO toca catalogo, NO toca stock, NO toca ledger, NO toca
 * persistencia, NO toca DOM. Funcion pura y determinista.
 *
 * Contrato:
 *   parsePurchaseText(text) -> Array<{raw,name,qty,unitPrice,...}>
 *
 * REGLA ABSOLUTA: no inventar valores. Si una cantidad o un precio no son
 * confiables se devuelven null y la linea queda con needsReview=true.
 *
 * Classic script (sin ES modules, sin defer), compatible con file://.
 */

// Marcas diacriticas combinantes (forma escapada, igual que core/utils.js).
var _NA_OCR_COMBINING = /[̀-ͯ]/g;

// Lineas que NO son producto: cabeceras, totales y datos fiscales del
// documento. Se comparan sin tildes y en minusculas.
//
// INEQUIVOCAS: descartan la linea siempre.
var _NA_OCR_NON_ITEM_PATTERNS = [
  /^sub\s*total/, /^igv/, /^i\.\s*g\.\s*v/, /^impuesto/,
  /^op\.?\s*(gravad|inafect|exonerad|gratuit)/, /^gravad/, /^inafect/, /^exonerad/,
  /^ruc/, /^dni/, /^razon\s*social/, /^direccion/, /^telefono/,
  /^factura/, /^boleta/, /^guia/, /^nota\s*de/, /^comprobante/,
  /^n[°º]/, /^nro/, /^numero/,
  /^fecha/, /^hora/, /^cajero/, /^vendedor/, /^cliente/, /^proveedor/,
  /^cant(idad)?$/, /^cant\.?\s+(desc|prod|art)/, /^descripcion/, /^detalle$/,
  /^precio$/, /^p\.?\s*unit/, /^importe/, /^valor\s*(unit|venta)/, /^unidad$/,
  /^codigo$/, /^cod\.?$/, /^item$/, /^articulo$/,
  /^forma\s*de\s*pago/, /^efectivo$/, /^vuelto/, /^cambio$/, /^descuento/,
  /^gracias/, /^atendido/, /^observacion/, /^condicion/, /^vencimiento$/,
  /^representacion\s*impresa/, /^autorizado\s*mediante/, /^bienes\s*transferidos/,
];

// AMBIGUAS: son cabecera del documento PERO tambien existen como producto o
// marca real ("TOTAL QUARTZ", "CAJA DE FOSFOROS", "SERIE ORO"). Solo descartan
// la linea cuando NO hay estructura de compra, es decir menos de dos numeros
// consecutivos al final. Asi un total del documento ("TOTAL 24.78", un solo
// numero) se descarta y un producto ("TOTAL QUARTZ 5W30 2 45.00") se conserva.
var _NA_OCR_AMBIGUOUS_PATTERNS = [
  /^total/, /^caja/, /^serie/, /^ticket/,
];

/** Quita tildes reutilizando el helper del producto si esta cargado. */
function _naOcrDeaccent(value) {
  var text = String(value === null || value === undefined ? '' : value);
  if (typeof sinTildes === 'function') {
    try { return sinTildes(text); } catch (e) { /* usa el fallback local */ }
  }
  return text.normalize('NFD').replace(_NA_OCR_COMBINING, '');
}

/** Clave de comparacion para cabeceras: sin tildes, minusculas, 1 espacio. */
function _naOcrHeaderKey(line) {
  return _naOcrDeaccent(line).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** true si la linea es cabecera/total/dato fiscal y no una linea de producto. */
function _naOcrIsNonItemLine(line) {
  var key = _naOcrHeaderKey(line);
  if (!key) return true;
  for (var i = 0; i < _NA_OCR_NON_ITEM_PATTERNS.length; i += 1) {
    if (_NA_OCR_NON_ITEM_PATTERNS[i].test(key)) return true;
  }
  for (var j = 0; j < _NA_OCR_AMBIGUOUS_PATTERNS.length; j += 1) {
    if (!_NA_OCR_AMBIGUOUS_PATTERNS[j].test(key)) continue;
    // Palabra ambigua: solo es cabecera si la linea no trae cantidad + precio.
    return _naOcrTailNumCount(_naOcrTokenize(line)) < 2;
  }
  return false;
}

/*
 * Convierte UN token OCR en numero, sin inventar.
 *
 * Reparaciones aplicadas (solo si el token ya contiene al menos un digito
 * ASCII real, para no convertir palabras en numeros):
 *   - simbolos monetarios: "S/", "S/.", "$", "€"
 *   - O/o/Q -> 0 ; I/l/i/| -> 1
 *   - coma decimal -> punto ; separador de miles -> se elimina
 *
 * Devuelve {value, repaired, decimalComma, thousands} o null si no es numero.
 */
function _naOcrToNumber(token) {
  var raw = String(token === null || token === undefined ? '' : token).trim();
  if (!raw) return null;
  var body = raw.replace(/^[sS]\s*\/\.?/, '').replace(/[$€]/g, '').replace(/\s+/g, '');
  body = body.replace(/[.,;:]+$/, '');
  if (!body) return null;
  if (!/[0-9]/.test(body)) return null; // sin digitos reales: no se repara

  var repaired = false;
  var fixedBody = body.replace(/[OoQ]/g, '0').replace(/[Il|i]/g, '1');
  if (fixedBody !== body) repaired = true;
  if (!/^[0-9.,]+$/.test(fixedBody)) return null;

  var decimalComma = false;
  var thousands = false;
  var lastComma = fixedBody.lastIndexOf(',');
  var lastDot = fixedBody.lastIndexOf('.');
  var normalized = fixedBody;

  if (lastComma >= 0 && lastDot >= 0) {
    // El separador que aparece MAS a la derecha es el decimal.
    if (lastComma > lastDot) {
      normalized = fixedBody.replace(/\./g, '');
      normalized = normalized.replace(/,/g, '.');
      decimalComma = true;
    } else {
      normalized = fixedBody.replace(/,/g, '');
    }
    thousands = true;
  } else if (lastComma >= 0) {
    var afterComma = fixedBody.length - lastComma - 1;
    if (afterComma === 3 && lastComma > 0) {
      normalized = fixedBody.replace(/,/g, ''); // 1,250 -> miles
      thousands = true;
    } else {
      normalized = fixedBody.replace(/,/g, '.'); // 3,50 -> decimal
      decimalComma = true;
    }
  }

  if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) return null;
  var value = Number(normalized);
  if (!isFinite(value)) return null;
  return { value: value, repaired: repaired, decimalComma: decimalComma, thousands: thousands };
}

/** Cantidad plausible: positiva, no gigantesca. Entera o con 1-3 decimales. */
function _naOcrPlausibleQty(value) {
  if (typeof value !== 'number' || !isFinite(value)) return false;
  if (value <= 0 || value > 9999) return false;
  return true;
}

/** Cantidad "fuerte": entera. Las fraccionarias (peso) van a revision. */
function _naOcrIntegerQty(value) {
  return _naOcrPlausibleQty(value) && Math.abs(value - Math.round(value)) < 1e-9;
}

/** Precio plausible: positivo y con techo defensivo. */
function _naOcrPlausiblePrice(value) {
  return typeof value === 'number' && isFinite(value) && value > 0 && value <= 1000000;
}

/**
 * Codigo candidato (barcode/SKU) dentro de un token: corridas de 6-14 digitos.
 * Se repara O->0 e I->1 solo si el token ya tenia digitos.
 */
function _naOcrCodeCandidate(token) {
  var raw = String(token === null || token === undefined ? '' : token).trim();
  if (!raw || !/[0-9]/.test(raw)) return null;
  var body = raw.replace(/[OoQ]/g, '0').replace(/[Il|i]/g, '1');
  if (!/^[0-9]{6,14}$/.test(body)) return null;
  return body;
}

/** Redondeo monetario a 2 decimales. */
function _naOcrRound2(value) {
  return Math.round(Number(value) * 100) / 100;
}

// Token que solo es marca monetaria: no aporta dato y rompia el bloque
// numerico final ("... 1 S/ 189,50"). Se descarta al tokenizar.
var _NA_OCR_CURRENCY_ONLY = /^(?:[sS]\s*\/\.?|[$€])$/;

/**
 * Tokeniza una linea y precalcula, por token, su lectura numerica y su
 * lectura como codigo.
 *
 * - Los tokens que solo son simbolo monetario se descartan.
 * - Una corrida de 6 a 14 digitos SIN separador decimal se clasifica como
 *   CODIGO (barcode/SKU) y NO participa del analisis cantidad/precio: de lo
 *   contrario un barcode de 13 digitos se leia como cantidad.
 *
 * @returns {{text:string, num:object|null, code:string|null}[]}
 */
function _naOcrTokenize(line) {
  var parts = String(line === null || line === undefined ? '' : line)
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  var out = [];
  for (var i = 0; i < parts.length; i += 1) {
    var text = parts[i];
    if (!text) continue;
    if (_NA_OCR_CURRENCY_ONLY.test(text)) continue;
    var code = null;
    if (text.indexOf('.') < 0 && text.indexOf(',') < 0) code = _naOcrCodeCandidate(text);
    out.push({ text: text, num: code ? null : _naOcrToNumber(text), code: code });
  }
  return out;
}

/** Cantidad de tokens numericos consecutivos al final de la linea. */
function _naOcrTailNumCount(tokens) {
  var i = tokens.length;
  while (i > 0 && tokens[i - 1].num) i -= 1;
  return tokens.length - i;
}

/**
 * Parsea UNA linea. Devuelve el objeto de linea de compra o null si la linea
 * no es una linea de producto (vacia, cabecera, total, o sin nombre ni codigo).
 */
function _naOcrParseLine(line, lineNumber) {
  var raw = String(line === null || line === undefined ? '' : line);
  var trimmed = raw.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (_naOcrIsNonItemLine(trimmed)) return null;

  var tokens = _naOcrTokenize(trimmed);
  if (!tokens.length) return null;

  var reasons = [];
  var tailStart = tokens.length;
  while (tailStart > 0 && tokens[tailStart - 1].num) tailStart -= 1;
  var tail = tokens.slice(tailStart);
  var headIsNum = tailStart > 0 && !!tokens[0].num;

  var qty = null, unitPrice = null, total = null;
  var qtyConfident = false, priceConfident = false;
  var layout = 'NAME_ONLY';
  var consumedHead = 0, consumedTail = 0;
  var totalChecked = false, totalMatches = false;

  if (tail.length >= 3) {
    var a = tail[tail.length - 3].num.value;
    var b = tail[tail.length - 2].num.value;
    var c = tail[tail.length - 1].num.value;
    var tol = Math.max(0.05, Math.abs(c) * 0.01);
    consumedTail = 3;
    totalChecked = true;
    if (_naOcrPlausibleQty(a) && _naOcrPlausiblePrice(b) && Math.abs(a * b - c) <= tol) {
      qty = a; unitPrice = b; total = c; layout = 'NAME_QTY_PRICE_TOTAL';
      qtyConfident = _naOcrIntegerQty(a); priceConfident = true; totalMatches = true;
      if (!qtyConfident) reasons.push('CANTIDAD_FRACCIONARIA');
    } else if (_naOcrPlausibleQty(b) && _naOcrPlausiblePrice(a) && Math.abs(b * a - c) <= tol) {
      qty = b; unitPrice = a; total = c; layout = 'NAME_PRICE_QTY_TOTAL';
      qtyConfident = _naOcrIntegerQty(b); priceConfident = true; totalMatches = true;
      reasons.push('COLUMNAS_INVERTIDAS');
      if (!qtyConfident) reasons.push('CANTIDAD_FRACCIONARIA');
    } else {
      qty = a; unitPrice = b; total = c; layout = 'NAME_QTY_PRICE_TOTAL';
      reasons.push('DISCREPANCIA_CANTIDAD_POR_PRECIO');
    }
  }

  else if (tail.length === 2) {
    var q2 = tail[0].num.value, p2 = tail[1].num.value;
    consumedTail = 2;
    // La cantidad de este layout debe ser ENTERA. Un valor fraccionario
    // (18.90) es un precio, no una cantidad: leerlo como cantidad inventaba
    // datos. Si no es entera se interpreta como (precio, total).
    if (_naOcrIntegerQty(q2) && _naOcrPlausiblePrice(p2)) {
      qty = q2; unitPrice = p2; layout = 'NAME_QTY_PRICE';
      qtyConfident = true; priceConfident = true;
    } else {
      unitPrice = q2; total = p2; layout = 'NAME_PRICE_TOTAL';
      priceConfident = _naOcrPlausiblePrice(q2);
      reasons.push('CANTIDAD_NO_DETECTADA');
    }
  } else if (tail.length === 1) {
    var only = tail[0].num.value;
    consumedTail = 1;
    if (headIsNum && _naOcrIntegerQty(tokens[0].num.value)) {
      qty = tokens[0].num.value; unitPrice = only; consumedHead = 1;
      layout = 'QTY_NAME_PRICE';
      qtyConfident = true; priceConfident = _naOcrPlausiblePrice(only);
    } else {
      unitPrice = only; layout = 'NAME_PRICE';
      priceConfident = _naOcrPlausiblePrice(only);
      reasons.push('CANTIDAD_NO_DETECTADA');
    }
  } else if (headIsNum && _naOcrIntegerQty(tokens[0].num.value)) {
    qty = tokens[0].num.value; consumedHead = 1; layout = 'QTY_NAME';
    qtyConfident = true;
    reasons.push('PRECIO_NO_DETECTADO');
  } else {
    reasons.push('CANTIDAD_NO_DETECTADA');
    reasons.push('PRECIO_NO_DETECTADO');
  }

  if (!priceConfident && unitPrice !== null && reasons.indexOf('PRECIO_NO_CONFIABLE') < 0
      && reasons.indexOf('DISCREPANCIA_CANTIDAD_POR_PRECIO') < 0) {
    reasons.push('PRECIO_NO_CONFIABLE');
  }

  // Codigos: se recolectan de TODOS los tokens (los tokens-codigo nunca se
  // consumen como cantidad/precio). El nombre se arma solo con los tokens
  // libres que no son codigo.
  var codes = [];
  for (var c = 0; c < tokens.length; c += 1) {
    if (tokens[c].code && codes.indexOf(tokens[c].code) < 0) codes.push(tokens[c].code);
  }
  var free = tokens.slice(consumedHead, tokens.length - consumedTail);
  var nameParts = [];
  for (var i = 0; i < free.length; i += 1) {
    if (free[i].code) continue;
    nameParts.push(free[i].text);
  }
  var name = nameParts.join(' ').replace(/^[-–—•.,:;|]+/, '').replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ').trim();

  // Una linea sin NINGUN dato de compra (ni cantidad, ni precio, ni total, ni
  // codigo) no es una linea de compra: es texto del documento (razon social,
  // direccion, leyendas). No se emite para no ensuciar la revision humana.
  if (qty === null && unitPrice === null && total === null && !codes.length) return null;

  var hasLetter = /[A-Za-zÑñ]/.test(_naOcrDeaccent(name));
  if (!hasLetter && !codes.length) return null;
  if (!hasLetter) reasons.push('NOMBRE_NO_DETECTADO');

  // Banderas de reparacion OCR sobre los tokens realmente consumidos.
  var repaired = false, decimalComma = false;
  var consumed = [];
  if (consumedHead) consumed.push(tokens[0]);
  for (var t = tokens.length - consumedTail; t < tokens.length; t += 1) consumed.push(tokens[t]);
  for (var k = 0; k < consumed.length; k += 1) {
    if (!consumed[k] || !consumed[k].num) continue;
    if (consumed[k].num.repaired) repaired = true;
    if (consumed[k].num.decimalComma) decimalComma = true;
  }
  if (repaired) reasons.push('OCR_DIGITOS_CORREGIDOS');
  if (decimalComma) reasons.push('DECIMAL_CON_COMA');
  if (codes.length) reasons.push('CODIGO_DETECTADO');

  var confidence = 0.4;
  if (qtyConfident) confidence += 0.25;
  if (priceConfident) confidence += 0.25;
  if (totalChecked && totalMatches) confidence += 0.1;
  if (repaired) confidence -= 0.15;
  if (reasons.indexOf('DISCREPANCIA_CANTIDAD_POR_PRECIO') >= 0) confidence -= 0.1;
  if (!hasLetter) confidence -= 0.1;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;

  return {
    raw: trimmed,
    lineNumber: lineNumber,
    name: name,
    qty: qty === null ? null : _naOcrRound2(qty),
    unitPrice: unitPrice === null ? null : _naOcrRound2(unitPrice),
    total: total === null ? null : _naOcrRound2(total),
    codes: codes,
    layout: layout,
    qtyConfident: qtyConfident,
    priceConfident: priceConfident,
    totalMatches: totalChecked ? totalMatches : null,
    needsReview: !(qtyConfident && priceConfident),
    confidence: _naOcrRound2(confidence),
    reasons: reasons,
  };
}

/**
 * PARSE: texto OCR bruto -> lineas de compra estructuradas.
 *
 * Tolera CRLF/CR, lineas vacias, espacios dobles, simbolos monetarios,
 * decimales con coma o punto y confusiones tipicas O/0 e I/l/1 en tokens
 * numericos. Descarta cabeceras, totales y datos fiscales del documento.
 *
 * NO inventa valores: lo que no se puede leer con seguridad queda en null y
 * la linea se marca needsReview=true con el motivo en reasons[].
 *
 * @param {string} text texto OCR bruto
 * @returns {object[]} lineas de compra (vacio si no hay ninguna)
 */
function parsePurchaseText(text) {
  var source = String(text === null || text === undefined ? '' : text);
  if (!source.trim()) return [];
  var lines = source.replace(/\r\n?/g, '\n').split('\n');
  var out = [];
  for (var i = 0; i < lines.length; i += 1) {
    var parsed = _naOcrParseLine(lines[i], i + 1);
    if (parsed) out.push(parsed);
  }
  return out;
}

// Superficie publica del modulo de parse (para pruebas y para el resto del
// pipeline OCR). No se registra nada en V9/V10 ni en persistencia.
var _NA_OCR_PARSE = {
  version: '1.1.0',
  parsePurchaseText: parsePurchaseText,
  toNumber: _naOcrToNumber,
  tokenize: _naOcrTokenize,
  isNonItemLine: _naOcrIsNonItemLine,
  codeCandidate: _naOcrCodeCandidate,
  deaccent: _naOcrDeaccent,
  parseLine: _naOcrParseLine,
};

if (typeof window !== 'undefined') {
  window._NA_OCR_PARSE = _NA_OCR_PARSE;
  window.parsePurchaseText = parsePurchaseText;
}
