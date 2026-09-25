(function () {
  'use strict';
  if (!window.__NA_LAB__) return;

  const motion = window.NA_LAB_MOTION = window.NA_LAB_MOTION || {};
  const WORKSPACE_OVERLAY_ID = 'naLabWorkspaceOverlay';
  const SETTLE_MS = 560;
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
  const cleanupTimers = new WeakMap();

  motion.enterModal = function (element) {
    if (element) element.classList.add('lab-modal-enter');
  };

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

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

  function setVisualProgress(overlay, panel, distance) {
    const progress = clamp(distance / visualTravel(panel), 0, 1);

    overlay.style.setProperty('--lab-workspace-drag-y', distance.toFixed(1) + 'px');
    overlay.style.setProperty('--lab-workspace-panel-opacity', (1 - progress * 0.94).toFixed(3));
    overlay.style.setProperty('--lab-workspace-backdrop-alpha', (0.62 * (1 - progress)).toFixed(3));
  }

  function clearCleanupTimer(overlay) {
    const timer = cleanupTimers.get(overlay);
    if (timer) window.clearTimeout(timer);
    cleanupTimers.delete(overlay);
  }

  function clearVisualState(overlay) {
    clearCleanupTimer(overlay);
    overlay.classList.remove('lab-workspace-dragging', 'lab-workspace-settling');
    overlay.style.removeProperty('--lab-workspace-drag-y');
    overlay.style.removeProperty('--lab-workspace-panel-opacity');
    overlay.style.removeProperty('--lab-workspace-backdrop-alpha');
  }

  function beginSettle(overlay, applyTarget) {
    clearCleanupTimer(overlay);
    overlay.classList.remove('lab-workspace-dragging');
    overlay.classList.add('lab-workspace-settling');

    // Conserva exactamente el frame alcanzado con el dedo. El target se aplica
    // en el siguiente frame para evitar que el navegador fusione ambos estados.
    void overlay.offsetWidth;
    window.requestAnimationFrame(function () {
      applyTarget();
    });
  }

  function scheduleCleanup(overlay, callback) {
    clearCleanupTimer(overlay);
    const delay = reducedMotion() ? 20 : SETTLE_MS + 70;
    const timer = window.setTimeout(function () {
      cleanupTimers.delete(overlay);
      callback();
    }, delay);
    cleanupTimers.set(overlay, timer);
  }

  function settleBack(overlay) {
    beginSettle(overlay, function () {
      overlay.style.setProperty('--lab-workspace-drag-y', '0px');
      overlay.style.setProperty('--lab-workspace-panel-opacity', '1');
      overlay.style.setProperty('--lab-workspace-backdrop-alpha', '0.62');
    });

    scheduleCleanup(overlay, function () {
      if (overlay.style.display !== 'none') clearVisualState(overlay);
    });
  }

  function dismissOverlay(overlay, panel) {
    beginSettle(overlay, function () {
      const panelHeight = Math.max(0, panel.getBoundingClientRect().height || panel.offsetHeight || 0);
      const exitDistance = Math.max(window.innerHeight || 0, panelHeight + 80) + 32;

      overlay.style.setProperty('--lab-workspace-drag-y', exitDistance + 'px');
      overlay.style.setProperty('--lab-workspace-panel-opacity', '0');
      overlay.style.setProperty('--lab-workspace-backdrop-alpha', '0');
    });

    scheduleCleanup(overlay, function () {
      // En este punto el panel ya terminó visualmente en opacity 0. display:none
      // solo retira el overlay invisible; no produce un corte visible.
      overlay.style.display = 'none';
      clearVisualState(overlay);
    });
  }

  function bindWorkspaceSwipe(overlay) {
    if (!overlay || boundOverlays.has(overlay)) return;
    const panel = panelFor(overlay);
    if (!panel) return;

    boundOverlays.add(overlay);

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

      clearCleanupTimer(overlay);
      overlay.classList.remove('lab-workspace-settling');
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
      else settleBack(overlay);
    }

    panel.addEventListener('touchend', function () {
      finishGesture(false);
    }, { passive: true });

    panel.addEventListener('touchcancel', function () {
      finishGesture(true);
    }, { passive: true });
  }

  function findAndBindWorkspace() {
    bindWorkspaceSwipe(document.getElementById(WORKSPACE_OVERLAY_ID));
  }

  if (document.body) {
    findAndBindWorkspace();
    const observer = new MutationObserver(findAndBindWorkspace);
    observer.observe(document.body, { childList: true, subtree: true });
  }
})();
