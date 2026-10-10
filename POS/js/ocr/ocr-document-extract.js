/* Local document reader. Plain text only; never imports document HTML or executes PDF actions. */
(function(root){
 'use strict';
 var MAX_BYTES=20*1024*1024,MAX_PAGES=30,MAX_TEXT=500000,MAX_ZIP=40*1024*1024;
 var pdfPromise,wordPromise;
 function kind(file){
  var name=String(file&&file.name||'').toLowerCase(),type=String(file&&file.type||'');
  if(/\.pdf$/.test(name)||type==='application/pdf')return 'pdf';
  if(/\.docx$/.test(name)||type==='application/vnd.openxmlformats-officedocument.wordprocessingml.document')return 'docx';
  if(/\.(png|jpe?g|webp)$/.test(name)||/^(image\/(png|jpeg|webp))$/.test(type))return 'image';
  return '';
 }
 function validate(file){
  if(!file||!kind(file))return 'Usa JPG, PNG, WEBP, PDF o Word (.docx).';
  if(!file.size||file.size>MAX_BYTES)return 'El archivo debe tener contenido y pesar como máximo 20 MB.';
  return '';
 }
 function fail(message){return {ok:false,rawText:'',error:{code:'DOCUMENT_READ_FAILED',message:String(message)}};}
 function progress(options,page,total){if(options.logger)options.logger({progress:page/total,status:'Página '+page+' de '+total});}
 function loadWord(){
  if(!wordPromise)wordPromise=new Promise(function(resolve,reject){
   var script=document.createElement('script');script.src='js/ocr/vendor/mammoth-1.13.0/mammoth.browser.min.js';
   script.onload=function(){resolve(root.mammoth);};script.onerror=function(){script.remove();wordPromise=null;reject(new Error('No se pudo cargar el lector Word. Conéctate para la primera lectura.'));};document.head.appendChild(script);
  });return wordPromise;
 }
 function loadPdf(){
  if(!pdfPromise)pdfPromise=import('./vendor/pdfjs-6.4.299/pdf.min.mjs').then(function(lib){lib.GlobalWorkerOptions.workerSrc=new URL('js/ocr/vendor/pdfjs-6.4.299/pdf.worker.min.mjs',document.baseURI).href;return lib;}).catch(function(error){pdfPromise=null;throw error;});return pdfPromise;
 }
 // Bound declared expanded ZIP sizes before Mammoth allocates decompression buffers.
 function validateDocx(bytes){
  var view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=-1;
  for(var i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
  if(end<0)throw new Error('El documento Word no es un DOCX válido.');
  var count=view.getUint16(end+10,true),offset=view.getUint32(end+16,true),expanded=0,found=false;
  if(count>2000)throw new Error('El documento Word es demasiado complejo.');
  for(var n=0;n<count;n++){
   if(offset+46>bytes.length||view.getUint32(offset,true)!==0x02014b50)throw new Error('El archivo DOCX está dañado.');
   if(view.getUint16(offset+8,true)&1)throw new Error('Los documentos protegidos no se pueden leer.');
   expanded+=view.getUint32(offset+24,true);
   if(expanded>MAX_ZIP)throw new Error('El documento Word descomprimido supera el límite.');
   var length=view.getUint16(offset+28,true),name=new TextDecoder().decode(bytes.subarray(offset+46,offset+46+length));
   if(name==='word/document.xml')found=true;
   offset+=46+length+view.getUint16(offset+30,true)+view.getUint16(offset+32,true);
  }
  if(!found)throw new Error('El archivo no contiene un documento Word.');
 }
 function pageText(items){
  var lines=[],line=[],y=null;
  items.forEach(function(item){if(typeof item.str!=='string')return;var next=item.transform&&item.transform[5];
   if(line.length&&y!==null&&typeof next==='number'&&Math.abs(next-y)>3){lines.push(line.join(' '));line=[];}
   line.push(item.str);y=next;
   if(item.hasEOL){lines.push(line.join(' '));line=[];y=null;}
  });if(line.length)lines.push(line.join(' '));return lines.join('\n');
 }
 async function prepareImage(file){
  var bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
  try{
   if(bitmap.width*bitmap.height>50000000)throw new Error('La imagen es demasiado grande. Recórtala antes de subirla.');
   var scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
   var canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
   var ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
   var pixels=ctx.getImageData(0,0,canvas.width,canvas.height),data=pixels.data;
   for(var i=0;i<data.length;i+=4){var gray=.299*data[i]+.587*data[i+1]+.114*data[i+2];gray=Math.max(0,Math.min(255,(gray-128)*1.15+128));data[i]=data[i+1]=data[i+2]=gray;}
   ctx.putImageData(pixels,0,0);return await new Promise(function(resolve,reject){canvas.toBlob(function(blob){blob?resolve(blob):reject(new Error('No se pudo preparar la imagen.'));},'image/png');});
  }finally{bitmap.close();}
 }
 async function extract(file,options){
  var settings=options||{},error=validate(file);if(error)return fail(error);
  var pdf=null,task=null;
  try{
   var type=kind(file),result;
   if(type==='image'){
    var prepared=await prepareImage(file);result=await root.extractOcrText(prepared,settings);return result;
   }
   var bytes=new Uint8Array(await file.arrayBuffer());
   if(type==='docx'){
    validateDocx(bytes);var word=await loadWord();result=await word.convertToHtml({arrayBuffer:bytes.buffer},{externalFileAccess:false,convertImage:word.images.imgElement(function(){return Promise.resolve({src:''});})});
    // Parse only in an inert document and return text, never inject converted HTML.
    var inert=new DOMParser().parseFromString(result.value,'text/html'),lines=[];
    function collect(node){
     if(node.tagName==='TABLE'){Array.from(node.querySelectorAll('tr')).forEach(function(row){lines.push(Array.from(row.children).map(function(cell){return cell.textContent.replace(/\s+/g,' ').trim();}).join(' '));});return;}
     if(/^(P|H[1-6]|LI)$/.test(node.tagName)){lines.push(node.textContent);return;}
     Array.from(node.children||[]).forEach(collect);
    }collect(inert.body);result.value=lines.join('\n');
    if(!result.value.trim())throw new Error('El Word no contiene texto legible. Si solo contiene fotos, súbelas como imágenes o PDF.');
    if(result.value.length>MAX_TEXT)throw new Error('El documento contiene demasiado texto. Divídelo en archivos más pequeños.');
    return {ok:true,rawText:result.value,metadata:{source:'docx',confidence:null},error:null};
   }
   if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('El archivo no es un PDF válido.');
   var lib=await loadPdf();task=lib.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useWasm:false,standardFontDataUrl:new URL('js/ocr/vendor/pdfjs-6.4.299/standard_fonts/',document.baseURI).href});
   pdf=await task.promise;if(pdf.numPages>MAX_PAGES)throw new Error('El PDF supera 30 páginas. Divídelo en archivos más pequeños.');
   var texts=[],confidences=[];
   for(var pageNo=1;pageNo<=pdf.numPages;pageNo++){
    progress(settings,pageNo-1,pdf.numPages);var page=await pdf.getPage(pageNo);
    var content=await page.getTextContent(),text=pageText(content.items);
    // A sparse text overlay (e.g. page number) must not hide a scanned purchase.
    var operators=await page.getOperatorList();
    var images=operators.fnArray.some(function(op){return op===lib.OPS.paintImageXObject||op===lib.OPS.paintInlineImageXObject||op===lib.OPS.paintImageXObjectRepeat||op===lib.OPS.paintImageMaskXObject;});
    if(images||text.trim().length<30){
     var base=page.getViewport({scale:1}),scale=Math.min(2.5,2400/Math.max(base.width,base.height));
     var viewport=page.getViewport({scale:scale}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
     await page.render({canvasContext:canvas.getContext('2d'),viewport:viewport}).promise;
     var blob=await new Promise(function(resolve){canvas.toBlob(resolve,'image/png');});
     var read=await root.extractOcrText(blob,{logger:function(info){if(settings.logger)settings.logger({progress:(pageNo-1+(info.progress||0))/pdf.numPages,status:'Página '+pageNo+' de '+pdf.numPages});}});
     canvas.width=canvas.height=0;if(!read.ok)throw new Error('Página '+pageNo+': '+read.error.message);
     text=read.rawText;confidences.push(read.metadata.confidence);
    }
    texts.push(text);page.cleanup();if(texts.join('\n').length>MAX_TEXT)throw new Error('El PDF contiene demasiado texto.');
   }
   progress(settings,pdf.numPages,pdf.numPages);
   return {ok:true,rawText:texts.join('\n'),metadata:{source:'pdf',pages:pdf.numPages,confidence:confidences.length?Math.min.apply(Math,confidences):null},error:null};
  }catch(error){return fail(error&&error.name==='PasswordException'?'El PDF está protegido con contraseña. Sube una copia sin contraseña.':error.message||error);}
  finally{if(task)try{await task.destroy();}catch(ignored){/* Preserve the extraction result. */}}
 }
 root._NA_OCR_DOCUMENT={kind:kind,validate:validate,extract:extract};root.extractPurchaseDocument=extract;
})(typeof window!=='undefined'?window:globalThis);
