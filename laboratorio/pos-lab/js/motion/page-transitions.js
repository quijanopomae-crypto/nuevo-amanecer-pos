(function () {
  'use strict';
  if (!window.__NA_LAB__) return;

  const motion = window.NA_LAB_MOTION = window.NA_LAB_MOTION || {};

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function parseTimeMs(value, fallbackMs) {
    const text = String(value || '').trim();
    if (!text) return fallbackMs;
    const parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) return fallbackMs;
    if (text.endsWith('ms')) return parsed;
    if (text.endsWith('s')) return parsed * 1000;
    return fallbackMs;
  }

  function cssTimeMs(element, propertyName, fallbackMs) {
    if (!element || !propertyName || typeof getComputedStyle !== 'function') return fallbackMs;
    const style = getComputedStyle(element);
    return parseTimeMs(style.getPropertyValue(propertyName), fallbackMs);
  }

  function restartClass(element, className) {
    if (!element || !className) return false;
    element.classList.remove(className);
    void element.offsetWidth;
    element.classList.add(className);
    return true;
  }

  function setState(element, state) {
    if (!element) return state || 'idle';
    element.dataset.labMotionState = state || 'idle';
    return element.dataset.labMotionState;
  }

  function getState(element) {
    if (!element || !element.dataset) return 'idle';
    return element.dataset.labMotionState || 'idle';
  }

  function setProgress(element, value) {
    const progress = clamp(Number(value) || 0, 0, 1);
    if (element && element.style) {
      element.style.setProperty('--lab-motion-progress', progress.toFixed(4));
    }
    return progress;
  }

  function inspect(element) {
    const raw = element && element.style
      ? element.style.getPropertyValue('--lab-motion-progress')
      : '';
    const parsed = Number.parseFloat(raw);
    return {
      state: getState(element),
      progress: Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 0,
      reducedMotion: reducedMotion()
    };
  }

  function whenTransitionEnds(element, options, callback) {
    const config = options || {};
    const propertyName = config.propertyName || '';
    const fallbackMs = Math.max(0, Number(config.fallbackMs) || 0);
    let done = false;
    let timer = null;

    function cleanup() {
      if (timer !== null) window.clearTimeout(timer);
      if (element && element.removeEventListener) {
        element.removeEventListener('transitionend', onEnd);
        element.removeEventListener('transitioncancel', onCancel);
      }
    }

    function finish() {
      if (done) return;
      done = true;
      cleanup();
      if (typeof callback === 'function') callback();
    }

    function cancel() {
      if (done) return;
      done = true;
      cleanup();
    }

    function onEnd(event) {
      if (!event || event.target !== element) return;
      if (propertyName && event.propertyName !== propertyName) return;
      finish();
    }

    function onCancel(event) {
      if (event && event.target && event.target !== element) return;
      finish();
    }

    if (!element || !element.addEventListener) {
      timer = window.setTimeout(finish, fallbackMs);
      return cancel;
    }

    element.addEventListener('transitionend', onEnd);
    element.addEventListener('transitioncancel', onCancel);
    timer = window.setTimeout(finish, fallbackMs);
    return cancel;
  }

  motion.core = Object.assign(motion.core || {}, {
    clamp,
    reducedMotion,
    parseTimeMs,
    cssTimeMs,
    restartClass,
    setState,
    getState,
    setProgress,
    inspect,
    whenTransitionEnds
  });

  motion.enterPage = function (element) {
    return motion.core.restartClass(element, 'lab-enter-fade');
  };

  /* Módulos móviles: una sola geometría visual, basada en scroll nativo.
     Clientes, Inventario, Ventas y Gastos recortan únicamente bandas secundarias
     al pie del page-chrome. Caja conserva título/pestañas y aplica el mismo
     feedback visual a su resumen superior cuando existe desplazamiento natural. */
  (function bindMobileScrollLinkedChrome() {
    const core = motion.core;
    if (!core ||
        typeof document === 'undefined' ||
        typeof document.getElementById !== 'function' ||
        !document.body) return;

    const configs = [
      {
        key: 'clientes',
        pageId: 'pageClientes',
        clipChrome: true,
        secondarySelectors: ['.filter-bar', '.stats-strip']
      },
      {
        key: 'inventario',
        pageId: 'pageInventario',
        clipChrome: true,
        secondarySelectors: ['.filter-bar', '.stats-strip']
      },
      {
        key: 'ventas',
        pageId: 'pageVentas',
        clipChrome: true,
        secondarySelectors: ['#ventasFilterBar', '#ventasReportControls', '#ventasKPI']
      },
      {
        key: 'caja',
        pageId: 'pageCaja',
        clipChrome: false,
        secondarySelectors: [
          '#cajContent > .caj-banner-wrap',
          '#cajContent > .cj-stats-grid',
          '#cajContent > div:first-child > .banner-cerrada-cj'
        ],
        observeSelector: '#cajContent'
      },
      {
        key: 'gastos',
        pageId: 'pageGastos',
        clipChrome: true,
        secondarySelectors: ['.stats-strip', '.filter-bar']
      }
    ];

    const controllers = new Map();

    function currentScroll() {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    function pageIsMobileActive(page) {
      return window.innerWidth <= 700 &&
        page.classList.contains('active') &&
        document.body.classList.contains('module-mobile-scroll');
    }

    function refreshBodyFlag() {
      const anyActive = [...controllers.values()].some(controller => controller.inspect().active);
      document.body.classList.toggle('lab-module-scroll-linked', anyActive);
    }

    function createController(config) {
      const page = document.getElementById(config.pageId);
      const chrome = page && page.querySelector(':scope > .page-chrome');
      if (!page || !chrome) return null;

      let active = false;
      let collapseOffset = 0;
      let targetOffset = 0;
      let totalHeight = 1;
      let lastScroll = 0;
      let renderFrame = 0;
      let secondaryElements = [];

      function collectSecondary() {
        const found = [];
        for (const selector of config.secondarySelectors) {
          for (const element of page.querySelectorAll(selector)) {
            if (!found.includes(element)) found.push(element);
          }
        }
        for (const element of secondaryElements) {
          if (!found.includes(element) && element.classList) {
            element.classList.remove('lab-scroll-secondary');
          }
        }
        for (const element of found) element.classList.add('lab-scroll-secondary');
        secondaryElements = found;
        return found;
      }

      function measurableHeight(element) {
        if (!element || element.hidden) return 0;
        if (typeof getComputedStyle === 'function' && getComputedStyle(element).display === 'none') return 0;
        const rectHeight = element.getBoundingClientRect ? element.getBoundingClientRect().height : 0;
        return Math.max(0, element.scrollHeight || rectHeight || 0);
      }

      function measure() {
        const elements = collectSecondary();
        const measured = elements.reduce((sum, element) => sum + measurableHeight(element), 0);
        totalHeight = Math.max(1, measured);
        return totalHeight;
      }

      function renderOffset(nextOffset) {
        collapseOffset = core.clamp(Number(nextOffset) || 0, 0, totalHeight);
        targetOffset = collapseOffset;
        const progress = core.setProgress(page, collapseOffset / totalHeight);
        const visible = 1 - progress;
        const reduced = core.reducedMotion();

        page.style.setProperty('--lab-scroll-collapse-y', collapseOffset.toFixed(2) + 'px');
        page.style.setProperty('--lab-scroll-secondary-opacity', reduced ? '1' : visible.toFixed(4));
        page.style.setProperty('--lab-scroll-secondary-shift', reduced ? '0px' : (-6 * progress).toFixed(2) + 'px');
        page.style.setProperty('--lab-scroll-secondary-pointer', progress >= 0.98 ? 'none' : 'auto');
        core.setState(page, 'idle');
        return progress;
      }

      function queueOffset(nextOffset) {
        targetOffset = core.clamp(Number(nextOffset) || 0, 0, totalHeight);
        if (renderFrame) return;

        renderFrame = window.requestAnimationFrame(function () {
          renderFrame = 0;
          renderOffset(targetOffset);
        });
      }

      function remeasurePreservingProgress() {
        if (!active) return;
        const progress = totalHeight > 0 ? targetOffset / totalHeight : 0;
        measure();
        renderOffset(progress * totalHeight);
        lastScroll = currentScroll();
      }

      function clearVisualState() {
        if (renderFrame) {
          window.cancelAnimationFrame(renderFrame);
          renderFrame = 0;
        }
        collapseOffset = 0;
        targetOffset = 0;
        for (const element of secondaryElements) element.classList.remove('lab-scroll-secondary');
        secondaryElements = [];
        page.classList.remove('lab-scroll-linked');
        delete page.dataset.labScrollClip;
        page.style.removeProperty('--lab-scroll-collapse-y');
        page.style.removeProperty('--lab-scroll-secondary-opacity');
        page.style.removeProperty('--lab-scroll-secondary-shift');
        page.style.removeProperty('--lab-scroll-secondary-pointer');
        page.style.removeProperty('--lab-motion-progress');
        delete page.dataset.labMotionState;
      }

      function activate() {
        active = true;
        page.classList.add('lab-scroll-linked');
        page.dataset.labScrollClip = config.clipChrome ? 'chrome' : 'none';
        measure();
        collapseOffset = 0;
        targetOffset = 0;
        lastScroll = currentScroll();
        renderOffset(0);
        refreshBodyFlag();
      }

      function deactivate() {
        active = false;
        clearVisualState();
        refreshBodyFlag();
      }

      function syncActivation() {
        const next = pageIsMobileActive(page);
        if (next === active) return;
        if (next) activate();
        else deactivate();
      }

      function onScroll() {
        if (!active) return;
        const now = currentScroll();
        const delta = now - lastScroll;
        lastScroll = now;
        if (Math.abs(delta) < 0.5) return;
        queueOffset(targetOffset + delta);
      }

      function onResize() {
        const wasActive = active;
        syncActivation();
        if (!wasActive || !active) return;
        remeasurePreservingProgress();
      }

      const pageObserver = typeof MutationObserver === 'function'
        ? new MutationObserver(syncActivation)
        : null;
      if (pageObserver) {
        pageObserver.observe(page, { attributes: true, attributeFilter: ['class'] });
      }

      const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(remeasurePreservingProgress)
        : null;
      if (resizeObserver) {
        resizeObserver.observe(chrome);
        const observed = config.observeSelector ? page.querySelector(config.observeSelector) : null;
        if (observed) resizeObserver.observe(observed);
      }

      return {
        key: config.key,
        page,
        syncActivation,
        onScroll,
        onResize,
        remeasurePreservingProgress,
        inspect: function () {
          const base = core.inspect(page);
          return Object.assign(base, {
            active,
            clipChrome: config.clipChrome,
            collapseOffset,
            targetOffset,
            totalHeight,
            secondaryCount: secondaryElements.length
          });
        },
        reset: function () {
          if (!active) return false;
          measure();
          renderOffset(0);
          lastScroll = currentScroll();
          return true;
        }
      };
    }

    for (const config of configs) {
      const controller = createController(config);
      if (controller) controllers.set(config.pageId, controller);
    }

    window.addEventListener('scroll', function () {
      for (const controller of controllers.values()) controller.onScroll();
    }, { passive: true });

    window.addEventListener('resize', function () {
      for (const controller of controllers.values()) controller.onResize();
    }, { passive: true });

    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        for (const controller of controllers.values()) controller.syncActivation();
      }).observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    motion.moduleChrome = Object.assign(motion.moduleChrome || {}, {
      inspect: function (pageId) {
        const controller = controllers.get(pageId);
        return controller ? controller.inspect() : null;
      },
      reset: function (pageId) {
        const controller = controllers.get(pageId);
        return controller ? controller.reset() : false;
      },
      pages: function () {
        return [...controllers.keys()];
      }
    });

    const clientsController = controllers.get('pageClientes');
    motion.clientsChrome = Object.assign(motion.clientsChrome || {}, {
      inspect: function () {
        return clientsController ? clientsController.inspect() : null;
      },
      reset: function () {
        return clientsController ? clientsController.reset() : false;
      }
    });

    for (const controller of controllers.values()) controller.syncActivation();
  })();
})();
