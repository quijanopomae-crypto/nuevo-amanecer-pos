(function (root) {
  'use strict';

  var motion = root.NA_MOTION = root.NA_MOTION || {};
  var core = motion.core;
  if (!core) return;

  var bound = new WeakSet();
  var cleanup = new WeakMap();
  var defaultInteractive = 'button,input,textarea,select,option,a,label,[contenteditable="true"],[role="button"]';

  function enter(element) {
    if (!element || core.reducedMotion()) return false;
    return core.restartClass(element, 'na-modal-enter');
  }

  function clearCleanup(overlay) {
    var cancel = cleanup.get(overlay);
    if (cancel) cancel();
    cleanup.delete(overlay);
  }

  function bindSwipeDismiss(overlay, options) {
    if (!overlay || bound.has(overlay)) return !!overlay;
    options = options || {};
    var panel = options.panel || overlay.firstElementChild;
    if (!panel || !panel.addEventListener) return false;

    bound.add(overlay);
    overlay.dataset.naMotionSwipe = 'true';
    core.setState(overlay, core.getState(overlay) === 'idle' ? 'open' : core.getState(overlay));

    var selector = options.interactiveSelector || defaultInteractive;
    var tracking = false;
    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startAt = 0;
    var lastDistance = 0;
    var gestureHeight = 1;

    function resetGesture() {
      tracking = false;
      dragging = false;
      startX = 0;
      startY = 0;
      startAt = 0;
      lastDistance = 0;
    }

    function travel() {
      return Math.min(640, Math.max(360, gestureHeight * 0.58 || 360));
    }

    function render(distance) {
      var progress = core.setProgress(overlay, distance / travel());
      overlay.style.setProperty('--na-modal-drag-y', distance.toFixed(1) + 'px');
      overlay.style.setProperty('--na-modal-panel-opacity', (1 - progress * 0.94).toFixed(3));
      overlay.style.setProperty('--na-modal-backdrop-alpha', (0.62 * (1 - progress)).toFixed(3));
      return progress;
    }

    function resetVisual() {
      clearCleanup(overlay);
      overlay.classList.remove('na-motion-dragging','na-motion-settling');
      ['--na-modal-drag-y','--na-modal-panel-opacity','--na-modal-backdrop-alpha','--na-motion-progress']
        .forEach(function (name) { overlay.style.removeProperty(name); });
      core.setState(overlay, 'open');
    }

    function settle(target, state, done) {
      clearCleanup(overlay);
      overlay.classList.remove('na-motion-dragging');
      overlay.classList.add('na-motion-settling');
      core.setState(overlay, state || 'settling');
      root.requestAnimationFrame(target);
      var fallback = core.reducedMotion() ? 24 : core.cssTimeMs(overlay, '--na-motion-modal-settle-duration', 560) + 90;
      cleanup.set(overlay, core.whenTransitionEnds(panel, { propertyName:'transform', fallbackMs:fallback }, function () {
        cleanup.delete(overlay);
        overlay.classList.remove('na-motion-settling');
        if (typeof done === 'function') done();
      }));
    }

    function settleBack() {
      settle(function () {
        core.setProgress(overlay, 0);
        overlay.style.setProperty('--na-modal-drag-y', '0px');
        overlay.style.setProperty('--na-modal-panel-opacity', '1');
        overlay.style.setProperty('--na-modal-backdrop-alpha', '.62');
      }, 'settling', resetVisual);
    }

    function dismiss() {
      if (core.reducedMotion()) {
        core.setState(overlay, 'closed');
        if (typeof options.onDismiss === 'function') options.onDismiss(overlay);
        return;
      }
      settle(function () {
        var distance = Math.max(root.innerHeight || 0, gestureHeight + 80) + 32;
        core.setProgress(overlay, 1);
        overlay.style.setProperty('--na-modal-drag-y', distance + 'px');
        overlay.style.setProperty('--na-modal-panel-opacity', '0');
        overlay.style.setProperty('--na-modal-backdrop-alpha', '0');
      }, 'closing', function () {
        core.setState(overlay, 'closed');
        if (typeof options.onDismiss === 'function') options.onDismiss(overlay);
        resetVisual();
      });
    }

    panel.addEventListener('touchstart', function (event) {
      if (core.reducedMotion() || !event.touches || event.touches.length !== 1) return;
      if (typeof options.canStart === 'function' && !options.canStart(overlay, panel, event)) return;
      if (event.target && event.target.closest && event.target.closest(selector)) return;
      var state = core.getState(overlay);
      if (state === 'settling' || state === 'closing') return;
      clearCleanup(overlay);
      var touch = event.touches[0];
      gestureHeight = Number(panel.getBoundingClientRect ? panel.getBoundingClientRect().height : panel.offsetHeight) || 1;
      tracking = true;
      startX = touch.clientX;
      startY = touch.clientY;
      startAt = root.performance && root.performance.now ? root.performance.now() : Date.now();
      lastDistance = 0;
    }, { passive:true });

    panel.addEventListener('touchmove', function (event) {
      if (!tracking || !event.touches || event.touches.length !== 1) return;
      var touch = event.touches[0];
      var dx = touch.clientX - startX;
      var dy = touch.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) { resetGesture(); return; }
        if (dy <= 6) return;
        dragging = true;
        overlay.classList.add('na-motion-dragging');
        core.setState(overlay, 'dragging');
      }
      if (dy <= 0) return;
      event.preventDefault();
      lastDistance = dy;
      render(dy);
    }, { passive:false });

    function finish(cancelled) {
      if (!tracking) return;
      var wasDragging = dragging;
      var distance = lastDistance;
      var now = root.performance && root.performance.now ? root.performance.now() : Date.now();
      var elapsed = Math.max(1, now - startAt);
      var velocity = distance / elapsed;
      var threshold = Math.min(190, Math.max(110, gestureHeight * 0.22));
      var shouldDismiss = !cancelled && wasDragging &&
        (distance >= threshold || (distance >= 60 && velocity >= 0.85));
      resetGesture();
      if (!wasDragging) return;
      if (shouldDismiss) dismiss();
      else settleBack();
    }

    panel.addEventListener('touchend', function () { finish(false); }, { passive:true });
    panel.addEventListener('touchcancel', function () { finish(true); }, { passive:true });

    return true;
  }

  motion.modal = Object.assign(motion.modal || {}, {
    enter: enter,
    bindSwipeDismiss: bindSwipeDismiss
  });
})(window);
