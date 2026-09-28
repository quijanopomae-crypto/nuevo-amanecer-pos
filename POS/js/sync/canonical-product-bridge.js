(function (root) {
  'use strict';

  if (!root || !root.document) return;

  var busy = false;

  function api() { return root.NuevoAmanecerCanonical; }

  function enabled() {
    var client = api();
    try { return !!(client && typeof client.enabled === 'function' && client.enabled()); }
    catch (_) { return false; }
  }

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function number(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : (fallback === undefined ? NaN : fallback);
  }

  function moneyCents(value, allowZero) {
    var amount = number(value, NaN);
    if (!Number.isFinite(amount) || amount < 0 || (!allowZero && amount <= 0)) return null;
    var cents = Math.round(amount * 100);
    if (!Number.isSafeInteger(cents) || cents < 0 || (!allowZero && cents === 0)) return null;
    return cents;
  }

  function notify(message, tone) {
    var fn = null;
    try { if (typeof toast === 'function') fn = toast; } catch (_) {}
    if (!fn && typeof root.toast === 'function') fn = root.toast;
    if (typeof fn === 'function') fn(message, tone || 'error');
  }

  function closeModal() {
    var fn = null;
    try { if (typeof cerrarModal === 'function') fn = cerrarModal; } catch (_) {}
    if (!fn && typeof root.cerrarModal === 'function') fn = root.cerrarModal;
    if (typeof fn === 'function') fn('mProd');
    else root.document.getElementById('mProd')?.classList.remove('open');
  }

  function renderViews() {
    ['invRender', 'posRender', 'updateDashboard'].forEach(function (name) {
      var fn = root[name];
      if (typeof fn === 'function') fn.call(root);
    });
  }

  function editId() {
    try {
      /* global invEditId */
      return typeof invEditId === 'undefined' ? null : invEditId;
    } catch (_) {
      return null;
    }
  }

  function readAlternateCodes() {
    var fn = null;
    try { if (typeof readAltBarcodes === 'function') fn = readAltBarcodes; } catch (_) {}
    if (!fn && typeof root.readAltBarcodes === 'function') fn = root.readAltBarcodes;
    if (typeof fn !== 'function') return [];
    var result = fn();
    return result === null ? null : (Array.isArray(result) ? result.map(clean).filter(Boolean) : []);
  }

  function currentImage() {
    try {
      /* global imagenProducto */
      return typeof imagenProducto === 'undefined' || imagenProducto == null ? null : String(imagenProducto);
    } catch (_) {
      return null;
    }
  }

  function appConfigValue() {
    try {
      /* global appConfig */
      return typeof appConfig === 'undefined' || !appConfig ? {} : appConfig;
    } catch (_) {
      return {};
    }
  }

  function pendingRecord() {
    var client = api();
    if (!client || typeof client.pendingSnapshot !== 'function') return null;
    try { return client.pendingSnapshot(); }
    catch (_) { return { command:'unknown', invalid:true }; }
  }

  async function refreshCanonical() {
    var client = api();
    if (!client || typeof client.refresh !== 'function') throw new Error('CANONICAL_CLIENT_UNAVAILABLE');
    return client.refresh();
  }

  async function afterCommit(receipt, replayed) {
    closeModal();
    var operation = clean(receipt && receipt.operation_id);
    var productId = clean(receipt && receipt.product_id);
    try {
      await refreshCanonical();
      renderViews();
      notify(replayed
        ? 'Se confirmó el producto CANON pendiente' + (productId ? ' (' + productId + ')' : '') + '. No se creó un duplicado.'
        : 'Producto registrado en CANON' + (productId ? ' (' + productId + ')' : ''), 'success');
    } catch (error) {
      notify('Producto CONFIRMADO en CANON (operación ' + operation + '). No se pudo actualizar la vista: ' +
        clean(error && error.message) + '. NO vuelvas a guardarlo; recarga la pantalla para verlo.', 'success');
    }
    return true;
  }

  function pendingMessage(error) {
    var pending = pendingRecord();
    var code = clean(error && error.message);
    if (pending && pending.command === 'product.create' && !pending.invalid) {
      if (pending.last_error) {
        return 'CANON rechazó el producto (' + clean(pending.last_error) + '). No se creó ningún producto nuevo.';
      }
      return 'El producto se envió pero CANON no confirmó la recepción (' + code + '). Pulsa Guardar otra vez para reintentar la MISMA operación; no abras otro alta.';
    }
    return 'No se registró el producto CANON' + (code ? ': ' + code : '');
  }

  function value(id) {
    return root.document.getElementById(id)?.value;
  }

  function checked(id) {
    return !!root.document.getElementById(id)?.checked;
  }

  function buildInput() {
    var name = clean(value('pNombre'));
    var description = clean(value('pDescripcion'));
    var sku = clean(value('pSku')) || ('PROD-' + Date.now());
    var barcode = clean(value('pBarcode'));
    var brand = clean(value('pMarca')) || 'Sin marca';
    var unit = clean(value('pUnidad'));
    var purchaseUnit = clean(value('pUnidadCompra')) || 'unidad';
    var purchaseFactor = purchaseUnit === 'unidad' ? 1 : number(value('pFactorCompra'), NaN);
    var costCents = moneyCents(value('pCosto'), true);
    var priceCents = moneyCents(value('pPrecio'), false);
    var controlInventory = checked('pControlInventario');
    var stock = controlInventory ? number(value('pStock'), NaN) : 0;
    var stockMin = controlInventory ? number(value('pStockMin'), 0) : 0;
    var alternateCodes = readAlternateCodes();
    if (alternateCodes === null) return null;

    if (!name || !unit || priceCents === null || costCents === null) {
      notify('Nombre, unidad de medida y precio de venta son obligatorios', 'error');
      return null;
    }
    if (!Number.isFinite(purchaseFactor) || purchaseFactor <= 0) {
      notify('Las unidades por presentación deben ser mayores que cero', 'error');
      return null;
    }
    if (!Number.isFinite(stock) || stock < 0 || !Number.isFinite(stockMin) || stockMin < 0) {
      notify('Stock inicial y stock mínimo deben ser valores válidos', 'error');
      return null;
    }

    var cfg = appConfigValue();
    if (cfg.margenActive && priceCents < costCents) {
      notify('El precio no puede ser menor al costo mientras el control de margen esté activo', 'error');
      return null;
    }

    var boxPriceRaw = clean(value('pPrecioCaja'));
    var boxUnitsRaw = clean(value('pUnidCaja'));
    var hasBoxPrice = boxPriceRaw !== '';
    var hasBoxUnits = boxUnitsRaw !== '';
    if (hasBoxPrice !== hasBoxUnits) {
      notify('Completa precio mayorista y unidades por caja, o deja ambos vacíos', 'error');
      return null;
    }
    var boxPriceCents = hasBoxPrice ? moneyCents(boxPriceRaw, false) : null;
    var boxUnits = hasBoxUnits ? number(boxUnitsRaw, NaN) : null;
    if (hasBoxPrice && (boxPriceCents === null || !Number.isFinite(boxUnits) || boxUnits <= 0)) {
      notify('Precio mayorista o unidades por caja inválidos', 'error');
      return null;
    }
    if (cfg.margenActive && boxPriceCents !== null && boxPriceCents < costCents * boxUnits) {
      notify('El precio por caja está por debajo del costo total', 'error');
      return null;
    }

    var codes = [sku, barcode].concat(alternateCodes).map(clean).filter(Boolean);
    var seen = new Set();
    for (var code of codes) {
      var key = code.toLowerCase();
      if (seen.has(key)) {
        notify('El código ' + code + ' está repetido dentro del mismo producto', 'error');
        return null;
      }
      seen.add(key);
    }

    return {
      name: name,
      description: description || null,
      sku: sku,
      barcode: barcode || null,
      alternate_codes: alternateCodes,
      category: clean(value('pCat')) || null,
      brand: brand,
      icon: clean(value('pIcon')) || '📦',
      image: currentImage(),
      unit: unit,
      purchase_unit: purchaseUnit,
      purchase_factor: purchaseFactor,
      cost_cents: costCents,
      price_cents: priceCents,
      box_price_cents: boxPriceCents,
      units_per_box: boxUnits,
      initial_stock_quantity: controlInventory ? stock : 0,
      stock_min_quantity: controlInventory ? stockMin : 0,
      expiry_date: controlInventory && clean(value('pVenc')) ? clean(value('pVenc')) : null,
      includes_igv: checked('pIncluyeIGV'),
      tax_type: clean(value('pTipoImpuesto')).toLowerCase(),
      complementary_tax: clean(value('pImpuestoComplementario')).toLowerCase(),
      tracks_inventory: controlInventory
    };
  }

  async function save() {
    if (!enabled() || busy) return false;

    if (editId() !== null && editId() !== undefined) {
      notify('La edición de productos CANON todavía no está habilitada en esta etapa. No se modificó el producto.', 'error');
      return false;
    }

    var client = api();
    var pending = pendingRecord();
    if (pending) {
      if (pending.command !== 'product.create' || pending.invalid) {
        notify('Hay otra operación CANON pendiente (' + clean(pending.command) + '). Resuélvela antes de guardar un producto.', 'error');
        return false;
      }
      if (pending.last_error) {
        notify('Un alta de producto anterior fue rechazada por CANON (' + clean(pending.last_error) + '). No se creó un producto nuevo.', 'error');
        return false;
      }
    }

    var input = pending ? null : buildInput();
    if (!pending && !input) return false;

    var button = root.document.querySelector('#mProd .mbtn-ok');
    var label = button?.textContent || '💾 Guardar';
    busy = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Procesando…';
    }

    try {
      if (pending) {
        if (!client || typeof client.retryPending !== 'function') throw new Error('CANONICAL_PRODUCT_UNAVAILABLE');
        var replay;
        try { replay = await client.retryPending(); }
        catch (error) {
          notify(pendingMessage(error), 'error');
          return false;
        }
        return await afterCommit(replay, true);
      }

      try {
        await refreshCanonical();
      } catch (error) {
        notify('No se registró el producto: CANON no disponible (' + clean(error && error.message) + ')', 'error');
        return false;
      }

      if (!client || typeof client.createProduct !== 'function') {
        notify('No se registró el producto CANON: CANONICAL_PRODUCT_UNAVAILABLE', 'error');
        return false;
      }

      var receipt;
      try { receipt = await client.createProduct(input); }
      catch (error) {
        var pendingAfterError=pendingRecord();
        if(pendingAfterError && pendingAfterError.command==='product.create' && pendingAfterError.last_error &&
           typeof client.discardRejectedProduct==='function') {
          try {
            var discarded=await client.discardRejectedProduct();
            if(discarded) {
              notify('CANON rechazó el producto (' + clean(pendingAfterError.last_error) + '). No se creó ningún producto; puedes corregir los datos y volver a guardar.', 'error');
              return false;
            }
          } catch (_) {}
        }
        notify(pendingMessage(error), 'error');
        return false;
      }
      return await afterCommit(receipt, false);
    } finally {
      busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }

  root.NuevoAmanecerCanonicalProductBridge = Object.freeze({
    enabled: enabled,
    save: save,
    busy: function () { return busy; }
  });
})(globalThis);
