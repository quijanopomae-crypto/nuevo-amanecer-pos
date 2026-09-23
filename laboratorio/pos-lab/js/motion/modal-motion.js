(function () {
  'use strict';
  if (!window.__NA_LAB__) return;
  const motion = window.NA_LAB_MOTION = window.NA_LAB_MOTION || {};
  motion.enterModal = function (element) {
    if (element) element.classList.add('lab-modal-enter');
  };
})();
