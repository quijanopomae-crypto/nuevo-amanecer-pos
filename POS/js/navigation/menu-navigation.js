(function (root) {
  'use strict';

  if (typeof document === 'undefined') return;

  var MOBILE_HOME_MAX_WIDTH = 767;
  var ALLOWED_PAGES = Object.freeze([
    'pagePOS',
    'pageInventario',
    'pageVentas',
    'pageClientes',
    'pageCaja',
    'pageGastos',
    'pageConfig'
  ]);
  var MOBILE_SCROLL_PAGES = Object.freeze({
    pageInventario:true,
    pageClientes:true,
    pageVentas:true,
    pageCaja:true,
    pageGastos:true
  });
  var allowed = Object.create(null);
  ALLOWED_PAGES.forEach(function (id) { allowed[id] = true; });

  var activeTouch = null;
  var suppressClick = null;
  var mobileActivityObserver = null;
  var MOVE_TOLERANCE_PX = 12;
  var SYNTHETIC_CLICK_WINDOW_MS = 900;

  function now() {
    return root.performance && typeof root.performance.now === 'function'
      ? root.performance.now()
      : Date.now();
  }

  function isMobile() {
    return Number(root.innerWidth || 0) <= MOBILE_HOME_MAX_WIDTH;
  }

  function pageForCard(card) {
    if (!card || typeof card.getAttribute !== 'function') return null;
    var dataPage = card.getAttribute('data-page');
    if (dataPage && allowed[dataPage]) return dataPage;

    var inline = card.getAttribute('onclick') || '';
    var match = inline.match(/goPage\(\s*['"]([^'"]+)['"]\s*\)/);
    return match && allowed[match[1]] ? match[1] : null;
  }

  function cardFromTarget(target) {
    if (!target || typeof target.closest !== 'function') return null;
    var card = target.closest('.module-card');
    if (!card || typeof card.closest !== 'function') return null;
    return card.closest('#pageMenu') ? card : null;
  }

  function stopEvent(event) {
    if (!event) return;
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (typeof event.stopPropagation === 'function') event.stopPropagation();
  }

  function paintThen(callback) {
    var raf = typeof root.requestAnimationFrame === 'function'
      ? root.requestAnimationFrame.bind(root)
      : function (cb) { return root.setTimeout(cb, 16); };
    raf(function () { raf(callback); });
  }

  function scheduleRenderer(pageId) {
    var run = function () {
      if (typeof root._naSchedulePageRender === 'function') {
        root._naSchedulePageRender(pageId);
      }
    };
    if (typeof root.requestIdleCallback === 'function') {
      root.requestIdleCallback(run, { timeout: 700 });
    } else {
      root.setTimeout(run, 80);
    }
  }

  function persistVisiblePage(target) {
    if (!target || !target.classList || !target.classList.contains('active')) return;
    if (typeof root.saveAppState !== 'function') return;
    try {
      var pending = root.saveAppState();
      if (pending && typeof pending.catch === 'function') pending.catch(function () {});
    } catch (_) {}
  }

  function scheduleClientScrollMotion(pageId, target) {
    if (pageId !== 'pageClientes') return;

    var run = function () {
      if (!target || !target.classList || !target.classList.contains('active')) return;
      if (!document.body || !document.body.classList.contains('module-mobile-scroll')) return;

      var motion = root.NA_MOTION;
      if (!motion || !motion.scroll || typeof motion.scroll.enablePreset !== 'function') return;

      try {
        var controller = motion.scroll.enablePreset('clientes');
        if (controller && typeof controller.sync === 'function') controller.sync();
      } catch (_) {
        // Motion is optional. Navigation and rendering must remain usable even
        // when the visual runtime is unavailable on a phone.
      }
    };

    if (typeof root.requestIdleCallback === 'function') {
      root.requestIdleCallback(run, { timeout: 900 });
    } else {
      root.setTimeout(run, 120);
    }
  }

  function mobileSafeNavigate(pageId) {
    if (!allowed[pageId]) return false;
    var target = document.getElementById(pageId);
    if (!target) return false;

    root.NA_MOBILE_SAFE_NAV_ACTIVE = true;

    document.documentElement.classList.remove('config-page-scroll', 'cfg-menu-lock');
    if (document.body) {
      document.body.classList.remove('config-page-scroll', 'module-mobile-scroll');
    }

    document.querySelectorAll('.page').forEach(function (page) {
      page.classList.remove('active');
    });
    target.classList.add('active');

    var back = document.getElementById('backBtn');
    if (back) back.style.display = 'block';

    try { root.scrollTo(0, 0); } catch (_) {}

    paintThen(function () {
      if (!target.classList.contains('active')) return;

      var configMode = pageId === 'pageConfig' && Number(root.innerWidth || 0) <= 960;
      if (configMode) {
        document.documentElement.classList.add('config-page-scroll');
        if (document.body) document.body.classList.add('config-page-scroll');
      }

      if (document.body && MOBILE_SCROLL_PAGES[pageId]) {
        document.body.classList.add('module-mobile-scroll');
      }

      // Persist only after the destination has painted so storage work never
      // competes with the visual page switch on mobile.
      persistVisiblePage(target);
      scheduleRenderer(pageId);
      scheduleClientScrollMotion(pageId, target);
    });

    return true;
  }

  function navigate(pageId) {
    if (!allowed[pageId]) return false;
    if (isMobile()) return mobileSafeNavigate(pageId);
    if (typeof root.goPage !== 'function') return false;
    root.goPage(pageId);
    return true;
  }

  function activateCard(card, event) {
    var pageId = pageForCard(card);
    if (!pageId) return false;
    stopEvent(event);
    return navigate(pageId);
  }

  function prepareCards(menu) {
    if (!menu || typeof menu.querySelectorAll !== 'function') return;
    menu.querySelectorAll('.module-card').forEach(function (card) {
      var pageId = pageForCard(card);
      if (!pageId) return;
      card.setAttribute('data-page', pageId);
      card.setAttribute('role', 'button');
      if (!card.hasAttribute('tabindex')) card.setAttribute('tabindex', '0');
      if (!card.hasAttribute('aria-label')) {
        var label = card.querySelector && card.querySelector('.module-label');
        var name = label && label.textContent ? label.textContent.trim() : pageId;
        card.setAttribute('aria-label', 'Abrir ' + name);
      }
    });
  }

  function node(tag, className, text) {
    var element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function ensureMobileStylesheet() {
    if (!isMobile() || typeof document.createElement !== 'function') return false;
    if (document.getElementById('naMobileHomeStyles')) return true;
    var head = document.head || (document.querySelector && document.querySelector('head'));
    if (!head || typeof head.appendChild !== 'function') return false;
    var link = node('link');
    link.id = 'naMobileHomeStyles';
    link.rel = 'stylesheet';
    link.href = 'css/canon-mobile-home.css';
    head.appendChild(link);
    return true;
  }

  function insertAfter(reference, element) {
    if (!reference || !reference.parentNode) return;
    reference.parentNode.insertBefore(element, reference.nextSibling);
  }

  function closeMobileDrawer() {
    var drawer = document.getElementById('naMobileDrawer');
    var overlay = document.getElementById('naMobileDrawerOverlay');
    var toggle = document.getElementById('naMobileMenuToggle');
    if (drawer) {
      drawer.classList.remove('is-open');
      drawer.setAttribute('aria-hidden', 'true');
    }
    if (overlay) overlay.classList.remove('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    if (document.body && document.body.classList) document.body.classList.remove('na-mobile-drawer-open');
  }

  function openMobileDrawer() {
    if (!isMobile()) return;
    var drawer = document.getElementById('naMobileDrawer');
    var overlay = document.getElementById('naMobileDrawerOverlay');
    var toggle = document.getElementById('naMobileMenuToggle');
    if (!drawer || !overlay) return;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    overlay.classList.add('is-open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    if (document.body && document.body.classList) document.body.classList.add('na-mobile-drawer-open');
  }

  function showMobileHome() {
    closeMobileDrawer();
    if (typeof root.goMenu === 'function') {
      root.goMenu();
    } else {
      document.querySelectorAll('.page').forEach(function (page) { page.classList.remove('active'); });
      var menu = document.getElementById('pageMenu');
      if (menu) menu.classList.add('active');
      var back = document.getElementById('backBtn');
      if (back) back.style.display = 'none';
    }
    refreshMobileActivity();
  }

  function navigateFromMobileHome(pageId) {
    closeMobileDrawer();
    if (root.NA_MENU_NAVIGATION && typeof root.NA_MENU_NAVIGATION.navigate === 'function') {
      return root.NA_MENU_NAVIGATION.navigate(pageId);
    }
    return navigate(pageId);
  }

  function quickAction(label, icon, description, pageId) {
    var button = node('button', 'na-mobile-quick-action');
    button.type = 'button';
    button.setAttribute('aria-label', label);
    var iconNode = node('span', 'na-mobile-quick-icon', icon);
    iconNode.setAttribute('aria-hidden', 'true');
    var copy = node('span', 'na-mobile-quick-copy');
    copy.appendChild(node('strong', '', label));
    copy.appendChild(node('small', '', description));
    var chevron = node('span', 'na-mobile-quick-chevron', '›');
    chevron.setAttribute('aria-hidden', 'true');
    button.appendChild(iconNode);
    button.appendChild(copy);
    button.appendChild(chevron);
    button.addEventListener('click', function () { navigateFromMobileHome(pageId); });
    return button;
  }

  function drawerItem(label, icon, pageId) {
    var button = node('button', 'na-mobile-drawer-link');
    button.type = 'button';
    var iconNode = node('span', 'na-mobile-drawer-icon', icon);
    iconNode.setAttribute('aria-hidden', 'true');
    button.appendChild(iconNode);
    button.appendChild(node('span', 'na-mobile-drawer-label', label));
    button.appendChild(node('span', 'na-mobile-drawer-chevron', '›'));
    button.addEventListener('click', function () {
      if (pageId === 'pageMenu') showMobileHome();
      else navigateFromMobileHome(pageId);
    });
    return button;
  }

  function saleRows() {
    var rows = typeof ventas !== 'undefined' && Array.isArray(ventas) ? ventas : root.ventas;
    return Array.isArray(rows) ? rows : [];
  }

  function saleStamp(sale) {
    if (!sale) return 0;
    var raw = sale.timestamp || sale.createdAt || sale.fechaCreacion || '';
    var parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
    var date = String(sale.fecha || '');
    var time = String(sale.hora24 || sale.hora || '00:00:00').slice(0, 8);
    parsed = Date.parse(date + 'T' + (/^\d{2}:\d{2}/.test(time) ? time : '00:00:00'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function saleAmount(sale) {
    if (!sale) return 0;
    if (typeof totalV === 'function') {
      try { return Number(totalV(sale)) || 0; } catch (_) {}
    }
    return Number(sale.total || sale.monto || 0) || 0;
  }

  function money(value) {
    if (typeof fmt === 'function') {
      try { return fmt(value); } catch (_) {}
    }
    return 'S/ ' + Number(value || 0).toFixed(2);
  }

  function activityRow(icon, title, detail, amount, tone) {
    var row = node('div', 'na-mobile-activity-row' + (tone ? ' is-' + tone : ''));
    var iconNode = node('span', 'na-mobile-activity-icon', icon);
    iconNode.setAttribute('aria-hidden', 'true');
    var copy = node('span', 'na-mobile-activity-copy');
    copy.appendChild(node('strong', '', title));
    copy.appendChild(node('small', '', detail));
    row.appendChild(iconNode);
    row.appendChild(copy);
    if (amount) row.appendChild(node('span', 'na-mobile-activity-value', amount));
    return row;
  }

  function textOf(id, fallback) {
    var element = document.getElementById(id);
    var value = element && element.textContent ? element.textContent.trim() : '';
    return value || fallback;
  }

  function refreshMobileActivity() {
    if (!isMobile()) return;
    var list = document.getElementById('naMobileActivityList');
    if (!list || typeof list.replaceChildren !== 'function') return;

    var activeSales = saleRows().filter(function (sale) { return sale && !sale.anulada; }).slice();
    activeSales.sort(function (a, b) { return saleStamp(b) - saleStamp(a); });
    var latest = activeSales[0];
    var fragment = document.createDocumentFragment ? document.createDocumentFragment() : node('div');

    if (latest) {
      var saleId = String(latest.id || latest.ventaId || 'reciente').replace(/^V-/, '#');
      var customer = latest.clienteNombre || latest.customerName || latest.cliente || 'Venta registrada';
      fragment.appendChild(activityRow('🛒', 'Venta ' + saleId, String(customer), money(saleAmount(latest)), 'sale'));
    } else {
      fragment.appendChild(activityRow('🛒', 'Sin ventas recientes', 'La actividad aparecerá aquí cuando registres movimientos.', '', 'muted'));
    }

    fragment.appendChild(activityRow('🧾', 'Cuentas por cobrar', textOf('qsPorCobrarSub', 'Sin créditos activos'), textOf('qsPorCobrar', 'S/ 0.00'), 'credit'));
    fragment.appendChild(activityRow('📦', 'Stock crítico', textOf('qsStockCriticoSub', 'productos por reponer'), textOf('qsStockCritico', '0'), 'stock'));
    fragment.appendChild(activityRow('💵', 'Estado de caja', textOf('qsCajaSub', 'Caja no abierta'), textOf('qsCaja', 'S/ 0.00'), 'cash'));
    list.replaceChildren(fragment);
  }

  function ensureMobileHome() {
    if (!isMobile() || typeof document.createElement !== 'function' || !document.body) return false;
    ensureMobileStylesheet();
    var page = document.getElementById('pageMenu');
    if (!page || typeof page.querySelector !== 'function') return false;
    var scroll = page.querySelector('.main-scroll.home-shell');
    var stats = page.querySelector('.quick-stats');
    if (!scroll || !stats) return false;

    if (!document.getElementById('naMobileWelcome')) {
      var welcome = node('section', 'na-mobile-welcome');
      welcome.id = 'naMobileWelcome';
      var welcomeCopy = node('div', 'na-mobile-welcome-copy');
      welcomeCopy.appendChild(node('span', 'na-mobile-welcome-kicker', 'Panel principal'));
      welcomeCopy.appendChild(node('h1', '', 'Hola 👋'));
      welcomeCopy.appendChild(node('p', '', '¿Qué quieres hacer hoy?'));
      welcome.appendChild(welcomeCopy);
      var summaryLabel = null;
      Array.prototype.forEach.call(page.querySelectorAll('.section-label'), function (label) {
        var text = String(label.textContent || '').trim().toLowerCase();
        if (text === 'resumen') summaryLabel = label;
        if (text === 'módulos principales') label.classList.add('menu-modules-label');
      });
      scroll.insertBefore(welcome, summaryLabel || scroll.firstChild);
    }

    if (!document.getElementById('naMobileQuickActions')) {
      var quickSection = node('section', 'na-mobile-home-section na-mobile-quick-actions');
      quickSection.id = 'naMobileQuickActions';
      var quickHead = node('div', 'na-mobile-section-head');
      quickHead.appendChild(node('h2', '', 'Acciones rápidas'));
      quickHead.appendChild(node('span', '', 'Accesos directos'));
      quickSection.appendChild(quickHead);
      var quickGrid = node('div', 'na-mobile-quick-grid');
      quickGrid.appendChild(quickAction('Nueva venta', '🛒', 'Abrir el Punto de Venta', 'pagePOS'));
      quickGrid.appendChild(quickAction('Registrar abono', '💳', 'Ir a créditos del cliente', 'pageClientes'));
      quickGrid.appendChild(quickAction('Ingresar mercadería', '📦', 'Registrar movimiento de inventario', 'pageInventario'));
      quickGrid.appendChild(quickAction('Registrar gasto', '🧾', 'Abrir módulo de gastos', 'pageGastos'));
      quickGrid.appendChild(quickAction('Buscar cliente', '👥', 'Consultar saldos y créditos', 'pageClientes'));
      quickGrid.appendChild(quickAction('Abrir / cerrar caja', '💵', 'Controlar el turno de caja', 'pageCaja'));
      quickSection.appendChild(quickGrid);
      insertAfter(stats, quickSection);
    }

    if (!document.getElementById('naMobileActivity')) {
      var activitySection = node('section', 'na-mobile-home-section na-mobile-activity');
      activitySection.id = 'naMobileActivity';
      var activityHead = node('div', 'na-mobile-section-head');
      activityHead.appendChild(node('h2', '', 'Actividad reciente'));
      activityHead.appendChild(node('span', '', 'Estado del negocio'));
      activitySection.appendChild(activityHead);
      var list = node('div', 'na-mobile-activity-list');
      list.id = 'naMobileActivityList';
      activitySection.appendChild(list);
      var quickSectionRef = document.getElementById('naMobileQuickActions');
      insertAfter(quickSectionRef || stats, activitySection);
    }

    if (!document.getElementById('naMobileMenuToggle')) {
      var topbar = document.querySelector && document.querySelector('.g-topbar');
      if (topbar && typeof topbar.insertBefore === 'function') {
        var toggle = node('button', 'na-mobile-menu-toggle', '☰');
        toggle.id = 'naMobileMenuToggle';
        toggle.type = 'button';
        toggle.setAttribute('aria-label', 'Abrir menú principal');
        toggle.setAttribute('aria-controls', 'naMobileDrawer');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.addEventListener('click', openMobileDrawer);
        topbar.insertBefore(toggle, topbar.firstChild);
      }
    }

    if (!document.getElementById('naMobileDrawerOverlay')) {
      var overlay = node('div', 'na-mobile-drawer-overlay');
      overlay.id = 'naMobileDrawerOverlay';
      overlay.addEventListener('click', closeMobileDrawer);
      document.body.appendChild(overlay);
    }

    if (!document.getElementById('naMobileDrawer')) {
      var drawer = node('aside', 'na-mobile-drawer');
      drawer.id = 'naMobileDrawer';
      drawer.setAttribute('aria-label', 'Navegación principal');
      drawer.setAttribute('aria-hidden', 'true');

      var drawerHead = node('div', 'na-mobile-drawer-head');
      drawerHead.appendChild(node('div', 'na-mobile-drawer-brand-icon', '🌅'));
      var brand = node('div', 'na-mobile-drawer-brand');
      brand.appendChild(node('strong', '', 'Nuevo Amanecer'));
      brand.appendChild(node('span', '', 'Sistema de gestión comercial'));
      drawerHead.appendChild(brand);
      var close = node('button', 'na-mobile-drawer-close', '✕');
      close.type = 'button';
      close.setAttribute('aria-label', 'Cerrar menú');
      close.addEventListener('click', closeMobileDrawer);
      drawerHead.appendChild(close);
      drawer.appendChild(drawerHead);

      var navigation = node('nav', 'na-mobile-drawer-nav');
      navigation.appendChild(drawerItem('Inicio', '⌂', 'pageMenu'));
      navigation.appendChild(drawerItem('Punto de Venta', '🛒', 'pagePOS'));
      navigation.appendChild(drawerItem('Ventas', '📊', 'pageVentas'));
      navigation.appendChild(drawerItem('Inventario', '📦', 'pageInventario'));
      navigation.appendChild(drawerItem('Clientes', '👥', 'pageClientes'));
      navigation.appendChild(drawerItem('Cuentas por cobrar', '💳', 'pageClientes'));
      navigation.appendChild(drawerItem('Caja', '💵', 'pageCaja'));
      navigation.appendChild(drawerItem('Gastos', '🧾', 'pageGastos'));
      var divider = node('div', 'na-mobile-drawer-divider');
      divider.setAttribute('aria-hidden', 'true');
      navigation.appendChild(divider);
      navigation.appendChild(drawerItem('Configuración', '⚙️', 'pageConfig'));
      drawer.appendChild(navigation);
      document.body.appendChild(drawer);
    }

    refreshMobileActivity();

    if (!mobileActivityObserver && root.MutationObserver) {
      mobileActivityObserver = new root.MutationObserver(function () { refreshMobileActivity(); });
      try { mobileActivityObserver.observe(stats, { subtree:true, childList:true, characterData:true }); } catch (_) {}
    }
    return true;
  }

  function bindMobileHomeEvents() {
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', function (event) {
        if (event && event.key === 'Escape') closeMobileDrawer();
      });
    }
    if (typeof root.addEventListener === 'function') {
      root.addEventListener('resize', function () {
        if (!isMobile()) closeMobileDrawer();
        else ensureMobileHome();
      });
      root.addEventListener('pageshow', function () {
        if (isMobile()) {
          ensureMobileHome();
          refreshMobileActivity();
        }
      });
      root.addEventListener('na:canonical-updated', function () {
        if (isMobile()) refreshMobileActivity();
      });
    }
  }

  function bind() {
    var menu = document.getElementById('pageMenu');
    if (!menu || menu.getAttribute('data-na-menu-nav-bound') === '1') return;
    menu.setAttribute('data-na-menu-nav-bound', '1');
    prepareCards(menu);
    ensureMobileHome();
    bindMobileHomeEvents();

    menu.addEventListener('pointerdown', function (event) {
      if (!event || event.pointerType === 'mouse') return;
      var card = cardFromTarget(event.target);
      if (!card) return;
      activeTouch = {
        pointerId: event.pointerId,
        card: card,
        x: Number(event.clientX) || 0,
        y: Number(event.clientY) || 0
      };
    }, true);

    menu.addEventListener('pointerup', function (event) {
      if (!activeTouch || !event || event.pointerId !== activeTouch.pointerId) return;
      var touch = activeTouch;
      activeTouch = null;
      var card = cardFromTarget(event.target);
      var dx = Math.abs((Number(event.clientX) || 0) - touch.x);
      var dy = Math.abs((Number(event.clientY) || 0) - touch.y);
      var sameCard = card === touch.card;
      var isTap = sameCard && dx <= MOVE_TOLERANCE_PX && dy <= MOVE_TOLERANCE_PX;
      suppressClick = { card: touch.card, until: now() + SYNTHETIC_CLICK_WINDOW_MS };
      if (isTap) activateCard(touch.card, event);
    }, true);

    menu.addEventListener('pointercancel', function () {
      activeTouch = null;
    }, true);

    menu.addEventListener('click', function (event) {
      var card = cardFromTarget(event.target);
      if (!card) return;

      if (suppressClick && suppressClick.card === card && now() <= suppressClick.until) {
        suppressClick = null;
        stopEvent(event);
        return;
      }
      suppressClick = null;
      activateCard(card, event);
    }, true);

    menu.addEventListener('keydown', function (event) {
      if (!event || (event.key !== 'Enter' && event.key !== ' ')) return;
      var card = cardFromTarget(event.target);
      if (!card) return;
      activateCard(card, event);
    }, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind, { once: true });
  } else {
    bind();
  }

  root.NA_MENU_NAVIGATION = Object.freeze({
    bind: bind,
    navigate: navigate,
    mobileSafeNavigate: mobileSafeNavigate,
    openMobileDrawer: openMobileDrawer,
    closeMobileDrawer: closeMobileDrawer,
    refreshMobileHome: refreshMobileActivity,
    pages: ALLOWED_PAGES.slice()
  });
})(window);
