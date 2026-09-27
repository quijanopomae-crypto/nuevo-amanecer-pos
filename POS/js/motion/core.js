(function (root) {
  'use strict';

  var motion = root.NA_MOTION = root.NA_MOTION || {};
  var controllers = motion.controllers = motion.controllers || Object.create(null);

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function reducedMotion() {
    try {
      return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (_) {
      return false;
    }
  }

  function parseTimeMs(value, fallbackMs) {
    var text = String(value || '').trim();
    if (!text) return fallbackMs;
    var parsed = Number.parseFloat(text);
    if (!Number.isFinite(parsed)) return fallbackMs;
    if (/ms$/i.test(text)) return parsed;
    if (/s$/i.test(text)) return parsed * 1000;
    return fallbackMs;
  }

  function cssTimeMs(element, propertyName, fallbackMs) {
    try {
      if (!element || !propertyName || typeof root.getComputedStyle !== 'function') return fallbackMs;
      return parseTimeMs(root.getComputedStyle(element).getPropertyValue(propertyName), fallbackMs);
    } catch (_) {
      return fallbackMs;
    }
  }

  function restartClass(element, className) {
    if (!element || !className || !element.classList) return false;
    element.classList.remove(className);
    if (typeof element.offsetWidth === 'number') void element.offsetWidth;
    element.classList.add(className);
    return true;
  }

  function setState(element, state) {
    var next = state || 'idle';
    if (!element || !element.dataset) return next;
    element.dataset.naMotionState = next;
    return next;
  }

  function getState(element) {
    if (!element || !element.dataset) return 'idle';
    return element.dataset.naMotionState || 'idle';
  }

  function setProgress(element, value) {
    var progress = clamp(Number(value) || 0, 0, 1);
    if (element && element.style && element.style.setProperty) {
      element.style.setProperty('--na-motion-progress', progress.toFixed(4));
    }
    return progress;
  }

  function inspect(element) {
    var raw = '';
    try {
      raw = element && element.style ? element.style.getPropertyValue('--na-motion-progress') : '';
    } catch (_) {}
    var parsed = Number.parseFloat(raw);
    return {
      state: getState(element),
      progress: Number.isFinite(parsed) ? clamp(parsed, 0, 1) : 0,
      reducedMotion: reducedMotion()
    };
  }

  function whenTransitionEnds(element, options, callback) {
    var config = options || {};
    var propertyName = config.propertyName || '';
    var fallbackMs = Math.max(0, Number(config.fallbackMs) || 0);
    var done = false;
    var timer = null;

    function cleanup() {
      if (timer !== null) root.clearTimeout(timer);
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
      timer = root.setTimeout(finish, fallbackMs);
      return cancel;
    }

    element.addEventListener('transitionend', onEnd);
    element.addEventListener('transitioncancel', onCancel);
    timer = root.setTimeout(finish, fallbackMs);
    return cancel;
  }

  function registerController(name, controller) {
    if (!name || !controller || typeof controller !== 'object') return false;
    controllers[String(name)] = controller;
    return true;
  }

  function controller(name) {
    return controllers[String(name)] || null;
  }

  motion.version = '1.0.0';
  motion.authority = 'visual-only';
  motion.core = Object.assign(motion.core || {}, {
    clamp: clamp,
    reducedMotion: reducedMotion,
    parseTimeMs: parseTimeMs,
    cssTimeMs: cssTimeMs,
    restartClass: restartClass,
    setState: setState,
    getState: getState,
    setProgress: setProgress,
    inspect: inspect,
    whenTransitionEnds: whenTransitionEnds,
    registerController: registerController,
    controller: controller
  });

  motion.inspect = function () {
    return {
      version: motion.version,
      authority: motion.authority,
      reducedMotion: reducedMotion(),
      controllers: Object.keys(controllers)
    };
  };

  try {
    root.dispatchEvent(new CustomEvent('na:motion-ready', { detail: motion.inspect() }));
  } catch (_) {}
})(window);
