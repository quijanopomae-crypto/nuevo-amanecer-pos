/* Mobile presentation only: reuse the existing controls and business handlers. */
(function(){
  'use strict';
  const page=document.getElementById('pageInventario');if(!page)return;
  const media=matchMedia('(max-width:767px)'),moves=[];
  function relocate(node,target){if(!node)return;const marker=document.createComment('inventory original position');node.before(marker);moves.push([node,marker]);target.append(node);}
  function panel(label,kind){const details=document.createElement('details');details.className='inv-mobile-panel '+kind;const summary=document.createElement('summary');summary.textContent=label;details.append(summary);return details;}
  function decorate(){
    if(!media.matches)return;
    page.querySelectorAll('#invBody tr').forEach(row=>{
      if(row.dataset.mobileInventory||row.children.length!==6)return;
      row.dataset.mobileInventory='1';
      const cells=row.children,actions=cells[5].querySelector('.act-btns');if(!actions)return;
      const menu=panel('⋮','inv-product-menu');menu.querySelector('summary').setAttribute('aria-label','Acciones y detalles de '+(row.querySelector('.prod-name-sm')?.textContent||'producto'));
      const content=document.createElement('div');content.className='inv-menu-content';
      [row.querySelector('.prod-sku-sm'),cells[1].firstElementChild,cells[2].children[1],cells[3].firstElementChild].filter(Boolean).forEach(node=>{const line=document.createElement('div');line.textContent=node.textContent;content.append(line);});
      for(const button of actions.querySelectorAll('button')){button.dataset.inventoryOriginalText=button.textContent;button.textContent=button.classList.contains('btn-ent')?'Entrada de stock':button.classList.contains('btn-sal')?'Salida de stock':button.classList.contains('btn-edt')?'Editar producto':'Sin control de stock';}
      actions.before(menu);content.append(actions);menu.append(content);
      const name=row.querySelector('.prod-name-sm');if(name){name.tabIndex=0;name.setAttribute('role','button');name.setAttribute('aria-label','Ver detalles de '+name.textContent);name.onclick=event=>{event.stopPropagation();menu.open=!menu.open;};name.onkeydown=event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();menu.open=!menu.open;}};}
    });
    const count=page.querySelector('.inv-mobile-count');if(count)count.textContent=(document.getElementById('invB0')?.textContent||'0')+' productos';
  }
  function enable(){
    if(page.classList.contains('inv-mobile-simple'))return;
    page.classList.add('inv-mobile-simple');
    const top=page.querySelector('.top-mod-bar'),chrome=page.querySelector('.page-chrome'),bar=page.querySelector('.filter-bar');
    const tools=panel('⋮','inv-tools');tools.querySelector('summary').setAttribute('aria-label','Herramientas y resumen del inventario');const content=document.createElement('div');content.className='inv-menu-content';tools.append(content);top.append(tools);
    const buttons=page.querySelector('.ocr-purchase-actions');relocate(buttons,content);
    const add=buttons.querySelector('button:last-child');relocate(add,top);add.dataset.inventoryOriginalText=add.textContent;add.textContent='+';add.setAttribute('aria-label','Nuevo producto');add.classList.add('inv-mobile-add');
    relocate(page.querySelector('.ocr-purchase-status'),content);
    const stats=panel('Resumen del inventario','inv-summary');content.append(stats);relocate(page.querySelector('.stats-strip'),stats);
    const filters=panel('Filtrar','inv-filters');const filterContent=document.createElement('div');filterContent.className='inv-menu-content';filters.append(filterContent);bar.append(filters);relocate(page.querySelector('.tabs-wrap'),filterContent);relocate(document.getElementById('invCat'),filterContent);
    const count=document.createElement('div');count.className='inv-mobile-count';chrome.append(count);decorate();
  }
  function disable(){
    page.classList.remove('inv-mobile-simple');
    page.querySelectorAll('.inv-product-menu').forEach(menu=>{const actions=menu.querySelector('.act-btns');menu.before(actions);menu.remove();});
    page.querySelectorAll('[data-inventory-original-text]').forEach(button=>{button.textContent=button.dataset.inventoryOriginalText;delete button.dataset.inventoryOriginalText;button.classList.remove('inv-mobile-add');});
    page.querySelectorAll('#invBody tr').forEach(row=>{delete row.dataset.mobileInventory;const name=row.querySelector('.prod-name-sm');if(name){name.removeAttribute('tabindex');name.removeAttribute('role');name.removeAttribute('aria-label');name.onclick=null;name.onkeydown=null;}});
    while(moves.length){const [node,marker]=moves.pop();marker.replaceWith(node);}
    page.querySelectorAll('.inv-tools,.inv-filters,.inv-mobile-count').forEach(node=>node.remove());
  }
  function sync(){if(media.matches)enable();else disable();}
  page.addEventListener('toggle',event=>{if(!event.target.open||!event.target.matches('.inv-mobile-panel'))return;page.querySelectorAll('.inv-tools[open],.inv-filters[open],.inv-product-menu[open]').forEach(other=>{if(other!==event.target&&!other.contains(event.target))other.open=false;});},true);
  page.addEventListener('click',event=>{if(event.target.closest('.tab,.btn-act,.inv-tools button'))page.querySelectorAll('.inv-tools,.inv-filters,.inv-product-menu').forEach(menu=>menu.open=false);});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')page.querySelectorAll('details[open]').forEach(menu=>menu.open=false);});
  document.addEventListener('click',event=>{page.querySelectorAll('.inv-tools[open],.inv-filters[open],.inv-product-menu[open]').forEach(menu=>{if(!menu.contains(event.target))menu.open=false;});});
  new MutationObserver(decorate).observe(document.getElementById('invBody'),{childList:true});
  new MutationObserver(()=>{const count=page.querySelector('.inv-mobile-count');if(count)count.textContent=document.getElementById('invB0').textContent+' productos';}).observe(document.getElementById('invB0'),{childList:true});
  media.addEventListener('change',sync);sync();
})();
