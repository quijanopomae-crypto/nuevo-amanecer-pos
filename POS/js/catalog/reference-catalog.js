/*
 * reference-catalog.js — CATALOGO MAESTRO DE REFERENCIA (V1.1, ciclo 1B).
 *
 * CATALOGO MAESTRO != INVENTARIO REAL. Esta capa es SOLO LECTURA y SOLO
 * REFERENCIA: normaliza filas de la fuente, construye indices derivados en
 * memoria y responde busquedas. Nunca crea productos ni toca stock, costo,
 * precio, SKU, barcode, ventas, caja, creditos, inventoryMovements,
 * applyInventoryMovement ni el snapshot V9.
 *
 * Almacenamiento: dataset versionado como classic JS
 * (POS/js/catalog/reference-catalog-data.js) + indices derivados en memoria.
 * Sin IndexedDB, sin localStorage, sin backend. Ver WHY_STORAGE en el informe.
 *
 * IDENTIDAD: CODIGO_REFERENCIA NO es unico (hay codigos repetidos entre
 * productos distintos). La identidad estable es FILA_XLS, de donde se deriva
 * referenceId. Un codigo puede devolver VARIAS referencias y eso NUNCA se
 * resuelve automaticamente: requiere revision humana.
 *
 * No convierte CODIGO_REFERENCIA en barcode del POS.
 * No convierte MEDIDA en unidad comercial del POS.
 *
 * Classic script (sin ES modules, sin defer), compatible con file://.
 */

// Marcas diacriticas combinantes (misma forma que core/utils.js).
var _NA_REF_COMBINING = /[̀-ͯ]/g;

/** Quita tildes reutilizando el helper del producto si esta cargado. */
function _naRefDeaccent(value) {
  var text = String(value === null || value === undefined ? '' : value);
  if (typeof sinTildes === 'function') {
    try { return sinTildes(text); } catch (e) { /* usa el fallback local */ }
  }
  return text.normalize('NFD').replace(_NA_REF_COMBINING, '');
}

/** Limpieza conservadora: recorta y colapsa espacios. No cambia el contenido. */
function _naRefClean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

/**
 * Clave de busqueda: sin tildes, minusculas, un solo espacio.
 * Conservadora: no quita puntuacion ni reordena palabras.
 */
function _naRefSearchKey(value) {
  return _naRefDeaccent(_naRefClean(value)).toLowerCase();
}

/** Clave de codigo: sin espacios ni guiones, minusculas. */
function _naRefCodeKey(value) {
  return _naRefDeaccent(_naRefClean(value)).toLowerCase().replace(/[\s\-_.]/g, '');
}

/** Booleano tolerante a "1"/"SI"/"TRUE"/"X" de una hoja de calculo. */
function _naRefBool(value) {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  var key = _naRefSearchKey(value);
  if (!key) return false;
  return key === '1' || key === 'si' || key === 'sí' || key === 'true'
    || key === 'x' || key === 'yes' || key === 'v';
}

// Alias aceptados por columna de la fuente. La fuente canonica usa los
// nombres exactos del XLSX normalizado; los alias permiten releer un CSV
// exportado sin reescribir el importador.
var _NA_REF_COLUMNS = {
  sourceRow: ['FILA_XLS', 'sourceRow', 'fila', 'row'],
  referenceCode: ['CODIGO_REFERENCIA', 'referenceCode', 'codigo'],
  group: ['GRUPO', 'group', 'grupo'],
  originalName: ['NOMBRE_ORIGINAL', 'originalName'],
  safeName: ['NOMBRE_LIMPIO_SEGURO', 'safeName'],
  measure: ['MEDIDA', 'measure', 'medida'],
  duplicateCode: ['CODIGO_DUPLICADO', 'duplicateCode'],
  duplicateName: ['NOMBRE_DUPLICADO', 'duplicateName'],
};

/** Primer valor presente entre los alias de una columna. */
function _naRefPick(raw, aliases) {
  for (var i = 0; i < aliases.length; i += 1) {
    var key = aliases[i];
    if (raw && Object.prototype.hasOwnProperty.call(raw, key)) {
      var value = raw[key];
      if (value !== null && value !== undefined && String(value) !== '') return value;
    }
  }
  return null;
}

/** Entero de hoja de calculo o null. No inventa: "" y basura dan null. */
function _naRefInt(value) {
  if (value === null || value === undefined) return null;
  var text = _naRefClean(value);
  if (!/^[0-9]+$/.test(text)) return null;
  var parsed = parseInt(text, 10);
  return isFinite(parsed) ? parsed : null;
}

/**
 * Normaliza UNA fila cruda de la fuente al modelo de referencia.
 * Devuelve null si la fila no tiene identidad ni nombre utilizable.
 *
 * referenceId se deriva de FILA_XLS (identidad estable de la fuente) porque
 * CODIGO_REFERENCIA NO es unico. Si falta FILA_XLS se usa el indice recibido.
 */
function _naRefNormalizeRow(raw, fallbackIndex) {
  if (!raw || typeof raw !== 'object') return null;
  var sourceRow = _naRefInt(_naRefPick(raw, _NA_REF_COLUMNS.sourceRow));
  var originalName = _naRefClean(_naRefPick(raw, _NA_REF_COLUMNS.originalName));
  var safeName = _naRefClean(_naRefPick(raw, _NA_REF_COLUMNS.safeName));
  var referenceCode = _naRefClean(_naRefPick(raw, _NA_REF_COLUMNS.referenceCode));
  if (!originalName && !safeName && !referenceCode) return null;
  var effectiveRow = sourceRow === null ? (Number(fallbackIndex) + 1) : sourceRow;
  return Object.freeze({
    referenceId: 'REF-' + String(effectiveRow),
    sourceRow: sourceRow,
    referenceCode: referenceCode,
    group: _naRefClean(_naRefPick(raw, _NA_REF_COLUMNS.group)),
    originalName: originalName,
    safeName: safeName || originalName,
    measure: _naRefClean(_naRefPick(raw, _NA_REF_COLUMNS.measure)),
    duplicateCode: _naRefBool(_naRefPick(raw, _NA_REF_COLUMNS.duplicateCode)),
    duplicateName: _naRefBool(_naRefPick(raw, _NA_REF_COLUMNS.duplicateName)),
  });
}

/**
 * Carga las referencias disponibles y devuelve el Array normalizado.
 *
 * @param {object|object[]|null} source dataset {rows:[...]}, Array de filas
 *        crudas, o nada para usar _NA_REFERENCE_CATALOG_DATA.
 * @returns {object[]} referencias normalizadas e inmutables (Object.freeze)
 */
function loadReferenceCatalog(source) {
  var data = source;
  if (data === null || data === undefined) {
    data = (typeof _NA_REFERENCE_CATALOG_DATA !== 'undefined') ? _NA_REFERENCE_CATALOG_DATA
      : ((typeof window !== 'undefined' && window._NA_REFERENCE_CATALOG_DATA) || null);
  }
  var rows = null;
  if (Array.isArray(data)) rows = data;
  else if (data && Array.isArray(data.rows)) rows = data.rows;
  if (!rows) return [];
  var out = [];
  for (var i = 0; i < rows.length; i += 1) {
    var reference = _naRefNormalizeRow(rows[i], i);
    if (reference) out.push(reference);
  }
  return out;
}

/**
 * Construye los indices derivados. NO modifica las referencias de entrada.
 *
 * @param {object[]} references salida de loadReferenceCatalog
 * @returns {object} indices congelados
 */
function buildReferenceCatalogIndexes(references) {
  var list = Array.isArray(references) ? references : [];
  var byId = new Map();
  var byCode = new Map();
  var byNameKey = new Map();
  var byGroup = new Map();
  var searchRows = [];

  for (var i = 0; i < list.length; i += 1) {
    var ref = list[i];
    if (!ref) continue;
    if (!byId.has(ref.referenceId)) byId.set(ref.referenceId, ref);

    var codeKey = _naRefCodeKey(ref.referenceCode);
    if (codeKey) {
      if (!byCode.has(codeKey)) byCode.set(codeKey, []);
      byCode.get(codeKey).push(ref);
    }

    var nameKey = _naRefSearchKey(ref.safeName);
    if (nameKey) {
      if (!byNameKey.has(nameKey)) byNameKey.set(nameKey, []);
      byNameKey.get(nameKey).push(ref);
    }

    var groupKey = _naRefSearchKey(ref.group);
    if (groupKey) {
      if (!byGroup.has(groupKey)) byGroup.set(groupKey, []);
      byGroup.get(groupKey).push(ref);
    }

    searchRows.push({
      reference: ref,
      nameKey: nameKey,
      originalKey: _naRefSearchKey(ref.originalName),
      codeKey: codeKey,
      groupKey: groupKey,
      measureKey: _naRefSearchKey(ref.measure),
    });
  }

  var duplicateCodeKeys = [];
  byCode.forEach(function (bucket, key) { if (bucket.length > 1) duplicateCodeKeys.push(key); });
  duplicateCodeKeys.sort();

  var duplicateNameKeys = [];
  byNameKey.forEach(function (bucket, key) { if (bucket.length > 1) duplicateNameKeys.push(key); });
  duplicateNameKeys.sort();

  return Object.freeze({
    count: list.length,
    byId: byId,
    byCode: byCode,
    byNameKey: byNameKey,
    byGroup: byGroup,
    searchRows: searchRows,
    duplicateCodeKeys: duplicateCodeKeys,
    duplicateNameKeys: duplicateNameKeys,
    duplicateCodeCount: duplicateCodeKeys.length,
    duplicateNameCount: duplicateNameKeys.length,
  });
}

// Estado del modulo: referencias + indices. Se puebla con initReferenceCatalog.
var _NA_REFERENCE_CATALOG_STATE = {
  loaded: false,
  references: [],
  indexes: buildReferenceCatalogIndexes([]),
};

/**
 * Carga y indexa en un solo paso. Idempotente por dataset.
 * @param {object|object[]|null} source
 * @returns {object} el estado del catalogo
 */
function initReferenceCatalog(source) {
  var references = loadReferenceCatalog(source);
  _NA_REFERENCE_CATALOG_STATE = {
    loaded: true,
    references: references,
    indexes: buildReferenceCatalogIndexes(references),
  };
  return _NA_REFERENCE_CATALOG_STATE;
}

/** Estado vigente; carga perezosa del dataset versionado en el primer uso. */
function _naRefState() {
  if (!_NA_REFERENCE_CATALOG_STATE.loaded) initReferenceCatalog(null);
  return _NA_REFERENCE_CATALOG_STATE;
}

/**
 * Obtiene una referencia exacta por referenceId.
 * @returns {object|null}
 */
function getReferenceById(referenceId) {
  var key = _naRefClean(referenceId);
  if (!key) return null;
  var found = _naRefState().indexes.byId.get(key);
  return found || null;
}

/**
 * TODAS las referencias que tienen ese codigo. Puede devolver mas de una:
 * en la fuente real hay codigos repetidos entre productos distintos.
 *
 * NUNCA asumir codigo -> producto unico.
 *
 * @returns {object[]} lista (vacia si no hay ninguna)
 */
function findReferenceCodeCandidates(code) {
  var key = _naRefCodeKey(code);
  if (!key) return [];
  var bucket = _naRefState().indexes.byCode.get(key);
  return bucket ? bucket.slice() : [];
}

/**
 * Resolucion EXPLICITA de un codigo. Nunca elige por el humano.
 *
 * @returns {{status:string, candidates:object[], reference:object|null}}
 *          status: 'NOT_FOUND' | 'UNIQUE' | 'AMBIGUOUS'
 *          reference solo se rellena cuando status === 'UNIQUE'
 */
function resolveReferenceCode(code) {
  var candidates = findReferenceCodeCandidates(code);
  if (!candidates.length) return { status: 'NOT_FOUND', candidates: [], reference: null };
  if (candidates.length > 1) {
    return { status: 'AMBIGUOUS', candidates: candidates, reference: null };
  }
  return { status: 'UNIQUE', candidates: candidates, reference: candidates[0] };
}

/** true si el nombre normalizado de la referencia aparece mas de una vez. */
function referenceNeedsHumanReview(reference) {
  if (!reference) return false;
  if (reference.duplicateCode || reference.duplicateName) return true;
  var indexes = _naRefState().indexes;
  var nameKey = _naRefSearchKey(reference.safeName);
  var nameBucket = nameKey ? indexes.byNameKey.get(nameKey) : null;
  if (nameBucket && nameBucket.length > 1) return true;
  var codeKey = _naRefCodeKey(reference.referenceCode);
  var codeBucket = codeKey ? indexes.byCode.get(codeKey) : null;
  return !!(codeBucket && codeBucket.length > 1);
}

/** Puntaje conservador de una fila indexada frente a la consulta normalizada. */
function _naRefScoreRow(row, queryKey, queryCodeKey) {
  if (row.codeKey && queryCodeKey && row.codeKey === queryCodeKey) return 100;
  if (row.nameKey === queryKey || row.originalKey === queryKey) return 90;
  if (row.codeKey && queryCodeKey && row.codeKey.indexOf(queryCodeKey) === 0) return 80;
  if (row.nameKey.indexOf(queryKey) === 0) return 70;
  if (row.nameKey.indexOf(queryKey) > 0) return 60;
  if (row.originalKey.indexOf(queryKey) >= 0) return 50;
  if (row.groupKey && row.groupKey === queryKey) return 40;
  if (row.groupKey && row.groupKey.indexOf(queryKey) >= 0) return 30;
  if (row.measureKey && row.measureKey.indexOf(queryKey) >= 0) return 20;
  return 0;
}

/**
 * Busca referencias por texto, codigo o grupo con normalizacion conservadora
 * (sin tildes, sin distinguir mayusculas, espacios colapsados).
 *
 * NO decide identidad: solo ordena candidatos y marca los que necesitan
 * revision humana por codigo o nombre repetido.
 *
 * @param {string} query
 * @param {{limit?:number}} [options]
 * @returns {{reference:object, score:number, needsHumanReview:boolean}[]}
 */
function searchReferenceCatalog(query, options) {
  var queryKey = _naRefSearchKey(query);
  if (!queryKey) return [];
  var queryCodeKey = _naRefCodeKey(query);
  var limit = options && options.limit > 0 ? Math.floor(options.limit) : 50;
  var rows = _naRefState().indexes.searchRows;
  var hits = [];
  for (var i = 0; i < rows.length; i += 1) {
    var score = _naRefScoreRow(rows[i], queryKey, queryCodeKey);
    if (score <= 0) continue;
    hits.push({
      reference: rows[i].reference,
      score: score,
      needsHumanReview: referenceNeedsHumanReview(rows[i].reference),
    });
  }
  hits.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    var an = a.reference.sourceRow === null ? Infinity : a.reference.sourceRow;
    var bn = b.reference.sourceRow === null ? Infinity : b.reference.sourceRow;
    if (an !== bn) return an - bn;
    return a.reference.referenceId < b.reference.referenceId ? -1 : 1;
  });
  return hits.slice(0, limit);
}

/** Metricas del catalogo vigente (para informes y gates). */
function referenceCatalogStats() {
  var state = _naRefState();
  return {
    loaded: state.loaded,
    referenceCount: state.references.length,
    duplicateCodeCount: state.indexes.duplicateCodeCount,
    duplicateNameCount: state.indexes.duplicateNameCount,
  };
}

// Superficie publica. SOLO LECTURA de referencia: aqui no hay ninguna
// escritura de inventario, stock, ledger, ventas, caja, creditos ni V9.
var _NA_REFERENCE_CATALOG = {
  version: '1.1.0',
  loadReferenceCatalog: loadReferenceCatalog,
  buildReferenceCatalogIndexes: buildReferenceCatalogIndexes,
  initReferenceCatalog: initReferenceCatalog,
  searchReferenceCatalog: searchReferenceCatalog,
  getReferenceById: getReferenceById,
  findReferenceCodeCandidates: findReferenceCodeCandidates,
  resolveReferenceCode: resolveReferenceCode,
  referenceNeedsHumanReview: referenceNeedsHumanReview,
  referenceCatalogStats: referenceCatalogStats,
  normalizeRow: _naRefNormalizeRow,
  searchKey: _naRefSearchKey,
  codeKey: _naRefCodeKey,
  columns: _NA_REF_COLUMNS,
};

if (typeof window !== 'undefined') {
  window._NA_REFERENCE_CATALOG = _NA_REFERENCE_CATALOG;
}
