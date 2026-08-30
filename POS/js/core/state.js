/*
 * js/core/state.js - estado UI transversal compartido del POS (ETAPA 4, work item STATE).
 *
 * TRES bloques puros extraidos byte-exacto desde POS/index.html @ 4158e04
 * (checkpoint core-utils), con el bloque de gestos ADAPTADO (UI POLISH):
 *   1. modal-scroll: reset de scroll al abrir modales (Android);
 *   2. topbar-gestures: ocultar/mostrar .g-topbar por GESTOS SIGNIFICATIVOS
 *      (abajo significativo oculta; 2 gestos ascendentes consecutivos muestran;
 *      cerca del top muestra inmediato; jitter ignorado), en móvil, incluida
 *      la API de pruebas window._naTopbarGesture (solo activa con ?na-test=1);
 *   3. modal-backdrop-close: click/tap en el backdrop de un modal normal
 *      cerrable mediante X ejecuta exactamente el mismo cierre que la X
 *      (cerrarModal), salvo operación en curso.
 * Cero persistencia, cero negocio, cero V10, cero globals del contrato 177.
 * Classic script SIN defer/async; ejecuta en la misma posicion documental
 * original (inmediatamente despues del script inline que lo contenia).
 * NAVEGACION (goPage/goMenu/toggleDark/etc) deliberadamente NO extraida:
 * acoplada a saveAppState/persistencia, renders de dominio y contrato 177.
 */

// Mantiene un único desplazamiento fluido al abrir modales en Android.
(function(){
  function prepareModalScroll(overlay){
    if(!overlay)return;
    requestAnimationFrame(()=>{
      overlay.scrollTop=0;
      const modal=overlay.querySelector('.modal');
      if(modal)modal.scrollTop=0;
    });
  }
  document.addEventListener('DOMContentLoaded',()=>{
    document.querySelectorAll('.modal-overlay').forEach(overlay=>{
      const observer=new MutationObserver(()=>{
        if(overlay.classList.contains('open'))prepareModalScroll(overlay);
      });
      observer.observe(overlay,{attributes:true,attributeFilter:['class']});
    });
  });
})();

// Gestos de scroll: ocultar/mostrar .g-topbar con GESTOS SIGNIFICATIVOS en móvil.
// UI POLISH: scroll abajo significativo oculta; mostrar exige 2 gestos ascendentes
// CONSECUTIVOS (un gesto físico = máximo un incremento; touch usa touchstart/move/end;
// wheel agrupa eventos consecutivos); el jitter/minidesplazamientos no cuenta; volver
// cerca del top muestra inmediatamente. Sin salto de layout: transform sobre sticky.
// HOTFIX DESKTOP: en escritorio (>=701px) el scroll real vive en el CONTENEDOR de la
// página activa (.main-scroll y equivalentes), no en window. Se reutiliza la misma
// máquina (hide/jitter/2 gestos arriba/top reveal); solo cambia la FUENTE de scroll.
(function(){
  var UP_GESTURES_REQUIRED=2,UP_GESTURE_MIN=60,DOWN_HIDE_MIN=80,NEAR_TOP=12,WHEEL_WINDOW=350;
  var upGestureCount=0,scrollAnchor=0,ticking=false,modeActive=false;
  var touchStartY=0,touchDelta=0,touchActive=false;
  var wheelGroupActive=false,wheelGroupDir=null,wheelGroupDist=0,wheelTimer=null;
  var lastActivePage='';
  var DESKTOP_PAGES=['pageMenu','pageInventario','pageClientes','pageVentas','pageCaja','pageGastos'];
  var DESKTOP_SCROLL_SEL='.main-scroll,.table-wrap,.cli-list,#cajContent,#ventasContent,.v-list-wrap,#gasContent,.cj-mov-wrap';
  function activePageEl(){
    for(var i=0;i<DESKTOP_PAGES.length;i++){
      var p=document.getElementById(DESKTOP_PAGES[i]);
      if(p&&p.classList&&p.classList.contains('active'))return p;
    }
    return null;
  }
  function desktopMode(){return window.innerWidth>700&&!!activePageEl();}
  function activeScrollEl(){
    if(window.innerWidth<=700)return null;
    var page=activePageEl();
    if(page&&page.querySelector)return page.querySelector(DESKTOP_SCROLL_SEL)||null;
    return null;
  }
  function isDesktopContainer(el){
    if(!el)return false;
    var keys=DESKTOP_SCROLL_SEL.split(',');
    for(var i=0;i<keys.length;i++){
      var k=keys[i].trim();
      if(k.charAt(0)==='#'){if(el.id===k.slice(1))return true;}
      else if(k.charAt(0)==='.'&&el.classList){if(el.classList.contains(k.slice(1)))return true;}
    }
    return false;
  }
  function gesturesActive(){
    if(document.body.classList.contains('module-mobile-scroll'))return true;
    if(document.documentElement.classList.contains('config-page-scroll'))return true;
    return desktopMode();
  }
  function tb(){return document.querySelector('.g-topbar');}
  function show(){var t=tb();if(t)t.classList.remove('g-topbar-hidden');}
  function hide(){var t=tb();if(t)t.classList.add('g-topbar-hidden');}
  function currentScroll(){
    var el=activeScrollEl();
    if(el&&typeof el.scrollTop==='number')return el.scrollTop||0;
    return window.scrollY||document.documentElement.scrollTop||0;
  }
  function resetState(){upGestureCount=0;touchDelta=0;touchActive=false;scrollAnchor=currentScroll();wheelGroupDir=null;wheelGroupDist=0;wheelGroupActive=false;if(wheelTimer){clearTimeout(wheelTimer);wheelTimer=null;}}
  function significantDown(){var st=currentScroll();if(st<=NEAR_TOP){show();resetState();return;}hide();cancelGesture();scrollAnchor=st;}
  function isExcluded(el){
    while(el&&el!==document.body){
      if(el.closest){var c=el.closest('#cartDrawer,.cart-drawer,.modal-overlay,.modal,#mTicket,#mPrinter,#mCobro,#mMovInv,#mVentaLibre,#mDescuento,.cfg-sidebar,.pay-modal-body');if(c)return true;}
      if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT')return true;
      el=el.parentElement;
    }
    return false;
  }
  /* Un gesto ascendente claro (= desplazar el contenido hacia abajo) suma; con 2 consecutivos se muestra. */
  function countGesture(){upGestureCount++;if(upGestureCount>=UP_GESTURES_REQUIRED){show();resetState();}}
  function cancelGesture(){upGestureCount=0;}
  /* ── Touch: un gesto físico = máximo un incremento ── */
  document.addEventListener('touchstart',function(e){
    if(!gesturesActive())return;
    if(e.touches.length!==1)return;
    if(isExcluded(e.target)){touchActive=false;return;}
    touchActive=true;touchStartY=e.touches[0].clientY;touchDelta=0;
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!touchActive)return;
    touchDelta=e.touches[0].clientY-touchStartY;
  },{passive:true});
  document.addEventListener('touchend',function(){
    if(!touchActive)return;touchActive=false;
    if(touchDelta>=UP_GESTURE_MIN)countGesture();
    else if(touchDelta<=-DOWN_HIDE_MIN)significantDown();
    touchDelta=0;
  });
  document.addEventListener('touchcancel',function(){touchActive=false;touchDelta=0;});
  /* ── Wheel / trackpad: agrupa eventos consecutivos como un solo gesto ── */
  document.addEventListener('wheel',function(e){
    if(!gesturesActive())return;
    if(isExcluded(e.target))return;
    var d=e.deltaY,dir=d>1?'down':(d<-1?'up':null);if(!dir)return;
    if(!wheelGroupActive){wheelGroupActive=true;wheelGroupDir=dir;wheelGroupDist=Math.abs(d);}
    else{if(dir===wheelGroupDir)wheelGroupDist+=Math.abs(d);else{wheelGroupDir=dir;wheelGroupDist=Math.abs(d);}}
    if(wheelTimer)clearTimeout(wheelTimer);
    wheelTimer=setTimeout(function(){
      wheelGroupActive=false;wheelTimer=null;
      if(wheelGroupDir==='up'&&wheelGroupDist>=UP_GESTURE_MIN)countGesture();
      if(wheelGroupDir==='down'&&wheelGroupDist>=DOWN_HIDE_MIN)significantDown();
      wheelGroupDir=null;wheelGroupDist=0;
    },WHEEL_WINDOW);
  },{passive:true});
  /* ── Scroll: ocultar solo con desplazamiento descendente significativo; top → mostrar inmediato ── */
  function handleScroll(){
    if(ticking)return;ticking=true;
    requestAnimationFrame(function(){
      ticking=false;
      if(!gesturesActive())return;
      if(!tb())return;
      var st=currentScroll();
      if(st<=NEAR_TOP){show();resetState();return;}
      var delta=st-scrollAnchor;
      if(delta>=DOWN_HIDE_MIN){hide();scrollAnchor=st;upGestureCount=0;}
    });
  }
  window.addEventListener('scroll',handleScroll,{passive:true});
  /* HOTFIX DESKTOP: escucha el scroll del contenedor activo REAL. Los eventos scroll no
     burbujean; con capture=true llegan al document. Misma handleScroll => mismo hide,
     jitter, 2 gestos arriba y top reveal. En móvil (<=700) esta ruta no se usa. */
  document.addEventListener('scroll',function(e){
    if(window.innerWidth<=700)return;
    if(!gesturesActive())return;
    var t=e&&e.target;
    if(!t||t===document)return;
    if(!isDesktopContainer(t))return;
    handleScroll();
  },true);
  /* ── Reinicio al cambiar de módulo o redimensionar ── */
  function syncMode(){
    var next=gesturesActive();
    if(next!==modeActive){modeActive=next;show();resetState();return;}
    var page=activePageEl();
    var id=page?page.id:'';
    if(id!==lastActivePage){lastActivePage=id;show();resetState();}
  }
  modeActive=gesturesActive();lastActivePage=(activePageEl()||{}).id||'';resetState();
  if(typeof MutationObserver==='function'){
    new MutationObserver(syncMode).observe(document.body,{attributes:true,attributeFilter:['class']});
    new MutationObserver(syncMode).observe(document.documentElement,{attributes:true,attributeFilter:['class']});
  }
  /* HOTFIX DESKTOP: en desktop navegar no cambia clases del body, así que se envuelve
     goPage/goMenu para reiniciar la máquina en el mismo punto (misma clase g-topbar-hidden). */
  var _naOrigGoPage=goPage,_naOrigGoMenu=goMenu;
  if(typeof _naOrigGoPage==='function'){
    goPage=function(id){var r=_naOrigGoPage(id);syncMode();return r;};
  }
  if(typeof _naOrigGoMenu==='function'){
    goMenu=function(){var r=_naOrigGoMenu();syncMode();return r;};
  }
  window.addEventListener('resize',function(){syncMode();if(window.innerWidth>700){show();resetState();}});
  /* ── API de pruebas: solo disponible con ?na-test=1 ── */
  if(location.search.indexOf('na-test=1')!==-1){
    window._naTopbarGesture={
      getCount:function(){return upGestureCount;},
      getRequired:function(){return UP_GESTURES_REQUIRED;},
      getUpMin:function(){return UP_GESTURE_MIN;},
      getHideMin:function(){return DOWN_HIDE_MIN;},
      reset:resetState,
      isHidden:function(){var t=tb();return !!(t&&t.classList&&t.classList.contains('g-topbar-hidden'));},
      show:show,
      hide:hide,
      getTouchActive:function(){return touchActive;},
      getWheelActive:function(){return wheelGroupActive;},
      getWheelDir:function(){return wheelGroupDir;},
      getWheelDist:function(){return wheelGroupDist;},
      getNearTop:function(){return NEAR_TOP;},
      isActive:function(){return gesturesActive();},
      sync:function(){syncMode();},
      getActivePage:function(){var p=activePageEl();return p?p.id:'';},
      getContainerScrollTop:function(){var el=activeScrollEl();return el?(el.scrollTop||0):null;},
      simulateUpGesture:function(){if(!gesturesActive())return;countGesture();},
      simulateDownScroll:function(){if(!gesturesActive())return;cancelGesture();hide();}
    };
  }
})();

// UI POLISH: click/tap en el backdrop de un modal normal CERRABLE MEDIANTE X ejecuta
// exactamente el mismo cierre que la X (cerrarModal con el mismo id). Click dentro del
// contenido NO cierra; con una operación en curso (guards de procesamiento) NO cierra.
(function(){
  function anyBusy(){
    return !!(
      (typeof posProc!=='undefined'&&posProc)
      ||(typeof pagoProc!=='undefined'&&pagoProc)
      ||(typeof pagoRevProc!=='undefined'&&pagoRevProc)
      ||(typeof cajMovProc!=='undefined'&&cajMovProc)
      ||(typeof cajCloseProc!=='undefined'&&cajCloseProc)
      ||(typeof gastoProc!=='undefined'&&gastoProc)
      ||(typeof _naInventoryMoveBusy!=='undefined'&&_naInventoryMoveBusy)
      ||(typeof _naQuickPaymentProc!=='undefined'&&_naQuickPaymentProc)
      ||(typeof _naSaleAnnulmentProc!=='undefined'&&_naSaleAnnulmentProc)
    );
  }
  document.addEventListener('click',function(event){
    var target=event.target;
    if(!target||!target.classList||!target.classList.contains('modal-overlay'))return;
    var overlay=target;
    if(!overlay.classList.contains('open'))return;
    if(!overlay.querySelector('.btn-close-m,.pay-close'))return;
    if(anyBusy())return;
    if(typeof cerrarModal==='function'&&overlay.id)cerrarModal(overlay.id);
  },false);
})();
