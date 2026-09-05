/*
 * ocr-reference-matcher.js — MATCHER OCR -> PRODUCTOS REALES DEL POS
 * (V1.1, ciclo 1C / WP-03A).
 *
 * Resuelve lineas de parsePurchaseText contra productos POS y conserva el
 * catalogo maestro como evidencia auxiliar. No crea productos, no modifica
 * inventario y no convierte referenceCode en barcode/SKU ni measure en una
 * unidad comercial.
 *
 * Requiere que reference-catalog.js se haya cargado antes.
 * Classic script (sin ES modules), compatible con file:// y sin DOM.
 */

function _naOcrMatcherCatalog() {
  if (typeof _NA_REFERENCE_CATALOG !== 'undefined') return _NA_REFERENCE_CATALOG;
  if (typeof window !== 'undefined' && window._NA_REFERENCE_CATALOG) {
    return window._NA_REFERENCE_CATALOG;
  }
  return null;
}

function _naOcrMatcherText(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function _naOcrMatcherCodes(line) {
  if (!line || !Array.isArray(line.codes)) return [];
  var seen = Object.create(null);
  var codes = [];
  for (var i = 0; i < line.codes.length; i += 1) {
    var code = _naOcrMatcherText(line.codes[i]);
    if (!code || seen[code]) continue;
    seen[code] = true;
    codes.push(code);
  }
  return codes;
}

function _naOcrMatcherAddCandidate(byId, reference, score, matchedBy, needsHumanReview) {
  if (!reference || !reference.referenceId) return;
  var id = String(reference.referenceId);
  var current = byId[id];
  if (!current) {
    current = {
      reference: reference,
      score: score,
      matchedBy: [],
      needsHumanReview: !!needsHumanReview,
    };
    byId[id] = current;
  }
  if (score > current.score) current.score = score;
  if (current.matchedBy.indexOf(matchedBy) < 0) current.matchedBy.push(matchedBy);
  if (needsHumanReview) current.needsHumanReview = true;
}

function _naOcrMatcherCandidateSort(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  var an = a.reference.sourceRow === null ? Infinity : a.reference.sourceRow;
  var bn = b.reference.sourceRow === null ? Infinity : b.reference.sourceRow;
  if (an !== bn) return an - bn;
  if (a.reference.referenceId === b.reference.referenceId) return 0;
  return a.reference.referenceId < b.reference.referenceId ? -1 : 1;
}

function _naOcrMatcherResult(status, reference, candidates, evidence, reasons) {
  return {
    status: status,
    reference: reference,
    candidates: candidates,
    evidence: evidence,
    needsReview: status !== 'MATCHED',
    reasons: reasons,
  };
}

/**
 * Propone una referencia para una linea ya parseada.
 *
 * MATCHED exige una unica evidencia exacta, sin duplicados ni conflictos.
 * REVIEW conserva candidatos para decision humana. NOT_FOUND indica que hubo
 * una consulta de identidad valida, pero el catalogo no produjo candidatos.
 */
function matchOcrLineToReference(line) {
  var catalog = _naOcrMatcherCatalog();
  if (!catalog) {
    return _naOcrMatcherResult('REVIEW', null, [], [], ['CATALOGO_NO_DISPONIBLE']);
  }
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    return _naOcrMatcherResult('REVIEW', null, [], [], ['LINEA_INVALIDA']);
  }

  var name = _naOcrMatcherText(line.name);
  var codes = _naOcrMatcherCodes(line);
  if (!name && !codes.length) {
    return _naOcrMatcherResult('REVIEW', null, [], [], ['SIN_DATOS_DE_IDENTIDAD']);
  }

  var byId = Object.create(null);
  var evidence = [];
  var reasons = [];
  var exactIds = Object.create(null);
  var ambiguousCode = false;
  var conflictingCodes = false;
  var uniqueCodeId = null;

  for (var i = 0; i < codes.length; i += 1) {
    var resolved = catalog.resolveReferenceCode(codes[i]);
    var codeIds = [];
    for (var c = 0; c < resolved.candidates.length; c += 1) {
      var codeRef = resolved.candidates[c];
      codeIds.push(codeRef.referenceId);
      _naOcrMatcherAddCandidate(
        byId,
        codeRef,
        100,
        'CODE_EXACT',
        catalog.referenceNeedsHumanReview(codeRef)
      );
    }
    evidence.push({
      type: 'CODE',
      query: codes[i],
      status: resolved.status,
      referenceIds: codeIds,
    });
    if (resolved.status === 'AMBIGUOUS') ambiguousCode = true;
    if (resolved.status === 'UNIQUE') {
      var codeId = resolved.reference.referenceId;
      exactIds[codeId] = true;
      if (uniqueCodeId !== null && uniqueCodeId !== codeId) conflictingCodes = true;
      uniqueCodeId = codeId;
    }
  }

  var exactNameIds = [];
  if (name) {
    var nameHits = catalog.searchReferenceCatalog(name);
    for (var n = 0; n < nameHits.length; n += 1) {
      var hit = nameHits[n];
      _naOcrMatcherAddCandidate(
        byId,
        hit.reference,
        hit.score,
        hit.score === 90 ? 'NAME_EXACT' : 'NAME_PARTIAL',
        hit.needsHumanReview
      );
      if (hit.score === 90) {
        exactNameIds.push(hit.reference.referenceId);
        exactIds[hit.reference.referenceId] = true;
      }
    }
    evidence.push({
      type: 'NAME',
      query: name,
      status: exactNameIds.length === 1 ? 'UNIQUE_EXACT'
        : (exactNameIds.length > 1 ? 'AMBIGUOUS_EXACT' : (nameHits.length ? 'PARTIAL' : 'NOT_FOUND')),
      referenceIds: nameHits.map(function (item) { return item.reference.referenceId; }),
    });
  }

  var candidates = Object.keys(byId).map(function (id) { return byId[id]; });
  candidates.sort(_naOcrMatcherCandidateSort);

  if (ambiguousCode) reasons.push('CODIGO_AMBIGUO');
  if (conflictingCodes) reasons.push('CODIGOS_EN_CONFLICTO');
  if (exactNameIds.length > 1) reasons.push('NOMBRE_AMBIGUO');
  if (uniqueCodeId !== null && exactNameIds.length === 1 && uniqueCodeId !== exactNameIds[0]) {
    reasons.push('CODIGO_NOMBRE_EN_CONFLICTO');
  }

  var exactIdList = Object.keys(exactIds);
  var hasConflict = ambiguousCode || conflictingCodes || exactNameIds.length > 1
    || reasons.indexOf('CODIGO_NOMBRE_EN_CONFLICTO') >= 0;
  if (!hasConflict && exactIdList.length === 1) {
    var selected = byId[exactIdList[0]];
    if (selected && !selected.needsHumanReview) {
      return _naOcrMatcherResult('MATCHED', selected.reference, candidates, evidence, ['COINCIDENCIA_EXACTA']);
    }
    reasons.push('REFERENCIA_REQUIERE_REVISION');
  }

  if (candidates.length) {
    if (!reasons.length) reasons.push('SOLO_COINCIDENCIAS_PARCIALES');
    return _naOcrMatcherResult('REVIEW', null, candidates, evidence, reasons);
  }
  return _naOcrMatcherResult('NOT_FOUND', null, [], evidence, ['SIN_COINCIDENCIAS']);
}

/** Proyecta lineas en el mismo orden, sin agruparlas ni aplicar la compra. */
function matchOcrLinesToReferences(lines) {
  if (!Array.isArray(lines)) return [];
  return lines.map(function (line) { return matchOcrLineToReference(line); });
}

function _naOcrPosNameKey(value) {
  if (typeof _naNormCatalogName !== 'function' || typeof sinTildes !== 'function') return null;
  return sinTildes(_naNormCatalogName(value)).toUpperCase();
}

function _naOcrPosCodeKey(value) {
  return _naOcrMatcherText(value).toLowerCase();
}

function _naOcrPosAddCandidate(byId, product, matchedBy) {
  if (!product || product.id === null || product.id === undefined) return;
  var id = String(product.id);
  if (!byId[id]) byId[id] = { product: product, matchedBy: [] };
  if (byId[id].matchedBy.indexOf(matchedBy) < 0) byId[id].matchedBy.push(matchedBy);
}

function _naOcrPosResult(status, product, candidates, referenceEvidence, evidence, reasons) {
  return {
    status: status,
    product: product,
    candidates: candidates,
    referenceEvidence: referenceEvidence,
    evidence: evidence,
    needsReview: status !== 'MATCHED_SAFE',
    reasons: reasons,
  };
}

function _naOcrPosCandidateSort(a, b) {
  var ai = String(a.product.id);
  var bi = String(b.product.id);
  if (ai === bi) return 0;
  return ai < bi ? -1 : 1;
}

/**
 * Resuelve una linea OCR contra productos reales del POS.
 *
 * Los productos solo entran por el argumento posProducts. Los codigos OCR se
 * comparan con sku/barcode/alternativos mediante los helpers canonicos. El
 * catalogo maestro se conserva como evidencia separada y nunca crea identidad
 * POS ni convierte referenceCode en barcode.
 */
function matchOcrLineToPosProduct(line, posProducts) {
  var referenceEvidence = matchOcrLineToReference(line);
  if (!line || typeof line !== 'object' || Array.isArray(line)) {
    return _naOcrPosResult('NO_SAFE_MATCH', null, [], referenceEvidence, [], ['LINEA_INVALIDA']);
  }
  if (!Array.isArray(posProducts)) {
    return _naOcrPosResult('NO_SAFE_MATCH', null, [], referenceEvidence, [], ['PRODUCTOS_POS_NO_DISPONIBLES']);
  }
  if (typeof _naProductAltCodes !== 'function' || typeof _naAllProductCodes !== 'function'
      || typeof _naNormCatalogName !== 'function' || typeof sinTildes !== 'function') {
    return _naOcrPosResult('NO_SAFE_MATCH', null, [], referenceEvidence, [], ['HELPERS_POS_NO_DISPONIBLES']);
  }

  var name = _naOcrMatcherText(line.name);
  var nameKey = _naOcrPosNameKey(name);
  var codes = _naOcrMatcherCodes(line);
  var byId = Object.create(null);
  var evidence = [];
  var exactCodeProducts = [];
  var exactCodeProductIds = Object.create(null);
  var exactNameProductIds = Object.create(null);

  for (var c = 0; c < codes.length; c += 1) {
    var codeKey = _naOcrPosCodeKey(codes[c]);
    var codeIds = [];
    for (var p = 0; p < posProducts.length; p += 1) {
      var product = posProducts[p];
      if (!product) continue;
      var productCodes = _naAllProductCodes(product);
      var matchesCode = productCodes.some(function (candidateCode) {
        return _naOcrPosCodeKey(candidateCode) === codeKey;
      });
      if (!matchesCode || product.id === null || product.id === undefined) continue;
      var productId = String(product.id);
      codeIds.push(productId);
      exactCodeProducts.push(product);
      exactCodeProductIds[productId] = true;
      _naOcrPosAddCandidate(byId, product, 'POS_CODE_EXACT');
    }
    evidence.push({ type: 'POS_CODE', query: codes[c], productIds: codeIds });
  }

  var exactNameIds = [];
  var partialNameIds = [];
  if (nameKey) {
    for (var n = 0; n < posProducts.length; n += 1) {
      var namedProduct = posProducts[n];
      if (!namedProduct) continue;
      var productNameKey = _naOcrPosNameKey(namedProduct.name);
      if (!productNameKey) continue;
      var namedId = String(namedProduct.id);
      if (productNameKey === nameKey) {
        if (namedProduct.id === null || namedProduct.id === undefined) continue;
        exactNameIds.push(namedId);
        exactNameProductIds[namedId] = true;
        _naOcrPosAddCandidate(byId, namedProduct, 'POS_NAME_EXACT');
      } else if (productNameKey.indexOf(nameKey) >= 0 || nameKey.indexOf(productNameKey) >= 0) {
        partialNameIds.push(namedId);
        _naOcrPosAddCandidate(byId, namedProduct, 'POS_NAME_PARTIAL');
      }
    }
    evidence.push({
      type: 'POS_NAME',
      query: name,
      exactProductIds: exactNameIds,
      partialProductIds: partialNameIds,
    });
  }

  var exactCodeIds = Object.keys(exactCodeProductIds);
  var exactNameIdList = Object.keys(exactNameProductIds);
  var candidates = Object.keys(byId).map(function (id) { return byId[id]; });
  candidates.sort(_naOcrPosCandidateSort);

  if (exactCodeIds.length === 1) {
    var selectedId = exactCodeIds[0];
    var selected = byId[selectedId];
    var nameSupportsCode = !nameKey || exactNameProductIds[selectedId]
      || partialNameIds.indexOf(selectedId) >= 0;
    var namePointsElsewhere = exactNameIdList.some(function (id) { return id !== selectedId; })
      || partialNameIds.some(function (id) { return id !== selectedId; });
    if (nameSupportsCode && !namePointsElsewhere) {
      return _naOcrPosResult(
        'MATCHED_SAFE', selected.product, candidates, referenceEvidence, evidence, ['CODIGO_POS_UNICO']
      );
    }
    return _naOcrPosResult(
      'MATCHED_REVIEW', null, candidates, referenceEvidence, evidence, ['CODIGO_NOMBRE_POS_EN_CONFLICTO']
    );
  }
  if (exactCodeIds.length > 1) {
    return _naOcrPosResult(
      'MATCHED_REVIEW', null, candidates, referenceEvidence, evidence, ['CODIGO_POS_AMBIGUO']
    );
  }
  if (candidates.length) {
    var reason = exactNameIdList.length === 1
      ? 'SOLO_NOMBRE_POS_EXACTO'
      : (exactNameIdList.length > 1 ? 'NOMBRE_POS_AMBIGUO' : 'SOLO_COINCIDENCIAS_POS_PARCIALES');
    return _naOcrPosResult('MATCHED_REVIEW', null, candidates, referenceEvidence, evidence, [reason]);
  }
  var reason = referenceEvidence && referenceEvidence.candidates.length
    ? 'SOLO_REFERENCIA_SIN_PRODUCTO_POS'
    : 'SIN_PRODUCTO_POS_CANDIDATO';
  return _naOcrPosResult('NO_SAFE_MATCH', null, [], referenceEvidence, evidence, [reason]);
}

function matchOcrLinesToPosProducts(lines, posProducts) {
  if (!Array.isArray(lines)) return [];
  return lines.map(function (line) { return matchOcrLineToPosProduct(line, posProducts); });
}

var _NA_OCR_REFERENCE_MATCHER = {
  version: '1.1.0',
  matchLine: matchOcrLineToReference,
  matchLines: matchOcrLinesToReferences,
  matchPosProduct: matchOcrLineToPosProduct,
  matchPosProducts: matchOcrLinesToPosProducts,
};

if (typeof window !== 'undefined') {
  window._NA_OCR_REFERENCE_MATCHER = _NA_OCR_REFERENCE_MATCHER;
  window.matchOcrLineToReference = matchOcrLineToReference;
  window.matchOcrLinesToReferences = matchOcrLinesToReferences;
  window.matchOcrLineToPosProduct = matchOcrLineToPosProduct;
  window.matchOcrLinesToPosProducts = matchOcrLinesToPosProducts;
}
