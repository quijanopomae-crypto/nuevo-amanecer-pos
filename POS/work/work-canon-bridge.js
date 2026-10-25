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
  function time(){return new Date().toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});}
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
  if(disc)disc.textContent='WORK conectado a CANON · Las acciones críticas requieren confirmación en el POS.';
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
    post('reset');pending.clear();if($msgs)$msgs.replaceChildren();bubble('theirs','Nueva conversación de WORK. Tus datos del POS no se han modificado.');
  });
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
    if(d.action!=='chat'||!pending.has(d.id))return;
    var item=pending.get(d.id);pending.delete(d.id);
    if(item.loading)item.loading.remove();
    var output=d.ok?String(d.text||'Sin respuesta'):('No se completó la consulta: '+String(d.text||'Error de conexión'));
    bubble('theirs',output);
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
  // WORK is the Inicio. Navigation into protected modules uses the existing POS routing.
  var closeBtn=$('#chatBack');if(closeBtn)closeBtn.title='Volver a WORK';
  post('metrics');
})(window);
