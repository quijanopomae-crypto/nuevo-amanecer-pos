(function (root) {
  'use strict';

  var motion = root.NA_MOTION = root.NA_MOTION || {};
  motion.cart = motion.cart || {};

  motion.cart.pulse = function (element) {
    if (!element) return false;
    if (motion.core && motion.core.reducedMotion && motion.core.reducedMotion()) return false;
    if (motion.core && motion.core.restartClass) return motion.core.restartClass(element, 'na-cart-pulse');
    element.classList.remove('na-cart-pulse');
    void element.offsetWidth;
    element.classList.add('na-cart-pulse');
    return true;
  };
})(window);
