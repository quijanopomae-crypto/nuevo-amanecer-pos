(function (root) {
  'use strict';

  if (!root || !root.document) return;

  var busy = false;

  function api() {
    return root.NuevoAmanecerCanonical;
  }

  function enabled() {
    var client = api();
    try {
      return !!(client && typeof client.enabled === 'function' && client.enabled());
    } catch (_) {
      return false;
    }
  }

  function clean(value) {
    return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
  }

  function moneyCents(value) {
    var amount = Number(value);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    var cents = Math.round(amount * 100);
    return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
  }

  function selectedCreditId() {
    try {
      return typeof pagoCredId !== 'undefined' && pagoCredId !== null && pagoCredId !== undefined
        ? String(pagoCredId)
        : '';
    } catch (_) {
      return '';
    }
  }

  function toast(message, tone) {
    if (typeof root.toast === 'function') root.toast(message, tone || 'error');
  }

  function closeModal() {
    if (typeof root.cerrarModal === 'function') root.cerrarModal('mPagoCred');
    else root.document.getElementById('mPagoCred')?.classList.remove('open');
  }

  function renderViews() {
    if (typeof root.cliRender === 'function') root.cliRender();
    if (typeof root.cajRender === 'function') root.cajRender();
    if (typeof root.updateDashboard === 'function') root.updateDashboard();
  }

  async function refreshCanonical() {
    var client = api();
    if (!client || typeof client.refresh !== 'function' || typeof client.legacySnapshot !== 'function') {
      throw new Error('CANONICAL_CLIENT_UNAVAILABLE');
    }
    await client.refresh();
    return client.legacySnapshot();
  }

  function findCredit(snapshot, id) {
    return (snapshot && Array.isArray(snapshot.credits) ? snapshot.credits : []).find(function (credit) {
      return credit && String(credit.id !== undefined ? credit.id : credit.credit_id) === String(id);
    }) || null;
  }

  function referenceUsed(snapshot, reference) {
    var key = clean(reference).toLowerCase();
    if (!key) return false;
    return (snapshot && Array.isArray(snapshot.credits) ? snapshot.credits : []).some(function (credit) {
      return Array.isArray(credit && credit.pagos) && credit.pagos.some(function (payment) {
        var value = clean(payment && (payment.numeroOperacion || payment.operacion || payment.referencia));
        return value && value.toLowerCase() === key;
      });
    });
  }

  async function confirm() {
    if (!enabled()) return false;
    if (busy) return false;

    var amountCents = moneyCents(root.document.getElementById('pagoMonto')?.value);
    var method = clean(root.document.getElementById('pagoMetodo')?.value) || 'efectivo';
    var reference = clean(root.document.getElementById('pagoOperacion')?.value);
    var creditId = selectedCreditId();

    if (!creditId) {
      toast('No se encontró el crédito seleccionado', 'error');
      return false;
    }
    if (!amountCents) {
      toast('Ingresa un monto válido', 'error');
      return false;
    }
    if (!['efectivo', 'yape', 'transferencia'].includes(method)) {
      toast('Método de pago inválido', 'error');
      return false;
    }
    if (method !== 'efectivo' && reference.length < 4) {
      toast('Ingresa al menos 4 caracteres del número de operación', 'error');
      root.document.getElementById('pagoOperacion')?.focus?.();
      return false;
    }

    var button = root.document.getElementById('pagoConfirmBtn');
    var label = button?.textContent || '✅ Confirmar';
    busy = true;
    if (button) {
      button.disabled = true;
      button.textContent = 'Procesando…';
    }

    try {
      var snapshot = await refreshCanonical();
      var credit = findCredit(snapshot, creditId);
      if (!credit) throw new Error('CANONICAL_CREDIT_NOT_FOUND');

      var outstandingCents = Math.round(Number(credit.saldo || 0) * 100);
      if (!Number.isSafeInteger(outstandingCents) || outstandingCents <= 0) {
        toast('Este crédito ya está pagado completamente', 'error');
        return false;
      }
      if (amountCents > outstandingCents) {
        toast('El abono supera el saldo pendiente', 'error');
        return false;
      }
      if (method !== 'efectivo' && referenceUsed(snapshot, reference)) {
        toast('Ese número de operación ya fue registrado', 'error');
        return false;
      }

      var input = {
        credit_id: String(credit.credit_id !== undefined ? credit.credit_id : credit.id),
        amount_cents: amountCents,
        payment_method: method
      };

      if (method === 'efectivo') {
        var cash = snapshot.cashState;
        if (!cash || !cash.abierta || !cash.sessionId) {
          toast('Abre la caja antes de registrar un cobro en efectivo', 'error');
          return false;
        }
        input.session_id = String(cash.sessionId);
      } else {
        input.reference = reference;
      }

      var client = api();
      if (!client || typeof client.createPayment !== 'function') throw new Error('CANONICAL_PAYMENT_UNAVAILABLE');
      await client.createPayment(input);
      await refreshCanonical();

      closeModal();
      renderViews();
      toast('Pago CANON de S/ ' + (amountCents / 100).toFixed(2) + ' registrado', 'success');
      return true;
    } catch (error) {
      var detail = clean(error && error.message);
      toast('No se pudo registrar el pago CANON' + (detail ? ': ' + detail : ''), 'error');
      return false;
    } finally {
      busy = false;
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
  }

  root.NuevoAmanecerCanonicalCreditPaymentBridge = Object.freeze({
    enabled: enabled,
    confirm: confirm,
    busy: function () { return busy; }
  });
})(globalThis);
