// Seguridad: la vista previa y la ventana de impresión reciben texto, nunca HTML de la venta.
_baseRenderTicketPreview=function(){
  const sale=tkCurrentVenta||{id:'V-000001',operation:'00000001',fecha:obtenerHoy(),hora:nowT(),cajero:'Frank',metodo:'efectivo',recibido:25,vuelto:4,anulada:false,items:[{name:'Producto de ejemplo',qty:2,precio:8.5},{name:'Segundo producto',qty:1,precio:4}]};
  const built=_naBuildThermalTicket(sale,true),wrap=document.getElementById('tkPreviewWrap'),body=document.getElementById('ticketBody'),font=document.getElementById('tkFuente')?.value||"'Courier New',monospace",size=_naTicketPreviewSize();
  const selected=document.getElementById('tkAncho')?.value,customWrap=document.getElementById('tkCustomWidthWrap');
  if(customWrap)customWrap.style.display=selected==='custom'?'block':'none';
  const info=document.getElementById('tkWidthInfo');
  if(info)info.textContent=`${built.mm} mm · aproximadamente ${built.width} caracteres por línea`;
  if(wrap){
    wrap.style.width=`${built.mm}mm`;
    wrap.style.maxWidth='calc(100vw - 38px)';
    wrap.style.boxSizing='border-box';
  }
  if(!body)return;
  body.style.fontFamily=font;
  body.style.fontSize=size;
  body.style.background='#fff';
  body.style.color='#000';
  body.style.filter='grayscale(1)';
  body.style.padding=built.mm<=40?'8px 4px':'10px 6px';
  body.style.boxSizing='border-box';
  body.style.width='100%';
  body.style.overflow='hidden';
  const preview=_naSecElement('pre','thermal-ticket-pre',built.text);
  body.replaceChildren(preview);
};
imprimirTicketSistema=function(){
  _naSaveTicketSettings();
  const built=_naBuildThermalTicket(tkCurrentVenta||{items:[]},false),popup=window.open('','_blank','width=500,height=700');
  if(!popup){toast('Permite ventanas emergentes para imprimir','error');return;}
  const printDocument=popup.document,head=printDocument.createElement('head'),body=printDocument.createElement('body'),meta=printDocument.createElement('meta'),title=printDocument.createElement('title'),style=printDocument.createElement('style');
  meta.setAttribute('charset','UTF-8');
  title.textContent='Ticket';
  style.textContent=`@page{size:${built.mm}mm auto;margin:1.5mm}html,body{background:#fff!important;color:#000!important;margin:0;padding:0}body{font-family:'Courier New',monospace;width:${built.mm}mm;max-width:${built.mm}mm;margin:0 auto}#ticketBody{padding:${built.mm<=40?'1mm':'2mm'};box-sizing:border-box}.thermal-ticket-pre{margin:0;white-space:pre;font-family:'Courier New',monospace;font-size:${built.mm<=40?'7.5px':built.mm<=58?'9px':'10px'};line-height:1.25;color:#000}*{color:#000!important;background:#fff!important;box-shadow:none!important;text-shadow:none!important;filter:grayscale(1)!important}`;
  head.append(meta,title,style);
  const ticketBody=printDocument.createElement('div');
  ticketBody.id='ticketBody';
  const ticketText=printDocument.createElement('pre');
  ticketText.className='thermal-ticket-pre';
  ticketText.textContent=built.text;
  ticketBody.appendChild(ticketText);
  body.appendChild(ticketBody);
  printDocument.documentElement.replaceChildren(head,body);
  popup.focus();
  popup.onafterprint=()=>popup.close();
  setTimeout(()=>popup.print(),300);
  appConfig.printer={...(appConfig.printer||{}),mode:'system'};
  saveAppState();
};
