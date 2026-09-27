(function (root) {
  'use strict';

  var originalRender = root.cliRender;
  if (typeof originalRender !== 'function' || originalRender.__naClientListMotion) return;

  var firstVisibleRender = true;
  var pendingTimer = null;

  function page() { return root.document && root.document.getElementById('pageClientes'); }
  function isActive(node) { return !!(node && node.classList && node.classList.contains('active')); }
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (_) { return false; }
  }
  function frame(callback) {
    var raf = root.requestAnimationFrame || function (fn) { return root.setTimeout(fn, 16); };
    return raf.call(root, callback);
  }
  function clear(node) {
    if (!node || !node.classList) return;
    node.classList.remove('na-client-refresh-in');
    node.classList.remove('na-client-refresh-out');
  }

  function renderWithMotion() {
    var node = page();
    if (!isActive(node) || reducedMotion()) {
      clear(node);
      return originalRender.apply(this, arguments);
    }

    var args = arguments;
    var self = this;

    if (firstVisibleRender) {
      firstVisibleRender = false;
      var result = originalRender.apply(self, args);
      node.classList.add('na-client-refresh-in');
      frame(function () { frame(function () { node.classList.remove('na-client-refresh-in'); }); });
      return result;
    }

    node.classList.remove('na-client-refresh-in');
    node.classList.add('na-client-refresh-out');
    if (pendingTimer) root.clearTimeout(pendingTimer);
    pendingTimer = root.setTimeout(function () {
      pendingTimer = null;
      originalRender.apply(self, args);
      frame(function () { node.classList.remove('na-client-refresh-out'); });
    }, 850);
    return undefined;
  }

  renderWithMotion.__naClientListMotion = true;
  root.cliRender = renderWithMotion;
})(window);
