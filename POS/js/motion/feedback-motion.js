(function (root) {
  'use strict';

  var motion = root.NA_MOTION = root.NA_MOTION || {};
  motion.feedback = motion.feedback || {};

  motion.feedback.enter = function (element) {
    if (!element) return false;
    if (motion.core && motion.core.reducedMotion && motion.core.reducedMotion()) return false;
    if (motion.core && motion.core.restartClass) return motion.core.restartClass(element, 'na-feedback-enter');
    element.classList.add('na-feedback-enter');
    return true;
  };
})(window);
