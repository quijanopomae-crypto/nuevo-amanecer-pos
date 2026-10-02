(function (root) {
  'use strict';

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function actionButton(symbol, label, handler) {
    var button = element('button', '');
    button.type = 'button';
    var icon = element('span', '', symbol);
    var text = element('span', '', label);
    button.append(icon, text);
    button.addEventListener('click', handler);
    return button;
  }

  function cartSnapshot() {
    try {
      if (typeof cart !== 'undefined' && Array.isArray(cart)) return cart;
    } catch (_) {}
    return [];
  }

  function updateCartMeta() {
    var items = cartSnapshot();
    var lines = items.length;
    var units = items.reduce(function (sum, item) {
      var qty = Number(item && item.qty);
      var factor = Number(item && item.unitsPerQty);
      if (!Number.isFinite(qty) || qty < 0) qty = 0;
      if (!Number.isFinite(factor) || factor < 1) factor = 1;
      return sum + qty * factor;
    }, 0);
    var productText = lines === 1 ? '1 producto' : lines + ' productos';
    var unitText = units === 1 ? '1 unidad' : units + ' unidades';
    var summary = document.getElementById('posCartSummary');
    var productCount = document.getElementById('posProductCount');
    var unitCount = document.getElementById('posUnitCount');
    if (summary) summary.textContent = productText;
    if (productCount) productCount.textContent = productText;
    if (unitCount) unitCount.textContent = unitText;
  }

  function decoratePrices() {
    var badges = document.querySelectorAll('#pagePOS #posArea .p-price-badge');
    badges.forEach(function (badge) {
      var text = String(badge.textContent || '').trim();
      if (!text || /\bx\s+(?:und|caja)\b/i.test(text)) return;
      var box = text.match(/^Caja\s+x\d+\s+·\s+(S\/\s*[\d.,]+)/i);
      if (box) {
        badge.textContent = box[1] + ' x caja';
        return;
      }
      if (/^S\/\s*[\d.,]+$/i.test(text)) badge.textContent = text + ' x und';
    });
  }

  function installToolbar(page) {
    var toolbar = page.firstElementChild;
    if (!toolbar || toolbar.classList.contains('pos-commandbar')) return;
    toolbar.classList.add('pos-commandbar');
    toolbar.removeAttribute('style');

    var search = toolbar.querySelector('.pos-search-box');
    if (!search) return;

    var identity = element('div', 'pos-module-identity');
    identity.setAttribute('aria-label', 'Punto de Venta Nuevo Amanecer');

    var menu = element('button', 'pos-menu-button', '☰');
    menu.type = 'button';
    menu.title = 'Volver al menú';
    menu.setAttribute('aria-label', 'Volver al menú');
    menu.addEventListener('click', function () {
      if (typeof root.goMenu === 'function') root.goMenu();
    });

    var mark = element('div', 'pos-module-mark', '🛒');
    mark.setAttribute('aria-hidden', 'true');

    var copy = element('div', 'pos-module-copy');
    copy.append(element('strong', '', 'Nuevo Amanecer'), element('span', '', 'PUNTO DE VENTA'));
    identity.append(menu, mark, copy);
    toolbar.insertBefore(identity, search);

    var searchIcon = search.querySelector('span:first-child');
    if (searchIcon && searchIcon.id !== 'scannerIndicator') {
      searchIcon.classList.add('pos-search-icon');
      searchIcon.textContent = '⌕';
      searchIcon.removeAttribute('style');
      searchIcon.setAttribute('aria-hidden', 'true');
    }
    var input = search.querySelector('#posSearch');
    if (input) input.placeholder = 'Buscar productos o escanear código...';

    var free = toolbar.querySelector('#btnVentaLibre');
    var cartButton = toolbar.querySelector('.cart-fab');
    var major = toolbar.querySelector('#btnMayorista');
    var actions = element('div', 'pos-toolbar-actions');
    if (free) {
      free.replaceChildren(document.createTextNode('＋ '), element('span', 'free-sale-label', 'VARIOS'));
      actions.appendChild(free);
    }
    if (major) {
      major.classList.add('pos-majorista-btn');
      major.removeAttribute('style');
      major.replaceChildren(document.createTextNode('▣ '), element('span', '', 'Mayor'));
      actions.appendChild(major);
    }
    if (cartButton) {
      cartButton.type = 'button';
      cartButton.title = 'Ver venta actual';
      cartButton.setAttribute('aria-label', 'Ver venta actual');
      actions.appendChild(cartButton);
    }
    toolbar.appendChild(actions);
  }

  function installCartHead(page) {
    var head = page.querySelector('#cartDrawer .cart-head');
    if (!head || head.querySelector('#posCartSummary')) return;

    var title = head.querySelector('.cart-head-title');
    var actionHost = title && title.nextElementSibling;
    if (!title || !actionHost) return;

    var tag = title.querySelector('#modoMayoristaTag');
    if (tag) tag.remove();
    title.textContent = 'Venta actual';
    if (tag) {
      tag.className = 'cart-mode-tag';
      tag.setAttribute('style', 'display:none');
      title.append(document.createTextNode(' '), tag);
    }

    var copy = element('div', 'cart-head-copy');
    head.insertBefore(copy, title);
    copy.appendChild(title);
    copy.appendChild(element('div', 'cart-head-sub', '0 productos')).id = 'posCartSummary';

    actionHost.classList.add('cart-head-actions');
    actionHost.removeAttribute('style');
    var menuWrap = actionHost.firstElementChild;
    if (menuWrap) {
      menuWrap.classList.add('cart-menu-wrap');
      menuWrap.removeAttribute('style');
    }
    var dropdown = page.querySelector('#cartMenuDropdown');
    if (dropdown) {
      dropdown.classList.add('cart-menu-dropdown');
      dropdown.setAttribute('style', 'display:none');
      var separator = dropdown.querySelector('div');
      if (separator) {
        separator.className = 'cart-menu-separator';
        separator.removeAttribute('style');
      }
      var danger = dropdown.querySelector('button[onclick="limpiarCarrito()"]');
      if (danger) {
        danger.classList.add('cart-menu-danger');
        danger.removeAttribute('style');
      }
    }

    var closeButtons = actionHost.querySelectorAll('.btn-close-x');
    if (closeButtons.length > 1) {
      closeButtons[closeButtons.length - 1].classList.add('cart-mobile-close');
      closeButtons[closeButtons.length - 1].title = 'Cerrar venta actual';
      closeButtons[closeButtons.length - 1].setAttribute('aria-label', 'Cerrar venta actual');
    }
  }

  function installCartFooter(page) {
    var footer = page.querySelector('#cartDrawer .cart-footer');
    if (!footer || footer.querySelector('.cart-secondary-actions')) return;
    var totals = footer.querySelector('.cart-totals');
    var actions = footer.querySelector('.cart-actions');
    if (!totals || !actions) return;

    var secondary = element('div', 'cart-secondary-actions');
    secondary.setAttribute('aria-label', 'Acciones rápidas de venta');
    secondary.append(
      actionButton('％', 'Descuento', function () { if (typeof root.abrirDescuento === 'function') root.abrirDescuento(); }),
      actionButton('▣', 'Mayorista', function () { if (typeof root.toggleMayorista === 'function') root.toggleMayorista(); }),
      actionButton('＋', 'VARIOS', function () { if (typeof root.abrirVentaLibre === 'function') root.abrirVentaLibre(); })
    );
    footer.insertBefore(secondary, totals);

    var countLine = element('div', 'cart-count-line');
    var productCount = element('span', '', '0 productos');
    productCount.id = 'posProductCount';
    var unitCount = element('span', '', '0 unidades');
    unitCount.id = 'posUnitCount';
    countLine.append(productCount, unitCount);
    totals.insertBefore(countLine, totals.firstChild);

    var quick = page.querySelector('#btnRapido');
    var pay = page.querySelector('#btnPagar');
    if (quick) {
      quick.replaceChildren(element('span', 'pay-action-icon', '⚡'), element('span', '', 'Pago rápido'));
    }
    if (pay) {
      pay.replaceChildren(element('span', 'pay-action-icon', '▰'), element('span', '', 'Pagar'));
    }
    var cancel = actions.querySelector('.btn-cancelar-cart');
    if (cancel) cancel.textContent = '🗑️ Limpiar venta';
  }

  function installObservers(page) {
    var products = page.querySelector('#posArea');
    var cartItems = page.querySelector('#cartItems');
    if (typeof MutationObserver !== 'function') return;
    if (products) new MutationObserver(decoratePrices).observe(products, { childList: true, subtree: true });
    if (cartItems) new MutationObserver(updateCartMeta).observe(cartItems, { childList: true, subtree: true });
  }

  function wrapRenderers() {
    if (typeof root.posRender === 'function' && !root.posRender.__naReferenceUiWrapped) {
      var originalRender = root.posRender;
      var wrappedRender = function () {
        var result = originalRender.apply(this, arguments);
        decoratePrices();
        return result;
      };
      wrappedRender.__naReferenceUiWrapped = true;
      root.posRender = wrappedRender;
    }

    if (typeof root.posUpdateCart === 'function' && !root.posUpdateCart.__naReferenceUiWrapped) {
      var originalUpdate = root.posUpdateCart;
      var wrappedUpdate = function () {
        var result = originalUpdate.apply(this, arguments);
        updateCartMeta();
        return result;
      };
      wrappedUpdate.__naReferenceUiWrapped = true;
      root.posUpdateCart = wrappedUpdate;
    }
  }

  function install() {
    var page = document.getElementById('pagePOS');
    if (!page || page.dataset.naReferenceUi === '1') return;
    page.dataset.naReferenceUi = '1';
    installToolbar(page);
    installCartHead(page);
    installCartFooter(page);
    wrapRenderers();
    installObservers(page);
    decoratePrices();
    updateCartMeta();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})(globalThis);
