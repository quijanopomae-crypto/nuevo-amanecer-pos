(function () {
  'use strict';
  if (!window.__NA_LAB__) return;

  const motion = window.NA_LAB_MOTION = window.NA_LAB_MOTION || {};
  const core = motion.core;
  const WORKSPACE_OVERLAY_ID = 'naLabWorkspaceOverlay';
  const INTERACTIVE_SELECTOR = [
    'button',
    'input',
    'textarea',
    'select',
    'option',
    'a',
    'label',
    '[contenteditable="true"]',
    '[role="button"]'
  ].join(',');
  const boundOverlays = new WeakSet();
  const cleanupWatchers = new WeakMap();

  motion.enterModal = function (element) {
    if (!element) return false;
    if (core && core.restartClass) return core.restartClass(element, 'lab-modal-enter');
    element.classList.add('lab-modal-enter');
    return true;
  };

  /* El bootstrap de motion se carga antes que este controlador. Si falta,
     degradamos solo la interacción visual; nunca bloqueamos lógica comercial. */
  if (!core) return;

  function isInteractive(target) {
    return !!(target && target.closest && target.closest(INTERACTIVE_SELECTOR));
  }

  function panelFor(overlay) {
    return overlay && overlay.firstElementChild ? overlay.firstElementChild : null;
  }

  function visualTravel(panel) {
    const panelHeight = Math.max(1, panel.getBoundingClientRect().height || panel.offsetHeight || 1);
    return Math.min(640, Math.max(360, panelHeight * 0.58));
  }

  function settleDurationMs(overlay) {
    const slowFallback = core.cssTimeMs(document.documentElement, '--lab-motion-slow', 350);
    return core.cssTimeMs(overlay, '--lab-motion-modal-settle-duration', slowFallback);
  }

  function setVisualProgress(overlay, panel, distance) {
    const progress = core.setProgress(overlay, distance / visualTravel(panel));

    overlay.style.setProperty('--lab-workspace-drag-y', distance.toFixed(1) + 'px');
    overlay.style.setProperty('--lab-workspace-panel-opacity', (1 - progress * 0.94).toFixed(3));
    overlay.style.setProperty('--lab-workspace-backdrop-alpha', (0.62 * (1 - progress)).toFixed(3));
  }

  function clearCleanupWatcher(overlay) {
    const cancel = cleanupWatchers.get(overlay);
    if (cancel) cancel();
    cleanupWatchers.delete(overlay);
  }

  function clearVisualState(overlay) {
    clearCleanupWatcher(overlay);
    overlay.classList.remove('lab-workspace-dragging', 'lab-workspace-settling');
    overlay.style.removeProperty('--lab-workspace-drag-y');
    overlay.style.removeProperty('--lab-workspace-panel-opacity');
    overlay.style.removeProperty('--lab-workspace-backdrop-alpha');
    core.setProgress(overlay, 0);
    core.setState(overlay, overlay.style.display === 'none' ? 'closed' : 'idle');
  }

  function beginSettle(overlay, applyTarget, state) {
    clearCleanupWatcher(overlay);
    overlay.classList.remove('lab-workspace-dragging');
    overlay.classList.add('lab-workspace-settling');
    core.setState(overlay, state || 'settling');

    // Conserva exactamente el frame alcanzado con el dedo. El target se aplica
    // en el siguiente frame para evitar que el navegador fusione ambos estados.
    void overlay.offsetWidth;
    window.requestAnimationFrame(function () {
      applyTarget();
    });
  }

  function watchCleanup(overlay, panel, callback) {
    clearCleanupWatcher(overlay);
    const fallbackMs = core.reducedMotion()
      ? 24
      : settleDurationMs(overlay) + 90;

    const cancel = core.whenTransitionEnds(panel, {
      propertyName: 'transform',
      fallbackMs
    }, function () {
      cleanupWatchers.delete(overlay);
      callback();
    });

    cleanupWatchers.set(overlay, cancel);
  }

  function settleBack(overlay, panel) {
    beginSettle(overlay, function () {
      core.setProgress(overlay, 0);
      overlay.style.setProperty('--lab-workspace-drag-y', '0px');
      overlay.style.setProperty('--lab-workspace-panel-opacity', '1');
      overlay.style.setProperty('--lab-workspace-backdrop-alpha', '0.62');
    }, 'settling');

    watchCleanup(overlay, panel, function () {
      if (overlay.style.display !== 'none') clearVisualState(overlay);
    });
  }

  function dismissOverlay(overlay, panel) {
    beginSettle(overlay, function () {
      const panelHeight = Math.max(0, panel.getBoundingClientRect().height || panel.offsetHeight || 0);
      const exitDistance = Math.max(window.innerHeight || 0, panelHeight + 80) + 32;

      core.setProgress(overlay, 1);
      overlay.style.setProperty('--lab-workspace-drag-y', exitDistance + 'px');
      overlay.style.setProperty('--lab-workspace-panel-opacity', '0');
      overlay.style.setProperty('--lab-workspace-backdrop-alpha', '0');
    }, 'closing');

    watchCleanup(overlay, panel, function () {
      // El panel ya terminó visualmente en opacity 0. display:none solo retira
      // el overlay invisible; el timeout es únicamente fallback visual.
      overlay.style.display = 'none';
      clearVisualState(overlay);
    });
  }

  function bindWorkspaceSwipe(overlay) {
    if (!overlay || boundOverlays.has(overlay)) return false;
    const panel = panelFor(overlay);
    if (!panel) return false;

    boundOverlays.add(overlay);
    if (!overlay.dataset.labMotionState) core.setState(overlay, 'idle');

    let tracking = false;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startAt = 0;
    let lastDistance = 0;

    function resetGesture() {
      tracking = false;
      dragging = false;
      startX = 0;
      startY = 0;
      startAt = 0;
      lastDistance = 0;
    }

    panel.addEventListener('touchstart', function (event) {
      if (event.touches.length !== 1) return;
      if (overlay.style.display === 'none') return;
      if (overlay.scrollTop > 0) return;
      if (isInteractive(event.target)) return;

      const state = core.getState(overlay);
      if (state === 'settling' || state === 'closing') return;

      clearCleanupWatcher(overlay);
      const touch = event.touches[0];
      tracking = true;
      dragging = false;
      startX = touch.clientX;
      startY = touch.clientY;
      startAt = performance.now();
      lastDistance = 0;
    }, { passive: true });

    panel.addEventListener('touchmove', function (event) {
      if (!tracking || event.touches.length !== 1) return;

      const touch = event.touches[0];
      const deltaX = touch.clientX - startX;
      const deltaY = touch.clientY - startY;

      if (!dragging) {
        if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 8) {
          resetGesture();
          return;
        }
        if (deltaY <= 6) return;
        if (overlay.scrollTop > 0) {
          resetGesture();
          return;
        }
        dragging = true;
        core.setState(overlay, 'dragging');
        overlay.classList.add('lab-workspace-dragging');
      }

      if (deltaY <= 0) return;
      event.preventDefault();
      lastDistance = deltaY;
      setVisualProgress(overlay, panel, deltaY);
    }, { passive: false });

    function finishGesture(cancelled) {
      if (!tracking) return;
      const wasDragging = dragging;
      const distance = lastDistance;
      const elapsed = Math.max(1, performance.now() - startAt);
      const velocity = distance / elapsed;
      const panelHeight = Math.max(1, panel.getBoundingClientRect().height || panel.offsetHeight || 1);
      const distanceThreshold = Math.min(190, Math.max(110, panelHeight * 0.22));
      const shouldDismiss = !cancelled && wasDragging &&
        (distance >= distanceThreshold || (distance >= 60 && velocity >= 0.85));

      resetGesture();

      if (!wasDragging) return;
      if (shouldDismiss) dismissOverlay(overlay, panel);
      else settleBack(overlay, panel);
    }

    panel.addEventListener('touchend', function () {
      finishGesture(false);
    }, { passive: true });

    panel.addEventListener('touchcancel', function () {
      finishGesture(true);
    }, { passive: true });

    return true;
  }

  function findAndBindWorkspace() {
    bindWorkspaceSwipe(document.getElementById(WORKSPACE_OVERLAY_ID));
  }

  motion.workspace = Object.assign(motion.workspace || {}, {
    bind: bindWorkspaceSwipe,
    inspect: function () {
      return core.inspect(document.getElementById(WORKSPACE_OVERLAY_ID));
    }
  });

  if (document.body) {
    findAndBindWorkspace();
    const observer = new MutationObserver(findAndBindWorkspace);
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
