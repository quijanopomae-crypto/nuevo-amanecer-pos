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


  // ===== LAB ETAPA 01: FICHA FINANCIERA DE CLIENTE =====
  // Capa de presentación exclusivamente LAB. Consume el modelo financiero vigente
  // y reutiliza sus acciones; no calcula ni persiste saldos, pagos, FIFO o línea.
  var labClientCreditView = Object.create(null);

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

  function labCreditStatusSync(cr) {
    if (typeof _naSyncCreditStatus === 'function') {
      try { _naSyncCreditStatus(cr); } catch {}
    }
    return String((cr && (cr.status || cr.estado)) || '').toLowerCase();
  }

  function labDueDays(cr) {
    if (!cr || !cr.vence) return null;
    if (typeof diasHasta === 'function') {
      var days = diasHasta(cr.vence);
      return Number.isFinite(days) ? days : null;
    }
    var due = new Date(String(cr.vence).slice(0, 10) + 'T23:59:59');
    if (!Number.isFinite(due.getTime())) return null;
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.ceil((due - today) / 86400000);
  }

  function labCreditBucket(cr) {
    var status = labCreditStatusSync(cr);
    var pending = labCreditPending(cr);
    if (cr && (cr.anulado || status === 'anulado' || status === 'cancelado' || pending <= 0.001)) return 'anteriores';
    var days = labDueDays(cr);
    if (days !== null && days < 0) return 'vencidos';
    if (days === 0) return 'hoy';
    if (days !== null && days > 0 && days <= 7) return 'proximos';
    return 'activos';
  }

  function labBucketWeight(bucket) {
    return ({ vencidos:0, hoy:1, proximos:2, activos:3, anteriores:4 })[bucket] ?? 5;
  }

  function labCreditSort(a, b) {
    var aw = labBucketWeight(labCreditBucket(a));
    var bw = labBucketWeight(labCreditBucket(b));
    if (aw !== bw) return aw - bw;
    var ad = labDueDays(a);
    var bd = labDueDays(b);
    if (ad === null && bd !== null) return 1;
    if (ad !== null && bd === null) return -1;
    if (ad !== null && bd !== null && ad !== bd) return ad - bd;
    return String(a && a.id || '').localeCompare(String(b && b.id || ''));
  }

  function labClientCredits(clientId) {
    return (Array.isArray(creditos) ? creditos : [])
      .filter(function (cr) { return String(cr && (cr.cliId ?? cr.clienteId)) === String(clientId); })
      .slice()
      .sort(labCreditSort);
  }

  function labCreditDueText(cr) {
    var days = labDueDays(cr);
    if (days === null) return cr && cr.vence ? String(cr.vence) : 'Sin fecha suficiente';
    if (days < 0) return 'Vencido hace ' + Math.abs(days) + (Math.abs(days) === 1 ? ' día' : ' días');
    if (days === 0) return 'Vence hoy';
    if (days === 1) return 'Vence mañana';
    if (days <= 7) return 'Vence en ' + days + ' días';
    return cr && cr.vence ? String(cr.vence) : '—';
  }

  function labCreditBucketMeta(bucket) {
    return ({
      vencidos:{ icon:'🔴', label:'VENCIDO', tone:'red' },
      hoy:{ icon:'🟠', label:'VENCE HOY', tone:'orange' },
      proximos:{ icon:'🟡', label:'PRÓXIMO', tone:'amber' },
      activos:{ icon:'🟢', label:'VIGENTE', tone:'teal' },
      anteriores:{ icon:'✓', label:'CERRADO', tone:'green' }
    })[bucket] || { icon:'•', label:'SIN ESTADO', tone:'slate' };
  }

  function labClientSummary(client) {
    var all = labClientCredits(client.id);
    var active = all.filter(function (cr) { return labCreditBucket(cr) !== 'anteriores'; });
    var debt = active.reduce(function (sum, cr) { return sum + labCreditPending(cr); }, 0);
    var overdue = active.filter(function (cr) { return labCreditBucket(cr) === 'vencidos'; })
      .reduce(function (sum, cr) { return sum + labCreditPending(cr); }, 0);
    var nextFuture = active
      .filter(function (cr) {
        var days = labDueDays(cr);
        return days !== null && days >= 0;
      })
      .sort(function (a, b) { return labDueDays(a) - labDueDays(b); })[0] || null;
    var urgent = active.slice().sort(labCreditSort)[0] || null;
    var evaluation = null;
    if (typeof _naEvaluateClientCredit === 'function') {
      try { evaluation = _naEvaluateClientCredit(client.id); } catch {}
    }
    return {
      all: all,
      active: active,
      closed: all.filter(function (cr) { return labCreditBucket(cr) === 'anteriores'; }),
      debt: Number(debt.toFixed(2)),
      overdue: Number(overdue.toFixed(2)),
      nextFuture: nextFuture,
      urgent: urgent,
      evaluation: evaluation
    };
  }

  function labLineReason(evaluation) {
    if (!evaluation || !evaluation.exists) return 'Sin datos suficientes para explicar la evaluación.';
    if (typeof _naCreditRequirementText === 'function') {
      try { return _naCreditRequirementText(evaluation); } catch {}
    }
    if (evaluation.manualActive) return 'Excepción manual registrada.';
    if (!evaluation.enabled) return 'La política de créditos está desactivada.';
    return evaluation.eligible ? 'Cumple la evaluación de crédito vigente.' : 'Todavía no cumple la evaluación de crédito vigente.';
  }

  function labLineState(evaluation) {
    if (!evaluation || !evaluation.exists) return 'SIN DATOS SUFICIENTES';
    if (!evaluation.enabled) return 'CRÉDITOS DESACTIVADOS';
    if (evaluation.manualActive) return 'EXCEPCIÓN MANUAL';
    if (evaluation.eligible) return 'ACTIVA';
    return 'AÚN NO CALIFICA';
  }

  function labLineValue(evaluation, field) {
    if (!evaluation || !evaluation.exists) return null;
    var value = evaluation[field];
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function labNextInstallment(cr) {
    var candidates = [
      cr && cr.proximaCuotaMonto,
      cr && cr.cuotaPendiente,
      cr && cr.nextInstallmentAmount
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var value = Number(candidates[i]);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return null;
  }

  function labPaymentStatus(pay) {
    if (!pay) return '—';
    if (String(pay.status || '').toUpperCase() === 'REVERTED' || pay.reversalId) return 'REVERTIDO';
    return String(pay.status || 'REGISTRADO').toUpperCase();
  }

  function labPaymentHtml(pay, cr) {
    var method = (typeof _NA_CREDIT_METHOD_LABELS !== 'undefined' && _NA_CREDIT_METHOD_LABELS[pay.metodo])
      ? _NA_CREDIT_METHOD_LABELS[pay.metodo]
      : (pay.metodo || '—');
    var operation = pay.operacion || pay.numeroOperacion || pay.referencia || '—';
    var date = pay.fecha || '—';
    var time = pay.hora24 || pay.hora || '—';
    var cashier = pay.cajeroNombre || pay.cajero || '—';
    return '<div class="lab-fin-payment">' +
      '<div class="lab-fin-payment-head"><strong>' + labEsc(pay.pagoId || pay.id || 'Pago sin ID') + '</strong><span>' + labMoney(pay.monto ?? pay.montoPagado) + '</span></div>' +
      '<div class="lab-fin-payment-grid">' +
        '<span>Fecha</span><b>' + labEsc(date) + ' · ' + labEsc(time) + '</b>' +
        '<span>Método</span><b>' + labEsc(method) + '</b>' +
        '<span>Cajero</span><b>' + labEsc(cashier) + '</b>' +
        '<span>Saldo</span><b>' + labMoney(pay.saldoAnterior) + ' → ' + labMoney(pay.saldoActual) + '</b>' +
        '<span>Crédito</span><b>' + labEsc((cr && (cr.desc || cr.id)) || '—') + '</b>' +
        '<span>Operación</span><b>' + labEsc(operation) + '</b>' +
        '<span>Estado</span><b>' + labEsc(labPaymentStatus(pay)) + '</b>' +
      '</div>' +
      (pay.reversalId ? '<div class="lab-fin-payment-reversal">Reversión: ' + labEsc(pay.reversalId) + (pay.reversalReason ? ' · ' + labEsc(pay.reversalReason) : '') + '</div>' : '') +
    '</div>';
  }

  function labAllPaymentsHtml(summary) {
    var rows = [];
    summary.all.forEach(function (cr) {
      (Array.isArray(cr.pagos) ? cr.pagos : []).forEach(function (pay) {
        rows.push({ pay:pay, cr:cr });
      });
    });
    rows.sort(function (a, b) {
      var at = a.pay && a.pay.timestamp ? new Date(a.pay.timestamp).getTime() : 0;
      var bt = b.pay && b.pay.timestamp ? new Date(b.pay.timestamp).getTime() : 0;
      return bt - at;
    });
    if (!rows.length) return '<div class="lab-fin-empty">Todavía no hay pagos registrados.</div>';
    return rows.map(function (row) { return labPaymentHtml(row.pay, row.cr); }).join('');
  }

  function labCreditCardHtml(cr) {
    var bucket = labCreditBucket(cr);
    var meta = labCreditBucketMeta(bucket);
    var original = Number(cr && cr.monto);
    var paid = Number(cr && cr.pagado);
    var pending = labCreditPending(cr);
    var pct = Number.isFinite(original) && original > 0 ? Math.min(100, Math.max(0, (Number.isFinite(paid) ? paid : 0) / original * 100)) : 0;
    var installment = labNextInstallment(cr);
    var paymentAllowed = bucket !== 'anteriores' && !cr.anulado && pending > 0.001;
    return '<article class="lab-fin-credit lab-fin-tone-' + meta.tone + '" data-lab-credit-bucket="' + bucket + '">' +
      '<div class="lab-fin-credit-head"><div><span class="lab-fin-state lab-fin-state-' + meta.tone + '">' + meta.icon + ' ' + meta.label + '</span>' +
      '<h5>' + labEsc(cr.desc || cr.tipo || 'Crédito') + '</h5></div><strong class="lab-fin-credit-pending">' + labMoney(pending) + '<small>PENDIENTE</small></strong></div>' +
      '<div class="lab-fin-credit-metrics">' +
        '<div><span>Original</span><b>' + labMoney(Number.isFinite(original) ? original : null) + '</b></div>' +
        '<div><span>Pagado</span><b>' + labMoney(Number.isFinite(paid) ? paid : null) + '</b></div>' +
        '<div class="priority"><span>Pendiente</span><b>' + labMoney(pending) + '</b></div>' +
      '</div>' +
      '<div class="lab-fin-progress" aria-label="' + pct.toFixed(0) + '% pagado"><span style="width:' + pct.toFixed(0) + '%"></span></div>' +
      '<div class="lab-fin-progress-label">' + pct.toFixed(0) + '% pagado</div>' +
      '<div class="lab-fin-credit-due"><span>' + labEsc(labCreditDueText(cr)) + '</span><span>' + (cr.vence ? 'Vence: ' + labEsc(cr.vence) : 'Fecha: —') + '</span></div>' +
      '<div class="lab-fin-installment"><span>Próxima cuota</span><b>' + (installment === null ? '—' : labMoney(installment)) + '</b></div>' +
      '<div class="lab-fin-credit-actions">' +
        (paymentAllowed ? '<button type="button" class="lab-fin-btn primary" onclick="abrirPago(\'' + labEsc(String(cr.id)) + '\')">Registrar pago</button>' : '') +
        '<button type="button" class="lab-fin-btn ghost" onclick="abrirDetalleCredito(\'' + labEsc(String(cr.id)) + '\')">Historial</button>' +
      '</div>' +
    '</article>';
  }

  function labCreditViewHtml(client, summary) {
    var view = labClientCreditView[String(client.id)] || 'vencidos';
    var counts = {
      vencidos: summary.active.filter(function (cr) { return labCreditBucket(cr) === 'vencidos'; }).length,
      hoy: summary.active.filter(function (cr) { return labCreditBucket(cr) === 'hoy'; }).length,
      proximos: summary.active.filter(function (cr) { return labCreditBucket(cr) === 'proximos'; }).length,
      activos: summary.active.filter(function (cr) { return labCreditBucket(cr) === 'activos'; }).length,
      anteriores: summary.closed.length
    };
    if (!counts[view] && view !== 'activos') {
      view = counts.vencidos ? 'vencidos' : counts.hoy ? 'hoy' : counts.proximos ? 'proximos' : counts.activos ? 'activos' : 'anteriores';
      labClientCreditView[String(client.id)] = view;
    }
    var source = view === 'anteriores' ? summary.closed : summary.active.filter(function (cr) { return labCreditBucket(cr) === view; });
    var labels = { vencidos:'Vencidos', hoy:'Hoy', proximos:'Próximos', activos:'Vigentes', anteriores:'Anteriores' };
    var tabs = ['vencidos','hoy','proximos','activos','anteriores'].map(function (key) {
      return '<button type="button" class="lab-fin-tab ' + (view === key ? 'active' : '') + '" onclick="naLabClientFinancialSetView(\'' + labEsc(String(client.id)) + '\',\'' + key + '\')">' +
        labels[key] + '<span>' + counts[key] + '</span></button>';
    }).join('');
    return '<section class="lab-fin-section lab-fin-credits-section"><div class="lab-fin-section-title"><span>CRÉDITOS</span><button type="button" class="lab-fin-link" onclick="abrirCred(\'' + labEsc(String(client.id)) + '\')">+ Nuevo crédito</button></div>' +
      '<div class="lab-fin-tabs">' + tabs + '</div>' +
      '<div class="lab-fin-credit-list">' + (source.length ? source.map(labCreditCardHtml).join('') : '<div class="lab-fin-empty">Sin créditos en esta categoría.</div>') + '</div></section>';
  }

  function labUrgentActionHtml(summary) {
    var cr = summary.urgent;
    if (!cr) {
      return '<section class="lab-fin-section"><div class="lab-fin-section-title">PRÓXIMA ACCIÓN</div><div class="lab-fin-action lab-fin-action-green"><div><span class="lab-fin-state lab-fin-state-green">🟢 AL DÍA</span><h4>Sin cobros pendientes</h4><p>No hay créditos activos que requieran atención.</p></div></div></section>';
    }
    var bucket = labCreditBucket(cr);
    var meta = labCreditBucketMeta(bucket);
    var pending = labCreditPending(cr);
    var days = labDueDays(cr);
    var actionText = bucket === 'vencidos'
      ? 'Cobrar ' + labMoney(pending) + ' — ' + labCreditDueText(cr).toLowerCase()
      : bucket === 'hoy'
        ? 'Cobrar ' + labMoney(pending) + ' hoy'
        : days === null
          ? 'Revisar saldo ' + labMoney(pending) + ' — sin fecha suficiente'
          : 'Próximo cobro ' + labMoney(pending) + (cr.vence ? ' — ' + cr.vence : '');
    return '<section class="lab-fin-section"><div class="lab-fin-section-title">PRÓXIMA ACCIÓN</div>' +
      '<div class="lab-fin-action lab-fin-action-' + meta.tone + '">' +
        '<div class="lab-fin-action-main"><span class="lab-fin-state lab-fin-state-' + meta.tone + '">' + meta.icon + ' ' + meta.label + '</span>' +
          '<h4>' + labEsc(actionText) + '</h4><p>' + labEsc(cr.desc || 'Crédito') + ' · ' + labEsc(labCreditDueText(cr)) + '</p></div>' +
        '<div class="lab-fin-action-buttons"><button type="button" class="lab-fin-btn primary" onclick="abrirPago(\'' + labEsc(String(cr.id)) + '\')">Registrar pago</button>' +
        '<button type="button" class="lab-fin-btn ghost" onclick="abrirDetalleCredito(\'' + labEsc(String(cr.id)) + '\')">Ver detalle</button></div>' +
      '</div></section>';
  }

  function labLineHtml(client, summary) {
    var e = summary.evaluation;
    var approved = labLineValue(e, 'assignedLine');
    var used = e && e.history && Number.isFinite(Number(e.history.debt)) ? Number(e.history.debt) : (summary.active.length ? summary.debt : 0);
    var available = labLineValue(e, 'available');
    var suggested = labLineValue(e, 'automaticLine');
    return '<section class="lab-fin-section"><div class="lab-fin-section-title">LÍNEA DE CRÉDITO</div>' +
      '<div class="lab-fin-line">' +
        '<div class="lab-fin-line-grid"><div><span>Aprobado</span><b>' + labMoney(approved) + '</b></div><div><span>Utilizado</span><b>' + labMoney(used) + '</b></div><div class="wide"><span>Disponible</span><b class="available">' + labMoney(available) + '</b></div>' +
        '<div><span>Sugerido</span><b>' + labMoney(suggested) + '</b></div><div><span>Estado</span><b>' + labEsc(labLineState(e)) + '</b></div></div>' +
        '<div class="lab-fin-line-reason"><span>Motivo</span><p>' + labEsc(labLineReason(e)) + '</p></div>' +
        (typeof abrirEvaluacionCredito === 'function' ? '<button type="button" class="lab-fin-btn ghost full" onclick="abrirEvaluacionCredito(\'' + labEsc(String(client.id)) + '\')">Ver evaluación</button>' : '') +
      '</div></section>';
  }

  function labClosedCreditsHtml(summary) {
    if (!summary.closed.length) return '<div class="lab-fin-empty">No hay créditos cerrados.</div>';
    return summary.closed.map(function (cr) {
      var original = Number(cr.monto);
      var paid = Number(cr.pagado);
      return '<div class="lab-fin-closed-row"><div><strong>' + labEsc(cr.desc || 'Crédito') + '</strong><span>' + labEsc(cr.fecha || 'Fecha de apertura no registrada') + (cr.vence ? ' · vencía ' + labEsc(cr.vence) : '') + '</span></div><div><b>' + labMoney(Number.isFinite(original) ? original : null) + '</b><span>Pagado ' + labMoney(Number.isFinite(paid) ? paid : null) + '</span></div></div>';
    }).join('');
  }

  function labBehaviorHtml(summary) {
    var e = summary.evaluation;
    if (!e || !e.exists) return '<div class="lab-fin-empty">Sin datos suficientes para evaluar comportamiento.</div>';
    var history = e.history || {};
    var behavior = typeof _naCreditBehaviorLabel === 'function' ? _naCreditBehaviorLabel(history.behavior) : (history.behavior || 'Sin historial');
    return '<div class="lab-fin-behavior-grid"><div><span>Comportamiento</span><b>' + labEsc(behavior) + '</b></div><div><span>Créditos registrados</span><b>' + labEsc(String(history.total ?? summary.all.length)) + '</b></div><div><span>Puntuales</span><b>' + labEsc(String(history.punctual ?? '—')) + '</b></div><div><span>Tardíos / vencidos</span><b>' + labEsc(String(history.late ?? '—')) + '</b></div></div>';
  }

  function labProfileHtml(client) {
    var summary = labClientSummary(client);
    var next = summary.nextFuture;
    var clientStatus = summary.active.length ? 'Cliente activo' : 'Sin deuda activa';
    var doc = client.dni || 'Sin documento';
    var phone = client.tel ? ' · ' + client.tel : '';
    var nextValue = next ? labCreditPending(next) : null;
    var nextDate = next ? labCreditDueText(next) : 'Sin próximo vencimiento';
    return '<div class="lab-fin-profile" data-lab-fin-client="' + labEsc(String(client.id)) + '">' +
      '<section class="lab-fin-identity"><div><h3>' + labEsc(client.nombre || 'Cliente') + '</h3><p>' + labEsc(doc) + labEsc(phone) + '</p><span>' + labEsc(clientStatus) + '</span></div>' +
      '<button type="button" class="lab-fin-more" onclick="abrirEvaluacionCredito(\'' + labEsc(String(client.id)) + '\')" aria-label="Ver evaluación">⋮</button></section>' +
      '<section class="lab-fin-section"><div class="lab-fin-section-title">SITUACIÓN ACTUAL</div><div class="lab-fin-kpis">' +
        '<div><span>DEUDA TOTAL</span><b>' + labMoney(summary.debt) + '</b></div>' +
        '<div class="' + (summary.overdue > 0 ? 'danger' : '') + '"><span>VENCIDO</span><b>' + labMoney(summary.overdue) + '</b></div>' +
        '<div><span>PRÓXIMO PAGO</span><b>' + labMoney(nextValue) + '</b><small>' + labEsc(nextDate) + '</small></div>' +
        '<div><span>CRÉDITOS</span><b>' + summary.active.length + ' activos</b></div>' +
      '</div></section>' +
      labUrgentActionHtml(summary) +
      labLineHtml(client, summary) +
      labCreditViewHtml(client, summary) +
      '<section class="lab-fin-folds">' +
        '<details><summary>Historial de pagos <span>' + summary.all.reduce(function (n, cr) { return n + (Array.isArray(cr.pagos) ? cr.pagos.length : 0); }, 0) + '</span></summary><div class="lab-fin-fold-body">' + labAllPaymentsHtml(summary) + '</div></details>' +
        '<details><summary>Créditos cerrados <span>' + summary.closed.length + '</span></summary><div class="lab-fin-fold-body">' + labClosedCreditsHtml(summary) + '</div></details>' +
        '<details><summary>Comportamiento del cliente</summary><div class="lab-fin-fold-body">' + labBehaviorHtml(summary) + '</div></details>' +
      '</section>' +
    '</div>';
  }

  function labClientIdForPanel(panel) {
    if (!panel) return '';
    var legacyId = String(panel.id || '');
    if (/^cc-/.test(legacyId)) return legacyId.replace(/^cc-/, '');
    var card = panel.closest ? panel.closest('.client-card[data-client-id]') : null;
    return card && card.dataset ? String(card.dataset.clientId || '') : '';
  }

  function labClientPanelForId(clientId) {
    var legacy = document.getElementById('cc-' + clientId);
    if (legacy) return legacy;
    var cards = document.querySelectorAll('#pageClientes .client-card[data-client-id]');
    for (var i = 0; i < cards.length; i += 1) {
      if (String(cards[i].dataset.clientId || '') === String(clientId)) {
        return cards[i].querySelector('.client-creds');
      }
    }
    return null;
  }

  function labOpenClientIds() {
    return Array.from(document.querySelectorAll('#pageClientes .client-creds.open'))
      .map(labClientIdForPanel)
      .filter(Boolean);
  }

  function labRestoreClientOpenState(ids) {
    ids.forEach(function (id) {
      var node = labClientPanelForId(id);
      if (node) node.classList.add('open');
    });
  }

  function labRenderClientProfiles(openIds) {
    var list = document.getElementById('cliList');
    if (!list || !Array.isArray(clientes)) return;
    Array.from(list.querySelectorAll('.client-creds')).forEach(function (panel) {
      var clientId = labClientIdForPanel(panel);
      var client = clientes.find(function (item) { return String(item.id) === String(clientId); });
      if (!client) return;
      panel.innerHTML = labProfileHtml(client);
    });
    labRestoreClientOpenState(openIds || []);
  }

  window.naLabClientFinancialSetView = function (clientId, view) {
    if (!['vencidos','hoy','proximos','activos','anteriores'].includes(view)) return;
    labClientCreditView[String(clientId)] = view;
    var panel = labClientPanelForId(clientId);
    var client = Array.isArray(clientes) ? clientes.find(function (item) { return String(item.id) === String(clientId); }) : null;
    if (panel && client) panel.innerHTML = labProfileHtml(client);
  };

  window.NA_LAB_CLIENT_FINANCIAL_PROFILE = Object.freeze({
    classifyCredit: labCreditBucket,
    sortCredits: function (rows) { return (Array.isArray(rows) ? rows.slice() : []).sort(labCreditSort); },
    summarizeClient: labClientSummary,
    ensureRenderHook: labEnsureClientRenderHook
  });
  // ===== FIN LAB ETAPA 01: FICHA FINANCIERA DE CLIENTE =====

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
    var context = this;
    var args = arguments;
    var page = document.getElementById('pageClientes');
    var active = !!(page && page.classList.contains('active'));
    var openIds = labOpenClientIds();

    if (!active || labClientReducedMotion()) {
      var immediateResult = originalCliRender.apply(context, args);
      labRenderClientProfiles(openIds);
      return immediateResult;
    }

    // Primera pintura: datos inmediatos, solo una entrada suave.
    if (!labClientMotionReady) {
      labClientMotionReady = true;
      var firstResult = originalCliRender.apply(context, args);
      labRenderClientProfiles(openIds);
      labClientEnter(page);
      return firstResult;
    }

    // Refrescos siguientes: la vista se desplaza lentamente sin desaparecer.
    // El DOM se actualiza casi al final de la salida y luego vuelve desde la
    // misma posición; no existe salto instantáneo de -Y a +Y.
    clearTimeout(labClientMotionTimer);
    page.classList.remove('lab-client-refresh-in');
    page.classList.add('lab-client-refresh-out');

    labClientMotionTimer = setTimeout(function () {
      originalCliRender.apply(context, args);
      labRenderClientProfiles(openIds);
      requestAnimationFrame(function () {
        page.classList.remove('lab-client-refresh-out');
      });
    }, 850);
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
    return Array.from(list.querySelectorAll('.client-creds')).some(function (panel) {
      return !!labClientIdForPanel(panel) && !panel.querySelector('.lab-fin-profile');
    });
  }

  function labScheduleClientProfileEnhancement() {
    if (labClientProfileEnhancing || labClientProfileRaf) return;
    labClientProfileRaf = requestAnimationFrame(function () {
      labClientProfileRaf = 0;
      labEnsureClientRenderHook();
      if (!labClientProfilesNeedEnhancement()) return;

      var openIds = labOpenClientIds();
      labClientProfileEnhancing = true;
      try {
        labRenderClientProfiles(openIds);
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
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('load', function () {
      labEnsureClientRenderHook();
      labObserveClientProfileRenders();
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
