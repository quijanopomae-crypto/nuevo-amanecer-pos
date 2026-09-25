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

    function finish() {
      if (done) return;
      done = true;
      if (timer !== null) window.clearTimeout(timer);
      if (element && element.removeEventListener) {
        element.removeEventListener('transitionend', onEnd);
        element.removeEventListener('transitioncancel', onCancel);
      }
      if (typeof callback === 'function') callback();
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
      return finish;
    }

    element.addEventListener('transitionend', onEnd);
    element.addEventListener('transitioncancel', onCancel);
    timer = window.setTimeout(finish, fallbackMs);
    return finish;
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
})();
