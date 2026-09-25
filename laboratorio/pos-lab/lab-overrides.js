/*
 * Extensiones exclusivas del POS-LAB.
 *
 * Agrega aquí funciones nuevas, eventos o prototipos mientras estén en prueba.
 * NO copies este archivo completo a POS/. Cuando una función sea aprobada,
 * promueve únicamente el cambio mínimo al módulo canónico correspondiente.
 */
(function () {
  'use strict';

  if (!window.__NA_LAB__) {
    throw new Error('LAB_OVERRIDES_OUTSIDE_LAB');
  }

  window._NA_LAB_EXTENSIONS = window._NA_LAB_EXTENSIONS || {
    version: 1,
    experiments: Object.create(null)
  };

  var labClientMotionTimer = 0;
  var labClientMotionReady = false;
  var originalCliRender = null;
  var labClientProfileObserver = null;
  var labClientProfileRaf = 0;
  var labClientProfileEnhancing = false;


  // ===== LAB ETAPA 02: CUENTAS Y CRÉDITOS POR CLIENTE V2 =====
  // LAB-only. El ledger financiero sigue siendo el existente; esta capa añade
  // organización, navegación y metadata opcional sin duplicar pagos/caja/FIFO.
  var LAB_SMALL_ACCOUNT_ID = 'small';
  var LAB_SMALL_ACCOUNT_NAME = 'Créditos pequeños';
  var labClientScreenState = { clientId:null, route:'home', categoryId:null, creditId:null, purchaseId:null };
  var labSaleCreditState = { clientId:null, categoryId:LAB_SMALL_ACCOUNT_ID, installmentCount:1 };

  function labEsc(value) {
    if (typeof _naEsc === 'function') return _naEsc(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, function (char) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char];
    });
  }

  function labMoney(value) {
    if (value === null || value === undefined || value === '' || Number.isNaN(Number(value))) return '—';
    if (typeof fmt === 'function') return fmt(Number(value));
    return 'S/ ' + Number(value).toFixed(2);
  }

  function labCreditPending(cr) {
    if (typeof _naCreditOutstanding === 'function') return Math.max(0, Number(_naCreditOutstanding(cr)) || 0);
    return Math.max(0, (Number(cr && cr.monto) || 0) - (Number(cr && cr.pagado) || 0));
  }

  function labCreditStatus(cr) {
    if (typeof _naSyncCreditStatus === 'function') {
      try { _naSyncCreditStatus(cr); } catch {}
    }
    return String((cr && (cr.status || cr.estado)) || '').toLowerCase();
  }

  function labIsCanceled(cr) {
    var status = labCreditStatus(cr);
    return !!(cr && !cr.anulado && status !== 'anulado' && (status === 'cancelado' || labCreditPending(cr) <= 0.001));
  }

  function labDueDays(value) {
    if (!value) return null;
    if (typeof diasHasta === 'function') {
      var result = diasHasta(value);
      return Number.isFinite(result) ? result : null;
    }
    var due = new Date(String(value).slice(0, 10) + 'T23:59:59');
    if (!Number.isFinite(due.getTime())) return null;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.ceil((due - today) / 86400000);
  }

  function labClientCredits(clientId) {
    return (Array.isArray(creditos) ? creditos : []).filter(function (cr) {
      return String(cr && (cr.cliId ?? cr.clienteId)) === String(clientId) && !cr.anulado && labCreditStatus(cr) !== 'anulado';
    });
  }

  function labNormalizeCategory(raw, fallbackIndex) {
    if (!raw || typeof raw !== 'object') return null;
    var name = String(raw.name || raw.nombre || '').trim();
    if (!name) return null;
    var mode = raw.mode === 'accumulated' ? 'accumulated' : 'separate';
    var id = String(raw.id || ('labcat_' + fallbackIndex)).trim();
    if (!id || id === LAB_SMALL_ACCOUNT_ID) return null;
    return { id:id, name:name.slice(0, 60), mode:mode, createdAt:raw.createdAt || null };
  }

  function labCustomCategories(client) {
    var seen = new Set();
    return (Array.isArray(client && client.labCreditCategories) ? client.labCreditCategories : [])
      .map(labNormalizeCategory)
      .filter(function (cat) {
        if (!cat || seen.has(cat.id)) return false;
        seen.add(cat.id);
        return true;
      });
  }

  function labCreditAccountMeta(cr) {
    var raw = cr && cr.labCreditAccount;
    if (raw && typeof raw === 'object' && raw.categoryId && raw.categoryId !== LAB_SMALL_ACCOUNT_ID) {
      return {
        categoryId:String(raw.categoryId),
        categoryName:String(raw.categoryName || 'Categoría').slice(0, 60),
        mode:raw.mode === 'accumulated' ? 'accumulated' : 'separate',
        source:raw.source || 'legacy'
      };
    }
    return { categoryId:LAB_SMALL_ACCOUNT_ID, categoryName:LAB_SMALL_ACCOUNT_NAME, mode:'accumulated', source:'default' };
  }

  function labCategoriesForClient(client) {
    var result = [{ id:LAB_SMALL_ACCOUNT_ID, name:LAB_SMALL_ACCOUNT_NAME, mode:'accumulated', builtin:true }];
    var seen = new Set([LAB_SMALL_ACCOUNT_ID]);
    labCustomCategories(client).forEach(function (cat) {
      if (!seen.has(cat.id)) { seen.add(cat.id); result.push(cat); }
    });
    labClientCredits(client && client.id).forEach(function (cr) {
      var meta = labCreditAccountMeta(cr);
      if (meta.categoryId !== LAB_SMALL_ACCOUNT_ID && !seen.has(meta.categoryId)) {
        seen.add(meta.categoryId);
        result.push({ id:meta.categoryId, name:meta.categoryName, mode:meta.mode, recovered:true });
      }
    });
    return result;
  }

  function labCreditsForCategory(clientId, categoryId) {
    return labClientCredits(clientId).filter(function (cr) {
      return labCreditAccountMeta(cr).categoryId === String(categoryId || LAB_SMALL_ACCOUNT_ID);
    });
  }

  function labCategorySummary(client, category) {
    var all = labCreditsForCategory(client.id, category.id);
    var active = all.filter(function (cr) { return !labIsCanceled(cr); });
    var closed = all.filter(labIsCanceled);
    var pending = active.reduce(function (sum, cr) { return sum + labCreditPending(cr); }, 0);
    var purchaseCount = all.filter(function (cr) { return !!cr.ventaId || cr.tipo === 'venta_credito'; }).length;
    return {
      category:category, all:all, active:active, closed:closed,
      pending:Number(pending.toFixed(2)),
      purchaseCount:purchaseCount,
      activeCount:active.length
    };
  }

  function labEffectivePayments(cr) {
    return (Array.isArray(cr && cr.pagos) ? cr.pagos : [])
      .filter(function (pay) {
        return String(pay && pay.status || '').toUpperCase() !== 'REVERTED' && !(pay && pay.reversalId);
      })
      .slice()
      .sort(function (a,b) {
        return new Date(a.timestamp || (a.fecha || '') + 'T' + (a.hora24 || a.hora || '00:00:00')) -
               new Date(b.timestamp || (b.fecha || '') + 'T' + (b.hora24 || b.hora || '00:00:00'));
      });
  }

  function labSplitInstallmentAmounts(total, count) {
    var cents = Math.max(0, Math.round((Number(total) || 0) * 100));
    count = Math.max(1, Math.min(60, Math.floor(Number(count) || 1)));
    var base = Math.floor(cents / count), remainder = cents - base * count;
    return Array.from({length:count}, function (_, index) {
      return (base + (index < remainder ? 1 : 0)) / 100;
    });
  }

  function labInstallmentPlan(cr) {
    var raw = Array.isArray(cr && cr.labInstallments) && cr.labInstallments.length
      ? cr.labInstallments.slice()
      : [{ number:1, due:cr && cr.vence || '', amount:Number(cr && cr.monto) || 0 }];
    var amounts = labSplitInstallmentAmounts(Number(cr && cr.monto) || 0, raw.length);
    var paidTotal = Math.min(Number(cr && cr.monto) || 0, Math.max(0, Number(cr && cr.pagado) || 0));
    var payments = labEffectivePayments(cr), runningPayments = 0, paymentIndex = 0;
    var cumulativeDue = 0;

    return raw.map(function (item, index) {
      var amount = Number(item && item.amount);
      if (!Number.isFinite(amount) || amount < 0) amount = amounts[index];
      cumulativeDue += amount;
      while (paymentIndex < payments.length && runningPayments + 0.001 < cumulativeDue) {
        runningPayments += Math.max(0, Number(payments[paymentIndex].monto ?? payments[paymentIndex].montoPagado) || 0);
        paymentIndex += 1;
      }
      var isPaid = paidTotal + 0.001 >= cumulativeDue;
      var completionPayment = isPaid && paymentIndex > 0 ? payments[paymentIndex - 1] : null;
      return {
        number:Number(item && item.number) || index + 1,
        due:String(item && item.due || item && item.fecha || cr && cr.vence || '').slice(0, 10),
        amount:Number(amount.toFixed(2)),
        paid:isPaid,
        paidAt:completionPayment ? (completionPayment.timestamp || ((completionPayment.fecha || '') + 'T' + (completionPayment.hora24 || completionPayment.hora || ''))) : null,
        paymentId:completionPayment ? (completionPayment.pagoId || completionPayment.id || null) : null
      };
    });
  }

  function labInstallmentSummary(cr) {
    var plan = labInstallmentPlan(cr), paid = plan.filter(function (x) { return x.paid; });
    var pending = plan.filter(function (x) { return !x.paid; });
    return { plan:plan, paid:paid, pending:pending, paidCount:paid.length, pendingCount:pending.length };
  }

  function labLastPaymentDate(cr) {
    var rows = labEffectivePayments(cr);
    var pay = rows[rows.length - 1];
    if (!pay) return cr && cr.fecha ? cr.fecha : '—';
    return pay.fecha || (pay.timestamp ? String(pay.timestamp).slice(0,10) : '—');
  }

  function labClientFinancialSummary(client) {
    var all = labClientCredits(client.id);
    var active = all.filter(function (cr) { return !labIsCanceled(cr); });
    var closed = all.filter(labIsCanceled);
    var debt = active.reduce(function (sum, cr) { return sum + labCreditPending(cr); }, 0);
    var overdueDebt = active.filter(function (cr) {
      return labCreditPending(cr) > 0.001 && labDueDays(cr.vence) !== null && labDueDays(cr.vence) < 0;
    }).reduce(function (sum, cr) { return sum + labCreditPending(cr); }, 0);
    var evaluation = null;
    if (typeof _naEvaluateClientCredit === 'function') {
      try { evaluation = _naEvaluateClientCredit(client.id); } catch {}
    }
    return { all:all, active:active, closed:closed, debt:Number(debt.toFixed(2)), overdueDebt:Number(overdueDebt.toFixed(2)), evaluation:evaluation };
  }

  function labClassifyClient(client) {
    var summary = labClientFinancialSummary(client), e = summary.evaluation || {}, h = e.history || {};
    var label = 'REGULAR', tone = 'amber', reasons = [];
    if (summary.overdueDebt > 0.001 || Number(h.overdueActive || 0) > 0 || h.behavior === 'impuntual') {
      label = 'RIESGO ALTO'; tone = 'red';
      if (summary.overdueDebt > 0.001) reasons.push('Mantiene deuda vencida actualmente');
      if (Number(h.late || 0) > 0) reasons.push('Registra pagos tardíos o créditos vencidos');
    } else if (Number(h.punctual || 0) > 0 && Number(h.late || 0) === 0) {
      label = 'ESTABLE'; tone = 'green';
      reasons.push('Pagos registrados mayormente puntuales');
      reasons.push('Sin deuda vencida actual');
      if (Number(h.completed || 0) > 0) reasons.push('Tiene créditos finalizados');
    } else {
      if (Number(h.late || 0) > 0 || h.behavior === 'irregular') reasons.push('El historial incluye atrasos');
      else reasons.push('Historial financiero todavía limitado o en proceso');
      if (summary.overdueDebt <= 0.001) reasons.push('Sin deuda vencida actual');
    }
    return { label:label, tone:tone, reasons:reasons, summary:summary };
  }

  function labProductSummary(cr) {
    var items = Array.isArray(cr && cr.items) ? cr.items : [];
    if (!items.length) return String(cr && cr.desc || 'Compra a crédito');
    var first = items[0] && (items[0].nombre || items[0].name) || 'Producto';
    return items.length > 1 ? first + ' + ' + (items.length - 1) + (items.length - 1 === 1 ? ' producto' : ' productos') : first;
  }

  function labScreen() {
    var page = document.getElementById('pageClientes');
    if (!page) return null;
    var screen = page.querySelector('.lab-client-account-screen');
    if (!screen) {
      screen = document.createElement('section');
      screen.className = 'lab-client-account-screen';
      screen.hidden = true;
      screen.innerHTML = '<div class="lab-client-account-shell"><div class="lab-client-account-content"></div></div>';
      page.appendChild(screen);
    }
    return screen;
  }

  function labClientById(clientId) {
    return Array.isArray(clientes) ? clientes.find(function (c) { return String(c.id) === String(clientId); }) : null;
  }

  function labRenderScreen(html) {
    var screen = labScreen();
    if (!screen) return;
    var content = screen.querySelector('.lab-client-account-content');
    if (content) content.innerHTML = html;
    screen.hidden = false;
    document.getElementById('pageClientes')?.classList.add('lab-client-detail-open');
    screen.scrollTop = 0;
  }

  function labCloseScreen() {
    var screen = labScreen();
    if (screen) screen.hidden = true;
    document.getElementById('pageClientes')?.classList.remove('lab-client-detail-open');
    labClientScreenState = { clientId:null, route:'home', categoryId:null, creditId:null, purchaseId:null };
  }

  function labBackButton(label) {
    return '<button type="button" class="lab-v2-back" onclick="naLabClientBack()">← ' + labEsc(label || 'Clientes') + '</button>';
  }

  function labAccountRow(client, category) {
    var s = labCategorySummary(client, category);
    var detail = category.mode === 'accumulated'
      ? s.purchaseCount + (s.purchaseCount === 1 ? ' compra' : ' compras')
      : s.activeCount + (s.activeCount === 1 ? ' crédito activo' : ' créditos activos');
    return '<button type="button" class="lab-v2-row" onclick="naLabOpenCreditCategory(\'' + labEsc(String(category.id)) + '\')">' +
      '<span><strong>' + labEsc(category.name) + '</strong><small>' + labEsc(detail) + '</small></span>' +
      '<span class="lab-v2-row-value"><strong>' + labMoney(s.pending) + '</strong><small>pendiente</small></span><b>›</b>' +
    '</button>';
  }

  function labHomeHtml(client) {
    var c = labClassifyClient(client), s = c.summary, e = s.evaluation || {};
    var categories = labCategoriesForClient(client);
    var paymentCount = s.all.reduce(function (n, cr) { return n + labEffectivePayments(cr).length; }, 0);
    var line = Number.isFinite(Number(e.assignedLine)) ? Number(e.assignedLine) : null;
    var available = Number.isFinite(Number(e.available)) ? Number(e.available) : null;
    return '<div class="lab-v2-screen">' +
      labBackButton('Clientes') +
      '<header class="lab-v2-client-head"><div><div class="lab-v2-name-line"><h2>' + labEsc(client.nombre || 'Cliente') + '</h2>' +
        '<button type="button" class="lab-v2-risk lab-v2-risk-' + c.tone + '" onclick="naLabOpenClientBehavior()">' + (c.tone === 'green' ? '● ' : c.tone === 'red' ? '● ' : '● ') + labEsc(c.label) + '</button></div>' +
        '<p>' + (client.dni ? 'DNI ' + labEsc(client.dni) : 'Sin DNI') + (client.tel ? ' · ' + labEsc(client.tel) : '') + '</p></div>' +
        '<div class="lab-v2-head-money"><span>Deuda total</span><strong>' + labMoney(s.debt) + '</strong>' +
        '<small>Línea de crédito: ' + labMoney(line) + (available !== null ? ' · ' + labMoney(available) + ' disponible' : '') + '</small></div></header>' +
      '<div class="lab-v2-divider"></div>' +
      '<section class="lab-v2-section"><h3>CUENTAS Y CRÉDITOS</h3>' +
        '<div class="lab-v2-list">' + categories.map(function (cat) { return labAccountRow(client, cat); }).join('') + '</div></section>' +
      '<div class="lab-v2-divider"></div>' +
      '<section class="lab-v2-section lab-v2-list">' +
        '<button type="button" class="lab-v2-row" onclick="naLabOpenClientPaymentHistory()"><span><strong>HISTORIAL DE PAGOS</strong><small>' + paymentCount + ' pagos / cuotas canceladas</small></span><b>›</b></button>' +
        '<button type="button" class="lab-v2-row" onclick="naLabOpenCanceledCredits()"><span><strong>CRÉDITOS CANCELADOS</strong><small>' + s.closed.length + ' créditos finalizados</small></span><b>›</b></button>' +
        '<button type="button" class="lab-v2-row" onclick="naLabOpenCreditLine()"><span><strong>LÍNEA DE CRÉDITO</strong><small>' + (available === null ? 'Evaluación disponible' : labMoney(available) + ' disponible') + '</small></span><b>›</b></button>' +
        '<button type="button" class="lab-v2-row" onclick="naLabOpenClientBehavior()"><span><strong>COMPORTAMIENTO</strong><small>' + labEsc(c.label) + '</small></span><b>›</b></button>' +
      '</section>' +
    '</div>';
  }

  function labPurchaseRow(cr) {
    return '<button type="button" class="lab-v2-row lab-v2-purchase-row" onclick="naLabOpenSmallPurchase(\'' + labEsc(String(cr.id)) + '\')">' +
      '<span><strong>' + labEsc(cr.fecha || 'Fecha no registrada') + '</strong><small>' + labEsc(labProductSummary(cr)) + '</small></span>' +
      '<span class="lab-v2-row-value"><strong>' + labMoney(Number(cr.monto) || 0) + '</strong>' +
        (labCreditPending(cr) + 0.001 < Number(cr.monto || 0) ? '<small>' + labMoney(labCreditPending(cr)) + ' pendiente</small>' : '') + '</span><b>›</b>' +
    '</button>';
  }

  function labCreditRow(cr) {
    var ins = labInstallmentSummary(cr), pending = labCreditPending(cr);
    var next = ins.pending[0];
    return '<button type="button" class="lab-v2-row lab-v2-credit-row" onclick="naLabOpenIndividualCredit(\'' + labEsc(String(cr.id)) + '\')">' +
      '<span><strong>' + labEsc(cr.desc || labProductSummary(cr) || 'Crédito') + '</strong>' +
        '<small>' + ins.paidCount + ' cuotas pagadas · ' + ins.pendingCount + ' pendientes' + (next && next.due ? ' · Próximo pago: ' + labEsc(next.due) : '') + '</small></span>' +
      '<span class="lab-v2-row-value"><strong>' + labMoney(pending) + '</strong><small>pendiente</small></span><b>›</b>' +
    '</button>';
  }

  function labCategoryHtml(client, category) {
    var s = labCategorySummary(client, category);
    var rows = category.mode === 'accumulated' ? s.active.map(labPurchaseRow) : s.active.map(labCreditRow);
    var detail = category.mode === 'accumulated'
      ? s.purchaseCount + (s.purchaseCount === 1 ? ' compra' : ' compras')
      : s.activeCount + (s.activeCount === 1 ? ' crédito activo' : ' créditos activos');
    return '<div class="lab-v2-screen">' + labBackButton(client.nombre || 'Cliente') +
      '<header class="lab-v2-subhead"><h2>' + labEsc(category.name) + '</h2><span>Pendiente total</span><strong>' + labMoney(s.pending) + '</strong><small>' + labEsc(detail) + '</small></header>' +
      '<section class="lab-v2-list">' + (rows.length ? rows.join('') : '<div class="lab-v2-empty">No hay créditos activos en esta cuenta.</div>') + '</section></div>';
  }

  function labPurchaseHtml(client, cr) {
    var items = Array.isArray(cr.items) ? cr.items : [];
    return '<div class="lab-v2-screen">' + labBackButton(LAB_SMALL_ACCOUNT_NAME) +
      '<header class="lab-v2-subhead"><h2>VENTA ' + labEsc(cr.fecha || '') + '</h2></header>' +
      '<section class="lab-v2-product-list">' +
        (items.length ? items.map(function (item) {
          var qty = Number(item.cantidad ?? item.qty) || 1, unit = Number(item.precioUnitario ?? item.precio) || 0;
          var total = Number(item.subtotal);
          if (!Number.isFinite(total)) total = qty * unit;
          return '<div class="lab-v2-product"><span><strong>' + labEsc(item.nombre || item.name || 'Producto') + '</strong><small>' + qty + ' × ' + labMoney(unit) + '</small></span><b>' + labMoney(total) + '</b></div>';
        }).join('') : '<div class="lab-v2-empty">El crédito heredado no conserva detalle de productos.</div>') +
      '</section><div class="lab-v2-total"><span>Total</span><strong>' + labMoney(Number(cr.monto) || 0) + '</strong></div></div>';
  }

  function labPendingInstallmentsHtml(summary) {
    if (!summary.pending.length) return '<div class="lab-v2-empty">No quedan cuotas pendientes.</div>';
    var visible = summary.pending.slice(0, 6);
    return visible.map(function (item) {
      return '<div class="lab-v2-installment"><span><strong>Cuota ' + item.number + '</strong><small>' + labEsc(item.due || 'Fecha no registrada') + '</small></span></div>';
    }).join('') + (summary.pending.length > visible.length ? '<div class="lab-v2-more">+ ' + (summary.pending.length - visible.length) + ' pendientes</div>' : '');
  }

  function labCreditInfoHtml(cr, account) {
    return '<div class="lab-v2-credit-info" id="labV2CreditInfo" hidden>' +
      '<div><span>Monto original</span><strong>' + labMoney(cr.monto) + '</strong></div>' +
      '<div><span>Total pagado</span><strong>' + labMoney(cr.pagado) + '</strong></div>' +
      '<div><span>Saldo pendiente</span><strong>' + labMoney(labCreditPending(cr)) + '</strong></div>' +
      '<div><span>Fecha de inicio</span><strong>' + labEsc(cr.fecha || '—') + '</strong></div>' +
      '<div><span>Número total de cuotas</span><strong>' + labInstallmentPlan(cr).length + '</strong></div>' +
      '<div><span>Categoría</span><strong>' + labEsc(account.categoryName) + '</strong></div>' +
      '<div><span>Referencia / ID</span><strong>' + labEsc(String(cr.id || '—')) + '</strong></div>' +
    '</div>';
  }

  function labCreditHtml(client, cr) {
    var account = labCreditAccountMeta(cr), ins = labInstallmentSummary(cr);
    var total = Math.max(1, ins.plan.length), progress = Math.round(ins.paidCount / total * 100);
    return '<div class="lab-v2-screen">' + labBackButton(account.categoryName) +
      '<header class="lab-v2-subhead lab-v2-credit-title"><h2>' + labEsc(cr.desc || labProductSummary(cr) || 'Crédito') + '</h2>' +
        '<p>' + ins.paidCount + ' cuotas pagadas · ' + ins.pendingCount + ' pendientes</p></header>' +
      '<div class="lab-v2-progress"><span style="width:' + progress + '%"></span></div>' +
      '<section class="lab-v2-section"><h3>CUOTAS PENDIENTES</h3>' + labPendingInstallmentsHtml(ins) + '</section>' +
      '<div class="lab-v2-credit-actions">' +
        (!labIsCanceled(cr) && labCreditPending(cr) > 0.001 ? '<button type="button" class="lab-v2-pay" onclick="abrirPago(\'' + labEsc(String(cr.id)) + '\')">Registrar pago</button>' : '') +
        '<button type="button" class="lab-v2-info-btn" aria-label="Información del crédito" onclick="naLabToggleCreditInfo()">ⓘ</button>' +
      '</div>' +
      labCreditInfoHtml(cr, account) +
      '<button type="button" class="lab-v2-row lab-v2-history-link" onclick="naLabOpenCreditHistory(\'' + labEsc(String(cr.id)) + '\')"><span><strong>Historial de este crédito</strong><small>' + ins.paidCount + ' cuotas canceladas</small></span><b>›</b></button>' +
    '</div>';
  }

  function labFormatPaymentMoment(pay) {
    var date = pay && (pay.fecha || (pay.timestamp ? String(pay.timestamp).slice(0,10) : '')) || 'Fecha no registrada';
    var time = pay && (pay.hora || pay.hora24 || '') || '';
    return date + (time ? ' · ' + time : '');
  }

  function labCreditHistoryHtml(client, cr) {
    var ins = labInstallmentSummary(cr);
    return '<div class="lab-v2-screen">' + labBackButton(cr.desc || 'Crédito') +
      '<header class="lab-v2-subhead"><h2>CUOTAS PAGADAS</h2></header><section class="lab-v2-list">' +
      (ins.paid.length ? ins.paid.map(function (item) {
        var pay = item.paymentId ? labEffectivePayments(cr).find(function (p) { return String(p.pagoId || p.id) === String(item.paymentId); }) : null;
        return '<div class="lab-v2-paid-row"><span>✓</span><div><strong>Cuota ' + item.number + '</strong><small>' + labEsc(pay ? labFormatPaymentMoment(pay) : (item.paidAt || 'Pago histórico sin hora canónica')) + '</small></div></div>';
      }).join('') : '<div class="lab-v2-empty">Todavía no hay cuotas pagadas.</div>') +
      '</section></div>';
  }

  function labPaymentGroups(client) {
    return labCategoriesForClient(client).map(function (category) {
      var credits = labCreditsForCategory(client.id, category.id);
      var count = credits.reduce(function (n, cr) { return n + labEffectivePayments(cr).length; }, 0);
      return { category:category, credits:credits, paymentCount:count };
    }).filter(function (g) { return g.paymentCount > 0; });
  }

  function labGeneralHistoryHtml(client) {
    var groups = labPaymentGroups(client);
    return '<div class="lab-v2-screen">' + labBackButton(client.nombre || 'Cliente') +
      '<header class="lab-v2-subhead"><h2>HISTORIAL DE PAGOS</h2></header>' +
      (groups.length ? groups.map(function (group) {
        var content = group.category.mode === 'accumulated'
          ? '<button type="button" class="lab-v2-row" onclick="naLabOpenCreditCategory(\'' + labEsc(group.category.id) + '\')"><span><strong>' + labEsc(group.category.name) + '</strong><small>' + group.paymentCount + ' pagos realizados</small></span><b>›</b></button>'
          : group.credits.filter(function (cr) { return labEffectivePayments(cr).length; }).map(function (cr) {
              var count = labEffectivePayments(cr).length;
              return '<button type="button" class="lab-v2-row" onclick="naLabOpenCreditHistory(\'' + labEsc(String(cr.id)) + '\')"><span><strong>' + labEsc(cr.desc || 'Crédito') + '</strong><small>' + count + ' cuotas canceladas</small></span><b>›</b></button>';
            }).join('');
        return '<section class="lab-v2-section"><h3>' + labEsc(group.category.name).toUpperCase() + '</h3><div class="lab-v2-list">' + content + '</div></section>';
      }).join('') : '<div class="lab-v2-empty">Todavía no hay pagos registrados.</div>') +
    '</div>';
  }

  function labCanceledHtml(client) {
    var s = labClientFinancialSummary(client);
    return '<div class="lab-v2-screen">' + labBackButton(client.nombre || 'Cliente') +
      '<header class="lab-v2-subhead"><h2>CRÉDITOS CANCELADOS</h2><small>' + s.closed.length + ' créditos finalizados</small></header>' +
      '<section class="lab-v2-list">' + (s.closed.length ? s.closed.map(function (cr) {
        var ins = labInstallmentSummary(cr);
        return '<button type="button" class="lab-v2-row" onclick="naLabOpenIndividualCredit(\'' + labEsc(String(cr.id)) + '\')"><span><strong>' + labEsc(cr.desc || labProductSummary(cr) || 'Crédito') + '</strong><small>' + ins.paidCount + '/' + ins.plan.length + ' cuotas pagadas · Finalizado ' + labEsc(labLastPaymentDate(cr)) + '</small></span><b>›</b></button>';
      }).join('') : '<div class="lab-v2-empty">No hay créditos finalizados.</div>') + '</section></div>';
  }

  function labLineHtml(client) {
    var s = labClientFinancialSummary(client), e = s.evaluation || {};
    var assigned = Number.isFinite(Number(e.assignedLine)) ? Number(e.assignedLine) : null;
    var automatic = Number.isFinite(Number(e.automaticLine)) ? Number(e.automaticLine) : null;
    var available = Number.isFinite(Number(e.available)) ? Number(e.available) : null;
    return '<div class="lab-v2-screen">' + labBackButton(client.nombre || 'Cliente') +
      '<header class="lab-v2-subhead"><h2>LÍNEA DE CRÉDITO</h2><strong>' + labMoney(assigned) + '</strong><small>' + (e.manualActive ? 'Línea manual vigente' : 'Línea calculada por la evaluación actual') + '</small></header>' +
      '<section class="lab-v2-metrics"><div><span>Disponible</span><strong>' + labMoney(available) + '</strong></div><div><span>Deuda activa</span><strong>' + labMoney(s.debt) + '</strong></div><div><span>Línea automática</span><strong>' + labMoney(automatic) + '</strong></div></section>' +
      '<p class="lab-v2-note">Esta pantalla reutiliza la evaluación vigente del POS. La clasificación visual del cliente no sustituye ni sobrescribe la línea manual o automática.</p>' +
      (typeof abrirEvaluacionCredito === 'function' ? '<button type="button" class="lab-v2-pay secondary" onclick="abrirEvaluacionCredito(\'' + labEsc(String(client.id)) + '\')">Ver evaluación existente</button>' : '') +
    '</div>';
  }

  function labBehaviorHtml(client) {
    var c = labClassifyClient(client), s = c.summary, e = s.evaluation || {}, h = e.history || {};
    var assigned = Number.isFinite(Number(e.assignedLine)) ? Number(e.assignedLine) : null;
    return '<div class="lab-v2-screen">' + labBackButton(client.nombre || 'Cliente') +
      '<header class="lab-v2-subhead"><h2>COMPORTAMIENTO</h2><span class="lab-v2-risk lab-v2-risk-' + c.tone + '">● ' + labEsc(c.label) + '</span></header>' +
      '<section class="lab-v2-metrics"><div><span>Pagos puntuales</span><strong>' + labEsc(String(h.punctual ?? 0)) + '</strong></div>' +
        '<div><span>Pagos atrasados</span><strong>' + labEsc(String(h.late ?? 0)) + '</strong></div>' +
        '<div><span>Créditos finalizados</span><strong>' + labEsc(String(h.completed ?? s.closed.length)) + '</strong></div>' +
        '<div><span>Deuda vencida</span><strong>' + labMoney(s.overdueDebt) + '</strong></div>' +
        '<div><span>Línea actual</span><strong>' + labMoney(assigned) + '</strong></div></section>' +
      '<section class="lab-v2-why"><h3>¿Por qué?</h3>' + c.reasons.map(function (reason) { return '<p>✓ ' + labEsc(reason) + '</p>'; }).join('') +
        '<p>✓ La línea mostrada proviene de la evaluación financiera vigente del POS.</p></section>' +
    '</div>';
  }

  function labRenderRoute() {
    var client = labClientById(labClientScreenState.clientId);
    if (!client) { labCloseScreen(); return; }
    if (labClientScreenState.route === 'home') return labRenderScreen(labHomeHtml(client));
    if (labClientScreenState.route === 'category') {
      var cat = labCategoriesForClient(client).find(function (x) { return String(x.id) === String(labClientScreenState.categoryId); });
      if (!cat) { labClientScreenState.route = 'home'; return labRenderRoute(); }
      return labRenderScreen(labCategoryHtml(client, cat));
    }
    var cr = labClientCredits(client.id).find(function (x) { return String(x.id) === String(labClientScreenState.creditId || labClientScreenState.purchaseId); });
    if (labClientScreenState.route === 'purchase' && cr) return labRenderScreen(labPurchaseHtml(client, cr));
    if (labClientScreenState.route === 'credit' && cr) return labRenderScreen(labCreditHtml(client, cr));
    if (labClientScreenState.route === 'creditHistory' && cr) return labRenderScreen(labCreditHistoryHtml(client, cr));
    if (labClientScreenState.route === 'history') return labRenderScreen(labGeneralHistoryHtml(client));
    if (labClientScreenState.route === 'canceled') return labRenderScreen(labCanceledHtml(client));
    if (labClientScreenState.route === 'line') return labRenderScreen(labLineHtml(client));
    if (labClientScreenState.route === 'behavior') return labRenderScreen(labBehaviorHtml(client));
    labClientScreenState.route = 'home';
    return labRenderRoute();
  }

  window.naLabOpenClientAccount = function (clientId) {
    if (!labClientById(clientId)) return;
    labClientScreenState = { clientId:String(clientId), route:'home', categoryId:null, creditId:null, purchaseId:null };
    labRenderRoute();
  };

  window.naLabClientBack = function () {
    if (labClientScreenState.route === 'home') return labCloseScreen();
    if (labClientScreenState.route === 'purchase' || labClientScreenState.route === 'credit') {
      labClientScreenState.route = 'category'; labClientScreenState.creditId = null; labClientScreenState.purchaseId = null;
    } else if (labClientScreenState.route === 'creditHistory') {
      labClientScreenState.route = 'credit';
    } else {
      labClientScreenState.route = 'home'; labClientScreenState.categoryId = null; labClientScreenState.creditId = null;
    }
    labRenderRoute();
  };

  window.naLabOpenCreditCategory = function (categoryId) {
    labClientScreenState.route = 'category'; labClientScreenState.categoryId = String(categoryId || LAB_SMALL_ACCOUNT_ID);
    labRenderRoute();
  };
  window.naLabOpenSmallPurchase = function (creditId) {
    labClientScreenState.route = 'purchase'; labClientScreenState.purchaseId = String(creditId); labRenderRoute();
  };
  window.naLabOpenIndividualCredit = function (creditId) {
    var client = labClientById(labClientScreenState.clientId);
    var cr = client && labClientCredits(client.id).find(function (x) { return String(x.id) === String(creditId); });
    if (!cr) return;
    labClientScreenState.categoryId = labCreditAccountMeta(cr).categoryId;
    labClientScreenState.route = 'credit'; labClientScreenState.creditId = String(creditId); labRenderRoute();
  };
  window.naLabOpenCreditHistory = function (creditId) {
    labClientScreenState.route = 'creditHistory'; labClientScreenState.creditId = String(creditId); labRenderRoute();
  };
  window.naLabOpenClientPaymentHistory = function () { labClientScreenState.route = 'history'; labRenderRoute(); };
  window.naLabOpenCanceledCredits = function () { labClientScreenState.route = 'canceled'; labRenderRoute(); };
  window.naLabOpenCreditLine = function () { labClientScreenState.route = 'line'; labRenderRoute(); };
  window.naLabOpenClientBehavior = function () { labClientScreenState.route = 'behavior'; labRenderRoute(); };
  window.naLabToggleCreditInfo = function () {
    var node = document.getElementById('labV2CreditInfo'); if (node) node.hidden = !node.hidden;
  };

  function labBindClientCards() {
    var list = document.getElementById('cliList');
    if (!list) return;
    Array.from(list.querySelectorAll('.client-card')).forEach(function (card) {
      var panel = card.querySelector('.client-creds');
      var id = panel && /^cc-/.test(String(panel.id || '')) ? String(panel.id).replace(/^cc-/, '') : String(card.dataset && card.dataset.clientId || '');
      if (!id) return;
      card.dataset.labV2Ready = 'true';
      if (panel) { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
      var head = card.querySelector('.client-header') || card;
      if (!head.dataset.labV2Bound) {
        head.dataset.labV2Bound = 'true';
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.onclick = function (event) {
          event.preventDefault(); event.stopPropagation(); window.naLabOpenClientAccount(id);
        };
        head.onkeydown = function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.naLabOpenClientAccount(id); }
        };
      }
    });
  }

  function labRenderClientProfiles() {
    labBindClientCards();
    if (labClientScreenState.clientId && !labScreen()?.hidden) labRenderRoute();
  }
  function labOpenClientIds() { return []; }
  function labRestoreClientOpenState() {}

  function labSaleClient() {
    var id = document.getElementById('mCreditoCliente')?.value || '';
    return labClientById(id);
  }

  function labSelectedCategory(client) {
    var categories = client ? labCategoriesForClient(client) : [];
    var chosen = categories.find(function (cat) { return String(cat.id) === String(labSaleCreditState.categoryId); });
    return chosen || categories[0] || { id:LAB_SMALL_ACCOUNT_ID, name:LAB_SMALL_ACCOUNT_NAME, mode:'accumulated', builtin:true };
  }

  function labMonthlyDates(firstDate, count) {
    var base = firstDate ? new Date(String(firstDate).slice(0,10) + 'T12:00:00') : new Date();
    if (!Number.isFinite(base.getTime())) base = new Date();
    return Array.from({length:Math.max(1, Math.min(60, count))}, function (_, index) {
      var d = new Date(base.getTime());
      d.setMonth(d.getMonth() + index);
      return d.toISOString().slice(0,10);
    });
  }

  function labRenderInstallmentDates() {
    var wrap = document.getElementById('labCreditInstallmentDates');
    if (!wrap) return;
    var count = Math.max(1, Math.min(60, Number(document.getElementById('labCreditInstallmentCount')?.value) || 1));
    labSaleCreditState.installmentCount = count;
    var due = document.getElementById('mCreditoVence')?.value || '';
    var dates = labMonthlyDates(due, count);
    wrap.innerHTML = dates.map(function (date, index) {
      return '<label><span>Cuota ' + (index + 1) + '</span><input type="date" class="fi lab-credit-installment-date" data-installment-number="' + (index + 1) + '" value="' + labEsc(date) + '"></label>';
    }).join('');
  }

  function labSaleDestinationHtml(client) {
    if (!client) return '<div class="lab-credit-destination-empty">Selecciona primero el cliente del crédito.</div>';
    var categories = labCategoriesForClient(client), selected = labSelectedCategory(client);
    var radios = categories.map(function (cat) {
      return '<label class="lab-credit-destination-option ' + (String(cat.id) === String(selected.id) ? 'selected' : '') + '">' +
        '<input type="radio" name="labCreditDestination" value="' + labEsc(cat.id) + '" ' + (String(cat.id) === String(selected.id) ? 'checked' : '') + ' onchange="naLabSelectCreditDestination(\'' + labEsc(cat.id) + '\')">' +
        '<span><strong>' + labEsc(cat.name) + '</strong><small>' + (cat.id === LAB_SMALL_ACCOUNT_ID ? 'Predeterminado' : cat.mode === 'accumulated' ? 'Cuenta acumulada' : 'Créditos separados') + '</small></span></label>';
    }).join('');
    var installment = selected.mode === 'separate'
      ? '<div class="lab-credit-installment-config"><label><span>Número de cuotas</span><input id="labCreditInstallmentCount" class="fi" type="number" min="1" max="60" value="' + labSaleCreditState.installmentCount + '" oninput="naLabRefreshInstallmentDates()"></label><div id="labCreditInstallmentDates" class="lab-credit-installment-dates"></div></div>'
      : '';
    return '<div class="lab-credit-destination-title"><strong>¿Dónde registrar esta venta?</strong><small>Créditos pequeños está seleccionado por defecto.</small></div>' +
      '<div class="lab-credit-destination-options">' + radios + '</div>' +
      '<button type="button" class="lab-credit-new-category" onclick="naLabOpenNewCreditCategory()">+ Nueva categoría</button>' + installment;
  }

  function labEnsureSaleDestinationUi() {
    var section = document.getElementById('mCreditoSection');
    if (!section) return false;
    var wrap = section.querySelector('.lab-credit-destination');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'lab-credit-destination';
      section.appendChild(wrap);
    }
    var client = labSaleClient();
    var currentId = client ? String(client.id) : null;
    if (labSaleCreditState.clientId !== currentId) {
      labSaleCreditState = { clientId:currentId, categoryId:LAB_SMALL_ACCOUNT_ID, installmentCount:1 };
    }
    wrap.innerHTML = labSaleDestinationHtml(client);
    if (client && labSelectedCategory(client).mode === 'separate') requestAnimationFrame(labRenderInstallmentDates);
    return true;
  }

  window.naLabSelectCreditDestination = function (categoryId) {
    var client = labSaleClient(); if (!client) return;
    var exists = labCategoriesForClient(client).some(function (cat) { return String(cat.id) === String(categoryId); });
    labSaleCreditState.categoryId = exists ? String(categoryId) : LAB_SMALL_ACCOUNT_ID;
    labSaleCreditState.installmentCount = 1;
    labEnsureSaleDestinationUi();
  };
  window.naLabRefreshInstallmentDates = labRenderInstallmentDates;

  function labEnsureCategoryModal() {
    var modal = document.getElementById('labNewCreditCategoryModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'labNewCreditCategoryModal';
    modal.className = 'lab-credit-category-modal';
    modal.hidden = true;
    modal.innerHTML = '<div class="lab-credit-category-card"><div class="lab-credit-category-head"><h3>NUEVA CATEGORÍA</h3><button type="button" onclick="naLabCloseNewCreditCategory()" aria-label="Cerrar">×</button></div>' +
      '<label class="lab-credit-field"><span>Nombre</span><input id="labNewCreditCategoryName" class="fi" maxlength="60" placeholder="Tecnología"></label>' +
      '<fieldset><legend>Forma de manejo</legend>' +
        '<label><input type="radio" name="labNewCreditCategoryMode" value="separate" checked><span><strong>Créditos separados</strong><small>Cada operación conserva su propio crédito y cuotas.</small></span></label>' +
        '<label><input type="radio" name="labNewCreditCategoryMode" value="accumulated"><span><strong>Cuenta acumulada</strong><small>Varias ventas se muestran dentro de una misma cuenta.</small></span></label>' +
      '</fieldset><div class="lab-credit-category-actions"><button type="button" onclick="naLabCloseNewCreditCategory()">Cancelar</button><button type="button" class="primary" onclick="naLabCreateCreditCategory()">Crear y usar</button></div></div>';
    document.body.appendChild(modal);
    return modal;
  }

  window.naLabOpenNewCreditCategory = function () {
    var client = labSaleClient();
    if (!client) { if (typeof toast === 'function') toast('Selecciona primero el cliente del crédito','error'); return; }
    var modal = labEnsureCategoryModal(); modal.hidden = false;
    var input = document.getElementById('labNewCreditCategoryName'); if (input) { input.value=''; setTimeout(function(){ input.focus(); }, 30); }
  };
  window.naLabCloseNewCreditCategory = function () { var m=document.getElementById('labNewCreditCategoryModal'); if(m)m.hidden=true; };

  window.naLabCreateCreditCategory = async function () {
    var client = labSaleClient(); if (!client) return;
    var name = String(document.getElementById('labNewCreditCategoryName')?.value || '').trim().replace(/\s+/g,' ');
    if (!name) { if (typeof toast === 'function') toast('Escribe un nombre para la categoría','error'); return; }
    var duplicate = labCustomCategories(client).find(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
    if (duplicate) {
      labSaleCreditState.categoryId = duplicate.id;
      window.naLabCloseNewCreditCategory(); labEnsureSaleDestinationUi();
      if (typeof toast === 'function') toast('La categoría ya existía; se reutilizó.','success');
      return;
    }
    var mode = document.querySelector('input[name="labNewCreditCategoryMode"]:checked')?.value === 'accumulated' ? 'accumulated' : 'separate';
    var previous = Array.isArray(client.labCreditCategories) ? client.labCreditCategories.slice() : [];
    var id = 'labcat_' + Date.now().toString(36);
    client.labCreditCategories = previous.concat([{ id:id, name:name.slice(0,60), mode:mode, createdAt:new Date().toISOString() }]);
    var result = typeof saveAllData === 'function' ? await saveAllData() : { ok:true, durable:true };
    if (typeof _naWasPersisted === 'function' && !_naWasPersisted(result)) {
      client.labCreditCategories = previous;
      if (typeof toast === 'function') toast('No se pudo guardar la categoría en LAB','error');
      return;
    }
    labSaleCreditState.categoryId = id; labSaleCreditState.installmentCount = 1;
    window.naLabCloseNewCreditCategory(); labEnsureSaleDestinationUi();
    if (typeof toast === 'function') toast('Categoría creada y seleccionada','success');
  };

  function labReadInstallmentDraft() {
    var client = labSaleClient(), category = labSelectedCategory(client);
    if (!client || category.mode !== 'separate') return [];
    var inputs = Array.from(document.querySelectorAll('#labCreditInstallmentDates .lab-credit-installment-date'));
    var dates = inputs.map(function (input) { return String(input.value || '').slice(0,10); }).filter(Boolean);
    if (!dates.length) dates = labMonthlyDates(document.getElementById('mCreditoVence')?.value || '', labSaleCreditState.installmentCount);
    return dates.map(function (due,index) { return { number:index+1, due:due }; });
  }

  function labAnnotateNewCredit(beforeIds, clientId, category, installmentDraft) {
    var candidates = labClientCredits(clientId).filter(function (cr) { return !beforeIds.has(String(cr.id)); });
    if (!candidates.length) return null;
    candidates.sort(function (a,b) { return String(b.timestamp || '').localeCompare(String(a.timestamp || '')); });
    var cr = candidates[0];
    cr.labCreditAccount = {
      version:2,
      categoryId:category.id,
      categoryName:category.name,
      mode:category.mode,
      source:'sale',
      assignedAt:new Date().toISOString()
    };
    if (category.mode === 'separate') {
      var amounts = labSplitInstallmentAmounts(cr.monto, Math.max(1, installmentDraft.length));
      cr.labInstallments = (installmentDraft.length ? installmentDraft : [{number:1,due:cr.vence || ''}]).map(function (row,index) {
        return { number:index+1, due:String(row.due || cr.vence || '').slice(0,10), amount:(amounts[index] ?? amounts[0] ?? Number(cr.monto) ?? 0) };
      });
    } else {
      delete cr.labInstallments;
    }
    return cr;
  }

  function labInstallSaleHooks() {
    if (typeof abrirCobro === 'function' && !abrirCobro.__naLabCreditAccountsV2) {
      var baseOpen = abrirCobro;
      abrirCobro = function () {
        var out = baseOpen.apply(this, arguments);
        setTimeout(labEnsureSaleDestinationUi, 0);
        return out;
      };
      abrirCobro.__naLabCreditAccountsV2 = true;
    }
    if (typeof selPM === 'function' && !selPM.__naLabCreditAccountsV2) {
      var baseSelect = selPM;
      selPM = function () {
        var out = baseSelect.apply(this, arguments);
        if (typeof posPayM !== 'undefined' && posPayM === 'credito') setTimeout(labEnsureSaleDestinationUi, 0);
        return out;
      };
      selPM.__naLabCreditAccountsV2 = true;
    }
    if (typeof confirmarVenta === 'function' && !confirmarVenta.__naLabCreditAccountsV2) {
      var baseConfirm = confirmarVenta;
      confirmarVenta = async function () {
        var creditSale = typeof posPayM !== 'undefined' && posPayM === 'credito';
        if (!creditSale) return await baseConfirm.apply(this, arguments);
        var client = labSaleClient();
        var category = labSelectedCategory(client);
        var installmentDraft = labReadInstallmentDraft();
        var beforeIds = new Set((Array.isArray(creditos) ? creditos : []).map(function (cr) { return String(cr.id); }));
        var result = await baseConfirm.apply(this, arguments);
        if (!client) return result;
        var annotated = labAnnotateNewCredit(beforeIds, client.id, category, installmentDraft);
        if (annotated && typeof saveAllData === 'function') {
          try {
            var persisted = await saveAllData();
            if (typeof _naWasPersisted === 'function' && !_naWasPersisted(persisted) && typeof toast === 'function') {
              toast('La venta quedó registrada; la organización LAB usará Créditos pequeños hasta el próximo guardado.','error');
            }
          } catch (error) {
            console.warn('[NA-LAB] No se pudo persistir metadata de cuenta de crédito.', error && error.message || error);
          }
        }
        return result;
      };
      confirmarVenta.__naLabCreditAccountsV2 = true;
    }
  }

  function labAttachSaleClientListener() {
    var input = document.getElementById('mCreditoCliente');
    if (input && !input.dataset.labV2Bound) {
      input.dataset.labV2Bound = 'true';
      input.addEventListener('change', function () {
        labSaleCreditState = { clientId:String(input.value || ''), categoryId:LAB_SMALL_ACCOUNT_ID, installmentCount:1 };
        labEnsureSaleDestinationUi();
      });
    }
    var due = document.getElementById('mCreditoVence');
    if (due && !due.dataset.labV2Bound) {
      due.dataset.labV2Bound = 'true';
      due.addEventListener('change', function () {
        if (labSelectedCategory(labSaleClient()).mode === 'separate') labRenderInstallmentDates();
      });
    }
  }

  window.NA_LAB_CLIENT_CREDIT_ACCOUNTS_V2 = Object.freeze({
    smallAccountId:LAB_SMALL_ACCOUNT_ID,
    accountMeta:labCreditAccountMeta,
    categoriesForClient:labCategoriesForClient,
    creditsForCategory:labCreditsForCategory,
    categorySummary:labCategorySummary,
    installments:labInstallmentSummary,
    splitInstallmentAmounts:labSplitInstallmentAmounts,
    classifyClient:labClassifyClient,
    summarizeClient:labClientFinancialSummary,
    productSummary:labProductSummary,
    renderSaleDestination:labEnsureSaleDestinationUi,
    bindClientCards:labBindClientCards
  });
  // ===== FIN LAB ETAPA 02: CUENTAS Y CRÉDITOS POR CLIENTE V2 =====

  function labClientReducedMotion() {
    try { return !!window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  }

  function labClientEnter(page) {
    if (!page || labClientReducedMotion()) return;
    page.classList.remove('lab-client-refresh-out');
    page.classList.add('lab-client-refresh-in');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        page.classList.remove('lab-client-refresh-in');
      });
    });
  }

  function labClientRenderWrapper() {
    if (!originalCliRender) return undefined;
    var result = originalCliRender.apply(this, arguments);
    labRenderClientProfiles();
    if (!labClientMotionReady) {
      labClientMotionReady = true;
      labClientEnter(document.getElementById('pageClientes'));
    }
    return result;
  }
  labClientRenderWrapper.__naLabFinancialWrapper = true;

  function labEnsureClientRenderHook() {
    var current = (typeof cliRender === 'function') ? cliRender : null;
    if (!current) return false;

    if (current === labClientRenderWrapper || current.__naLabFinancialWrapper === true) {
      return true;
    }

    originalCliRender = current;
    cliRender = labClientRenderWrapper;

    // Si el render CANON ya ocurrió antes del enganche, mejora ese DOM ahora.
    labRenderClientProfiles(labOpenClientIds());
    return true;
  }

  function labClientProfilesNeedEnhancement() {
    var list = document.getElementById('cliList');
    if (!list) return false;
    return Array.from(list.querySelectorAll('.client-card')).some(function (card) {
      return card.dataset.labV2Ready !== 'true';
    });
  }

  function labScheduleClientProfileEnhancement() {
    if (labClientProfileEnhancing || labClientProfileRaf) return;
    labClientProfileRaf = requestAnimationFrame(function () {
      labClientProfileRaf = 0;
      labEnsureClientRenderHook();
      if (!labClientProfilesNeedEnhancement()) return;

      labClientProfileEnhancing = true;
      try {
        labRenderClientProfiles();
      } finally {
        labClientProfileEnhancing = false;
      }
    });
  }

  function labObserveClientProfileRenders() {
    var list = document.getElementById('cliList');
    if (!list || typeof MutationObserver !== 'function') return false;

    if (labClientProfileObserver) labClientProfileObserver.disconnect();
    labClientProfileObserver = new MutationObserver(function () {
      // _baseCliRender reconstruye las tarjetas. Si otro código reemplazó
      // cliRender, este ciclo vuelve a engancharlo y realza el DOM resultante.
      labScheduleClientProfileEnhancement();
    });
    labClientProfileObserver.observe(list, { childList:true, subtree:true });
    labScheduleClientProfileEnhancement();
    return true;
  }

  // Enganche inmediato + autocuración de renders tardíos/hidratación remota.
  labEnsureClientRenderHook();
  labObserveClientProfileRenders();
  labInstallSaleHooks();
  labAttachSaleClientListener();
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', function () {
      labEnsureClientRenderHook();
      labObserveClientProfileRenders();
      labInstallSaleHooks();
      labAttachSaleClientListener();
    });
    window.addEventListener('pageshow', function () {
      labEnsureClientRenderHook();
      labObserveClientProfileRenders();
    });
  }

  function clearRouteRestoreShield() {
    document.documentElement.classList.remove('lab-route-restoring');
    document.documentElement.removeAttribute('data-lab-restore-page');
  }

  var originalLoadAppState = (typeof loadAppState === 'function') ? loadAppState : null;
  if (originalLoadAppState) {
    loadAppState = function () {
      try {
        return originalLoadAppState.apply(this, arguments);
      } finally {
        clearRouteRestoreShield();
      }
    };
  } else {
    clearRouteRestoreShield();
  }

  console.info('[NA-LAB] Punto de extensión listo para funciones nuevas.');
})();
