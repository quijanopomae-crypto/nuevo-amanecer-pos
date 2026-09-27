(function (root) {
  'use strict';

  var motion = root.NA_MOTION = root.NA_MOTION || {};
  var core = motion.core;
  if (!core) return;

  var page = motion.page = motion.page || {};
  var bindings = new Map();

  function enter(element, className) {
    if (!element || core.reducedMotion()) return false;
    return core.restartClass(element, className || 'na-enter-fade');
  }

  function bind(pageId, options) {
    var id = String(pageId || '');
    var config = options || {};
    if (!id || typeof document === 'undefined') return null;
    var element = document.getElementById(id);
    if (!element) return null;

    if (bindings.has(id)) return bindings.get(id);

    var observer = typeof MutationObserver === 'function'
      ? new MutationObserver(function () {
          if (element.classList.contains('active')) enter(element, config.enterClass || 'na-enter-fade');
        })
      : null;

    if (observer) observer.observe(element, { attributes:true, attributeFilter:['class'] });

    var controller = {
      element: element,
      enter: function () { return enter(element, config.enterClass || 'na-enter-fade'); },
      destroy: function () {
        if (observer) observer.disconnect();
        bindings.delete(id);
      },
      inspect: function () {
        return {
          id: id,
          active: element.classList.contains('active'),
          reducedMotion: core.reducedMotion()
        };
      }
    };

    bindings.set(id, controller);
    core.registerController('page:' + id, controller);
    return controller;
  }

  page.enter = enter;
  page.bind = bind;
  page.inspect = function (pageId) {
    var controller = bindings.get(String(pageId || ''));
    return controller ? controller.inspect() : null;
  };
})(window);
