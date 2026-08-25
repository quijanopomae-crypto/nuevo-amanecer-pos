/*
 * legacy-globals.js — UNICA fuente de verdad del contrato de globales V9 (FASE 6).
 *
 * Fuente: POS/index.html @ e58cd7b (rama modularization/fase6-offline-compat).
 * Derivacion ESTRUCTURAL (F6-ARC-0 v3): nombres extraidos de los handlers
 * on* de TODO el HTML fuera de los rangos de script (full-document) y de los
 * templates JS, y definiciones detectadas por el parser puro
 * tests/offline-compat/lib/pos-parse.mjs. NO se usan numeros de linea fijos.
 *
 * v3 (GLM SECOND ENGINEER — contrato v3): discovery full-document. El
 * extractor v2 solo miraba el HTML anterior al primer script inline y omitia
 * 9 globals reales (linea de credito manual F7 + disenador/emojis F12);
 * ademas ahora se excluyen de raiz las asignaciones JavaScript .on*= (6 en
 * el primer script inline). REQUIRED_GLOBALS pasa de 168 a 177.
 *
 * Este archivo NO ejecuta ninguna funcion de negocio, NO toca persistencia,
 * NO toca storage y NO invoca V10. Solo REGISTRA el contrato y expone
 * verify(win, lexicalProbe), que comprueba la presencia de los globales con
 * typeof unicamente (sin invocar nada). Ademas detecta bindings lexicos
 * top-level (const/let) que NO son propiedades de window.
 *
 * Classic script (sin ES modules, sin defer). Conexion al index.html: FASE 7
 * (final del body, dos lineas reversibles SIN defer, en orden: este archivo
 * primero y luego js/app.js). En FASE 6 este archivo NO esta conectado al
 * documento.
 */
(function () {
  'use strict';

  var REQUIRED_GLOBALS = Object.freeze([
    "_naCreditPaymentMethodChanged",
    "_naEsc",
    "_naF10AddSaleNote",
    "_naF10AdminAnnulSale",
    "_naF10DownloadSnapshot",
    "_naF10DraftPermission",
    "_naF10DraftRole",
    "_naF10ExportAuditCsv",
    "_naF10GoModule",
    "_naF10OpenCashierPermissions",
    "_naF10OpenSalesAdmin",
    "_naF10RenderSalesAdmin",
    "_naF10SavePermissions",
    "_naF10SetCashierPin",
    "_naF10SetCashierRole",
    "_naF12ChooseAutoSuggestion",
    "_naF12DesignerAddText",
    "_naF12DesignerLoadImage",
    "_naF12DesignerReset",
    "_naF12EnableAutoEmoji",
    "_naF12ManualIconChanged",
    "_naF12ProductNameChanged",
    "_naF12RemoveProductImage",
    "_naF12RenderEmojiPicker",
    "_naF12SaveCustomIcon",
    "_naF8CustomRangeChanged",
    "_naF8ExportReport",
    "_naF8ReportPeriodChanged",
    "_naF9EditProduct",
    "_naF9Export",
    "_naF9OpenDetail",
    "_naF9SetSetting",
    "_naF9Simulate",
    "_naUpdateAltBarcodeUI",
    "_naUpdateCreditPaymentPreview",
    "abrirCaja",
    "abrirCobro",
    "abrirCreadorIcono",
    "abrirCred",
    "abrirDescuento",
    "abrirDetalleCredito",
    "abrirDisenadorTicket",
    "abrirEvaluacionCredito",
    "abrirLineaCreditoManual",
    "abrirModalApertura",
    "abrirModalCli",
    "abrirModalGasto",
    "abrirModalProd",
    "abrirMovCaja",
    "abrirMovInv",
    "abrirPago",
    "abrirSelectorEmoji",
    "abrirVentaLibre",
    "actualizarAdvertenciaLineaManual",
    "actualizarDispositivosBluetooth",
    "actualizarResumenVentaLibre",
    "actualizarStockMinPredeterminado",
    "addAltBarcodeField",
    "agregarCategoriaProducto",
    "anularV",
    "aplicarStockMinATodos",
    "applyFontSize",
    "buscarImpresoraBluetooth",
    "cajSetTab",
    "calcAbono",
    "calcCambio",
    "calcDif",
    "calcMargen",
    "calcMixedPayment",
    "cancelarVenta",
    "cargarBorrador",
    "cargarCatalogoInicial",
    "cashierAddFromConfig",
    "cashierRenameFromConfig",
    "cashierSelectActive",
    "cashierToggleFromConfig",
    "cerrarCaja",
    "cerrarModal",
    "clearProductImportPreview",
    "cliRender",
    "cliSetTab",
    "closeCartMenu",
    "compartirTicketBluetooth",
    "confirmProductImport",
    "confirmarPago",
    "confirmarPagoRapido",
    "confirmarVenta",
    "confirmarVentaLibre",
    "creditPolicySetNumber",
    "creditPolicyToggleEnabled",
    "desconectarImpresora",
    "downloadProductTemplate",
    "editProd",
    "exportProductsExcel",
    "exportarRespaldo",
    "filterCfgCategories",
    "freeSaleSetShortcut",
    "freeSaleToggleSetting",
    "gasRender",
    "gasSetTab",
    "generarCatalogo",
    "goMenu",
    "goPage",
    "guardarAjustesImpresora",
    "guardarBorrador",
    "guardarCli",
    "guardarConfig",
    "guardarCred",
    "guardarGasto",
    "guardarLineaCreditoManual",
    "guardarMovCaja",
    "guardarMovInv",
    "guardarProd",
    "importProducts",
    "importarRespaldo",
    "imprimirPorConexion",
    "imprimirTicket",
    "imprimirTicketSistema",
    "invRender",
    "invSetTab",
    "limpiarCarrito",
    "posAdd",
    "posQty",
    "posRm",
    "posSetCat",
    "prepCierre",
    "previewImagen",
    "quitarDescuento",
    "reclasificarCatalogo",
    "removeAltBarcodeField",
    "renderTicketPreview",
    "resetModule",
    "restaurarLineaCreditoAutomatica",
    "scannerFocusTest",
    "scannerSetNumber",
    "scannerToggleSetting",
    "securityChangePin",
    "securityClearLog",
    "securityExportLog",
    "securityLockNow",
    "securitySetAutoLock",
    "securitySetMaxDiscount",
    "securityUnlock",
    "selPM",
    "setAccent",
    "setMixedCash",
    "setMontoExacto",
    "setMontoRecibido",
    "setMovType",
    "setProductInventoryControl",
    "switchCfgCategory",
    "ticketPreviewSizeChanged",
    "ticketWidthChanged",
    "ticketZoneDragEnd",
    "ticketZoneDragLeave",
    "ticketZoneDragOver",
    "ticketZoneDragStart",
    "ticketZoneDrop",
    "ticketZoneMove",
    "ticketZonePreset",
    "ticketZoneReset",
    "ticketZoneSet",
    "toggleCart",
    "toggleCartMenu",
    "toggleCfg",
    "toggleCfgMenu",
    "toggleCliCard",
    "toggleDark",
    "toggleEditor",
    "toggleMayorista",
    "toggleNewCategoryField",
    "toggleOtherCashAmounts",
    "toggleVDet",
    "usarPuertoAutorizado",
    "ventasRender",
    "ventasSetTab",
    "verTicket",
  ]);

  // Overrides congelados F6 (referencia semantica F6-ARC-0): subconjunto de los
  // override winners derivados estructuralmente. count = numero de definiciones;
  // el winner (ultima definicion) se deriva en runtime por posOverrideWinners.
  // Formato JSON estricto para poder leerlo con JSON.parse en pruebas.
  var OVERRIDE_WINNERS = Object.freeze([
    { "name": "confirmarVenta", "count": 2 },
    { "name": "guardarMovInv", "count": 3 },
    { "name": "posRender", "count": 2 },
    { "name": "cliRender", "count": 2 },
    { "name": "cajRender", "count": 2 },
    { "name": "abrirCred", "count": 4 },
    { "name": "ventasRender", "count": 3 },
    { "name": "gasRender", "count": 2 },
    { "name": "guardarProd", "count": 3 },
    { "name": "abrirModalProd", "count": 3 },
    { "name": "previewImagen", "count": 3 },
    { "name": "abrirCaja", "count": 2 },
    { "name": "abrirCobro", "count": 2 },
    { "name": "abrirDescuento", "count": 2 },
    { "name": "abrirModalCli", "count": 3 },
    { "name": "abrirModalGasto", "count": 3 },
    { "name": "cerrarCaja", "count": 2 },
    { "name": "confirmarPago", "count": 2 },
    { "name": "guardarCli", "count": 2 },
    { "name": "guardarConfig", "count": 2 },
    { "name": "guardarCred", "count": 3 },
    { "name": "guardarMovCaja", "count": 2 },
    { "name": "imprimirTicketSistema", "count": 2 },
    { "name": "invRender", "count": 2 },
    { "name": "selPM", "count": 2 },
    { "name": "switchCfgCategory", "count": 2 },
    { "name": "ventasSetTab", "count": 2 },
    { "name": "_naF8ExportReport", "count": 2 },
  ]);

  // Identificador JS valido. Se valida ANTES de cualquier uso dinamico (via
  // Function) para impedir inyeccion de codigo (p.ej. if;alert(1)).
  var IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$$/;

  /**
   * Comprueba si name es un identificador JS valido (seguridad).
   * @param {string} name
   * @returns {boolean}
   */
  function isValidName(name) {
    return IDENT_RE.test(name);
  }

  /**
   * Sonda lexica por defecto. window[name] NO ve los bindings lexicos
   * top-level declarados con const/let (no son propiedades de window; p.ej.
   * const cerrarModal). En cambio Function(...) evalua en el scope global
   * REAL, que si los ve. Es typeof-only: NUNCA invoca la funcion, solo
   * comprueba typeof name.
   * @param {string} name ya validado por isValidName
   * @returns {boolean}
   */
  function defaultLexicalProbe(name) {
    try {
      /* eslint-disable-next-line no-new-func */
      return (new Function('return typeof ' + name + ';')()) !== 'undefined';
    } catch (e) {
      return false;
    }
  }

  /**
   * Comprueba la presencia de todos los globales requeridos en win usando
   * UNICAMENTE typeof (nunca invoca ninguna funcion). No lee storage.
   *
   * Presencia = typeof win[name] !== 'undefined' O sonda lexica global. Los
   * nombres hallados SOLO via sonda lexica se reportan en lexical.
   *
   * @param {object} win
   * @param {function(string):boolean} [lexicalProbe] inyectable (tests); por
   *   defecto usa defaultLexicalProbe (Function en el scope global real).
   * @returns {{ok:boolean, missing:string[], checked:number, lexical:string[]}}
   */
  function verify(win, lexicalProbe) {
    var probe = (typeof lexicalProbe === 'function') ? lexicalProbe : defaultLexicalProbe;
    var missing = [];
    var lexical = [];
    var checked = 0;
    for (var i = 0; i < REQUIRED_GLOBALS.length; i += 1) {
      var name = REQUIRED_GLOBALS[i];
      checked += 1;
      // Seguridad: nunca usar name dinamicamente si no es un identificador.
      if (!isValidName(name)) {
        missing.push(name);
        continue;
      }
      var present = (typeof win[name] !== 'undefined');
      if (!present && probe(name) === true) {
        present = true;
        lexical.push(name);
      }
      if (!present) missing.push(name);
    }
    return { ok: missing.length === 0, missing: missing, checked: checked, lexical: lexical };
  }

  var root = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);

  root._NA_LEGACY_GLOBALS = Object.freeze({
    phase: 'f6',
    requiredGlobals: REQUIRED_GLOBALS,
    overrideWinners: OVERRIDE_WINNERS,
    verify: verify,
    isValidName: isValidName
  });
})();
