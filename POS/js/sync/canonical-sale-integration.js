(function (root) {
  'use strict';

  var originalConfirm = root.confirmarVenta;
  var projection = null;
  var busy = false;
  var durableCartFingerprint = null;
  var VERSION = 1;

  function copy(value) { return value == null ? null : JSON.parse(JSON.stringify(value)); }
  function enabled() {
    return !!(root.NuevoAmanecerCanonical && typeof root.NuevoAmanecerCanonical.enabled === 'function' && root.NuevoAmanecerCanonical.enabled());
  }
  function failClosed(message, error) {
    if (typeof root.toast === 'function') root.toast(message, 'error');
    if (error && root.console && typeof root.console.error === 'function') root.console.error('[Venta canónica]', error.code || error.message || 'Error');
  }
  function nextSaleId() {
    var ids = (Array.isArray(root.ventas) ? root.ventas : []).map(function (sale) {
      return parseInt(String(sale.id).replace('V-', ''), 10) || 0;
    });
    return 'V-' + String(Math.max.apply(Math, [0].concat(ids)) + 1).padStart(3, '0');
  }
  function cents(value) { return Math.round(Number(value) * 100); }
  function setBusy(value) {
    busy = value;
    root.posProc = value;
    var button = root.document && root.document.getElementById('mBtnConf');
    if (button) button.disabled = value;
  }
  function updateAfterCommit(saleId) {
    root.cart = [];
    if (typeof root.posUpdateCart === 'function') root.posUpdateCart(false);
    if (typeof root.posRender === 'function') root.posRender();
    if (typeof root.cerrarModal === 'function') root.cerrarModal('mCobro');
    var drawer = root.document && root.document.getElementById('cartDrawer');
    var backdrop = root.document && root.document.getElementById('cartBackdrop');
    drawer && drawer.classList && drawer.classList.remove('open');
    backdrop && backdrop.classList && backdrop.classList.remove('open');
    if (typeof root.toast === 'function') root.toast('Venta ' + saleId + ' guardada localmente · pendiente de sincronización', 'success');
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
    if (busy || root.posProc) return;
    try {
      if (typeof root.isModuleLocked !== 'function' || root.isModuleLocked('ventas', { canonicalSaleCapture: true })) {
        failClosed('Las ventas están bloqueadas', null); return;
      }
    } catch (lockError) { failClosed('Las ventas están bloqueadas', lockError); return; }
    var cart = Array.isArray(root.cart) ? root.cart : [];
    if (!cart.length) { failClosed('El carrito está vacío.', null); return; }
    var cartFingerprint = JSON.stringify(cart.map(function (item) { return [item.id, item.qty, item.precio]; }));
    if (durableCartFingerprint === cartFingerprint) {
      failClosed('Esta venta ya quedó guardada localmente y está pendiente de sincronización.', null); return;
    }
    if (typeof root._naSessionOpen === 'function' && !root._naSessionOpen()) { failClosed('La caja no está abierta', null); return; }
    for (var i = 0; i < cart.length; i += 1) {
      var item = cart[i];
      var product = (Array.isArray(root.productos) ? root.productos : []).find(function (candidate) { return String(candidate.id) === String(item.id); });
      if (product && (!root._naTracksStock || root._naTracksStock(product))) {
        var reserved = cart.filter(function (candidate) { return String(candidate.id) === String(item.id); }).reduce(function (sum, candidate) { return sum + (root._naUnitsSold ? root._naUnitsSold(candidate) : Number(candidate.qty)); }, 0);
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
    var method = root.posPayM;
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
    if (reference && (Array.isArray(root.ventas) ? root.ventas : []).some(function (sale) { return !sale.anulada && sale.paymentRef === reference; })) {
      failClosed('Ese número de operación ya fue registrado.', null); return;
    }
    var customer = null, due = null;
    if (method === 'credito') {
      var customerId = root.document && root.document.getElementById('mCreditoCliente')?.value;
      customer = (Array.isArray(root.clientes) ? root.clientes : []).find(function (candidate) { return String(candidate.id) === String(customerId); });
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
        return { product_id: String(item.id), quantity: Number(item.qty), precio: item.precio,
          unitsPerQty: root._naUnitsPerQty ? root._naUnitsPerQty(item) : 1,
          ventaModo: item.ventaModo, modo: item.modo, ventaLibre: !!item.ventaLibre,
          ventaSinStock: !!item.ventaSinStock, unidadesSinStock: item.unidadesSinStock };
      })
    };
    if (method === 'mixto') input.payment = { cash_cents: cents(mixed.cash), digital_cents: cents(mixed.digital), digital_method: mixed.digitalMethod, reference: reference };
    else if (['yape', 'plin', 'transferencia'].includes(method)) input.payment = { reference: reference };
    if (customer && method !== 'credito') input.customer_id = customer.id;
    if (method === 'credito') { input.customer_id = customer.id; input.credit_due = due; }
    var durable = false;
    setBusy(true);
    try {
      var intentApi = root.NuevoAmanecerCanonicalSaleIntent;
      var outbox = root.NuevoAmanecerCanonicalSaleOutbox;
      if (!intentApi || typeof intentApi.build !== 'function' || !outbox || typeof outbox.enqueue !== 'function') throw new Error('CANONICAL_SALE_CAPTURE_UNAVAILABLE');
      var intent = intentApi.build(input);
      await outbox.enqueue(intent);
      durable = true;
      durableCartFingerprint = cartFingerprint;
      updateAfterCommit(saleId);
      try { projectCurrentOutbox(); }
      catch (projectionError) { failClosed('Venta ' + saleId + ' guardada localmente · pendiente de sincronización. No se pudo actualizar la proyección.', projectionError); }
    } catch (error) {
      if (durable) failClosed('Venta ' + saleId + ' guardada localmente · pendiente de sincronización.', error);
      else failClosed('No se guardó la venta. Tus productos siguen en el carrito.', error);
    } finally { setBusy(false); }
  }
  function wrappedConfirm() {
    if (!enabled()) return typeof originalConfirm === 'function' ? originalConfirm.apply(this, arguments) : undefined;
    return capture();
  }
  root.confirmarVenta = wrappedConfirm;
  root.NuevoAmanecerCanonicalSaleIntegration = Object.freeze({ VERSION: VERSION, capture: capture, lastProjection: function () { return copy(projection); }, enabled: enabled });
})(globalThis);
