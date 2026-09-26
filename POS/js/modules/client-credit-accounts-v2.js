/*
 * Nuevo Amanecer CANON — Ficha Financiera / Cuentas y Créditos V2.
 * Promoción selectiva del comportamiento aprobado en POS-LAB.
 * El ledger, pagos, FIFO, Caja, saldos y evaluación financiera existentes
 * continúan siendo la única autoridad financiera.
 */
(function (root) {
  'use strict';
// ===== CANON: CUENTAS Y CRÉDITOS POR CLIENTE V2 =====
  // CANON. El ledger financiero sigue siendo el existente; esta capa añade
  // organización, navegación y metadata opcional sin duplicar pagos/caja/FIFO.
  var NA_SMALL_ACCOUNT_ID = 'small';
  var NA_SMALL_ACCOUNT_NAME = 'Créditos pequeños';
  var labClientScreenState = { clientId:null, route:'home', categoryId:null, creditId:null, purchaseId:null };
  var labSaleCreditState = { clientId:null, categoryId:NA_SMALL_ACCOUNT_ID, installmentCount:1 };

  function labEsc(value) {
    if (typeof _naEsc === 'function') return _naEsc(String(value ?? ''));
    return String(value ?? '').replace(/[&<>"']/g, function (char) {
      return ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char];
    });
  }

  function labClientDisplayName(client) {
    return String(client && client.nombre || 'Cliente').toUpperCase();
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
    if (!id || id === NA_SMALL_ACCOUNT_ID) return null;
    return { id:id, name:name.slice(0, 60), mode:mode, createdAt:raw.createdAt || null };
  }

  function labCustomCategories(client) {
    var seen = new Set();
    return (Array.isArray(client && client.creditCategories) ? client.creditCategories : [])
      .map(labNormalizeCategory)
      .filter(function (cat) {
        if (!cat || seen.has(cat.id)) return false;
        seen.add(cat.id);
        return true;
      });
  }

  function creditAccountMeta(cr) {
    var raw = cr && cr.creditAccount;
    if (raw && typeof raw === 'object' && raw.categoryId && raw.categoryId !== NA_SMALL_ACCOUNT_ID) {
      return {
        categoryId:String(raw.categoryId),
        categoryName:String(raw.categoryName || 'Categoría').slice(0, 60),
        mode:raw.mode === 'accumulated' ? 'accumulated' : 'separate',
        source:raw.source || 'legacy'
      };
    }
    return { categoryId:NA_SMALL_ACCOUNT_ID, categoryName:NA_SMALL_ACCOUNT_NAME, mode:'accumulated', source:'default' };
  }

  function labCategoriesForClient(client) {
    var result = [{ id:NA_SMALL_ACCOUNT_ID, name:NA_SMALL_ACCOUNT_NAME, mode:'accumulated', builtin:true }];
    var seen = new Set([NA_SMALL_ACCOUNT_ID]);
    labCustomCategories(client).forEach(function (cat) {
      if (!seen.has(cat.id)) { seen.add(cat.id); result.push(cat); }
    });
    labClientCredits(client && client.id).forEach(function (cr) {
      var meta = creditAccountMeta(cr);
      if (meta.categoryId !== NA_SMALL_ACCOUNT_ID && !seen.has(meta.categoryId)) {
        seen.add(meta.categoryId);
        result.push({ id:meta.categoryId, name:meta.categoryName, mode:meta.mode, recovered:true });
      }
    });
    return result;
  }

  function labCreditsForCategory(clientId, categoryId) {
    return labClientCredits(clientId).filter(function (cr) {
      return creditAccountMeta(cr).categoryId === String(categoryId || NA_SMALL_ACCOUNT_ID);
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
    var raw = labInstallmentRawPlan(cr);
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
        visualDerived:!!(item && item.visualDerived),
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
    var punctual = Number(h.punctual || 0);
    var late = Number(h.late || 0);
    var completed = Number(h.completed || 0);
    var partial = Number(h.partial || 0);
    var overdueActive = Number(h.overdueActive || 0);
    var behavior = String(h.behavior || '').toLowerCase();
    var hasBehaviorHistory = punctual > 0 || late > 0 || completed > 0 || partial > 0;
    var label = 'NUEVO', tone = 'slate', reasons = [];

    if (summary.overdueDebt > 0.001 || overdueActive > 0 || behavior === 'impuntual') {
      label = 'PELIGRO'; tone = 'red';
      if (summary.overdueDebt > 0.001 || overdueActive > 0) reasons.push('Mantiene deuda vencida o mora activa');
      if (late > 0 || behavior === 'impuntual') reasons.push('Registra pagos tardíos o comportamiento impuntual');
    } else if (e.eligible === false) {
      label = 'SIN REQUISITOS'; tone = 'slate';
      reasons.push('No cumple actualmente los requisitos de la evaluación financiera vigente');
      reasons.push('Sin deuda vencida activa');
    } else if (!hasBehaviorHistory || behavior === 'sin_historial') {
      label = 'NUEVO'; tone = 'slate';
      reasons.push('Historial financiero insuficiente para clasificar su comportamiento');
      reasons.push('Aún no hay pagos suficientes para asignar una categoría de comportamiento');
    } else if (punctual > 0 && late === 0) {
      label = 'ESTABLE'; tone = 'green';
      reasons.push('Pagos registrados mayormente puntuales');
      reasons.push('Sin deuda vencida actual');
      if (completed > 0) reasons.push('Tiene créditos finalizados');
    } else {
      label = 'REGULAR'; tone = 'amber';
      if (late > 0 || behavior === 'irregular') reasons.push('El historial incluye atrasos o comportamiento irregular');
      else reasons.push('El historial financiero está todavía en evaluación');
      reasons.push('Sin deuda vencida activa');
    }
    return { label:label, tone:tone, reasons:reasons, summary:summary };
  }

  function labProductSummary(cr) {
    var items = Array.isArray(cr && cr.items) ? cr.items : [];
    if (!items.length) return String(cr && cr.desc || 'Compra a crédito');
    var first = items[0] && (items[0].nombre || items[0].name) || 'Producto';
    return items.length > 1 ? first + ' + ' + (items.length - 1) + (items.length - 1 === 1 ? ' producto' : ' productos') : first;
  }

  function labCategoryVisual(category) {
    var name = String(category && category.name || '').toLowerCase();
    if (String(category && category.id || '') === NA_SMALL_ACCOUNT_ID) return { tone:'teal', icon:'🧾' };
    if (/tecnolog|celular|equipo|electr/.test(name)) return { tone:'blue', icon:'📱' };
    if (/pr[eé]stamo|dinero|efectivo/.test(name)) return { tone:'amber', icon:'S/' };
    return { tone:'slate', icon:'◈' };
  }

  function labNavRow(icon, tone, title, subtitle, action) {
    var behaviorClass = title === 'COMPORTAMIENTO' ? ' na-v2-behavior-nav' : '';
    return '<button type="button" class="na-v2-row na-v2-nav-card na-v2-tone-' + labEsc(tone) + behaviorClass + '" onclick="' + action + '">' +
      '<span class="na-v2-row-main"><span class="na-v2-module-icon" aria-hidden="true">' + labEsc(icon) + '</span>' +
      '<span class="na-v2-row-copy"><strong>' + labEsc(title) + '</strong><small>' + labEsc(subtitle) + '</small></span></span><b>›</b></button>';
  }

  function labDisplayDate(value) {
    var iso = String(value || '').slice(0,10);
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    return match ? match[3] + '/' + match[2] + '/' + match[1] : (iso || 'Fecha no registrada');
  }

  function labTodayIso() {
    var now = new Date();
    var y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2,'0'), d = String(now.getDate()).padStart(2,'0');
    return y + '-' + m + '-' + d;
  }

  function labInstallmentVisualState(item, nextPendingNumber, todayIso) {
    if (item && item.paid) return { key:'paid', label:'Pagada', next:false };
    var due = String(item && item.due || '').slice(0,10);
    var today = todayIso || labTodayIso();
    var isNext = Number(item && item.number) === Number(nextPendingNumber);
    if (due && /^\d{4}-\d{2}-\d{2}$/.test(due) && due < today) return { key:'overdue', label:'Vencida', next:isNext };
    if (due && due === today) return { key:'today', label:'Hoy', next:isNext };
    if (isNext) return { key:'next', label:'Próxima', next:true };
    return { key:'pending', label:'Pendiente', next:false };
  }

  function labDescriptionInstallmentHint(cr) {
    var text = String(cr && cr.desc || '').trim();
    if (!text) return { count:null, amount:null, firstDue:'', dueDay:null };
    var countMatch = /(\d{1,2})\s+cuotas?\s+mensuales?/i.exec(text);
    var amountMatch = /cuotas?\s+mensuales?\s+de\s+S\/\s*([\d.,]+)/i.exec(text);
    var dateMatch = /desde\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
    var isoMatch = /desde\s+(\d{4})-(\d{2})-(\d{2})/i.exec(text);
    var dayMatch = /cada\s+d[ií]a\s+(\d{1,2})/i.exec(text);
    var amount = null;
    if (amountMatch) {
      var rawAmount = String(amountMatch[1] || '').trim();
      if (rawAmount.includes('.') && rawAmount.includes(',')) rawAmount = rawAmount.replace(/,/g,'');
      else if (!rawAmount.includes('.') && rawAmount.includes(',')) rawAmount = rawAmount.replace(',','.');
      amount = Number(rawAmount);
      if (!Number.isFinite(amount) || amount <= 0) amount = null;
    }
    var firstDue = '';
    if (dateMatch) {
      firstDue = dateMatch[3] + '-' + String(dateMatch[2]).padStart(2,'0') + '-' + String(dateMatch[1]).padStart(2,'0');
    } else if (isoMatch) {
      firstDue = isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3];
    }
    var count = countMatch ? Math.floor(Number(countMatch[1])) : null;
    if (!Number.isFinite(count) || count < 2 || count > 60) count = null;
    var dueDay = dayMatch ? Math.floor(Number(dayMatch[1])) : null;
    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) dueDay = null;
    return { count:count, amount:amount, firstDue:firstDue, dueDay:dueDay };
  }

  function labInstallmentCountHint(cr) {
    var candidates = [
      cr && cr.labInstallmentCount,
      cr && cr.installmentCount,
      cr && cr.numeroCuotas,
      cr && cr.cantidadCuotas,
      cr && cr.cuotasTotal,
      cr && cr.nroCuotas,
      cr && (typeof cr.cuotas === 'number' ? cr.cuotas : null)
    ];
    for (var i = 0; i < candidates.length; i += 1) {
      var count = Math.floor(Number(candidates[i]));
      if (Number.isFinite(count) && count > 1 && count <= 60) return count;
    }
    return labDescriptionInstallmentHint(cr).count || 1;
  }

  function labFirstInstallmentDue(cr) {
    var direct = [
      cr && cr.primerVencimiento,
      cr && cr.fechaPrimeraCuota,
      cr && cr.firstDue,
      cr && cr.firstInstallmentDate
    ];
    for (var i = 0; i < direct.length; i += 1) {
      var value = String(direct[i] || '').slice(0,10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    }
    var descHint = labDescriptionInstallmentHint(cr);
    if (/^\d{4}-\d{2}-\d{2}$/.test(descHint.firstDue || '')) return descHint.firstDue;
    var legacyDue = String(cr && cr.vence || '').slice(0,10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(legacyDue)) return legacyDue;
    var start = String(cr && (cr.fechaInicioCuotas || cr.fechaInicial || cr.fechaInicio || cr.fecha) || '').slice(0,10);
    var startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
    var dueDay = Math.floor(Number(cr && (cr.diaVencimiento || cr.diaCuota || cr.installmentDay)));
    if (!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) dueDay = descHint.dueDay;
    if (!startMatch || !Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) return '';
    var year = Number(startMatch[1]), monthIndex = Number(startMatch[2]) - 1, startDay = Number(startMatch[3]);
    if (dueDay < startDay) monthIndex += 1;
    var target = new Date(year, monthIndex + 1, 0);
    var day = Math.min(dueDay, target.getDate());
    var resolved = new Date(year, monthIndex, day, 12, 0, 0, 0);
    return resolved.toISOString().slice(0,10);
  }

  function labInstallmentRawPlan(cr) {
    if (Array.isArray(cr && cr.installments) && cr.installments.length) return cr.installments.slice();
    var count = labInstallmentCountHint(cr);
    var firstDue = labFirstInstallmentDue(cr);
    if (count > 1 && firstDue) {
      var total = Number(cr && cr.monto) || 0;
      var structuredAmount = cr && (cr.montoCuota ?? cr.cuotaMonto ?? cr.montoPorCuota ?? cr.installmentAmount);
      var explicitAmount = Number(structuredAmount);
      if (!Number.isFinite(explicitAmount) || explicitAmount <= 0) explicitAmount = Number(labDescriptionInstallmentHint(cr).amount);
      var useExplicit = Number.isFinite(explicitAmount) && explicitAmount > 0 &&
        (!total || Math.abs(explicitAmount * count - total) < 0.02);
      var amounts = useExplicit ? Array.from({length:count}, function () { return explicitAmount; }) : labSplitInstallmentAmounts(total, count);
      return labMonthlyDates(firstDue, count).map(function (due,index) {
        return { number:index + 1, due:due, amount:Number((amounts[index] ?? 0).toFixed(2)), visualDerived:true };
      });
    }
    return [{ number:1, due:cr && cr.vence || '', amount:Number(cr && cr.monto) || 0 }];
  }

  function labScreen() {
    var page = document.getElementById('pageClientes');
    if (!page) return null;
    var screen = page.querySelector('.na-client-account-screen');
    if (!screen) {
      screen = document.createElement('section');
      screen.className = 'na-client-account-screen';
      screen.hidden = true;
      screen.innerHTML = '<div class="na-client-account-shell"><div class="na-client-account-content"></div></div>';
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
    var content = screen.querySelector('.na-client-account-content');
    if (content) content.innerHTML = html;
    screen.hidden = false;
    document.getElementById('pageClientes')?.classList.add('na-client-detail-open');
    screen.scrollTop = 0;
  }

  function labCloseScreen() {
    var screen = labScreen();
    if (screen) screen.hidden = true;
    document.getElementById('pageClientes')?.classList.remove('na-client-detail-open');
    labClientScreenState = { clientId:null, route:'home', categoryId:null, creditId:null, purchaseId:null };
  }

  function labResetClientNavigationForMenu() {
    var page = document.getElementById('pageClientes');
    if (!page || !page.classList.contains('active')) return false;
    labCloseScreen();
    return true;
  }

  function labBindClientMenuReset() {
    var button = document.getElementById('backBtn');
    if (!button) return false;
    if (button.dataset.labClientMenuReset === 'true') return true;

    button.dataset.labClientMenuReset = 'true';
    button.addEventListener('click', function () {
      labResetClientNavigationForMenu();
    }, true);
    return true;
  }

  function labBackButton(label) {
    return '<button type="button" class="na-v2-back" onclick="naCanonClientBack()">← ' + labEsc(label || 'Clientes') + '</button>';
  }

  function labAccountRow(client, category) {
    var summary = labCategorySummary(client, category), visual = labCategoryVisual(category);
    var detail = category.mode === 'accumulated'
      ? summary.purchaseCount + (summary.purchaseCount === 1 ? ' compra' : ' compras')
      : summary.activeCount + (summary.activeCount === 1 ? ' crédito activo' : ' créditos activos');
    return '<button type="button" class="na-v2-row na-v2-account-card na-v2-tone-' + visual.tone + '" onclick="naCanonOpenCreditCategory(\'' + labEsc(String(category.id)) + '\')">' +
      '<span class="na-v2-row-main"><span class="na-v2-module-icon" aria-hidden="true">' + labEsc(visual.icon) + '</span>' +
      '<span class="na-v2-row-copy"><strong>' + labEsc(category.name) + '</strong><small>' + labEsc(detail) + '</small></span></span>' +
      '<span class="na-v2-row-value"><strong>' + labMoney(summary.pending) + '</strong><small>pendiente</small></span><b>›</b>' +
    '</button>';
  }

  function labHomeHtml(client) {
    var c = labClassifyClient(client), s = c.summary, e = s.evaluation || {};
    var categories = labCategoriesForClient(client);
    var paymentCount = s.all.reduce(function (n, cr) { return n + labEffectivePayments(cr).length; }, 0);
    var line = Number.isFinite(Number(e.assignedLine)) ? Number(e.assignedLine) : null;
    var available = Number.isFinite(Number(e.available)) ? Number(e.available) : null;
    return '<div class="na-v2-screen">' +
      labBackButton('Clientes') +
      '<header class="na-v2-client-head na-v2-tone-' + c.tone + '">' +
        '<div class="na-v2-client-identity"><span class="na-v2-eyebrow">Ficha financiera</span>' +
          '<div class="na-v2-name-line"><h2>' + labEsc(labClientDisplayName(client)) + '</h2>' +
          '<button type="button" class="na-v2-risk na-v2-risk-' + c.tone + '" onclick="naCanonOpenClientBehavior()">● ' + labEsc(c.label) + '</button></div>' +
          '<p>' + (client.dni ? 'DNI ' + labEsc(client.dni) : 'Sin DNI') + (client.tel ? ' · ' + labEsc(client.tel) : '') + '</p>' +
        '</div>' +
        '<div class="na-v2-head-money"><span>Deuda total</span><strong>' + labMoney(s.debt) + '</strong>' +
          '<small>Línea ' + labMoney(line) + (available !== null ? ' · ' + labMoney(available) + ' disponible' : '') + '</small></div>' +
      '</header>' +
      '<section class="na-v2-section na-v2-accounts-section"><div class="na-v2-section-title"><span>CUENTAS Y CRÉDITOS</span><small>Organizado por tipo</small></div>' +
        '<div class="na-v2-list na-v2-card-list">' + categories.map(function (cat) { return labAccountRow(client, cat); }).join('') + '</div></section>' +
      '<section class="na-v2-section"><div class="na-v2-section-title"><span>GESTIÓN DEL CLIENTE</span><small>Consulta y seguimiento</small></div>' +
        '<div class="na-v2-list na-v2-card-list na-v2-nav-grid">' +
          labNavRow('↺','slate','HISTORIAL DE PAGOS',paymentCount + ' pagos / cuotas canceladas','naCanonOpenClientPaymentHistory()') +
          labNavRow('✓','green','CRÉDITOS CANCELADOS',s.closed.length + ' créditos finalizados','naCanonOpenCanceledCredits()') +
          labNavRow('S/','blue','LÍNEA DE CRÉDITO',available === null ? 'Evaluación disponible' : labMoney(available) + ' disponible','naCanonOpenCreditLine()') +
          labNavRow('●',c.tone,'COMPORTAMIENTO',c.label,'naCanonOpenClientBehavior()') +
        '</div></section>' +
    '</div>';
  }

  function labPurchaseRow(cr) {
    return '<button type="button" class="na-v2-row na-v2-purchase-row" onclick="naCanonOpenSmallPurchase(\'' + labEsc(String(cr.id)) + '\')">' +
      '<span><strong>' + labEsc(cr.fecha || 'Fecha no registrada') + '</strong><small>' + labEsc(labProductSummary(cr)) + '</small></span>' +
      '<span class="na-v2-row-value"><strong>' + labMoney(Number(cr.monto) || 0) + '</strong>' +
        (labCreditPending(cr) + 0.001 < Number(cr.monto || 0) ? '<small>' + labMoney(labCreditPending(cr)) + ' pendiente</small>' : '') + '</span><b>›</b>' +
    '</button>';
  }

  function labCreditRow(cr) {
    var ins = labInstallmentSummary(cr), pending = labCreditPending(cr);
    var next = ins.pending[0], account = creditAccountMeta(cr), visual = labCategoryVisual(account);
    return '<button type="button" class="na-v2-row na-v2-credit-row na-v2-tone-' + visual.tone + '" onclick="naCanonOpenIndividualCredit(\'' + labEsc(String(cr.id)) + '\')">' +
      '<span class="na-v2-row-main"><span class="na-v2-module-icon" aria-hidden="true">' + labEsc(visual.icon) + '</span>' +
      '<span class="na-v2-row-copy"><strong>' + labEsc(cr.desc || labProductSummary(cr) || 'Crédito') + '</strong>' +
        '<small>' + ins.paidCount + ' pagadas · ' + ins.pendingCount + ' pendientes' + (next && next.due ? ' · Próxima ' + labDisplayDate(next.due) : '') + '</small></span></span>' +
      '<span class="na-v2-row-value"><strong>' + labMoney(pending) + '</strong><small>pendiente</small></span><b>›</b>' +
    '</button>';
  }

  function labCategoryHtml(client, category) {
    var summary = labCategorySummary(client, category), visual = labCategoryVisual(category);
    var rows = category.mode === 'accumulated' ? summary.active.map(labPurchaseRow) : summary.active.map(labCreditRow);
    var detail = category.mode === 'accumulated'
      ? summary.purchaseCount + (summary.purchaseCount === 1 ? ' compra' : ' compras')
      : summary.activeCount + (summary.activeCount === 1 ? ' crédito activo' : ' créditos activos');
    return '<div class="na-v2-screen">' + labBackButton(labClientDisplayName(client)) +
      '<header class="na-v2-subhead na-v2-category-head na-v2-tone-' + visual.tone + '">' +
        '<div class="na-v2-category-title"><span class="na-v2-module-icon" aria-hidden="true">' + labEsc(visual.icon) + '</span><div><span class="na-v2-eyebrow">Cuenta</span><h2>' + labEsc(category.name) + '</h2><small>' + labEsc(detail) + '</small></div></div>' +
        '<div class="na-v2-category-balance"><span>Pendiente total</span><strong>' + labMoney(summary.pending) + '</strong></div>' +
      '</header>' +
      '<section class="na-v2-list na-v2-card-list">' + (rows.length ? rows.join('') : '<div class="na-v2-empty">No hay créditos activos en esta cuenta.</div>') + '</section></div>';
  }

  function labCleanInstallmentProductName(value) {
    var text = String(value || '').trim();
    if (!text) return 'Producto';
    var cleaned = text.replace(/\s*[—–-]\s*\d{1,2}\s+cuotas?\s+mensuales?[\s\S]*$/i,'').trim();
    return cleaned || text;
  }

  function labPurchasePlanLabel(cr, installments) {
    if (!installments || !Array.isArray(installments.plan) || installments.plan.length < 2) return '';
    var hint = labDescriptionInstallmentHint(cr);
    var firstDue = String(installments.plan[0] && installments.plan[0].due || hint.firstDue || '').slice(0,10);
    var dueDay = hint.dueDay;
    if ((!Number.isFinite(dueDay) || dueDay < 1 || dueDay > 31) && /^\d{4}-\d{2}-\d{2}$/.test(firstDue)) {
      dueDay = Number(firstDue.slice(8,10));
    }
    var parts = [installments.plan.length + ' cuotas mensuales'];
    if (Number.isFinite(dueDay) && dueDay >= 1 && dueDay <= 31) parts.push('vence cada día ' + dueDay);
    if (/^\d{4}-\d{2}-\d{2}$/.test(firstDue)) parts.push('desde ' + labDisplayDate(firstDue));
    return parts.join(' · ');
  }

  function labPurchaseHtml(client, cr) {
    var items = Array.isArray(cr.items) ? cr.items : [];
    var installments = labInstallmentSummary(cr);
    var hasInstallmentSchedule = installments.plan.length > 1;
    var isSingleInstallmentItem = hasInstallmentSchedule && items.length === 1;
    var planLabel = isSingleInstallmentItem ? labPurchasePlanLabel(cr, installments) : '';
    return '<div class="na-v2-screen">' + labBackButton(NA_SMALL_ACCOUNT_NAME) +
      '<header class="na-v2-subhead na-v2-tone-teal"><span class="na-v2-eyebrow">Crédito pequeño</span><h2>VENTA ' + labEsc(cr.fecha || '') + '</h2>' +
        (hasInstallmentSchedule ? '<small>' + installments.paidCount + ' cuotas pagadas · ' + installments.pendingCount + ' pendientes</small>' : '') + '</header>' +
      '<section class="na-v2-product-list">' +
        (items.length ? items.map(function (item) {
          var qty = Number(item.cantidad ?? item.qty) || 1, unit = Number(item.precioUnitario ?? item.precio) || 0;
          var total = Number(item.subtotal);
          if (!Number.isFinite(total)) total = qty * unit;
          var rawName = item.nombre || item.name || 'Producto';
          var displayName = isSingleInstallmentItem ? labCleanInstallmentProductName(rawName) : rawName;
          var secondary = isSingleInstallmentItem ? planLabel : (qty + ' × ' + labMoney(unit));
          var lineAmount = isSingleInstallmentItem ? '' : '<b>' + labMoney(total) + '</b>';
          return '<div class="na-v2-product"><span><strong>' + labEsc(displayName) + '</strong>' +
            (secondary ? '<small>' + labEsc(secondary) + '</small>' : '') +
            '</span>' + lineAmount + '</div>';
        }).join('') : '<div class="na-v2-empty">El crédito heredado no conserva detalle de productos.</div>') +
      '</section><div class="na-v2-total"><span>Total</span><strong>' + labMoney(Number(cr.monto) || 0) + '</strong></div>' +
      (hasInstallmentSchedule
        ? '<section class="na-v2-section na-v2-schedule-section"><div class="na-v2-section-title"><span>CRONOGRAMA DE CUOTAS</span><small>' + installments.plan.length + ' cuotas en total</small></div>' + labPendingInstallmentsHtml(installments) + '</section>'
        : '') +
    '</div>';
  }

  function labPendingInstallmentsHtml(summary) {
    if (!summary.plan.length) return '<div class="na-v2-empty">No hay cronograma de cuotas disponible.</div>';
    var nextPendingNumber = summary.pending[0] && summary.pending[0].number;
    var today = labTodayIso();
    return '<div class="na-v2-installment-list">' + summary.plan.map(function (item) {
      var state = labInstallmentVisualState(item, nextPendingNumber, today);
      return '<div class="na-v2-installment na-v2-installment-' + state.key + (state.next ? ' is-next' : '') + '">' +
        '<span class="na-v2-installment-index" aria-hidden="true">' + item.number + '</span>' +
        '<span class="na-v2-installment-copy"><strong>Cuota ' + item.number + '</strong><small>' + labEsc(labDisplayDate(item.due)) + '</small></span>' +
        '<strong class="na-v2-installment-amount">' + labMoney(item.amount) + '</strong>' +
        '<span class="na-v2-installment-status">' + labEsc(state.label) + '</span>' +
      '</div>';
    }).join('') + '</div>';
  }

  function labCreditInfoHtml(cr, account) {
    return '<div class="na-v2-credit-info" id="naV2CreditInfo" hidden>' +
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
    var account = creditAccountMeta(cr), ins = labInstallmentSummary(cr);
    var total = Math.max(1, ins.plan.length), progress = Math.round(ins.paidCount / total * 100);
    var visual = labCategoryVisual(account);
    return '<div class="na-v2-screen">' + labBackButton(account.categoryName) +
      '<header class="na-v2-subhead na-v2-credit-title na-v2-tone-' + visual.tone + '">' +
        '<span class="na-v2-eyebrow">' + labEsc(account.categoryName) + '</span>' +
        '<h2>' + labEsc(cr.desc || labProductSummary(cr) || 'Crédito') + '</h2>' +
        '<p>' + ins.paidCount + ' cuotas pagadas · ' + ins.pendingCount + ' pendientes</p>' +
        '<div class="na-v2-progress-meta"><span>Avance del crédito</span><strong>' + progress + '%</strong></div>' +
        '<div class="na-v2-progress" aria-label="' + progress + '% de cuotas pagadas"><span style="width:' + progress + '%"></span></div>' +
      '</header>' +
      '<section class="na-v2-section na-v2-schedule-section"><div class="na-v2-section-title"><span>CRONOGRAMA DE CUOTAS</span><small>' + ins.plan.length + ' cuotas en total</small></div>' +
        labPendingInstallmentsHtml(ins) + '</section>' +
      '<div class="na-v2-credit-actions">' +
        (!labIsCanceled(cr) && labCreditPending(cr) > 0.001 ? '<button type="button" class="na-v2-pay" onclick="abrirPago(\'' + labEsc(String(cr.id)) + '\')">Registrar pago</button>' : '') +
        '<button type="button" class="na-v2-info-btn" aria-label="Información del crédito" onclick="naCanonToggleCreditInfo()">ⓘ</button>' +
      '</div>' +
      labCreditInfoHtml(cr, account) +
      '<button type="button" class="na-v2-row na-v2-history-link na-v2-nav-card na-v2-tone-slate" onclick="naCanonOpenCreditHistory(\'' + labEsc(String(cr.id)) + '\')">' +
        '<span class="na-v2-row-main"><span class="na-v2-module-icon" aria-hidden="true">↺</span><span class="na-v2-row-copy"><strong>Historial de este crédito</strong><small>' + ins.paidCount + ' cuotas canceladas</small></span></span><b>›</b></button>' +
    '</div>';
  }

  function labFormatPaymentMoment(pay) {
    var date = pay && (pay.fecha || (pay.timestamp ? String(pay.timestamp).slice(0,10) : '')) || 'Fecha no registrada';
    var time = pay && (pay.hora || pay.hora24 || '') || '';
    return date + (time ? ' · ' + time : '');
  }

  function labCreditHistoryHtml(client, cr) {
    var ins = labInstallmentSummary(cr);
    return '<div class="na-v2-screen">' + labBackButton(cr.desc || 'Crédito') +
      '<header class="na-v2-subhead"><h2>CUOTAS PAGADAS</h2></header><section class="na-v2-list">' +
      (ins.paid.length ? ins.paid.map(function (item) {
        var pay = item.paymentId ? labEffectivePayments(cr).find(function (p) { return String(p.pagoId || p.id) === String(item.paymentId); }) : null;
        return '<div class="na-v2-paid-row"><span>✓</span><div><strong>Cuota ' + item.number + '</strong><small>' + labEsc(pay ? labFormatPaymentMoment(pay) : (item.paidAt || 'Pago histórico sin hora canónica')) + '</small></div></div>';
      }).join('') : '<div class="na-v2-empty">Todavía no hay cuotas pagadas.</div>') +
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
    return '<div class="na-v2-screen">' + labBackButton(labClientDisplayName(client)) +
      '<header class="na-v2-subhead"><h2>HISTORIAL DE PAGOS</h2></header>' +
      (groups.length ? groups.map(function (group) {
        var content = group.category.mode === 'accumulated'
          ? '<button type="button" class="na-v2-row" onclick="naCanonOpenCreditCategory(\'' + labEsc(group.category.id) + '\')"><span><strong>' + labEsc(group.category.name) + '</strong><small>' + group.paymentCount + ' pagos realizados</small></span><b>›</b></button>'
          : group.credits.filter(function (cr) { return labEffectivePayments(cr).length; }).map(function (cr) {
              var count = labEffectivePayments(cr).length;
              return '<button type="button" class="na-v2-row" onclick="naCanonOpenCreditHistory(\'' + labEsc(String(cr.id)) + '\')"><span><strong>' + labEsc(cr.desc || 'Crédito') + '</strong><small>' + count + ' cuotas canceladas</small></span><b>›</b></button>';
            }).join('');
        return '<section class="na-v2-section"><h3>' + labEsc(group.category.name).toUpperCase() + '</h3><div class="na-v2-list">' + content + '</div></section>';
      }).join('') : '<div class="na-v2-empty">Todavía no hay pagos registrados.</div>') +
    '</div>';
  }

  function labCanceledHtml(client) {
    var summary = labClientFinancialSummary(client);
    return '<div class="na-v2-screen">' + labBackButton(labClientDisplayName(client)) +
      '<header class="na-v2-subhead na-v2-simple-hero na-v2-tone-green"><span class="na-v2-eyebrow">Histórico</span><h2>CRÉDITOS CANCELADOS</h2><small>' + summary.closed.length + ' créditos finalizados</small></header>' +
      '<section class="na-v2-list na-v2-card-list">' + (summary.closed.length ? summary.closed.map(function (cr) {
        var ins = labInstallmentSummary(cr);
        return '<button type="button" class="na-v2-row na-v2-nav-card na-v2-tone-green" onclick="naCanonOpenIndividualCredit(\'' + labEsc(String(cr.id)) + '\')">' +
          '<span class="na-v2-row-main"><span class="na-v2-module-icon" aria-hidden="true">✓</span><span class="na-v2-row-copy"><strong>' + labEsc(cr.desc || labProductSummary(cr) || 'Crédito') + '</strong>' +
          '<small>' + ins.paidCount + '/' + ins.plan.length + ' cuotas pagadas · Finalizado ' + labEsc(labLastPaymentDate(cr)) + '</small></span></span><b>›</b></button>';
      }).join('') : '<div class="na-v2-empty">No hay créditos finalizados.</div>') + '</section></div>';
  }

  function labLineHtml(client) {
    var summary = labClientFinancialSummary(client), e = summary.evaluation || {};
    var assigned = Number.isFinite(Number(e.assignedLine)) ? Number(e.assignedLine) : null;
    var automatic = Number.isFinite(Number(e.automaticLine)) ? Number(e.automaticLine) : null;
    var available = Number.isFinite(Number(e.available)) ? Number(e.available) : null;
    return '<div class="na-v2-screen">' + labBackButton(labClientDisplayName(client)) +
      '<header class="na-v2-line-hero"><span class="na-v2-eyebrow">Línea de crédito</span><strong>' + labMoney(assigned) + '</strong>' +
        '<small>' + (e.manualActive ? 'Línea manual vigente' : 'Línea calculada por la evaluación actual') + '</small></header>' +
      '<section class="na-v2-metrics na-v2-financial-metrics">' +
        '<div class="na-v2-metric-available"><span>Disponible</span><strong>' + labMoney(available) + '</strong></div>' +
        '<div><span>Deuda activa</span><strong>' + labMoney(summary.debt) + '</strong></div>' +
        '<div><span>Línea automática</span><strong>' + labMoney(automatic) + '</strong></div></section>' +
      '<p class="na-v2-note">Esta vista utiliza la evaluación financiera vigente del POS. La presentación visual no reemplaza ni modifica una línea manual o automática.</p>' +
      (typeof abrirEvaluacionCredito === 'function' ? '<button type="button" class="na-v2-pay secondary" onclick="abrirEvaluacionCredito(\'' + labEsc(String(client.id)) + '\')">Ver evaluación existente</button>' : '') +
    '</div>';
  }

  function labBehaviorHtml(client) {
    var c = labClassifyClient(client), summary = c.summary, e = summary.evaluation || {}, h = e.history || {};
    var assigned = Number.isFinite(Number(e.assignedLine)) ? Number(e.assignedLine) : null;
    return '<div class="na-v2-screen">' + labBackButton(labClientDisplayName(client)) +
      '<header class="na-v2-behavior-hero na-v2-tone-' + c.tone + '">' +
        '<div><span class="na-v2-eyebrow">Comportamiento financiero</span><h2>' + labEsc(c.label) + '</h2><p>Lectura basada en el historial financiero disponible.</p></div>' +
        '<span class="na-v2-risk na-v2-risk-' + c.tone + '">● ' + labEsc(c.label) + '</span></header>' +
      '<section class="na-v2-metrics na-v2-behavior-metrics">' +
        '<div><span>Pagos puntuales</span><strong>' + labEsc(String(h.punctual ?? 0)) + '</strong></div>' +
        '<div><span>Pagos atrasados</span><strong>' + labEsc(String(h.late ?? 0)) + '</strong></div>' +
        '<div><span>Créditos finalizados</span><strong>' + labEsc(String(h.completed ?? summary.closed.length)) + '</strong></div>' +
        '<div class="' + (summary.overdueDebt > 0.001 ? 'na-v2-metric-danger' : '') + '"><span>Deuda vencida</span><strong>' + labMoney(summary.overdueDebt) + '</strong></div>' +
        '<div><span>Línea actual</span><strong>' + labMoney(assigned) + '</strong></div></section>' +
      '<section class="na-v2-why"><div class="na-v2-section-title"><span>¿POR QUÉ?</span><small>Explicación visible</small></div>' +
        '<div class="na-v2-reason-list">' + c.reasons.map(function (reason) { return '<p><span>✓</span>' + labEsc(reason) + '</p>'; }).join('') +
        '<p><span>✓</span>La línea mostrada proviene de la evaluación financiera vigente del POS.</p></div></section>' +
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

  window.naCanonOpenClientAccount = function (clientId) {
    if (!labClientById(clientId)) return;
    labClientScreenState = { clientId:String(clientId), route:'home', categoryId:null, creditId:null, purchaseId:null };
    labRenderRoute();
  };

  window.naCanonClientBack = function () {
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

  window.naCanonOpenCreditCategory = function (categoryId) {
    labClientScreenState.route = 'category'; labClientScreenState.categoryId = String(categoryId || NA_SMALL_ACCOUNT_ID);
    labRenderRoute();
  };
  window.naCanonOpenSmallPurchase = function (creditId) {
    labClientScreenState.route = 'purchase'; labClientScreenState.purchaseId = String(creditId); labRenderRoute();
  };
  window.naCanonOpenIndividualCredit = function (creditId) {
    var client = labClientById(labClientScreenState.clientId);
    var cr = client && labClientCredits(client.id).find(function (x) { return String(x.id) === String(creditId); });
    if (!cr) return;
    labClientScreenState.categoryId = creditAccountMeta(cr).categoryId;
    labClientScreenState.route = 'credit'; labClientScreenState.creditId = String(creditId); labRenderRoute();
  };
  window.naCanonOpenCreditHistory = function (creditId) {
    labClientScreenState.route = 'creditHistory'; labClientScreenState.creditId = String(creditId); labRenderRoute();
  };
  window.naCanonOpenClientPaymentHistory = function () { labClientScreenState.route = 'history'; labRenderRoute(); };
  window.naCanonOpenCanceledCredits = function () { labClientScreenState.route = 'canceled'; labRenderRoute(); };
  window.naCanonOpenCreditLine = function () { labClientScreenState.route = 'line'; labRenderRoute(); };
  window.naCanonOpenClientBehavior = function () { labClientScreenState.route = 'behavior'; labRenderRoute(); };
  window.naCanonToggleCreditInfo = function () {
    var node = document.getElementById('naV2CreditInfo'); if (node) node.hidden = !node.hidden;
  };

  function labBindClientCards() {
    var list = document.getElementById('cliList');
    if (!list) return;
    Array.from(list.querySelectorAll('.client-card')).forEach(function (card) {
      var panel = card.querySelector('.client-creds');
      var id = panel && /^cc-/.test(String(panel.id || '')) ? String(panel.id).replace(/^cc-/, '') : String(card.dataset && card.dataset.clientId || '');
      if (!id) return;
      card.dataset.naV2Ready = 'true';
      if (panel) { panel.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
      var head = card.querySelector('.client-header') || card;
      if (!head.dataset.naV2Bound) {
        head.dataset.naV2Bound = 'true';
        head.setAttribute('role', 'button');
        head.setAttribute('tabindex', '0');
        head.onclick = function (event) {
          event.preventDefault(); event.stopPropagation(); window.naCanonOpenClientAccount(id);
        };
        head.onkeydown = function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); window.naCanonOpenClientAccount(id); }
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
    return chosen || categories[0] || { id:NA_SMALL_ACCOUNT_ID, name:NA_SMALL_ACCOUNT_NAME, mode:'accumulated', builtin:true };
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
      return '<label><span>Cuota ' + (index + 1) + '</span><input type="date" class="fi na-credit-installment-date" data-installment-number="' + (index + 1) + '" value="' + labEsc(date) + '"></label>';
    }).join('');
  }

  function labSaleDestinationHtml(client) {
    if (!client) return '<div class="na-credit-destination-empty">Selecciona primero el cliente del crédito.</div>';
    var categories = labCategoriesForClient(client), selected = labSelectedCategory(client);
    var radios = categories.map(function (cat) {
      return '<label class="na-credit-destination-option ' + (String(cat.id) === String(selected.id) ? 'selected' : '') + '">' +
        '<input type="radio" name="labCreditDestination" value="' + labEsc(cat.id) + '" ' + (String(cat.id) === String(selected.id) ? 'checked' : '') + ' onchange="naCanonSelectCreditDestination(\'' + labEsc(cat.id) + '\')">' +
        '<span><strong>' + labEsc(cat.name) + '</strong><small>' + (cat.id === NA_SMALL_ACCOUNT_ID ? 'Predeterminado' : cat.mode === 'accumulated' ? 'Cuenta acumulada' : 'Créditos separados') + '</small></span></label>';
    }).join('');
    var installment = selected.mode === 'separate'
      ? '<div class="na-credit-installment-config"><label><span>Número de cuotas</span><input id="labCreditInstallmentCount" class="fi" type="number" min="1" max="60" value="' + labSaleCreditState.installmentCount + '" oninput="naCanonRefreshInstallmentDates()"></label><div id="labCreditInstallmentDates" class="na-credit-installment-dates"></div></div>'
      : '';
    return '<div class="na-credit-destination-title"><strong>¿Dónde registrar esta venta?</strong><small>Créditos pequeños está seleccionado por defecto.</small></div>' +
      '<div class="na-credit-destination-options">' + radios + '</div>' +
      '<button type="button" class="na-credit-new-category" onclick="naCanonOpenNewCreditCategory()">+ Nueva categoría</button>' + installment;
  }

  function labEnsureSaleDestinationUi() {
    var section = document.getElementById('mCreditoSection');
    if (!section) return false;
    var wrap = section.querySelector('.na-credit-destination');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'na-credit-destination';
      section.appendChild(wrap);
    }
    var client = labSaleClient();
    var currentId = client ? String(client.id) : null;
    if (labSaleCreditState.clientId !== currentId) {
      labSaleCreditState = { clientId:currentId, categoryId:NA_SMALL_ACCOUNT_ID, installmentCount:1 };
    }
    wrap.innerHTML = labSaleDestinationHtml(client);
    if (client && labSelectedCategory(client).mode === 'separate') requestAnimationFrame(labRenderInstallmentDates);
    return true;
  }

  window.naCanonSelectCreditDestination = function (categoryId) {
    var client = labSaleClient(); if (!client) return;
    var exists = labCategoriesForClient(client).some(function (cat) { return String(cat.id) === String(categoryId); });
    labSaleCreditState.categoryId = exists ? String(categoryId) : NA_SMALL_ACCOUNT_ID;
    labSaleCreditState.installmentCount = 1;
    labEnsureSaleDestinationUi();
  };
  window.naCanonRefreshInstallmentDates = labRenderInstallmentDates;

  function labEnsureCategoryModal() {
    var modal = document.getElementById('naNewCreditCategoryModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'naNewCreditCategoryModal';
    modal.className = 'na-credit-category-modal';
    modal.hidden = true;
    modal.innerHTML = '<div class="na-credit-category-card"><div class="na-credit-category-head"><h3>NUEVA CATEGORÍA</h3><button type="button" onclick="naCanonCloseNewCreditCategory()" aria-label="Cerrar">×</button></div>' +
      '<label class="na-credit-field"><span>Nombre</span><input id="naNewCreditCategoryName" class="fi" maxlength="60" placeholder="Tecnología"></label>' +
      '<fieldset><legend>Forma de manejo</legend>' +
        '<label><input type="radio" name="naNewCreditCategoryMode" value="separate" checked><span><strong>Créditos separados</strong><small>Cada operación conserva su propio crédito y cuotas.</small></span></label>' +
        '<label><input type="radio" name="naNewCreditCategoryMode" value="accumulated"><span><strong>Cuenta acumulada</strong><small>Varias ventas se muestran dentro de una misma cuenta.</small></span></label>' +
      '</fieldset><div class="na-credit-category-actions"><button type="button" onclick="naCanonCloseNewCreditCategory()">Cancelar</button><button type="button" class="primary" onclick="naCanonCreateCreditCategory()">Crear y usar</button></div></div>';
    document.body.appendChild(modal);
    return modal;
  }

  window.naCanonOpenNewCreditCategory = function () {
    var client = labSaleClient();
    if (!client) { if (typeof toast === 'function') toast('Selecciona primero el cliente del crédito','error'); return; }
    var modal = labEnsureCategoryModal(); modal.hidden = false;
    var input = document.getElementById('naNewCreditCategoryName'); if (input) { input.value=''; setTimeout(function(){ input.focus(); }, 30); }
  };
  window.naCanonCloseNewCreditCategory = function () { var m=document.getElementById('naNewCreditCategoryModal'); if(m)m.hidden=true; };

  function labReadInstallmentDraft() {
    var client = labSaleClient(), category = labSelectedCategory(client);
    if (!client || category.mode !== 'separate') return [];
    var inputs = Array.from(document.querySelectorAll('#labCreditInstallmentDates .na-credit-installment-date'));
    var dates = inputs.map(function (input) { return String(input.value || '').slice(0,10); }).filter(Boolean);
    if (!dates.length) dates = labMonthlyDates(document.getElementById('mCreditoVence')?.value || '', labSaleCreditState.installmentCount);
    return dates.map(function (due,index) { return { number:index+1, due:due }; });
  }

  function labAttachSaleClientListener() {
    var input = document.getElementById('mCreditoCliente');
    if (input && !input.dataset.naV2Bound) {
      input.dataset.naV2Bound = 'true';
      input.addEventListener('change', function () {
        labSaleCreditState = { clientId:String(input.value || ''), categoryId:NA_SMALL_ACCOUNT_ID, installmentCount:1 };
        labEnsureSaleDestinationUi();
      });
    }
    var due = document.getElementById('mCreditoVence');
    if (due && !due.dataset.naV2Bound) {
      due.dataset.naV2Bound = 'true';
      due.addEventListener('change', function () {
        if (labSelectedCategory(labSaleClient()).mode === 'separate') labRenderInstallmentDates();
      });
    }
  }

  function naCanonicalSaleDraft() {
    var client = labSaleClient();
    if (!client) return null;
    var category = labSelectedCategory(client);
    var draft = labReadInstallmentDraft();
    return {
      account: { account_id:String(category.id || NA_SMALL_ACCOUNT_ID), name:String(category.name || NA_SMALL_ACCOUNT_NAME), mode:category.mode === 'separate' ? 'separate' : 'accumulated' },
      installment_dates: category.mode === 'separate' ? draft.map(function (row) { return String(row.due || '').slice(0,10); }).filter(Boolean) : []
    };
  }

  root.NA_CLIENT_CREDIT_ACCOUNTS_V2 = Object.freeze({
    smallAccountId:NA_SMALL_ACCOUNT_ID,
    accountMeta:creditAccountMeta,
    categoriesForClient:labCategoriesForClient,
    creditsForCategory:labCreditsForCategory,
    categorySummary:labCategorySummary,
    installments:labInstallmentSummary,
    installmentVisualState:labInstallmentVisualState,
    splitInstallmentAmounts:labSplitInstallmentAmounts,
    classifyClient:labClassifyClient,
    summarizeClient:labClientFinancialSummary,
    productSummary:labProductSummary,
    renderSaleDestination:labEnsureSaleDestinationUi,
    bindClientCards:labBindClientCards,
    saleDraft:naCanonicalSaleDraft
  });
  

  root.naCanonCreateCreditCategory = async function () {
    var client = labSaleClient(); if (!client) return;
    var name = String(document.getElementById('naNewCreditCategoryName')?.value || '').trim().replace(/\s+/g,' ');
    if (!name) { if (typeof toast === 'function') toast('Escribe un nombre para la categoría','error'); return; }
    var duplicate = labCustomCategories(client).find(function (c) { return c.name.toLowerCase() === name.toLowerCase(); });
    if (duplicate) {
      labSaleCreditState.categoryId = duplicate.id;
      root.naCanonCloseNewCreditCategory(); labEnsureSaleDestinationUi();
      if (typeof toast === 'function') toast('La categoría ya existía; se reutilizó.','success');
      return;
    }
    var mode = document.querySelector('input[name="naNewCreditCategoryMode"]:checked')?.value === 'accumulated' ? 'accumulated' : 'separate';
    var id = 'cat_' + root.crypto.randomUUID();
    try {
      if (!root.NuevoAmanecerCanonical || typeof root.NuevoAmanecerCanonical.createCreditAccount !== 'function') throw new Error('CANONICAL_CREDIT_ACCOUNT_UNAVAILABLE');
      await root.NuevoAmanecerCanonical.createCreditAccount({ customer_id:String(client.id), account_id:id, name:name.slice(0,60), mode:mode });
      await root.NuevoAmanecerCanonical.refresh();
      labSaleCreditState.categoryId=id; labSaleCreditState.installmentCount=1;
      root.naCanonCloseNewCreditCategory(); labEnsureSaleDestinationUi();
      if (typeof toast === 'function') toast('Categoría creada y seleccionada','success');
    } catch (error) {
      console.warn('[Nuevo Amanecer] No se pudo crear la categoría canónica.', error && error.message || error);
      if (typeof toast === 'function') toast('No se pudo guardar la categoría','error');
    }
  };

  function naUppercaseClientCards() {
    var list=document.getElementById('cliList'); if(!list) return;
    list.querySelectorAll('.client-card .c-name').forEach(function (node) { node.textContent=String(node.textContent||'').toUpperCase(); });
  }

  function naEnhanceClientCards() {
    labBindClientCards();
    naUppercaseClientCards();
    if (labClientScreenState.clientId) {
      var screen=labScreen();
      if (screen && !screen.hidden) labRenderRoute();
    }
  }

  function naResetClientNavigationForMenu() {
    var page=document.getElementById('pageClientes');
    if (page && page.classList.contains('active')) labCloseScreen();
  }

  function naEnsureClientLoadingUi() {
    var page=document.getElementById('pageClientes'), list=document.getElementById('cliList');
    if(!page||!list||!list.parentNode) return null;
    var loader=document.getElementById('naClientLoading');
    if(!loader) {
      loader=document.createElement('div'); loader.id='naClientLoading'; loader.className='na-client-loading';
      loader.setAttribute('role','status'); loader.setAttribute('aria-live','polite'); loader.hidden=true;
      var mark=document.createElement('div'); mark.className='na-client-loading-mark';
      var ring=document.createElement('span'); ring.className='na-client-loading-ring'; ring.setAttribute('aria-hidden','true');
      var logo=document.createElement('span'); logo.className='na-client-loading-logo'; logo.setAttribute('aria-hidden','true'); logo.textContent='🌅';
      var title=document.createElement('strong'); title.className='na-client-loading-title'; title.textContent='Cargando clientes…';
      var copy=document.createElement('span'); copy.className='na-client-loading-copy'; copy.textContent='Obteniendo datos, por favor espera.';
      mark.append(ring,logo); loader.append(mark,title,copy); list.parentNode.insertBefore(loader,list);
    }
    return loader;
  }

  function naSyncClientLoadingUi() {
    var page=document.getElementById('pageClientes'), loader=naEnsureClientLoadingUi();
    if(!page||!loader) return;
    var loading=false;
    try {
      if(root.NuevoAmanecerCanonical && root.NuevoAmanecerCanonical.enabled()) {
        var state=root.NuevoAmanecerCanonical.sourceState();
        loading=state.validation==='pending' || state.validation==='validating';
      }
    } catch (_) {}
    page.classList.toggle('na-client-loading-active',loading);
    loader.hidden=!loading; loader.setAttribute('aria-hidden',loading?'false':'true');
  }

  function naBindRuntime() {
    if (typeof cliRender === 'function' && !cliRender.__naCreditAccountsV2) {
      var base=cliRender;
      cliRender=function () {
        var result=base.apply(this,arguments);
        naEnhanceClientCards(); naSyncClientLoadingUi();
        return result;
      };
      cliRender.__naCreditAccountsV2=true;
    }
    if (typeof abrirCobro === 'function' && !abrirCobro.__naCreditAccountsV2) {
      var open=abrirCobro;
      abrirCobro=function(){var result=open.apply(this,arguments);setTimeout(labEnsureSaleDestinationUi,0);return result;};
      abrirCobro.__naCreditAccountsV2=true;
    }
    if (typeof selPM === 'function' && !selPM.__naCreditAccountsV2) {
      var select=selPM;
      selPM=function(){var result=select.apply(this,arguments);if(typeof posPayM!=='undefined'&&posPayM==='credito')setTimeout(labEnsureSaleDestinationUi,0);return result;};
      selPM.__naCreditAccountsV2=true;
    }
    labAttachSaleClientListener();
    var back=document.getElementById('backBtn');
    if(back && back.dataset.naClientMenuReset!=='true') {
      back.dataset.naClientMenuReset='true';
      back.addEventListener('click',naResetClientNavigationForMenu,true);
    }
    naEnhanceClientCards(); naSyncClientLoadingUi();
  }

  root.addEventListener('na:canonical-updated',function(){setTimeout(function(){naBindRuntime();naEnhanceClientCards();naSyncClientLoadingUi();},0);});
  root.addEventListener('load',naBindRuntime);
  root.addEventListener('pageshow',naBindRuntime);
  if (typeof MutationObserver === 'function') {
    var list=document.getElementById('cliList');
    if(list) new MutationObserver(function(){requestAnimationFrame(naEnhanceClientCards);}).observe(list,{childList:true,subtree:true});
  }
  naBindRuntime();

})(window);
