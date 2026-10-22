/* #32 Compartir comprobante en PDF por WhatsApp. Solo presentación: nunca escribe ventas, pagos ni stock.
   Candado 'compartir-pdf-whatsapp' (pos-permissions.js): falla cerrado; sin NA_PERMISSIONS o con el
   candado puesto, la opción no aparece. El PDF reutiliza el generador local de share-receipt.js (sin CDN)
   y el mismo texto del ticket: solo lo que ya imprime el ticket al cliente. */
(function(root){
  'use strict';
  const LOCK='compartir-pdf-whatsapp';
  let busy=false;
  function available(){try{const p=root.NA_PERMISSIONS;if(!p||typeof p.featureLocked!=='function')return false;return p.featureLocked(LOCK)===false;}catch(_){return false;}}
  function share(){return root.NAReceiptShare||null;}
  function notify(message,tone='error'){try{if(typeof toast==='function'){toast(message,tone);return;}}catch(_){}if(typeof root.toast==='function')root.toast(message,tone);}
  function el(tag,cls,text){const n=root.document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
  // Mensaje corto para el cliente; las instrucciones para adjuntar van al cajero en pantalla.
  function chatText(receipt){const name=String(receipt?.customerName||'').trim(),generic=!name||/^(sin cliente|consumidor final|cliente gen[eé]rico|cliente general|p[uú]blico general|varios)$/i.test(name);return(generic?'Hola':'Hola '+name)+', te envío tu comprobante en PDF.';}
  // Sin número válido abre wa.me/?text= para que elija el contacto. Con número respeta «Abrir con» (Android).
  function chatUrl(phone,receipt,app='auto',ua){const s=share(),text=chatText(receipt);if(s&&s.normalizePhone(phone))return s.sendUrl(phone,text,app,ua);return'https://wa.me/?text='+encodeURIComponent(text);}
  function canShareFile(file){try{const n=root.navigator;return!!(n&&typeof n.share==='function'&&typeof n.canShare==='function'&&n.canShare({files:[file]}));}catch(_){return false;}}
  function status(text){const s=root.document.getElementById('naPdfWaStatus');if(s)s.textContent=text;}
  function download(file){const url=root.URL.createObjectURL(file),a=el('a');a.href=url;a.download=file.name;a.rel='noopener';a.style.display='none';root.document.body.append(a);a.click();a.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),120000);}
  async function send(){
    if(busy||!available())return'locked';
    const s=share(),receipt=s?.currentReceipt?.();if(!s||!receipt){notify('No hay comprobante abierto');return'none';}
    const button=root.document.getElementById('naPdfWaSend');busy=true;if(button)button.disabled=true;status('Preparando PDF…');
    try{
      const file=await s.fileFor(receipt,'pdf');
      if(canShareFile(file)){
        // El menú del sistema muestra WhatsApp y WhatsApp Business: el dueño elige desde cuál enviar.
        try{await root.navigator.share({title:'Comprobante Nuevo Amanecer',text:chatText(receipt),files:[file]});status('Elige el contacto y confirma el envío en WhatsApp.');return'shared';}
        catch(error){if(error&&error.name==='AbortError'){status('Envío cancelado. La operación sigue guardada.');return'aborted';}}
      }
      download(file);
      const phone=root.document.getElementById('naReceiptPhone')?.value||receipt.phone||'',url=chatUrl(phone,receipt,s.settings().app);
      const chat=root.open(url,'_blank');if(chat)chat.opener=null;else root.location?.assign?.(url);
      status('PDF descargado. En el chat de WhatsApp toca 📎 y adjunta «'+file.name+'».');notify('PDF descargado. Adjúntalo en el chat de WhatsApp.','success');return'fallback';
    }catch(error){status('No se pudo generar el PDF. Puedes compartir como texto.');return'error';}
    finally{busy=false;if(button)button.disabled=false;}
  }
  function install(){
    const overlay=root.document.getElementById('naReceiptShare');if(!overlay)return false;
    let box=root.document.getElementById('naPdfWa');
    if(!available()){if(box)box.remove();return false;}
    if(box)return true;
    const body=overlay.querySelector('.mbody');if(!body)return false;
    box=el('div','na-pdf-wa');box.id='naPdfWa';
    const button=el('button','na-pdf-wa-send','📄 Enviar PDF por WhatsApp');button.id='naPdfWaSend';button.type='button';button.onclick=send;
    const hint=el('small','na-receipt-status','Podrás elegir WhatsApp o WhatsApp Business.');
    const st=el('p','na-receipt-status');st.id='naPdfWaStatus';st.setAttribute('role','status');
    box.append(button,hint,st);body.append(box);return true;
  }
  function check(){const o=root.document.getElementById('naReceiptShare');if(o&&o.classList.contains('open'))install();}
  function watchDialog(o){const obs=new root.MutationObserver(check);obs.observe(o,{attributes:true,attributeFilter:['class']});check();return obs;}
  function watch(){if(!root.document||typeof root.MutationObserver!=='function')return;const o=root.document.getElementById('naReceiptShare');if(o){watchDialog(o);return;}
    const host=root.document.body||root.document.documentElement;const wait=new root.MutationObserver(()=>{const d=root.document.getElementById('naReceiptShare');if(!d)return;wait.disconnect();watchDialog(d);});wait.observe(host,{childList:true});}
  if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',watch);else watch();}
  root.NA_PDF_WHATSAPP=Object.freeze({LOCK,available,chatText,chatUrl,canShareFile,send,install});
})(globalThis);
