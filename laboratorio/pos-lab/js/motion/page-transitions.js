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

  /* Clientes móvil: chrome marcado por el owner ligado al gesto 1:1.
     No hay snap temporal: mientras el dedo se mueve, el progreso visual sigue
     ese desplazamiento; después, el momentum continúa con el scroll real. */
  (function bindClientsScrollLinkedChrome() {
    const core = motion.core;
    const page = document.getElementById('pageClientes');
    const filter = page && page.querySelector('.filter-bar');
    const stats = page && page.querySelector('.stats-strip');
    if (!page || !filter || !stats || !core) return;

    let active = false;
    let touchActive = false;
    let touchStartY = 0;
    let touchStartOffset = 0;
    let collapseOffset = 0;
    let filterHeight = 0;
    let statsHeight = 0;
    let totalHeight = 1;
    let lastScroll = 0;
    let scrollFrame = 0;
    let pendingScrollDelta = 0;

    function currentScroll() {
      return window.scrollY || document.documentElement.scrollTop || 0;
    }

    function mobileClientsActive() {
      return window.innerWidth <= 700 &&
        page.classList.contains('active') &&
        document.body.classList.contains('module-mobile-scroll');
    }

    function excludedTarget(target) {
      return !!(target && target.closest &&
        target.closest('.modal-overlay,.modal,.cart-drawer,#cartDrawer,.cfg-sidebar'));
    }

    function measure() {
      filterHeight = Math.max(0, filter.scrollHeight || filter.getBoundingClientRect().height || 0);
      statsHeight = Math.max(0, stats.scrollHeight || stats.getBoundingClientRect().height || 0);
      totalHeight = Math.max(1, filterHeight + statsHeight);
    }

    function applyOffset(nextOffset, state) {
      collapseOffset = core.clamp(Number(nextOffset) || 0, 0, totalHeight);
      const progress = core.setProgress(page, collapseOffset / totalHeight);
      const visible = 1 - progress;
      const reduced = core.reducedMotion();

      page.style.setProperty('--lab-client-filter-height', (filterHeight * visible).toFixed(1) + 'px');
      page.style.setProperty('--lab-client-stats-height', (statsHeight * visible).toFixed(1) + 'px');
      page.style.setProperty('--lab-client-chrome-opacity', reduced ? '1' : visible.toFixed(4));
      page.style.setProperty('--lab-client-chrome-shift', reduced ? '0px' : (-12 * progress).toFixed(1) + 'px');
      page.style.setProperty('--lab-client-chrome-pointer', progress >= 0.98 ? 'none' : 'auto');
      core.setState(page, state || (touchActive ? 'dragging' : 'idle'));
      return progress;
    }

    function clearVisualState() {
      if (scrollFrame) {
        window.cancelAnimationFrame(scrollFrame);
        scrollFrame = 0;
      }
      pendingScrollDelta = 0;
      touchActive = false;
      collapseOffset = 0;
      page.style.removeProperty('--lab-client-filter-height');
      page.style.removeProperty('--lab-client-stats-height');
      page.style.removeProperty('--lab-client-chrome-opacity');
      page.style.removeProperty('--lab-client-chrome-shift');
      page.style.removeProperty('--lab-client-chrome-pointer');
      page.style.removeProperty('--lab-motion-progress');
      delete page.dataset.labMotionState;
    }

    function activate() {
      active = true;
      document.body.classList.add('lab-client-scroll-linked');
      measure();
      collapseOffset = 0;
      lastScroll = currentScroll();
      applyOffset(0, 'idle');
    }

    function deactivate() {
      active = false;
      document.body.classList.remove('lab-client-scroll-linked');
      clearVisualState();
    }

    function syncActivation() {
      const next = mobileClientsActive();
      if (next === active) return;
      if (next) activate();
      else deactivate();
    }

    document.addEventListener('touchstart', function (event) {
      if (!active || event.touches.length !== 1 || excludedTarget(event.target)) return;
      touchActive = true;
      touchStartY = event.touches[0].clientY;
      touchStartOffset = collapseOffset;
      lastScroll = currentScroll();
      core.setState(page, 'dragging');
    }, { passive: true });

    document.addEventListener('touchmove', function (event) {
      if (!active || !touchActive || event.touches.length !== 1) return;
      const fingerDelta = touchStartY - event.touches[0].clientY;
      applyOffset(touchStartOffset + fingerDelta, 'dragging');
      lastScroll = currentScroll();
    }, { passive: true });

    function finishTouch() {
      if (!touchActive) return;
      touchActive = false;
      lastScroll = currentScroll();
      core.setState(page, 'idle');
    }

    document.addEventListener('touchend', finishTouch, { passive: true });
    document.addEventListener('touchcancel', finishTouch, { passive: true });

    window.addEventListener('scroll', function () {
      if (!active) return;
      const now = currentScroll();
      const delta = now - lastScroll;
      lastScroll = now;

      // Durante touchmove manda el dedo; no contamos además el mismo scroll.
      if (touchActive || Math.abs(delta) < 0.5) return;

      pendingScrollDelta += delta;
      if (scrollFrame) return;
      scrollFrame = window.requestAnimationFrame(function () {
        scrollFrame = 0;
        const scrollDelta = pendingScrollDelta;
        pendingScrollDelta = 0;
        applyOffset(collapseOffset + scrollDelta, 'idle');
      });
    }, { passive: true });

    window.addEventListener('resize', function () {
      const wasActive = active;
      syncActivation();
      if (!wasActive || !active) return;
      const progress = core.inspect(page).progress;
      measure();
      applyOffset(progress * totalHeight, 'idle');
      lastScroll = currentScroll();
    }, { passive: true });

    if (typeof MutationObserver === 'function') {
      new MutationObserver(syncActivation).observe(page, {
        attributes: true,
        attributeFilter: ['class']
      });
      new MutationObserver(syncActivation).observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
      });
    }

    motion.clientsChrome = Object.assign(motion.clientsChrome || {}, {
      inspect: function () {
        const base = core.inspect(page);
        return Object.assign(base, {
          active,
          collapseOffset,
          totalHeight
        });
      },
      reset: function () {
        if (!active) return false;
        applyOffset(0, 'idle');
        lastScroll = currentScroll();
        return true;
      }
    });

    syncActivation();
  })();
})();
