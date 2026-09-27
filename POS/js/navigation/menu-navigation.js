(function (root) {
  'use strict';

  if (typeof document === 'undefined') return;

  var ALLOWED_PAGES = Object.freeze([
    'pagePOS',
    'pageInventario',
    'pageVentas',
    'pageClientes',
    'pageCaja',
    'pageGastos',
    'pageConfig'
  ]);
  var allowed = Object.create(null);
  ALLOWED_PAGES.forEach(function (id) { allowed[id] = true; });

  var activeTouch = null;
  var suppressClick = null;
  var MOVE_TOLERANCE_PX = 12;
  var SYNTHETIC_CLICK_WINDOW_MS = 900;

  function now() {
    return root.performance && typeof root.performance.now === 'function'
      ? root.performance.now()
      : Date.now();
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

  function activateCard(card, event) {
    var pageId = pageForCard(card);
    if (!pageId || typeof root.goPage !== 'function') return false;
    stopEvent(event);
    root.goPage(pageId);
    return true;
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

  function bind() {
    var menu = document.getElementById('pageMenu');
    if (!menu || menu.getAttribute('data-na-menu-nav-bound') === '1') return;
    menu.setAttribute('data-na-menu-nav-bound', '1');
    prepareCards(menu);

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
    pages: ALLOWED_PAGES.slice()
  });
})(window);
