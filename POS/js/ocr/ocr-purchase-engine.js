/*
 * ocr-purchase-engine.js — orquestador puro de compra OCR (V1.1, WP-04B).
 *
 * Convierte texto OCR ya extraido en propuestas mediante el parser y matcher
 * existentes. No procesa imagenes, no modifica inventario ni persiste datos.
 */
(function (root) {
  'use strict';

  function resolveParser(options) {
    if (options && typeof options.parsePurchaseText === 'function') return options.parsePurchaseText;
    if (typeof parsePurchaseText === 'function') return parsePurchaseText;
    return null;
  }

  function resolveMatcher(options) {
    if (options && typeof options.matchOcrLineToPosProduct === 'function') {
      return options.matchOcrLineToPosProduct;
    }
    if (typeof matchOcrLineToPosProduct === 'function') return matchOcrLineToPosProduct;
    return null;
  }

  function addReasons(target, reasons) {
    if (!Array.isArray(reasons)) return;
    for (var i = 0; i < reasons.length; i += 1) {
      if (target.indexOf(reasons[i]) < 0) target.push(reasons[i]);
    }
  }

  function controlledMatchFailure(error) {
    return {
      status: 'NO_SAFE_MATCH',
      product: null,
      candidates: [],
      referenceEvidence: null,
      evidence: [],
      needsReview: true,
      reasons: ['MATCHER_ERROR'],
      errorMessage: error && error.message ? error.message : String(error || 'Error de matcher.'),
    };
  }

  function proposalFor(parsed, match, sourceIndex) {
    var status = match && (
      match.status === 'MATCHED_SAFE'
      || match.status === 'MATCHED_REVIEW'
      || match.status === 'NO_SAFE_MATCH'
    ) ? match.status : 'NO_SAFE_MATCH';
    var safeProduct = status === 'MATCHED_SAFE' && match.product ? match.product : null;
    var reasons = [];
    addReasons(reasons, parsed && parsed.reasons);
    addReasons(reasons, match && match.reasons);
    if (status === 'NO_SAFE_MATCH' && (!match || match.status !== 'NO_SAFE_MATCH')) {
      addReasons(reasons, ['MATCHER_RESULTADO_INVALIDO']);
    }
    return {
      sourceIndex: sourceIndex,
      parsed: parsed,
      match: match,
      proposedProductId: safeProduct ? safeProduct.id : null,
      proposedQty: parsed && parsed.qty !== undefined ? parsed.qty : null,
      proposedUnitCost: parsed && parsed.unitPrice !== undefined ? parsed.unitPrice : null,
      status: status,
      needsReview: status !== 'MATCHED_SAFE' || !!(parsed && parsed.needsReview),
      reasons: reasons,
    };
  }

  /**
   * Procesa texto OCR bruto y devuelve propuestas; nunca aplica la compra.
   *
   * @param {string} rawText texto obtenido previamente por OCR
   * @param {object} options productos POS y dependencias opcionales para pruebas
   * @returns {object} lote de propuestas en el orden producido por el parser
   */
  function processPurchaseOcrText(rawText, options) {
    var settings = options || {};
    var source = typeof rawText === 'string' ? rawText : String(rawText === null || rawText === undefined ? '' : rawText);
    var parser = resolveParser(settings);
    var matcher = resolveMatcher(settings);
    var errors = [];
    var proposals = [];

    if (!parser) errors.push({ code: 'PARSER_UNAVAILABLE', message: 'parsePurchaseText no esta disponible.' });
    if (!matcher) errors.push({ code: 'MATCHER_UNAVAILABLE', message: 'matchOcrLineToPosProduct no esta disponible.' });
    if (!Array.isArray(settings.products)) {
      errors.push({ code: 'PRODUCTS_REQUIRED', message: 'options.products debe ser un arreglo.' });
    }
    if (errors.length) {
      return {
        ok: false,
        rawText: source,
        proposals: proposals,
        summary: { total: 0, safe: 0, review: 0, noSafeMatch: 0 },
        errors: errors,
      };
    }

    var parsedLines;
    try {
      parsedLines = parser(source);
      if (!Array.isArray(parsedLines)) throw new Error('El parser no devolvio un arreglo.');
    } catch (error) {
      return {
        ok: false,
        rawText: source,
        proposals: proposals,
        summary: { total: 0, safe: 0, review: 0, noSafeMatch: 0 },
        errors: [{
          code: 'PARSER_FAILED',
          message: error && error.message ? error.message : String(error || 'Error de parser.'),
        }],
      };
    }

    for (var i = 0; i < parsedLines.length; i += 1) {
      var match;
      try {
        match = matcher(parsedLines[i], settings.products);
      } catch (error) {
        match = controlledMatchFailure(error);
        errors.push({ sourceIndex: i, code: 'MATCHER_FAILED', message: match.errorMessage });
      }
      proposals.push(proposalFor(parsedLines[i], match, i));
    }

    var summary = { total: proposals.length, safe: 0, review: 0, noSafeMatch: 0 };
    for (var p = 0; p < proposals.length; p += 1) {
      if (proposals[p].status === 'MATCHED_SAFE') summary.safe += 1;
      else if (proposals[p].status === 'MATCHED_REVIEW') summary.review += 1;
      else summary.noSafeMatch += 1;
    }

    return {
      ok: errors.length === 0,
      rawText: source,
      proposals: proposals,
      summary: summary,
      errors: errors,
    };
  }

  var api = {
    version: '1.0.0',
    processPurchaseOcrText: processPurchaseOcrText,
  };

  if (root) {
    root._NA_OCR_PURCHASE_ENGINE = api;
    root.processPurchaseOcrText = processPurchaseOcrText;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
