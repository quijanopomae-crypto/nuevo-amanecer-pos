
// Seguridad: solamente se aceptan imágenes rasterizadas y la vista previa usa nodos DOM.
function _naSafeProductImageSource(value){
  const source=typeof value==='string'?value.trim():'';
  return /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(source)?source:null;
}
function _naSafeSetProductPreview(source,altText){
  const preview=document.getElementById('imgPreview');
  if(!preview)return;
  preview.replaceChildren();
  const safeSource=_naSafeProductImageSource(source);
  if(safeSource){
    const image=document.createElement('img');
    image.src=safeSource;
    image.alt=String(altText||'Vista previa del producto');
    image.style.cssText='width:100%;height:100%;object-fit:cover;border-radius:8px';
    preview.appendChild(image);
  }else preview.textContent=document.getElementById('pIcon')?.value||'📦';
  const remove=document.getElementById('pRemoveImageBtn');
  if(remove)remove.hidden=!safeSource;
}
_naF12RenderVisual=function(){
  const source=_naSafeProductImageSource(imagenProducto);
  if(!source&&imagenProducto)imagenProducto=null;
  _naSafeSetProductPreview(source,document.getElementById('pNombre')?.value||'Vista previa del producto');
};
previewImagen=function(){
  _naF12SetMode('image');
  const input=document.getElementById('pImagen'),file=input?.files?.[0];
  if(!file)return;
  const allowedTypes=new Set(['image/jpeg','image/png','image/webp','image/gif']);
  if(!allowedTypes.has(file.type)){
    toast('Selecciona una imagen JPG, PNG, WebP o GIF','error');
    input.value='';
    return;
  }
  if(file.size>12_000_000){
    toast('La imagen supera 12 MB','error');
    input.value='';
    return;
  }
  const reader=new FileReader();
  reader.onerror=()=>{input.value='';toast('No se pudo leer la imagen','error');};
  reader.onload=event=>{
    const decoded=new Image();
    decoded.onerror=()=>{input.value='';toast('No se pudo leer la imagen','error');};
    decoded.onload=()=>{
      let max=480,quality=.72,data='';
      for(let attempt=0;attempt<5;attempt++){
        const scale=Math.min(1,max/Math.max(decoded.width,decoded.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(decoded.width*scale));
        canvas.height=Math.max(1,Math.round(decoded.height*scale));
        const context=canvas.getContext('2d');
        if(!context){toast('El navegador no pudo procesar la imagen','error');return;}
        context.drawImage(decoded,0,0,canvas.width,canvas.height);
        data=canvas.toDataURL('image/jpeg',quality);
        if(data.length<120000)break;
        max=Math.round(max*.82);
        quality=Math.max(.48,quality-.08);
      }
      if(!_naSafeProductImageSource(data)||data.length>=180000){
        toast('La imagen sigue siendo demasiado pesada; usa una foto más pequeña','error');
        input.value='';
        return;
      }
      imagenProducto=data;
      _naSafeSetProductPreview(imagenProducto,document.getElementById('pNombre')?.value||'Vista previa del producto');
      toast('Imagen optimizada para el almacenamiento','success');
    };
    decoded.src=String(event.target?.result||'');
  };
  reader.readAsDataURL(file);
};
