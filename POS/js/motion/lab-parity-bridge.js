(function (root) {
  'use strict';

  var motion = root.NA_MOTION;
  if (!motion || !motion.page || !motion.scroll || typeof document === 'undefined') return;

  var presetByPage = Object.freeze({
    pageClientes: 'clientes',
    pageInventario: 'inventario',
    pageVentas: 'ventas',
    pageCaja: 'caja',
    pageGastos: 'gastos'
  });

  var bound = typeof WeakSet === 'function' ? new WeakSet() : null;
  var activeState = typeof WeakMap === 'function' ? new WeakMap() : null;
  var observers = [];

  function wasActive(page) {
    return activeState ? activeState.get(page) === true : page.__naMotionParityActive === true;
  }

  function remember(page, active) {
    if (activeState) activeState.set(page, !!active);
    else page.__naMotionParityActive = !!active;
  }

  function emit(page, preset) {
    try {
      root.dispatchEvent(new CustomEvent('na:motion-page-active', {
        detail: { pageId: page.id || '', preset: preset || null }
      }));
    } catch (_) {}
  }

  function syncPage(page) {
    if (!page || !page.classList) return;
    var active = page.classList.contains('active');
    var previous = wasActive(page);
    remember(page, active);
    if (!active || previous) return;

    try {
      if (motion.page && typeof motion.page.enter === 'function') {
        motion.page.enter(page, 'lab-enter-fade');
      }
    } catch (_) {}

    var preset = presetByPage[page.id] || null;
    if (preset) {
      try {
        var controller = motion.scroll && typeof motion.scroll.enablePreset === 'function'
          ? motion.scroll.enablePreset(preset)
          : null;
        if (controller && typeof controller.sync === 'function') controller.sync();
      } catch (_) {}
    }

    emit(page, preset);
  }

  function bindPage(page) {
    if (!page || (bound && bound.has(page))) return;
    if (bound) bound.add(page);
    remember(page, false);

    if (typeof MutationObserver === 'function') {
      var observer = new MutationObserver(function () { syncPage(page); });
      observer.observe(page, { attributes: true, attributeFilter: ['class'] });
      observers.push(observer);
    }

    syncPage(page);
  }

  function bindAll() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('.page').forEach(bindPage);
  }

  function resyncActive() {
    if (!document.querySelectorAll) return;
    document.querySelectorAll('.page').forEach(syncPage);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAll, { once: true });
  } else {
    bindAll();
  }

  root.addEventListener('pageshow', resyncActive);

  motion.labParity = Object.assign(motion.labParity || {}, {
    sync: resyncActive,
    presetForPage: function (pageId) { return presetByPage[String(pageId || '')] || null; },
    inspect: function () {
      var active = document.querySelector ? document.querySelector('.page.active') : null;
      return {
        activePageId: active ? active.id : null,
        activePreset: active ? (presetByPage[active.id] || null) : null,
        observerCount: observers.length
      };
    }
  });
})(window);
