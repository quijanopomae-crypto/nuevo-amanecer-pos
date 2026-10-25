/* WORK host — isolated frame, same-origin only. The canonical POS remains authoritative. */
(function (root) {
  'use strict';
  if (!root.document || root.NA_WORK_HOST) return;
  var doc = root.document, overlay = null, frame = null, launcher = null;
  var allowedPages = Object.freeze({
    'pageMenu':true,'pagePOS':true,'pageVentas':true,'pageInventario':true,
    'pageClientes':true,'pageCaja':true,'pageGastos':true,
    'pageProximamente':true,'pageConfig':true
  });
  function isHome() { var p=doc.getElementById('pageMenu'); return !!(p && p.classList.contains('active')); }
  // WORK is the default Inicio experience; ?work=0 is a reversible legacy fallback.
  // The fallback does not affect sales, cash, local outbox or canonical storage.
  // Only the authenticated hosted CANON opens WORK by default.
  // Local tests retain the current screens; ?work=1 exercises the new interface.
  var featureEnabled = !!(root.NA_HOSTED_CONFIG &&
    root.NA_HOSTED_CONFIG.environment === 'production'), temporarilyLegacy = false;
  try {
    var mode = new URLSearchParams(root.location.search).get('work');
    if (mode === '1') featureEnabled = true;
    if (mode === '0') featureEnabled = false;
  } catch (_) {}
  function sessionReady() {
    return !(root.NA_HOSTED_CONFIG && root.NA_HOSTED_CONFIG.environment === 'production') ||
      !!(root.NA_ROLES && root.NA_ROLES.confirmed === true);
  }
  function ownerDataAllowed() {
    try { return sessionReady() && !!(root.NA_ROLES && root.NA_ROLES.isOwner() === true); } catch (_) { return false; }
  }
  function syncButton() { if (launcher) launcher.hidden = !isHome() || !!overlay || !featureEnabled || !temporarilyLegacy; }
  var identity = null;
  function syncView() {
    var roles = root.NA_ROLES;
    var nextIdentity = sessionReady() && roles ? String(roles.role || 'unknown') + ':' + String(roles.deviceId || '') : null;
    if (identity !== nextIdentity) { identity = nextIdentity; close(); }

    if (!sessionReady() || !isHome()) {
      temporarilyLegacy = false;
      if (overlay) close();
    } else if (featureEnabled && !temporarilyLegacy && !overlay) {
      open();
    }
    syncButton();
  }
  function realMetrics() {
    if (!ownerDataAllowed()) return [];
    var items = Array.from(doc.querySelectorAll('#pageMenu .quick-stats .qs-card'));
    return items.map(function (card) {
      var label = card.querySelector('.qs-label'), value = card.querySelector('.qs-val'), detail = card.querySelector('.qs-sub');
      return {label:label ? label.textContent.trim() : '',value:value ? value.textContent.trim() : '',detail:detail ? detail.textContent.trim() : ''};
    }).filter(function (x) {return x.label && x.value;});
  }
  function realActivity() {
    if (!ownerDataAllowed()) return [];
    var list = doc.getElementById('naMobileActivityList');
    if (!list) return [];
    return Array.from(list.querySelectorAll('.na-mobile-activity-row')).slice(0,6).map(function (el) {
      function val(selector) { var n=el.querySelector(selector); return n ? String(n.textContent||'').trim().slice(0,150) : ''; }
      return {title:val('.na-mobile-activity-copy strong'),client:val('.na-mobile-activity-copy small:not(.na-mobile-activity-time)'),
        date:val('.na-mobile-activity-time'),amount:val('.na-mobile-activity-value')};
    }).filter(function (x) {return x.title && x.title !== 'Sin movimientos recientes';});
  }
  function initPayload() {
    var roles=root.NA_ROLES, owner=false;
    try { owner=!!(roles && typeof roles.isOwner==='function' && roles.isOwner()===true); } catch (_) {}
    return {action:'init',metrics:realMetrics(),activity:realActivity(),role:owner?'Dueño':'Empleado'};
  }
  function respond(target, data) {
    if (target && frame && target === frame.contentWindow) {
      target.postMessage(Object.assign({type:'na-work:response'},data),root.location.origin);
    }
  }
  var history = [], generation = 0, busy = false;
  function resetConversation() { history = []; generation++; busy = false; }
  function close() {
    resetConversation();
    if (overlay) { overlay.remove(); overlay=null; frame=null; doc.body.classList.remove('na-work-open'); }
    syncButton();
  }
  function open() {
    if (overlay || !doc.body || !sessionReady()) return;
    overlay=doc.createElement('section');
    overlay.id='naWorkOverlay';
    overlay.setAttribute('aria-label','WORK — Nuevo Amanecer');
    frame=doc.createElement('iframe');
    frame.src='work/index.html';
    frame.title='WORK — Nuevo Amanecer';
    frame.setAttribute('allow','microphone');
    overlay.appendChild(frame);
    doc.body.appendChild(overlay);
    doc.body.classList.add('na-work-open');
    frame.addEventListener('load',function () {
      respond(frame.contentWindow,initPayload());
    });
    syncButton();
  }
  async function ask(target,id,message) {
    if (busy) { respond(target,{action:'chat',id:id,ok:false,text:'Espera a que termine la consulta actual.'}); return; }
    var requestGeneration = generation;
    busy = true;
    try {
      if (!sessionReady() || !root.NA_ROLES || typeof root.NA_ROLES.api!=='function') throw Error('Asistente no disponible en esta sesión');
      var answer=await root.NA_ROLES.api('/auth/assistant/chat',{text:String(message||'').slice(0,1500),history:history.slice(),context:{products:[]}});
      if (requestGeneration !== generation || !sessionReady()) return;
      var out=answer && typeof answer==='object' ? answer : {};
      if (out.error) throw Error('El servidor respondió: '+String(out.error).slice(0,80));
      var text=out.texto || out.text || out.reply || out.respuesta || out.answer || out.message || '';
      if (typeof text!=='string') text='';
      if (!text && out.final) text=typeof out.final==='string'?out.final:out.final.text || out.final.respuesta || '';
      if (!text) text='El servidor respondió sin texto visible. La operación no se considera completada.';
      if (Array.isArray(out.proposals) && out.proposals.length) text+='\n\nHay propuestas pendientes de confirmar mediante el flujo autorizado del POS. No se han ejecutado automáticamente.';
      // Preserve server signatures unchanged; no synthetic assistant turns enter authenticated memory.
      if (Array.isArray(out.turns) && out.turns.length === 2 && out.turns.every(function(t){return t && ['user','assistant'].indexOf(t.role)>=0 && typeof t.content==='string' && t.content.length<=12000 && typeof t.sig==='string';})) {
        history = history.concat(out.turns).slice(-24);
        while (history.length && JSON.stringify(history).length > 60000) history.splice(0,2);
      }
      respond(target,{action:'chat',id:id,ok:true,text:String(text).slice(0,12000)});
    } catch (err) {
      if (requestGeneration !== generation || !sessionReady()) return;
      respond(target,{action:'chat',id:id,ok:false,text:err && err.message ? String(err.message).slice(0,200) : 'Error de conexión. No se ha confirmado ninguna acción.'});
    } finally { if (requestGeneration === generation) busy = false; }
  }
  root.addEventListener('message',function (event) {
    if (event.origin!==root.location.origin || !frame || event.source!==frame.contentWindow) return;
    var data=event.data;
    if (!data || typeof data!=='object' || typeof data.type!=='string' || !data.type.startsWith('na-work:')) return;
    if (data.type==='na-work:reset') {resetConversation();return;}
    if (data.type==='na-work:close') {temporarilyLegacy = true;close();return;}
    if (data.type==='na-work:metrics') {respond(event.source,initPayload());return;}
    if (data.type==='na-work:navigate') {
      var id=String(data.page||'');
      if (!allowedPages[id] || typeof root.goPage!=='function') return;
      if (id === 'pageMenu') { if (!isHome()) root.goPage(id); return; }
      // The canonical navigation still checks the session/role before entering a page.
      var changed = root.goPage(id);
      if (changed !== false && !isHome()) close();
      return;
    }
    if (data.type==='na-work:chat' && typeof data.id==='string' && typeof data.text==='string' && data.text.trim().length>0) {
      ask(event.source,data.id,data.text.trim());
    }
  });
  function mount() {
    if (!doc.body || launcher) return;
    var style=doc.createElement('style');
    style.textContent='#naWorkLauncher{position:fixed;right:17px;bottom:18px;z-index:27;border:0;border-radius:22px;background:linear-gradient(120deg,#073958,#0a90ae);color:white;font:750 14px/1 system-ui;padding:14px 18px;box-shadow:0 8px 24px #06345155;min-height:46px}#naWorkLauncher[hidden]{display:none!important}#naWorkOverlay{position:fixed;inset:0;z-index:10050;background:#f7fbff}#naWorkOverlay iframe{display:block;width:100%;height:100%;border:0;background:#f7fbff}body.na-work-open{overflow:hidden}';
    doc.head.appendChild(style);
    launcher=doc.createElement('button');
    launcher.id='naWorkLauncher';launcher.type='button';launcher.textContent='✦ WORK';
    launcher.setAttribute('aria-label','Abrir WORK');
    launcher.addEventListener('click',open);
    doc.body.appendChild(launcher);
    var home=doc.getElementById('pageMenu');
    if (home && root.MutationObserver) new root.MutationObserver(syncView).observe(home,{attributes:true,attributeFilter:['class']});
    root.addEventListener('pageshow', syncView);
    root.addEventListener('na:role', syncView);
    syncView();
    // Refresh read-only figures from the POS DOM; does not query the backend or change data.
    root.setInterval(function(){if(overlay && isHome() && frame)respond(frame.contentWindow,initPayload());},10000);
  }
  root.NA_WORK_HOST={open:open,close:close};
  if (doc.readyState==='loading') doc.addEventListener('DOMContentLoaded',mount,{once:true}); else mount();
})(window);
