(function (root) {
  'use strict';

  var motion = root.NA_MOTION = root.NA_MOTION || {};
  var core = motion.core;
  if (!core) return;

  var controllers = new Map();

  function currentScroll() {
    return root.scrollY || (document.documentElement && document.documentElement.scrollTop) || 0;
  }

  function create(config) {
    config = config || {};
    var page = document.getElementById(config.pageId || '');
    if (!page) return null;
    var chrome = page.querySelector(':scope > .page-chrome');
    var breakpoint = Number(config.breakpoint) || 700;
    var selectors = Array.isArray(config.secondarySelectors) ? config.secondarySelectors : [];
    var active = false;
    var offset = 0;
    var target = 0;
    var totalHeight = 1;
    var lastScroll = 0;
    var frame = 0;
    var secondary = [];

    function collect() {
      var found = [];
      selectors.forEach(function (selector) {
        page.querySelectorAll(selector).forEach(function (element) {
          if (!found.includes(element)) found.push(element);
        });
      });
      secondary.forEach(function (element) {
        if (!found.includes(element)) element.classList.remove('na-scroll-secondary');
      });
      found.forEach(function (element) { element.classList.add('na-scroll-secondary'); });
      secondary = found;
      return found;
    }

    function measure() {
      var found = collect();
      totalHeight = Math.max(1, found.reduce(function (sum, element) {
        if (!element || element.hidden) return sum;
        var height = element.scrollHeight || (element.getBoundingClientRect ? element.getBoundingClientRect().height : 0) || 0;
        return sum + Math.max(0, height);
      }, 0));
      return totalHeight;
    }

    function shouldActivate() {
      return root.innerWidth <= breakpoint &&
        page.classList.contains('active') &&
        document.body &&
        document.body.classList.contains('module-mobile-scroll');
    }

    function render(next) {
      offset = core.clamp(Number(next) || 0, 0, totalHeight);
      target = offset;
      var progress = core.setProgress(page, offset / totalHeight);
      var visible = 1 - progress;
      var reduced = core.reducedMotion();
      page.style.setProperty('--na-scroll-collapse-y', offset.toFixed(2) + 'px');
      page.style.setProperty('--na-scroll-secondary-opacity', reduced ? '1' : visible.toFixed(4));
      page.style.setProperty('--na-scroll-secondary-shift', reduced ? '0px' : (-6 * progress).toFixed(2) + 'px');
      page.style.setProperty('--na-scroll-secondary-pointer', progress >= 0.98 ? 'none' : 'auto');
      core.setState(page, 'idle');
      return progress;
    }

    function queue(next) {
      target = core.clamp(Number(next) || 0, 0, totalHeight);
      if (frame) return;
      frame = root.requestAnimationFrame(function () {
        frame = 0;
        render(target);
      });
    }

    function clear() {
      if (frame) root.cancelAnimationFrame(frame);
      frame = 0;
      offset = 0;
      target = 0;
      secondary.forEach(function (element) { element.classList.remove('na-scroll-secondary'); });
      secondary = [];
      page.classList.remove('na-scroll-linked');
      page.removeAttribute('data-na-scroll-clip');
      ['--na-scroll-collapse-y','--na-scroll-secondary-opacity','--na-scroll-secondary-shift','--na-scroll-secondary-pointer','--na-motion-progress']
        .forEach(function (name) { page.style.removeProperty(name); });
      delete page.dataset.naMotionState;
    }

    function sync() {
      var next = shouldActivate();
      if (next === active) return;
      active = next;
      if (active) {
        page.classList.add('na-scroll-linked');
        page.dataset.naScrollClip = config.clipChrome === false ? 'none' : 'chrome';
        measure();
        lastScroll = currentScroll();
        render(0);
      } else {
        clear();
      }
      document.body && document.body.classList.toggle('na-module-scroll-linked',
        Array.from(controllers.values()).some(function (controller) { return controller.inspect().active; }));
    }

    function onScroll() {
      if (!active) return;
      var now = currentScroll();
      var delta = now - lastScroll;
      lastScroll = now;
      if (Math.abs(delta) < 0.5) return;
      queue(target + delta);
    }

    function remeasure() {
      if (!active) return;
      var progress = totalHeight > 0 ? target / totalHeight : 0;
      measure();
      render(progress * totalHeight);
      lastScroll = currentScroll();
    }

    var pageObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(sync)
      : null;
    if (pageObserver) pageObserver.observe(page, { attributes:true, attributeFilter:['class'] });

    var resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(remeasure)
      : null;
    if (resizeObserver) {
      if (chrome) resizeObserver.observe(chrome);
      var observed = config.observeSelector ? page.querySelector(config.observeSelector) : null;
      if (observed && observed !== chrome) resizeObserver.observe(observed);
    }

    var controller = {
      page: page,
      sync: sync,
      onScroll: onScroll,
      onResize: function () { sync(); remeasure(); },
      destroy: function () {
        if (pageObserver) pageObserver.disconnect();
        if (resizeObserver) resizeObserver.disconnect();
        clear();
      },
      inspect: function () {
        return Object.assign(core.inspect(page), {
          active: active,
          collapseOffset: offset,
          targetOffset: target,
          totalHeight: totalHeight,
          secondaryCount: secondary.length
        });
      }
    };

    sync();
    return controller;
  }

  function register(config) {
    if (!config || !config.pageId || controllers.has(config.pageId)) return controllers.get(config && config.pageId) || null;
    var controller = create(config);
    if (!controller) return null;
    controllers.set(config.pageId, controller);
    core.registerController('scroll:' + config.pageId, controller);
    return controller;
  }

  function onScroll() {
    controllers.forEach(function (controller) { controller.onScroll(); });
  }

  function onResize() {
    controllers.forEach(function (controller) { controller.onResize(); });
  }

  root.addEventListener('scroll', onScroll, { passive:true });
  root.addEventListener('resize', onResize, { passive:true });

  motion.scroll = Object.assign(motion.scroll || {}, {
    register: register,
    inspect: function (pageId) {
      var controller = controllers.get(String(pageId || ''));
      return controller ? controller.inspect() : null;
    },
    presets: {
      clientes: { pageId:'pageClientes', clipChrome:true, secondarySelectors:['.filter-bar','.stats-strip'] },
      inventario: { pageId:'pageInventario', clipChrome:true, secondarySelectors:['.filter-bar','.stats-strip'] },
      ventas: { pageId:'pageVentas', clipChrome:true, secondarySelectors:['#ventasFilterBar','#ventasReportControls','#ventasKPI'] },
      caja: { pageId:'pageCaja', clipChrome:false, secondarySelectors:['#cajContent > .caj-banner-wrap','#cajContent > .cj-stats-grid','#cajContent > div:first-child > .banner-cerrada-cj'], observeSelector:'#cajContent' },
      gastos: { pageId:'pageGastos', clipChrome:true, secondarySelectors:['.stats-strip','.filter-bar'] }
    }
  });

  Object.keys(motion.scroll.presets).forEach(function (name) {
    register(motion.scroll.presets[name]);
  });
})(window);
