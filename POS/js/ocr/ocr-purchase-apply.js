/*
 * ocr-purchase-apply.js — aplicación segura de compras OCR (V1.1, WP-06).
 *
 * Orquesta propuestas ya confirmadas mediante applyInventoryMovement y la
 * persistencia canónica. No modifica stock ni escribe el ledger directamente.
 */
(function (root) {
  'use strict';

  function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function positiveNumber(value) {
    var number = typeof value === 'number' ? value : Number(value);
    return isFinite(number) && number > 0 ? number : null;
  }

  function resolveDependency(options, name) {
    if (options && typeof options[name] === 'function') return options[name];
    if (root && typeof root[name] === 'function') return root[name];
    return null;
  }

  function resolveArray(options, optionName, globalName) {
    if (options && Array.isArray(options[optionName])) return options[optionName];
    if (root && Array.isArray(root[globalName])) return root[globalName];
    return null;
  }

  function operationReference(operationId, sourceIndex) {
    return operationId + ':' + String(sourceIndex);
  }

  function alreadyApplied(movements, referenceId) {
    if (!Array.isArray(movements)) return false;
    for (var i = 0; i < movements.length; i += 1) {
      var movement = movements[i];
      if (movement && movement.source === 'OCR_PURCHASE'
          && String(movement.referenceId) === referenceId) return true;
    }
    return false;
  }

  function skippedRow(proposal, reason) {
    return {
      sourceIndex: proposal && proposal.sourceIndex,
      productId: proposal && proposal.productId !== undefined ? proposal.productId : null,
      reason: reason,
    };
  }

  function inventorySnapshot(pending, movements) {
    var stocks = [];
    var seen = Object.create(null);
    for (var i = 0; i < pending.length; i += 1) {
      var product = pending[i].product;
      var id = String(product.id);
      if (seen[id]) continue;
      seen[id] = true;
      stocks.push({ product: product, stock: product.stock });
    }
    return { stocks: stocks, ledgerLength: movements.length };
  }

  function restoreInventory(snapshot, movements) {
    for (var i = 0; i < snapshot.stocks.length; i += 1) {
      snapshot.stocks[i].product.stock = snapshot.stocks[i].stock;
    }
    movements.length = Math.min(snapshot.ledgerLength, movements.length);
  }

  async function rollbackInventory(snapshot, movements, persist, wasPersisted) {
    restoreInventory(snapshot, movements);
    try {
      var rollbackResult = await persist();
      return wasPersisted(rollbackResult);
    } catch (ignored) {
      return false;
    }
  }

  function validateConfirmed(proposal, index, products, tracksStock, operationId, movements) {
    var errors = [];
    var sourceIndex = proposal && proposal.sourceIndex !== undefined ? proposal.sourceIndex : index;
    var referenceId = operationReference(operationId, sourceIndex);
    var id = proposal && proposal.productId !== null && proposal.productId !== undefined
      ? String(proposal.productId) : '';
    var quantity = positiveNumber(proposal && proposal.quantity);
    var unitCost = positiveNumber(proposal && proposal.unitCost);
    var product = null;

    if (!id) errors.push('PRODUCT_ID_REQUIRED');
    else {
      for (var p = 0; p < products.length; p += 1) {
        if (products[p] && String(products[p].id) === id) {
          product = products[p];
          break;
        }
      }
      if (!product) errors.push('PRODUCT_NOT_FOUND');
      else if (tracksStock && !tracksStock(product)) errors.push('PRODUCT_NOT_TRACKED');
    }
    if (quantity === null) errors.push('INVALID_QUANTITY');
    if (unitCost === null) errors.push('INVALID_UNIT_COST');

    return {
      valid: errors.length === 0,
      errors: errors,
      sourceIndex: sourceIndex,
      productId: id || null,
      quantity: quantity,
      unitCost: unitCost,
      product: product,
      referenceId: referenceId,
      duplicate: alreadyApplied(movements, referenceId),
    };
  }

  /**
   * Aplica propuestas confirmadas por una persona usando el movimiento central.
   *
   * @param {object[]} proposals salida revisada de WP-05
   * @param {object} options operationId y dependencias canónicas
   * @returns {Promise<object>} detalle de aplicados, omitidos y errores
   */
  async function applyApprovedPurchaseProposals(proposals, options) {
    var settings = options || {};
    var operationId = text(settings.operationId);
    var products = resolveArray(settings, 'products', 'productos');
    var movements = resolveArray(settings, 'inventoryMovements', 'inventoryMovements');
    var applyMovement = resolveDependency(settings, 'applyInventoryMovement');
    var persist = resolveDependency(settings, 'saveAllData');
    var wasPersisted = resolveDependency(settings, 'wasPersisted')
      || resolveDependency(settings, '_naWasPersisted');
    var tracksStock = resolveDependency(settings, 'tracksStock')
      || resolveDependency(settings, '_naTracksStock');
    var result = { ok: false, operationId: operationId, applied: [], skipped: [], errors: [] };

    if (!Array.isArray(proposals)) {
      result.errors.push({ code: 'PROPOSALS_REQUIRED', message: 'proposals debe ser un arreglo.' });
      return result;
    }
    if (!operationId) result.errors.push({ code: 'OPERATION_ID_REQUIRED', message: 'operationId es obligatorio.' });
    if (!products) result.errors.push({ code: 'PRODUCTS_REQUIRED', message: 'No hay productos POS disponibles.' });
    if (!movements) result.errors.push({ code: 'MOVEMENTS_REQUIRED', message: 'No hay ledger de inventario disponible.' });
    if (!applyMovement) result.errors.push({ code: 'MOVEMENT_API_REQUIRED', message: 'applyInventoryMovement no esta disponible.' });
    if (!persist) result.errors.push({ code: 'PERSISTENCE_API_REQUIRED', message: 'saveAllData no esta disponible.' });
    if (!wasPersisted) result.errors.push({ code: 'PERSISTENCE_CHECK_REQUIRED', message: '_naWasPersisted no esta disponible.' });
    if (result.errors.length) return result;

    var pending = [];
    var pendingReferences = Object.create(null);
    for (var i = 0; i < proposals.length; i += 1) {
      var proposal = proposals[i];
      if (!proposal || proposal.decision !== 'CONFIRMED') {
        result.skipped.push(skippedRow(proposal, proposal && proposal.decision === 'DISCARDED'
          ? 'DISCARDED' : 'NOT_CONFIRMED'));
        continue;
      }
      var validation = validateConfirmed(proposal, i, products, tracksStock, operationId, movements);
      if (validation.duplicate) {
        result.skipped.push({
          sourceIndex: validation.sourceIndex,
          productId: validation.productId,
          reason: 'ALREADY_APPLIED',
          referenceId: validation.referenceId,
        });
        continue;
      }
      if (pendingReferences[validation.referenceId]) {
        result.errors.push({
          sourceIndex: validation.sourceIndex,
          productId: validation.productId,
          code: 'DUPLICATE_OPERATION_REFERENCE',
          referenceId: validation.referenceId,
        });
        continue;
      }
      if (!validation.valid) {
        result.errors.push({
          sourceIndex: validation.sourceIndex,
          productId: validation.productId,
          code: 'INVALID_PROPOSAL',
          reasons: validation.errors,
        });
      } else {
        pendingReferences[validation.referenceId] = true;
        pending.push(validation);
      }
    }

    if (result.errors.length) return result;
    if (!pending.length) {
      result.ok = true;
      return result;
    }

    var snapshot = inventorySnapshot(pending, movements);
    for (var m = 0; m < pending.length; m += 1) {
      var item = pending[m];
      var outcome;
      try {
        outcome = applyMovement({
          productId: item.productId,
          type: 'ENTRADA',
          delta: item.quantity,
          reason: 'Compra OCR ' + operationId + ', linea ' + item.sourceIndex,
          source: 'OCR_PURCHASE',
          referenceId: item.referenceId,
        });
      } catch (error) {
        outcome = { ok: false, error: 'MOVEMENT_EXCEPTION', message: error && error.message ? error.message : String(error) };
      }
      if (!outcome || !outcome.ok) {
        var movementRollbackPersisted = await rollbackInventory(snapshot, movements, persist, wasPersisted);
        result.applied = [];
        result.errors.push({
          sourceIndex: item.sourceIndex,
          productId: item.productId,
          code: outcome && outcome.error ? outcome.error : 'MOVEMENT_FAILED',
          message: outcome && outcome.message ? outcome.message : 'El movimiento canónico fallo.',
          stateRestored: true,
          rollbackPersisted: movementRollbackPersisted,
        });
        if (!movementRollbackPersisted) {
          result.errors.push({
            code: 'ROLLBACK_PERSISTENCE_NOT_VERIFIED',
            message: 'El estado fue restaurado en memoria, pero su persistencia no pudo verificarse.',
          });
        }
        return result;
      }
      result.applied.push({
        sourceIndex: item.sourceIndex,
        productId: item.productId,
        quantity: item.quantity,
        unitCost: item.unitCost,
        referenceId: item.referenceId,
        movement: outcome.movement || null,
      });
    }

    var persistenceResult;
    try {
      persistenceResult = await persist();
    } catch (error) {
      var exceptionRollbackPersisted = await rollbackInventory(snapshot, movements, persist, wasPersisted);
      result.applied = [];
      result.errors.push({
        code: 'PERSISTENCE_FAILED',
        message: error && error.message ? error.message : String(error),
        stateRestored: true,
        rollbackPersisted: exceptionRollbackPersisted,
      });
      if (!exceptionRollbackPersisted) {
        result.errors.push({
          code: 'ROLLBACK_PERSISTENCE_NOT_VERIFIED',
          message: 'El estado fue restaurado en memoria, pero su persistencia no pudo verificarse.',
        });
      }
      return result;
    }
    if (!wasPersisted(persistenceResult)) {
      var persistenceRollbackPersisted = await rollbackInventory(snapshot, movements, persist, wasPersisted);
      result.applied = [];
      result.errors.push({
        code: 'PERSISTENCE_NOT_VERIFIED',
        message: 'La persistencia canónica no fue verificada; el estado previo fue restaurado.',
        stateRestored: true,
        rollbackPersisted: persistenceRollbackPersisted,
      });
      if (!persistenceRollbackPersisted) {
        result.errors.push({
          code: 'ROLLBACK_PERSISTENCE_NOT_VERIFIED',
          message: 'El estado fue restaurado en memoria, pero su persistencia no pudo verificarse.',
        });
      }
      return result;
    }

    result.ok = true;
    return result;
  }

  var api = {
    version: '1.0.0',
    applyApprovedPurchaseProposals: applyApprovedPurchaseProposals,
  };

  if (root) {
    root._NA_OCR_PURCHASE_APPLY = api;
    root.applyApprovedPurchaseProposals = applyApprovedPurchaseProposals;
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
