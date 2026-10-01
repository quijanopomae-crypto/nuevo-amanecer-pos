(function (root) {
  'use strict';

  var originalConfirm = root.confirmarVenta;
  var projection = null;
  var busy = false;
  var VERSION = 1;

  function copy(value) { return value == null ? null : JSON.parse(JSON.stringify(value)); }
  function enabled() {
    return !!(root.NuevoAmanecerCanonical && typeof root.NuevoAmanecerCanonical.enabled === 'function' && root.NuevoAmanecerCanonical.enabled());
  }
  function runtime() { return root.NuevoAmanecerCanonicalUIAdapter && root.NuevoAmanecerCanonicalUIAdapter.runtime; }
  function notify(message, tone) {
    if (runtime()) return runtime().notify(message, tone);
    var fn; try { if (typeof toast === 'function') fn = toast; } catch (_) {}
    if (!fn) fn = root.toast;
    if (typeof fn === 'function') fn(message, tone);
  }
  function failClosed(message, error) {
    notify(message, 'error');
    if (error && root.console && typeof root.console.error === 'function') root.console.error('[Venta canónica]', error.code || error.message || 'Error');
  }

  // The legacy POS keeps its authoritative runtime state in top-level `let`
  // bindings. In classic browser scripts those bindings are shared by the same
  // global lexical environment, but they are NOT properties of window/globalThis.
  // Read/write the lexical binding first and keep root.* only as a compatibility
  // fallback for isolated tests or alternate hosts.
  function liveCart() {
    if (runtime()) return runtime().cart();
    try { if (typeof cart !== 'undefined' && Array.isArray(cart)) return cart; } catch (_) {}
    return Array.isArray(root.cart) ? root.cart : [];
  }
  function liveProducts() {
    if (runtime()) return runtime().products();
    try { if (typeof productos !== 'undefined' && Array.isArray(productos)) return productos; } catch (_) {}
    return Array.isArray(root.productos) ? root.productos : [];
  }
  function liveSales() {
    if (runtime()) return runtime().sales();
    try { if (typeof ventas !== 'undefined' && Array.isArray(ventas)) return ventas; } catch (_) {}
    return Array.isArray(root.ventas) ? root.ventas : [];
  }
  function liveCustomers() {
    if (runtime()) return runtime().customers();
    try { if (typeof clientes !== 'undefined' && Array.isArray(clientes)) return clientes; } catch (_) {}
    return Array.isArray(root.clientes) ? root.clientes : [];
  }
  function livePaymentMethod() {
    if (runtime()) return runtime().paymentMethod();
    try { if (typeof posPayM !== 'undefined') return posPayM; } catch (_) {}
    return root.posPayM;
  }
  function liveProcessing() {
    if (runtime()) return runtime().processing();
    try { if (typeof posProc !== 'undefined') return !!posProc; } catch (_) {}
    return !!root.posProc;
  }
  function setLiveProcessing(value) {
    if (runtime()) return runtime().setProcessing(value);
    try {
      if (typeof posProc !== 'undefined') posProc = value;
      else root.posProc = value;
    } catch (_) { root.posProc = value; }
  }
  function clearLiveCart() {
    if (runtime()) return runtime().clearCart();
    try {
      if (typeof cart !== 'undefined') { cart = []; return; }
    } catch (_) {}
    root.cart = [];
  }
  function browserLockReason() {
    try {
      if (typeof root.securityIsLocked === 'function' && root.securityIsLocked()) return 'sesión de seguridad bloqueada';
    } catch (_) {}
    try {
      if (typeof root._naGetLocks === 'function') {
        var locks = root._naGetLocks() || {};
        if (locks.master) return 'Bloquear edición crítica está activado';
        if (locks.readOnly) return 'Modo solo lectura está activado';
        if (locks.modules && locks.modules.ventas) return 'Ventas y POS está protegido';
      }
    } catch (_) {}
    try {
      if (root.sessionStorage && root.sessionStorage.getItem('na_security_locked') === 'true') return 'sesión de seguridad bloqueada';
      if (root.localStorage) {
        if (root.localStorage.getItem('na_master_lock') === 'true') return 'Bloquear edición crítica está activado';
        if (root.localStorage.getItem('na_readonly') === 'true') return 'Modo solo lectura está activado';
        if (root.localStorage.getItem('na_lock_ventas') === 'true') return 'Ventas y POS está protegido';
      }
    } catch (_) {}
    return '';
  }
  function nextSaleId() {
    var canonical = root.NuevoAmanecerCanonical;
    var outbox = root.NuevoAmanecerCanonicalSaleOutbox;
    var confirmed = canonical && typeof canonical.snapshot === 'function' ? canonical.snapshot().sales || [] : [];
    var pending = outbox && typeof outbox.snapshot === 'function' ? outbox.snapshot().intents : [];
    var ids = liveSales().concat(confirmed, pending).map(function (sale) {
      var match = /^V-(\d+)$/.exec(String(sale.sale_id || sale.id || ''));
      return match ? Number(match[1]) : 0;
    });
    return 'V-' + String(Math.max.apply(Math, [0].concat(ids)) + 1).padStart(3, '0');
  }

  function cents(value) { return Math.round(Number(value) * 100); }
  function setBusy(value) {
    busy = value;
    setLiveProcessing(value);
    var button = root.document && root.document.getElementById('mBtnConf');
    if (button) button.disabled = value;
  }
  function updateAfterCommit(saleId, confirmed) {
    clearLiveCart();
    if (typeof root.posUpdateCart === 'function') root.posUpdateCart(false);
    if (typeof root.posRender === 'function') root.posRender();
    if (runtime()) { runtime().closeModal('mCobro'); runtime().closeModal('mCobroRapido'); }
    else {
      var close; try { if (typeof cerrarModal === 'function') close = cerrarModal; } catch (_) {}
      if (!close) close = root.cerrarModal;
      if (typeof close === 'function') close('mCobro');
    }
    var drawer = root.document && root.document.getElementById('cartDrawer');
    var backdrop = root.document && root.document.getElementById('cartBackdrop');
    drawer && drawer.classList && drawer.classList.remove('open');
    backdrop && backdrop.classList && backdrop.classList.remove('open');
    notify(confirmed ? ('Venta ' + saleId + ' confirmada') : ('Venta ' + saleId + ' guardada localmente · pendiente de sincronización'), confirmed ? 'success' : 'info');
  }
  function projectCurrentOutbox() {
    var canonical = root.NuevoAmanecerCanonical;
    var outbox = root.NuevoAmanecerCanonicalSaleOutbox;
    var projector = root.NuevoAmanecerCanonicalSaleProjection;
    if (!canonical || typeof canonical.snapshot !== 'function' || !outbox || typeof outbox.snapshot !== 'function' || !projector || typeof projector.project !== 'function') throw new Error('CANONICAL_PROJECTION_UNAVAILABLE');
    var rawBase = canonical.snapshot();
    var base = { products: rawBase.products || [], customers: rawBase.customers || [], credits: rawBase.credits || [], sales: rawBase.sales || [] };
    projection = copy(projector.project(base, outbox.snapshot()));
    if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') root.dispatchEvent(new root.CustomEvent('na:canonical-sale-projection', { detail: copy(projection) }));
    return copy(projection);
  }
  async function capture() {
    if (!enabled()) return;
    if (busy || liveProcessing()) return;
    try {
      if (typeof root.isModuleLocked !== 'function' || root.isModuleLocked('ventas', { canonicalSaleCapture: true })) {
        var lockReason = browserLockReason();
        failClosed(lockReason ? 'Venta bloqueada: ' + lockReason : 'Las ventas están bloqueadas', null); return;
      }
    } catch (lockError) {
      var caughtReason = browserLockReason();
      failClosed(caughtReason ? 'Venta bloqueada: ' + caughtReason : 'Las ventas están bloqueadas por un error interno de seguridad', lockError); return;
    }
    var cart = liveCart();
    if (!cart.length) { failClosed('El carrito está vacío.', null); return; }
    if (typeof root._naSessionOpen === 'function' && !root._naSessionOpen()) { failClosed('La caja no está abierta', null); return; }
    var productsById = new Map();
    liveProducts().forEach(function (product) {
      productsById.set(String(product.id), product);
    });
    var reservedByProduct = new Map();
    cart.forEach(function (item) {
      var key = String(item.id);
      var units = root._naUnitsSold ? root._naUnitsSold(item) : Number(item.qty);
      reservedByProduct.set(key, (reservedByProduct.get(key) || 0) + units);
    });
    for (var i = 0; i < cart.length; i += 1) {
      var item = cart[i];
      var product = productsById.get(String(item.id));
      if (product && (!root._naTracksStock || root._naTracksStock(product))) {
        var reserved = reservedByProduct.get(String(item.id)) || 0;
        if (reserved > Number(product.stock)) { failClosed('Stock insuficiente para ' + (product.name || item.name || item.id) + ': quedan ' + product.stock + ' unidades', null); return; }
      }
    }
    var paymentState = typeof root._naPaymentState === 'function' ? root._naPaymentState() : { valid: false, message: 'No se pudo validar el pago.' };
    if (!paymentState.valid) {
      if (typeof root._naSetPaymentHint === 'function') root._naSetPaymentHint(paymentState.message, 'error');
      failClosed(paymentState.message, null);
      if (typeof root._naPaymentFocusTarget === 'function') root._naPaymentFocusTarget()?.focus();
      return;
    }
    var method = livePaymentMethod();
    var mixed = method === 'mixto' && typeof root._naMixedPaymentData === 'function' ? root._naMixedPaymentData() : null;
    var digital = typeof root._naDigitalSalePayment === 'function' && root._naDigitalSalePayment();
    var verified = typeof root._naDigitalPaymentVerified === 'function' && root._naDigitalPaymentVerified();
    if (digital && !verified) { failClosed('Confirma que verificaste la recepción del pago digital.', null); return; }
    var reference = '';
    if (method === 'mixto') reference = mixed.reference;
    else if (['yape', 'plin', 'transferencia'].includes(method)) {
      var referenceInput = root.document && root.document.getElementById('mDigitalRef');
      reference = typeof root._naClean === 'function' ? root._naClean(referenceInput && referenceInput.value) : String(referenceInput && referenceInput.value || '').trim();
    }
    if (reference && liveSales().some(function (sale) { return !sale.anulada && sale.paymentRef === reference; })) {
      failClosed('Ese número de operación ya fue registrado.', null); return;
    }
    var customer = null, due = null;
    var customerInputId = method === 'credito' ? 'mCreditoCliente' : 'mVentaCliente';
    var customerId = root.document && root.document.getElementById(customerInputId)?.value;
    if (customerId) {
      customer = liveCustomers().find(function (candidate) { return String(candidate.id) === String(customerId); });
      if (!customer) { failClosed('El cliente seleccionado ya no está disponible. Actualiza la lista y vuelve a intentarlo.', null); return; }
    }
    if (method === 'credito') {
      due = root.document && root.document.getElementById('mCreditoVence')?.value;
      if (!customer || !due) { failClosed('Selecciona cliente y fecha de vencimiento', null); return; }
    }
    var saleId = nextSaleId();
    var createdAt = new Date().toISOString();
    var input = {
      sale_id: saleId,
      created_at: createdAt,
      payment_method: method,
      items: cart.map(function (item) {
        var line = { quantity: Number(item.qty), precio: item.precio,
          unitsPerQty: root._naUnitsPerQty ? root._naUnitsPerQty(item) : 1,
          ventaModo: item.ventaModo, modo: item.modo, ventaLibre: !!item.ventaLibre,
          ventaSinStock: !!item.ventaSinStock, unidadesSinStock: item.unidadesSinStock };
        if (item.ventaLibre) {
          line.canonicalGenericId = item.canonicalGenericId;
          line.name = item.name || item.nombre || 'VARIOS';
          line.codigoIngresado = item.codigoIngresado || item.barcode || '';
          line.barcode = item.barcode || '';
          line.sku = item.sku || '';
        } else line.product_id = String(item.id);
        return line;
      })
    };
    if (method === 'mixto') input.payment = { cash_cents: cents(mixed.cash), digital_cents: cents(mixed.digital), digital_method: mixed.digitalMethod, reference: reference };
    else if (['yape', 'plin', 'transferencia'].includes(method)) input.payment = { reference: reference };
    if (customer && method !== 'credito') input.customer_id = customer.id;
    if (method === 'credito') {
      input.customer_id = customer.id; input.credit_due = due;
      var creditV2 = root.NA_CLIENT_CREDIT_ACCOUNTS_V2 && typeof root.NA_CLIENT_CREDIT_ACCOUNTS_V2.saleDraft === 'function'
        ? root.NA_CLIENT_CREDIT_ACCOUNTS_V2.saleDraft() : null;
      if (creditV2 && creditV2.account) input.credit_account = copy(creditV2.account);
      if (creditV2 && Array.isArray(creditV2.installment_dates) && creditV2.installment_dates.length) input.installment_dates = copy(creditV2.installment_dates);
    }
    var durable = false;
    var ownsBusy = true;
    setBusy(true);
    try {
      var intentApi = root.NuevoAmanecerCanonicalSaleIntent;
      var outbox = root.NuevoAmanecerCanonicalSaleOutbox;
      if (!intentApi || typeof intentApi.build !== 'function' || !outbox || typeof outbox.enqueue !== 'function') throw new Error('CANONICAL_SALE_CAPTURE_UNAVAILABLE');
      var intent = intentApi.build(input);
      intent = await outbox.enqueue(intent);
      saleId = intent.sale_id;
      durable = true;

      // Online happy path: do not paint "pendiente" first. The outbox remains
      // durable for crash/ACK recovery, but the visible sale waits only for the
      // single authoritative receipt.
      var outcome = typeof outbox.sync === 'function' ? await outbox.sync() : null;
      var receipt = root.NuevoAmanecerCanonical.receiptSnapshot && root.NuevoAmanecerCanonical.receiptSnapshot();
      if (receipt && receipt.operation_id === intent.operation_id && receipt.sale_id === saleId) {
        updateAfterCommit(saleId, true);
        setBusy(false);
        ownsBusy = false;
        return { status: 'CONFIRMED', operation_id: intent.operation_id, sale_id: saleId };
      }

      // Only genuine offline/unknown-ACK cases fall back to the durable pending
      // projection. A normal online sale never flashes this state.
      updateAfterCommit(saleId, false);
      try { projectCurrentOutbox(); }
      catch (projectionError) { failClosed('Venta ' + saleId + ' guardada localmente · pendiente de sincronización. No se pudo actualizar la proyección.', projectionError); }
      setBusy(false);
      ownsBusy = false;
      return { status: 'PENDING_SYNC', operation_id: intent.operation_id, sale_id: saleId, sync_status: outcome && outcome.status };
    } catch (error) {
      if (durable) {
        updateAfterCommit(saleId, false);
        try { projectCurrentOutbox(); } catch (_) {}
        failClosed('Venta ' + saleId + ' guardada localmente · pendiente de sincronización.', error);
      } else failClosed('No se guardó la venta. Tus productos siguen en el carrito.', error);
    } finally { if (ownsBusy) setBusy(false); }
  }
  function wrappedConfirm() {
    if (!enabled()) return typeof originalConfirm === 'function' ? originalConfirm.apply(this, arguments) : undefined;
    return capture();
  }
  root.confirmarVenta = wrappedConfirm;
  root.NuevoAmanecerCanonicalSaleIntegration = Object.freeze({ VERSION: VERSION, capture: capture, lastProjection: function () { return copy(projection); }, enabled: enabled });
})(globalThis);
