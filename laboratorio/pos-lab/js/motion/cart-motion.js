(function () {
  'use strict';
  if (!window.__NA_LAB__) return;
  const motion = window.NA_LAB_MOTION = window.NA_LAB_MOTION || {};
  motion.pulseCart = function (element) {
    if (!element) return;
    element.classList.remove('lab-cart-pulse');
    void element.offsetWidth;
    element.classList.add('lab-cart-pulse');
  };
})();
