(function (root) {
  'use strict';

  var motion = root.NA_MOTION = root.NA_MOTION || {};
  var core = motion.core;
  if (!core) return;

  var page = motion.page = motion.page || {};
  var bindings = new Map();
  var pending = typeof WeakMap === 'function' ? new WeakMap() : null;

  function frame(callback) {
    if (typeof root.requestAnimationFrame === 'function') return root.requestAnimationFrame(callback);
    return root.setTimeout(callback, 16);
  }

  function enter(element, className) {
    if (!element || !element.classList || core.reducedMotion()) return false;
    var nextClass = className || 'na-enter-fade';
    var token = {};
    if (pending) pending.set(element, token);

    element.classList.remove(nextClass);
    frame(function () {
      if (pending && pending.get(element) !== token) return;
      if (element.classList && element.classList.contains('page') && !element.classList.contains('active')) return;
      element.classList.add(nextClass);
    });
    return true;
  }

  function bind(pageId, options) {
    var id = String(pageId || '');
    var config = options || {};
    if (!id || typeof document === 'undefined') return null;
    var element = document.getElementById(id);
    if (!element) return null;

    if (bindings.has(id)) return bindings.get(id);

    var wasActive = element.classList.contains('active');
    var observer = typeof MutationObserver === 'function'
      ? new MutationObserver(function () {
          var isActive = element.classList.contains('active');
          var becameActive = isActive && !wasActive;
          wasActive = isActive;
          if (becameActive) enter(element, config.enterClass || 'na-enter-fade');
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
