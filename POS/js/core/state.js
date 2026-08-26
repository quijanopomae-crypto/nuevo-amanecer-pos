/*
 * js/core/state.js - estado UI transversal compartido del POS (ETAPA 4, work item STATE).
 *
 * DOS bloques puros extraidos byte-exacto desde POS/index.html @ 4158e04
 * (checkpoint core-utils):
 *   1. modal-scroll: reset de scroll al abrir modales (Android);
 *   2. topbar-gestures: ocultar/mostrar .g-topbar con 3 gestos ascendentes
 *      en movil, incluida la API de pruebas window._naTopbarGesture
 *      (solo activa con ?na-test=1).
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

// Gestos de scroll: ocultar/mostrar .g-topbar con 3 gestos ascendentes en móvil
// Un gesto físico = máximo un incremento. Touch usa touchstart/move/end. Wheel agrupa eventos consecutivos.
(function(){
  var upGestureCount=0,lastScrollY=0,ticking=false;
  var THRESHOLD=20,NEAR_TOP=20,WHEEL_WINDOW=350;
  var touchStartY=0,touchMaxUp=0,touchActive=false;
  var wheelGroupActive=false,wheelGroupDir=null,wheelGroupDist=0,wheelTimer=null;
  function tb(){return document.querySelector('.g-topbar');}
  function show(){var t=tb();if(t)t.classList.remove('g-topbar-hidden');}
  function hide(){var t=tb();if(t)t.classList.add('g-topbar-hidden');}
  function resetState(){upGestureCount=0;touchMaxUp=0;touchActive=false;wheelGroupDir=null;wheelGroupDist=0;wheelGroupActive=false;if(wheelTimer){clearTimeout(wheelTimer);wheelTimer=null;}}
  function isExcluded(el){
    while(el&&el!==document.body){
      if(el.closest){var c=el.closest('#cartDrawer,.cart-drawer,.modal-overlay,.modal,#mTicket,#mPrinter,#mCobro,#mMovInv,#mVentaLibre,#mDescuento,#pageConfig,.cfg-shell,.pay-modal-body');if(c)return true;}
      if(el.tagName==='INPUT'||el.tagName==='TEXTAREA'||el.tagName==='SELECT')return true;
      el=el.parentElement;
    }
    return false;
  }
  function countGesture(){upGestureCount++;if(upGestureCount>=3){show();resetState();}}
  function cancelGesture(){upGestureCount=0;}
  /* ── Touch: un gesto físico = máximo un incremento ── */
  document.addEventListener('touchstart',function(e){
    if(!document.body.classList.contains('module-mobile-scroll'))return;
    if(e.touches.length!==1)return;
    if(isExcluded(e.target)){touchActive=false;return;}
    touchActive=true;touchStartY=e.touches[0].clientY;touchMaxUp=0;
  },{passive:true});
  document.addEventListener('touchmove',function(e){
    if(!touchActive)return;
    var dY=e.touches[0].clientY-touchStartY;if(dY>touchMaxUp)touchMaxUp=dY;
  },{passive:true});
  document.addEventListener('touchend',function(){
    if(!touchActive)return;touchActive=false;
    if(touchMaxUp>=THRESHOLD)countGesture();
  });
  document.addEventListener('touchcancel',function(){touchActive=false;});
  /* ── Wheel / trackpad: agrupa eventos consecutivos como un solo gesto ── */
  document.addEventListener('wheel',function(e){
    if(!document.body.classList.contains('module-mobile-scroll'))return;
    if(isExcluded(e.target))return;
    var d=e.deltaY,dir=d>1?'down':(d<-1?'up':null);if(!dir)return;
    if(!wheelGroupActive){wheelGroupActive=true;wheelGroupDir=dir;wheelGroupDist=Math.abs(d);}
    else{if(dir===wheelGroupDir)wheelGroupDist+=Math.abs(d);else{wheelGroupDir=dir;wheelGroupDist=Math.abs(d);}}
    if(wheelTimer)clearTimeout(wheelTimer);
    wheelTimer=setTimeout(function(){
      wheelGroupActive=false;wheelTimer=null;
      if(wheelGroupDir==='up'&&wheelGroupDist>=THRESHOLD)countGesture();
      if(wheelGroupDir==='down')cancelGesture();
    },WHEEL_WINDOW);
    if(dir==='down'){cancelGesture();hide();}
  },{passive:true});
  /* ── Scroll: visibilidad (ocultar al bajar, mostrar cerca del inicio) ── */
  function handleScroll(){
    if(ticking)return;ticking=true;
    requestAnimationFrame(function(){
      if(!document.body.classList.contains('module-mobile-scroll')){ticking=false;return;}
      var st=window.scrollY||document.documentElement.scrollTop||0;
      if(!tb()){ticking=false;return;}
      if(st<=NEAR_TOP){show();resetState();lastScrollY=st;ticking=false;return;}
      var diff=st-lastScrollY;
      if(diff>5&&st>NEAR_TOP){hide();cancelGesture();}
      lastScrollY=st;ticking=false;
    });
  }
  window.addEventListener('scroll',handleScroll,{passive:true});
  /* ── Reinicio al cambiar de módulo o redimensionar ── */
  new MutationObserver(function(){
    if(!document.body.classList.contains('module-mobile-scroll')){show();resetState();}
  }).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',function(){if(window.innerWidth>700){show();resetState();}});
  /* ── API de pruebas: solo disponible con ?na-test=1 ── */
  if(location.search.indexOf('na-test=1')!==-1){
    window._naTopbarGesture={
      getCount:function(){return upGestureCount;},
      reset:resetState,
      isHidden:function(){return (tb()||{}).classList&&tb().classList.contains('g-topbar-hidden');},
      show:show,
      hide:hide,
      getTouchActive:function(){return touchActive;},
      getWheelActive:function(){return wheelGroupActive;},
      getWheelDir:function(){return wheelGroupDir;},
      getWheelDist:function(){return wheelGroupDist;},
      getThreshold:function(){return THRESHOLD;},
      getNearTop:function(){return NEAR_TOP;},
      simulateUpGesture:function(){if(!document.body.classList.contains('module-mobile-scroll'))return;countGesture();},
      simulateDownScroll:function(){if(!document.body.classList.contains('module-mobile-scroll'))return;cancelGesture();hide();}
    };
  }
})();
