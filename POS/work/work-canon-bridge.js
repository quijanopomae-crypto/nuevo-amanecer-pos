/* WORK CANON bridge. Loaded AFTER the original design script. Only inside a same-origin POS iframe. */
(function (win) {
  'use strict';
  var doc=win.document, $=function(q){return doc.querySelector(q);};
  var embedded=false;
  try {embedded=win.parent!==win && win.parent.location.origin===win.location.origin;} catch (_) { embedded=false; }
  if (!embedded) return; // Direct HTML remains an explicitly labeled standalone demo.
  var menuMap={'Nueva venta':'pagePOS','Ventas':'pageVentas','Inventario':'pageInventario',
    'Clientes':'pageClientes','Caja':'pageCaja','Gastos':'pageGastos',
    'Próximamente':'pageProximamente','Configuración':'pageConfig','Inicio':'pageMenu'};
  var msgId=0,pending=new Map(),spoken=false,speech=null,utterance=null;
  var $msgs=$('#chatMessages'),$chat=$('#workChat'),$voice=$('#workVoice');
  function post(type,data){win.parent.postMessage(Object.assign({type:'na-work:'+type},data||{}),win.location.origin);}
  function time(){try{return new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit',timeZone:'America/Lima'});}catch(_){return new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});}}
  function bubble(kind,text){
    if(!$msgs)return null;
    var row=doc.createElement('div');row.className='chat-row '+(kind==='user'?'mine':'theirs');
    var body=doc.createElement('div');body.className='chat-bubble';
    var t=doc.createElement('div');t.textContent=String(text||'');
    var stamp=doc.createElement('div');stamp.className='chat-mini-time';stamp.textContent=time();
    body.append(t,stamp);row.appendChild(body);$msgs.appendChild(row);
    $msgs.scrollTop=$msgs.scrollHeight;return row;
  }
  function openChat(){
    var ch=$chat;if(!ch)return;
    ch.classList.add('open');ch.setAttribute('aria-hidden','false');doc.body.classList.add('chat-active');
    if($msgs && $msgs.querySelector('.chat-welcome'))$msgs.replaceChildren();
  }
  function setState(state){
    if($voice){$voice.classList.remove('speaking','listening','processing');if(state)$voice.classList.add(state);}
  }
  function say(text){
    if(!spoken||!('speechSynthesis' in win)||!win.SpeechSynthesisUtterance)return;
    try{
      win.speechSynthesis.cancel();
      utterance=new win.SpeechSynthesisUtterance(String(text||'').slice(0,1500));
      utterance.lang='es-PE';utterance.rate=1;
      utterance.onstart=function(){setState('speaking');};
      utterance.onend=function(){setState('');};
      win.speechSynthesis.speak(utterance);
    }catch(_){setState('');}
  }
  function ask(text,mode){
    text=String(text||'').trim();
    if(!text)return;
    if(win.navigator.onLine===false){bubble('theirs','Sin conexión. No se ha enviado ninguna operación.');return;}
    openChat();
    bubble('user',text);
    var id='work-'+(++msgId)+'-'+Date.now();
    var loading=bubble('theirs','Consultando WORK…');
    pending.set(id,{loading:loading,mode:mode||'chat'});
    post('chat',{id:id,text:text});
  }
  function intercept(el,eventName,handler){
    if(!el)return;
    el.addEventListener(eventName,function(e){e.preventDefault();e.stopImmediatePropagation();handler(e);},true);
  }
  function interceptDocument(name,handler){
    doc.addEventListener('click',function(e){
      var button=e.target && e.target.closest ? e.target.closest(name):null;
      if(!button)return;
      e.preventDefault();e.stopImmediatePropagation();handler(button,e);
    },true);
  }
  // Map the nine actual menu entries to CANON; do not show demo modals.
  interceptDocument('.drawer-nav-item',function(button){
    var title=button.querySelector('.drawer-nav-text strong');
    var page=title && menuMap[title.textContent.trim()];
    if(page)post('navigate',{page:page});
  });
  // Replace screenshot-only dashboard figures with currently rendered CANON values.
  var metrics=$('.metrics');
  if(metrics)metrics.querySelectorAll('.metric').forEach(function(item){
    var v=item.querySelector('.metric-value'),d=item.querySelector('.metric-detail');
    if(v)v.textContent='—';
    if(d)d.textContent='Consultando CANON';
  });
  var recent=$('.recent'), recentNote=null;
  if(recent) {
    var rows=recent.querySelectorAll('.activity');
    rows.forEach(function(row){row.remove();});
    recentNote=doc.createElement('p');recentNote.textContent='Consulta el historial en Ventas; no se mostrarán operaciones de ejemplo.';
    recentNote.style.cssText='font-size:12px;color:#577086;line-height:1.6';recent.appendChild(recentNote);
  }
  function refreshActivity(items) {
    if (!recent) return;
    recent.querySelectorAll('.activity').forEach(function(row){row.remove();});
    var valid=(Array.isArray(items)?items:[]).slice(0,6).filter(function(row){return row && row.title;});
    if (recentNote) recentNote.hidden = valid.length > 0;
    valid.forEach(function(record){
      var line=doc.createElement('div');line.className='activity';
      var icon=doc.createElement('div');icon.className='activity-icon';icon.textContent='▤';
      var info=doc.createElement('div');info.className='activity-info';
      [['activity-title',record.title],['activity-client',record.client],['activity-date',record.date]].forEach(function(field){
        var n=doc.createElement('div');n.className=field[0];n.textContent=String(field[1]||'').slice(0,150);info.appendChild(n);
      });
      var amt=doc.createElement('div');amt.className='activity-amount';amt.textContent=String(record.amount||'').slice(0,80);
      line.append(icon,info,amt);recent.appendChild(line);
    });
  }
  var disc=$('.chat-disclaimer');
  if(disc)disc.textContent='WORK conectado a CANON · Ningún cambio se aplica sin tu «Confirmar» en la tarjeta.';
  var footer=$('.voice-history-foot');
  if(footer)footer.textContent='Las respuestas se consultan en CANON. La voz disponible usa dictado y lectura por turnos; no es aún audio Live bidireccional.';
  var voiceLabel=$('.voice-eyebrow');
  if(voiceLabel)voiceLabel.textContent='WORK · VOZ POR TURNOS';
  // Intercept demo answers; never label a generated poster as an actual image.
  intercept($('#chatComposeForm'),'submit',function(){
    var field=$('#chatInput');
    if(!field)return;
    var txt=field.value.trim();
    var tray=$('#attachmentTray');
    if(tray && tray.children.length) {
      openChat();bubble('theirs','Los adjuntos están en vista previa local. Aún no se envían al servicio de WORK. Retíralos para enviar solo texto.');
      return;
    }
    if(!txt){var b=$('#voiceButton');if(b)b.click();return;}
    field.value='';field.style.height='auto';
    ask(txt);
  });
  var ci=$('#chatInput');
  if(ci)ci.addEventListener('keydown',function(e){
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();e.stopImmediatePropagation();$('#chatComposeForm').requestSubmit();}
  },true);
  intercept($('#promptForm'),'submit',function(){
    var f=$('#promptInput');if(f){var s=f.value;f.value='';ask(s);}
  });
  interceptDocument('.chips button',function(btn){ask(btn.textContent);});
  interceptDocument('.chat-suggestions button',function(btn){ask(btn.textContent);});
  interceptDocument('.metric',function(btn){
    var n=btn.querySelector('.metric-name');
    if(n)ask('Explícame el estado actual de '+n.textContent.trim().toLowerCase()+' en el punto de venta.');
  });
  interceptDocument('#askImage,#askAdvertising',function(){
    openChat();bubble('theirs','Generación de imágenes pendiente de integrar con un proveedor autorizado. No se ha creado ninguna imagen.');
    var p=$('#attachOptions');if(p)p.hidden=true;
  });
  // The 3 labels remain faithful to the design, without pretending to select a server model.
  var brain=$('#brainLevelsButton');
  if(brain)brain.title='Flash, Pro y Ultra: preferencias visuales de WORK. El modelo real lo determina la configuración del servidor.';
  // Voice keyboard sends via the authenticated assistant; it never uses simulated replies.
  intercept($('#voiceTypeForm'),'submit',function(){
    var box=$('#voiceType');var t=box ? box.value.trim():'';
    if(box)box.value='';
    var cap=$('#voiceCaptionBox'),ct=$('#voiceSubtitle');
    if(cap)cap.hidden=false;if(ct)ct.textContent='WORK está consultando CANON…';
    ask(t,'voice');
  });
  // Browser speech recognition is turn-based; do not present it as full realtime Live.
  intercept($('#voiceMic'),'click',function(){
    var Recognition=win.SpeechRecognition||win.webkitSpeechRecognition;
    if(!Recognition){var c=$('#voiceCaptionBox'),t=$('#voiceSubtitle');if(c)c.hidden=false;if(t)t.textContent='Reconocimiento de voz no disponible. Puedes escribir en el cuadro inferior.';return;}
    if(speech){try{speech.stop();}catch(_){}speech=null;setState('');return;}
    var recog=new Recognition();speech=recog;recog.lang='es-PE';recog.interimResults=false;recog.maxAlternatives=1;
    recog.onresult=function(e){if(speech!==recog)return;var t=e.results&&e.results[0]&&e.results[0][0]?e.results[0][0].transcript:'';if(t)ask(t,'voice');};
    recog.onerror=function(){setState('');speech=null;};
    recog.onend=function(){setState('');speech=null;};
    setState('listening');
    try{recog.start();}catch(_){speech=null;setState('');}
  });
  function stopRealVoice() {
    var active=speech;speech=null;
    if(active){try{active.abort();}catch(_){}}
    if('speechSynthesis' in win)win.speechSynthesis.cancel();
    setState('');
  }
  // Keep the design's close handler; release the real bridge microphone first.
  ['#voiceExit','#chatBack'].forEach(function(selector){
    var button=$(selector);if(button)button.addEventListener('click',stopRealVoice,true);
  });
  win.addEventListener('pagehide',stopRealVoice);
  intercept($('#voiceStop'),'click',function(){
    if(speech){try{speech.abort();}catch(_){}speech=null;}
    if('speechSynthesis'in win)win.speechSynthesis.cancel();
    setState('');
  });
  intercept($('#voiceSound'),'click',function(e){
    spoken=!spoken;
    e.currentTarget.setAttribute('aria-pressed',String(spoken));
    e.currentTarget.title=spoken?'Lectura de respuestas activada':'Lectura de respuestas silenciada';
    if(!spoken && 'speechSynthesis' in win)win.speechSynthesis.cancel();
  });
  intercept($('#newConversation'),'click',function(){
    post('reset');pending.clear();cardEls.clear();if($msgs)$msgs.replaceChildren();bubble('theirs','Nueva conversación de WORK. Tus datos del POS no se han modificado.');
  });
  // ---- Tarjetas tipadas de WORK (confirmación real) ----
  // Solo se pintan datos planos que manda el host (textContent). El token firmado nunca llega aquí: el host lo guarda y la puerta del
  // asistente original lo gasta una sola vez en el servidor al tocar «Confirmar».
  var cardCss=doc.createElement('style');
  cardCss.textContent='.na-card{background:#fff;border:1px solid #cfe0ea;border-radius:14px;padding:12px 13px;margin-top:6px;font-size:13px;color:#16384e;max-width:100%}'+
    '.na-card h4{margin:0 0 7px;font-size:14px}.na-card table{width:100%;border-collapse:collapse}.na-card td,.na-card th{padding:4px 0;text-align:left;vertical-align:top;border-bottom:1px solid #eef3f6}'+
    '.na-card .na-tscroll{overflow-x:auto;max-width:100%;min-width:0;-webkit-overflow-scrolling:touch;overscroll-behavior-x:contain}.na-card .na-tscroll:focus-visible{outline:2px solid #066f87;outline-offset:2px}.na-card caption.na-cap{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}'+
    '.na-card td:last-child,.na-card th:last-child{text-align:right;white-space:nowrap;padding-left:8px}.na-card .na-warn{background:#fff6e0;border-radius:8px;padding:6px 8px;margin-top:7px;color:#7a5200}'+
    '.na-card .na-note{font-size:11.5px;color:#577086;margin-top:7px}.na-card .na-res{margin-top:7px;font-weight:650}.na-card .na-acts{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}'+
    '.na-card button{border:0;border-radius:11px;padding:10px 14px;font:700 14px system-ui;min-height:44px}.na-card .na-ok{background:linear-gradient(120deg,#052f49,#066f87);color:#fff}'+
    '.na-card .na-no{background:#eaf0f3;color:#16384e}.na-card button:disabled{opacity:.55}.na-card[data-st="done"]{border-color:#16a34a}.na-card[data-st="failed"],.na-card[data-st="blocked"]{border-color:#dc2626}.na-card[data-st="partial"],.na-card[data-st="waiting"]{border-color:#d97706}.na-card[data-kind="lote"]{border-width:2px;border-color:#066f87}.na-card .na-rows{max-height:24vh;overflow-y:auto;-webkit-overflow-scrolling:touch}.na-card[data-kind="clarify"] .na-acts button{flex:1 1 auto}';
  (doc.head||doc.body).appendChild(cardCss);
  var cardEls=new Map();
  function node(tag,cls,text){var n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=String(text);return n;}
  function renderCard(v){
    if(!v||typeof v!=='object'||typeof v.key!=='string'||!$msgs)return;
    var row=doc.createElement('div');row.className='chat-row theirs';
    var body=doc.createElement('div');body.className='chat-bubble';
    var c=node('div','na-card');c.dataset.st='pending';c.dataset.kind=String(v.kind||'');
    c.appendChild(node('h4','',v.title||'Propuesta'));
    var res=node('div','na-res');res.setAttribute('aria-live','polite');
    if(v.kind==='table'){
      if(v.text)c.appendChild(node('div','na-note',v.text));
      // Si el host recortó filas o columnas, se dice claro y en voz de lector de pantalla (role=status).
      if(v.trim){var tn=node('div','na-warn na-trim',v.trim);tn.setAttribute('role','status');c.appendChild(tn);}
      if(v.rows&&v.rows.length){
        // Contenedor con scroll horizontal propio: la tabla ancha se desliza dentro de la tarjeta y no ensancha la página.
        var wrap=node('div','na-tscroll');wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Tabla: '+String(v.title||'Consulta')+'. Se desliza a los lados.');
        var tb=doc.createElement('table');
        var nc=Math.max((v.columns||[]).length,v.rows.reduce(function(m,r){return Math.max(m,r.length);},0));
        if(nc>3)tb.style.minWidth=(nc*80)+'px';
        tb.appendChild(node('caption','na-cap',String(v.title||'Consulta')+(v.trim?'. '+v.trim:'')));
        if(v.columns&&v.columns.length){var th=doc.createElement('thead'),hr=doc.createElement('tr');v.columns.forEach(function(x){var h=node('th','',x);h.setAttribute('scope','col');hr.appendChild(h);});th.appendChild(hr);tb.appendChild(th);}
        var tbody=doc.createElement('tbody');
        v.rows.forEach(function(r){var tr=doc.createElement('tr');r.forEach(function(x){tr.appendChild(node('td','',x));});tbody.appendChild(tr);});
        tb.appendChild(tbody);wrap.appendChild(tb);c.appendChild(wrap);
      }else if(!v.text)c.appendChild(node('div','na-note','Sin datos.'));
    }else if(v.kind==='steps'){
      var ol=doc.createElement('ol');(v.steps||[]).forEach(function(x){ol.appendChild(node('li','',x));});c.appendChild(ol);
    }else if(v.rows&&v.rows.length){
      var t2=doc.createElement('table');
      v.rows.forEach(function(r){var tr=doc.createElement('tr');tr.appendChild(node('td','',r[0]));tr.appendChild(node('td','',r[1]));t2.appendChild(tr);});
      if(v.kind==='lote'){var wrap=node('div','na-rows');wrap.appendChild(t2);c.appendChild(wrap);}else c.appendChild(t2); // lote: la lista se desplaza dentro de la tarjeta y el botón queda a la vista
    }
    (v.warnings||[]).forEach(function(w){c.appendChild(node('div','na-warn',w));});
    if(v.note)c.appendChild(node('div','na-note',v.note));
    var left=null;
    if(v.kind==='confirm'&&v.expiresAt){left=node('div','na-note','');c.appendChild(left);}
    c.appendChild(res);
    var acts=node('div','na-acts');
    var ok=null,no=null;
    function send(type,extra){post(type,Object.assign({key:v.key},extra||{}));}
    if(v.kind==='confirm'){
      ok=node('button','na-ok','Confirmar');ok.type='button';
      no=node('button','na-no','Cancelar');no.type='button';
      ok.addEventListener('click',function(){if(c.dataset.st!=='pending'&&c.dataset.st!=='retry')return;ok.disabled=true;no.disabled=true;send('card-confirm');});
      no.addEventListener('click',function(){var st=c.dataset.st;if(st!=='pending'&&st!=='retry'&&st!=='waiting')return;ok.disabled=true;no.disabled=true;send('card-cancel');}); // «Cancelar» sigue activo durante la cuenta regresiva
      acts.append(ok,no);
    }else if(v.kind==='lote'){
      ok=node('button','na-ok',v.title||'Confirmar todo');ok.type='button';
      no=node('button','na-no','Cancelar todo');no.type='button';
      ok.addEventListener('click',function(){if(c.dataset.st!=='pending'&&c.dataset.st!=='retry')return;ok.disabled=true;send('card-confirm-all');});
      // «Cancelar todo» antes de empezar; mientras el lote corre el mismo botón es «Detener» (el host termina la tarjeta en curso y no gasta más).
      no.addEventListener('click',function(){var st=c.dataset.st;if(st!=='pending'&&st!=='retry'&&st!=='working'&&st!=='waiting')return;no.disabled=true;send('card-cancel-all');});
      acts.append(ok,no);
    }else if(v.kind==='clarify'){
      // Una sola pregunta con opciones tocables: tocar una opción manda ese pedido ya preciso; «Otro monto» / «Solo algunas» dejan el texto listo para completar.
      var chips=[];
      (v.options||[]).slice(0,8).forEach(function(o){
        var b=node('button','na-no',o.label);b.type='button';chips.push(b);
        b.addEventListener('click',function(){
          if(c.dataset.st==='done')return;
          if(o.text){c.dataset.st='done';chips.forEach(function(x){x.disabled=true;});ask(o.text);}
          else if(o.fill){var f=$('#chatInput');if(f){f.value=o.fill;f.focus();}}
        });
        acts.appendChild(b);
      });
    }else if(v.kind==='review'){
      var open=node('button','na-ok','Abrir en el asistente');open.type='button';
      open.addEventListener('click',function(){send('card-assistant');});acts.appendChild(open);
    }else if(v.kind==='steps'&&v.go){
      var go=node('button','na-ok','Llévame ahí');go.type='button';go.addEventListener('click',function(){send('card-open');});acts.appendChild(go);
    }else if(v.kind==='doc'){
      var dd=node('button','na-ok','Abrir documento');dd.type='button';dd.addEventListener('click',function(){send('card-open');});acts.appendChild(dd);
    }else if(v.kind==='denied'){
      res.textContent=v.note||'Eso lo hace el Admin.';
    }
    if(acts.childNodes.length)c.appendChild(acts);
    var timer=null;
    if(left){
      var tick=function(){
        var ms=v.expiresAt-Date.now();
        if(c.dataset.st==='done'||c.dataset.st==='cancelled'||c.dataset.st==='failed'||c.dataset.st==='blocked'||c.dataset.st==='expired'){clearInterval(timer);left.textContent='';return;}
        if(ms<=0){clearInterval(timer);left.textContent='Venció';if(c.dataset.st==='pending'||c.dataset.st==='retry'){ok.disabled=true;no.disabled=true;send('card-cancel',{why:'vencida'});}return;}
        var sec=Math.ceil(ms/1000);left.textContent='Vence en '+Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');
      };
      tick();timer=setInterval(tick,1000);
    }
    cardEls.set(v.key,{card:c,ok:ok,no:no,res:res,label:ok?ok.textContent:'',kind:v.kind});
    body.appendChild(c);row.appendChild(body);$msgs.appendChild(row);$msgs.scrollTop=$msgs.scrollHeight;
  }
  // Con muchas tarjetas el chat bajaba hasta la última y «Confirmar todo» quedaba ~30 tarjetas arriba: al pintar el lote se deja SU tarjeta a la vista
  // (arriba del chat) y mientras hay un lote las actualizaciones de las tarjetas no arrastran el chat hacia abajo.
  var loteEl=null;
  function showLote(cards){
    var lote=(cards||[]).filter(function(v){return v&&v.kind==='lote'&&typeof v.key==='string';})[0],r=lote&&cardEls.get(lote.key);
    if(!r||!r.card||!$msgs||!r.card.getBoundingClientRect)return;
    loteEl=r.card;
    $msgs.scrollTop=Math.max(0,r.card.getBoundingClientRect().top-$msgs.getBoundingClientRect().top+$msgs.scrollTop-8);
  }
  function updateCard(d){
    var rec=cardEls.get(d.key);if(!rec)return;
    var st=String(d.state||'');
    rec.card.dataset.st=st;
    rec.res.textContent=String(d.msg||'').slice(0,300);
    if(rec.ok){
      if(rec.kind==='lote'&&(st==='working'||st==='waiting')){rec.ok.disabled=true;rec.ok.textContent=d.stopping?'Deteniendo…':'Guardando…';rec.no.disabled=!!d.stopping;rec.no.textContent=d.stopping?'Deteniendo…':'Detener';}
      else if(st==='working'){rec.ok.disabled=true;rec.no.disabled=true;rec.ok.textContent='Guardando…';}
      else if(st==='waiting'){rec.ok.disabled=true;rec.no.disabled=false;rec.ok.textContent='Esperando…';}
      else if(st==='pending'){rec.ok.disabled=false;rec.no.disabled=false;rec.ok.textContent=rec.label||'Confirmar';if(rec.kind==='lote')rec.no.textContent='Cancelar todo';}
      else if(st==='retry'){rec.ok.disabled=false;rec.no.disabled=false;rec.ok.textContent='Reintentar';}
      else{rec.ok.disabled=true;rec.no.disabled=true;rec.ok.textContent=({done:'Hecho',partial:'Terminó',failed:'No disponible',blocked:'No disponible',expired:'Venció',cancelled:'Cancelada'})[st]||'Confirmar';}
    }
    if($msgs&&!(loteEl&&/^(pending|working|waiting|retry)$/.test(loteEl.dataset.st||'')))$msgs.scrollTop=$msgs.scrollHeight;
  }
  win.addEventListener('message',function(event){
    if(event.origin!==win.location.origin||event.source!==win.parent)return;
    var d=event.data;if(!d || d.type!=='na-work:response')return;
    if(d.action==='init'){
      var role=$('.drawer-user-data span');
      if (role) role.textContent = d.role==='Dueño' ? 'Dueño' : 'Empleado';
      refreshActivity(d.activity);
      var rows=Array.isArray(d.metrics)?d.metrics:[];
      var targets=metrics?Array.from(metrics.querySelectorAll('.metric')):[];
      targets.forEach(function(card){
        var lab=card.querySelector('.metric-name'),val=card.querySelector('.metric-value'),detail=card.querySelector('.metric-detail');
        var k=lab?lab.textContent.trim().toLowerCase():'';
        var matched=rows.find(function(r){var a=String(r.label||'').toLowerCase();return a===k || (k==='ventas hoy' && a.includes('ventas')) || (k==='en caja' && a.includes('caja')) || (k==='por cobrar' && a.includes('cobrar')) || (k==='stock crítico' && a.includes('stock'));});
        if(val)val.textContent=matched?matched.value:'—';
        if(detail)detail.textContent=matched?matched.detail||'CANON':'Sin dato confirmado';
      });
      return;
    }
    if(d.action==='card'&&typeof d.key==='string'){updateCard(d);return;}
    if(d.action==='progress'&&pending.has(d.id)){
      var pl=pending.get(d.id).loading,pt=pl&&pl.querySelector?pl.querySelector('.chat-bubble > div'):null;
      if(pt)pt.textContent=String(d.text||'').slice(0,200);
      return;
    }
    if(d.action!=='chat'||!pending.has(d.id))return;
    var item=pending.get(d.id);pending.delete(d.id);
    if(item.loading)item.loading.remove();
    var output=d.ok?String(d.text||(Array.isArray(d.cards)&&d.cards.length?'':'Sin respuesta')):('No se completó la consulta: '+String(d.text||'Error de conexión'));
    if(output.trim()||!(Array.isArray(d.cards)&&d.cards.length))bubble('theirs',output);
    if(d.ok&&Array.isArray(d.cards)){d.cards.slice(0,31).forEach(renderCard);showLote(d.cards);}
    if(item.mode==='voice') {
      var cap=$('#voiceCaptionBox'),sub=$('#voiceSubtitle');
      if(cap)cap.hidden=false;
      if(sub)sub.textContent=output;
      if(d.ok)say(output);
    }
  });
  // Render actual displayed turns in the voice history instead of the standalone demo array.
  var historyToggle=$('#voiceHistoryToggle');
  if(historyToggle)historyToggle.addEventListener('click',function(){
    var list=$('#voiceHistoryList'), count=$('#voiceHistoryCount');
    if(!list||!$msgs)return;
    list.replaceChildren();
    var rows=Array.from($msgs.querySelectorAll('.chat-row'));
    rows.forEach(function(row){var text=row.querySelector('.chat-bubble > div');if(!text)return;var item=doc.createElement('p');item.textContent=(row.classList.contains('mine')?'Tú: ':'WORK: ')+text.textContent;list.appendChild(item);});
    if(count)count.textContent=String(rows.filter(function(r){return r.classList.contains('mine');}).length);
  });
  // WORK closes to the existing POS without destroying app state.
  var closeBtn=$('#chatBack');if(closeBtn)closeBtn.title='Volver a WORK';
  var closeMain=doc.createElement('button');
  closeMain.type='button';closeMain.textContent='Volver al POS';
  closeMain.style.cssText='position:fixed;right:8px;bottom:8px;z-index:13;background:#073d59;color:#fff;border:0;border-radius:12px;padding:8px 12px;font-size:11px;box-shadow:0 2px 7px #0003';
  closeMain.setAttribute('aria-label','Volver al punto de venta');
  closeMain.addEventListener('click',function(){stopRealVoice();post('close');});
  doc.body.appendChild(closeMain);
  post('metrics');
})(window);
