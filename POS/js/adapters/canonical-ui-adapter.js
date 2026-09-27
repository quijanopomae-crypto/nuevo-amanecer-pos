(function (root) {
  'use strict';

  var VERSION = 1;

  function text(value, fallback) {
    if (value === undefined || value === null) return fallback === undefined ? '' : String(fallback);
    var out = String(value).trim();
    return out || (fallback === undefined ? '' : String(fallback));
  }

  function number(value, fallback) {
    var out = Number(value);
    return Number.isFinite(out) ? out : (fallback === undefined ? 0 : Number(fallback) || 0);
  }

  function integer(value, fallback) {
    return Math.trunc(number(value, fallback));
  }

  function cents(value) {
    return number(value, 0) / 100;
  }

  function safeArrayJson(value) {
    if (Array.isArray(value)) return value.slice();
    if (typeof value !== 'string' || !value.trim()) return [];
    try {
      var parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function uniqueCodes(raw, legacy) {
    var seen = new Set(), out = [];
    safeArrayJson(raw).concat(legacy ? [legacy] : []).forEach(function (value) {
      var code = text(value);
      if (!code || seen.has(code)) return;
      seen.add(code); out.push(code);
    });
    return out.slice(0, 10);
  }

  function uiProduct(p) {
    p = p && typeof p === 'object' ? p : {};
    var name = text(p.name, 'PRODUCTO');
    var barcode = text(p.barcode);
    var category = text(p.category).toLowerCase();
    var icon = text(p.icon, '📦');
    var unitsPerBox = integer(p.units_per_box, 0);
    var purchaseFactor = number(p.purchase_factor, unitsPerBox > 0 ? unitsPerBox : 1);
    if (!(purchaseFactor > 0)) purchaseFactor = unitsPerBox > 0 ? unitsPerBox : 1;
    var tracks = p.tracks_inventory !== 0 && p.tracks_inventory !== false;
    var altCodes = uniqueCodes(p.alternate_codes_json, p.legacy_alternate_code);
    var boxPrice = number(p.box_price_cents, 0);
    return {
      id: p.product_id,
      product_id: p.product_id,
      name: name,
      nombre: name,
      sku: text(p.sku),
      barcode: barcode,
      codigo: barcode,
      codigosAlternativos: altCodes,
      codigoAlternativo: altCodes[0] || '',
      cat: category,
      categoria: category,
      marca: text(p.brand, 'Sin marca'),
      descripcion: text(p.description),
      icon: icon,
      icono: icon,
      imagen: p.image || null,
      unidad: text(p.unit, 'unidad'),
      unidadCompra: text(p.purchase_unit, unitsPerBox > 1 ? 'caja' : 'unidad'),
      factorCompra: purchaseFactor,
      costo: cents(p.cost_cents),
      precio: cents(p.price_cents),
      precioCaja: boxPrice > 0 ? boxPrice / 100 : null,
      unidCaja: unitsPerBox > 0 ? unitsPerBox : null,
      stock: number(p.current_stock_quantity, 0),
      stockRevision: integer(p.stock_revision, 0),
      stockMin: number(p.stock_min_quantity, 0),
      venc: text(p.expiry_date),
      incluyeIGV: p.includes_igv !== 0 && p.includes_igv !== false,
      tipoImpuesto: text(p.tax_type),
      impuestoComplementario: text(p.complementary_tax),
      controlInventario: tracks,
      controlaStock: tracks,
      canonical: true
    };
  }

  function accountMap(accounts) {
    var byCustomer = new Map();
    (Array.isArray(accounts) ? accounts : []).forEach(function (account) {
      if (!account || account.customer_id === undefined || account.customer_id === null) return;
      var key = String(account.customer_id), list = byCustomer.get(key) || [];
      list.push({
        id: account.account_id,
        name: text(account.name, 'Categoría'),
        mode: account.mode === 'separate' ? 'separate' : 'accumulated',
        createdAt: account.created_at || null
      });
      byCustomer.set(key, list);
    });
    return byCustomer;
  }

  function uiCustomer(c, index, accountsByCustomer) {
    c = c && typeof c === 'object' ? c : {};
    var id = c.customer_id;
    var name = text(c.name, 'Cliente');
    return {
      id: id,
      customer_id: id,
      nombre: name,
      name: name,
      dni: text(c.document),
      document: text(c.document),
      tel: text(c.phone),
      phone: text(c.phone),
      dir: text(c.address),
      address: text(c.address),
      color: Number.isFinite(Number(c.color)) ? Number(c.color) : (Number(index) || 0) % 8,
      totalCompras: cents(c.total_purchases_cents),
      creditCategories: (accountsByCustomer.get(String(id)) || []).slice(),
      canonical: true
    };
  }

  function uiPayment(p, credit) {
    p = p && typeof p === 'object' ? p : {};
    credit = credit && typeof credit === 'object' ? credit : {};
    var known = !!p.payment_date_known;
    var operation = text(p.source_operation_reference);
    var seller = text(p.seller, 'Histórico');
    return {
      id: p.payment_id,
      pagoId: p.payment_id,
      creditoId: credit.credit_id !== undefined ? credit.credit_id : p.credit_id,
      clienteId: credit.customer_id,
      monto: cents(p.amount_cents),
      montoPagado: cents(p.amount_cents),
      fecha: known ? text(p.payment_date) : '',
      timestamp: known ? (p.payment_timestamp || p.payment_date || null) : null,
      canonicalDateKnown: known,
      datePrecision: p.date_precision,
      metodo: text(p.method || p.source_method, 'efectivo'),
      operacion: operation,
      numeroOperacion: operation,
      referencia: operation,
      cajero: seller,
      cajeroNombre: seller,
      canonical: true
    };
  }

  function safeInstallments(value) {
    return safeArrayJson(value).map(function (row, index) {
      row = row && typeof row === 'object' ? row : {};
      return {
        number: Number(row.number) || index + 1,
        due: text(row.due_date || row.due).slice(0, 10),
        amount: cents(row.amount_cents !== undefined ? row.amount_cents : number(row.amount, 0) * 100)
      };
    }).filter(function (row) { return row.number > 0; });
  }

  function uiCredit(c, customerById, paymentsByCredit) {
    c = c && typeof c === 'object' ? c : {};
    var issued = typeof c.issued_value === 'string' ? c.issued_value : (typeof c.created_at === 'string' ? c.created_at : '');
    var due = typeof c.due_value === 'string' ? c.due_value : (typeof c.due_date === 'string' ? c.due_date : '');
    var client = customerById.get(String(c.customer_id));
    var amount = cents(c.original_amount_cents);
    var balance = cents(c.current_balance_cents);
    var paid = Math.max(0, amount - balance);
    var seller = text(c.seller, 'Histórico');
    var description = text(c.concept || c.document_number || c.reference, 'Crédito histórico');
    var account = c.account_id ? {
      version: 2,
      categoryId: String(c.account_id),
      categoryName: text(c.account_name, 'Categoría'),
      mode: c.account_mode === 'separate' ? 'separate' : 'accumulated',
      source: 'canonical'
    } : null;
    var payments = (paymentsByCredit.get(String(c.credit_id)) || []).map(function (p) { return uiPayment(p, c); });
    return {
      id: c.credit_id,
      credit_id: c.credit_id,
      cliId: c.customer_id,
      clienteId: c.customer_id,
      customer_id: c.customer_id,
      ventaId: c.sale_id || null,
      sale_id: c.sale_id || null,
      clienteNombre: client && client.nombre || String(c.customer_id || ''),
      clienteDni: client && client.dni || '',
      desc: description,
      monto: amount,
      pagado: paid,
      saldo: balance,
      vence: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : '',
      canonicalDueKnown: /^\d{4}-\d{2}-\d{2}$/.test(due),
      fecha: /^\d{4}-\d{2}-\d{2}/.test(issued) ? issued.slice(0, 10) : '',
      timestamp: /^\d{4}-\d{2}-\d{2}T/.test(issued) ? issued : null,
      cajero: seller,
      cajeroNombre: seller,
      status: text(c.source_status || c.status),
      estado: text(c.source_status || c.status),
      anulado: false,
      pagos: payments,
      creditAccount: account,
      installments: safeInstallments(c.installments_json),
      items: [{
        itemKey: 'canonical:' + String(c.credit_id || ''),
        productoId: null,
        nombre: description,
        cantidad: 1,
        precioUnitario: amount,
        subtotal: amount,
        modo: 'concepto'
      }],
      canonical: true
    };
  }

  function snapshot(data) {
    if (!data || data.authority !== 'canonical') throw new Error('CANONICAL_SNAPSHOT_UNAVAILABLE');
    var accountsByCustomer = accountMap(data.creditAccounts);
    var customers = (Array.isArray(data.customers) ? data.customers : []).map(function (c, index) {
      return uiCustomer(c, index, accountsByCustomer);
    });
    var customerById = new Map(customers.map(function (c) { return [String(c.id), c]; }));
    var paymentsByCredit = new Map();
    (Array.isArray(data.payments) ? data.payments : []).forEach(function (p) {
      if (!p) return;
      var key = String(p.credit_id), list = paymentsByCredit.get(key) || [];
      list.push(p); paymentsByCredit.set(key, list);
    });
    var credits = (Array.isArray(data.credits) ? data.credits : []).map(function (c) {
      return uiCredit(c, customerById, paymentsByCredit);
    });
    return {
      products: (Array.isArray(data.products) ? data.products : []).map(uiProduct),
      customers: customers,
      credits: credits,
      payments: (Array.isArray(data.payments) ? data.payments : []).slice(),
      mode: data.mode,
      promotion_id: data.promotion_id,
      authority_epoch: data.authority_epoch,
      revision: data.revision,
      financial_revision: data.financial_revision,
      read_only: data.read_only
    };
  }

  root.NuevoAmanecerCanonicalUIAdapter = Object.freeze({
    VERSION: VERSION,
    product: uiProduct,
    customer: uiCustomer,
    credit: uiCredit,
    payment: uiPayment,
    snapshot: snapshot
  });
})(globalThis);
