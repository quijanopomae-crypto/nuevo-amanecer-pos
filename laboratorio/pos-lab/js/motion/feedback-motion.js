(function () {
  'use strict';
  if (!window.__NA_LAB__) return;

  const motion = window.NA_LAB_MOTION = window.NA_LAB_MOTION || {};

  motion.enterFeedback = function (element) {
    if (!element) return false;
    if (motion.core && motion.core.restartClass) {
      return motion.core.restartClass(element, 'lab-feedback-enter');
    }
    element.classList.add('lab-feedback-enter');
    return true;
  };
})();
